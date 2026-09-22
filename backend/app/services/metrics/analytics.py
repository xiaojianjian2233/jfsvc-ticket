"""工单维度统计看板聚合（领导层研发管理）。

只用系统原生字段（tickets 列 + handle_hours/sla_standard_hours 回填列），
新旧工单口径一致。实时多维聚合 SQL，非物化。received_at 按北京时区切月。
SLA 达成 = handle_hours <= sla_standard_hours；耗时统计只计 handle_hours 非空。

月度切月表达式按 dialect 分支：PG 用 `timezone()` 真正转到北京时区再切月；
SQLite（单测用）没有 `timezone`/`percentile_cont` 函数，退化为直接对
UTC `received_at` 做 `strftime`——单测夹具的时间点都落在月中，不触及
UTC/北京月份边界，因此两种路径在测试断言上等价。中位数/P90 改为在 Python
侧用与 PostgreSQL `percentile_cont`（线性插值）等价的算法计算，两库结果一致，
不依赖数据库端的 percentile 函数,也不需要牺牲 PG 正确性。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import HubIssue, Ticket, User

_TYPES = ("Operation", "Bug_fix", "Demand", "Internal_task")
_DEV_TYPES = ("Bug_fix", "Demand")
_HIST_BUCKETS = [(0, 4), (4, 8), (8, 24), (24, 72), (72, None)]


@dataclass(slots=True, frozen=True)
class KpiBlock:
    total: int
    by_type: dict[str, int]
    avg_handle_hours: float | None
    sla_rate: float | None
    sla_base: int  # SLA 达成率的分母（handle+std 都非空的工单数），供前端标注口径
    unassigned_count: int  # 未分配处理人的工单数
    unassigned_avg_hours: float | None  # 未分配工单的平均处理时长
    pending_count: int = 0
    completed_count: int = 0
    pending_operation_count: int = 0
    pending_dev_count: int = 0
    overdue_count: int = 0
    overdue_operation_count: int = 0
    overdue_dev_count: int = 0
    returned_count: int = 0


@dataclass(slots=True)
class TicketAnalytics:
    kpi: KpiBlock
    by_module: list[dict[str, Any]] = field(default_factory=list)
    by_assignee: list[dict[str, Any]] = field(default_factory=list)
    trend: list[dict[str, Any]] = field(default_factory=list)
    handle_hours_hist: list[dict[str, Any]] = field(default_factory=list)
    available_months: list[str] = field(default_factory=list)  # 全量数据里有工单的月份(降序)
    by_dev_staff: list[dict[str, Any]] = field(default_factory=list)


def _base_filter(
    start: datetime | None, end: datetime | None, product_line: str | None
) -> ColumnElement[bool]:
    conds: list[ColumnElement[bool]] = [Ticket.deleted_at.is_(None)]
    if start is not None:
        conds.append(Ticket.received_at >= start)
    if end is not None:
        conds.append(Ticket.received_at < end)
    if product_line:
        conds.append(Ticket.product_line_code == product_line)
    return and_(*conds)


def _month_expr(db: Session) -> ColumnElement[str]:
    """按北京时区切月的月份表达式；SQLite 单测环境退化为直接 strftime。"""
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        return func.strftime("%Y-%m", Ticket.received_at)
    # BEIJING（app.services.sla.workday）是固定 UTC+8 offset，非 IANA zone，无
    # .key 可取；中国无 DST，"Asia/Shanghai" 与之等价，直接传给 PG timezone()。
    return func.to_char(func.timezone("Asia/Shanghai", Ticket.received_at), "YYYY-MM")


def _percentile(sorted_values: list[float], p: float) -> float | None:
    """PostgreSQL `percentile_cont` 等价的线性插值算法（跨库一致）。"""
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = p * (len(sorted_values) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(sorted_values) - 1)
    frac = rank - lo
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * frac


def compute_ticket_analytics(
    db: Session,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    product_line: str | None = None,
) -> TicketAnalytics:
    flt = _base_filter(start, end, product_line)
    # 处理进展的统一口径：待处理、已完成、退回三类互不重叠。
    pending = Ticket.status.in_(("processing", "exception"))
    completed = Ticket.status == "answered"
    returned = Ticket.status.in_(("supplementing", "transferred_return"))
    now = datetime.now(UTC)
    overdue = and_(
        pending,
        or_(
            and_(
                Ticket.predicted_type == "Operation", Ticket.received_at < now - timedelta(hours=24)
            ),
            and_(
                Ticket.predicted_type.in_(("Bug_fix", "Demand")),
                Ticket.received_at < now - timedelta(hours=40),
            ),
        ),
    )
    def count_matching(condition: ColumnElement[bool]) -> int:
        return db.scalar(select(func.count(Ticket.id)).where(flt, condition)) or 0

    total = db.execute(select(func.count()).select_from(Ticket).where(flt)).scalar() or 0

    type_rows = db.execute(
        select(Ticket.predicted_type, func.count()).where(flt).group_by(Ticket.predicted_type)
    ).all()
    by_type = dict.fromkeys(_TYPES, 0)
    for t, c in type_rows:
        if t in by_type:
            by_type[t] = c

    avg_hh = db.execute(
        select(func.avg(Ticket.handle_hours)).where(and_(flt, Ticket.handle_hours.is_not(None)))
    ).scalar()
    avg_handle_hours = float(avg_hh) if avg_hh is not None else None

    # SLA 达成率：handle_hours 与 sla_standard_hours 都非空的工单里，handle<=std 占比
    sla_base = (
        db.execute(
            select(func.count())
            .select_from(Ticket)
            .where(
                and_(flt, Ticket.handle_hours.is_not(None), Ticket.sla_standard_hours.is_not(None))
            )
        ).scalar()
        or 0
    )
    sla_ok = (
        db.execute(
            select(func.count())
            .select_from(Ticket)
            .where(
                and_(
                    flt,
                    Ticket.handle_hours.is_not(None),
                    Ticket.sla_standard_hours.is_not(None),
                    Ticket.handle_hours <= Ticket.sla_standard_hours,
                )
            )
        ).scalar()
        or 0
    )
    sla_rate = (sla_ok / sla_base) if sla_base else None

    # 未分配工单（无处理人）——研发管理关注的"无人跟进"信号
    unassigned_count = (
        db.execute(
            select(func.count())
            .select_from(Ticket)
            .where(and_(flt, Ticket.assigned_user_id.is_(None)))
        ).scalar()
        or 0
    )
    unassigned_avg = db.execute(
        select(func.avg(Ticket.handle_hours)).where(
            and_(flt, Ticket.assigned_user_id.is_(None), Ticket.handle_hours.is_not(None))
        )
    ).scalar()
    unassigned_avg_hours = float(unassigned_avg) if unassigned_avg is not None else None

    kpi = KpiBlock(
        total=total,
        by_type=by_type,
        avg_handle_hours=avg_handle_hours,
        sla_rate=sla_rate,
        sla_base=sla_base,
        unassigned_count=unassigned_count,
        unassigned_avg_hours=unassigned_avg_hours,
        pending_count=count_matching(pending),
        completed_count=count_matching(completed),
        pending_operation_count=count_matching(and_(pending, Ticket.predicted_type == "Operation")),
        pending_dev_count=count_matching(
            and_(pending, Ticket.predicted_type.in_(("Bug_fix", "Demand")))
        ),
        overdue_count=count_matching(overdue),
        overdue_operation_count=count_matching(
            and_(overdue, Ticket.predicted_type == "Operation")
        ),
        overdue_dev_count=count_matching(
            and_(overdue, Ticket.predicted_type.in_(_DEV_TYPES))
        ),
        returned_count=count_matching(returned),
    )

    # 模块 × 类型（这批工单产品线单一=金蝶发票云，无区分度；module 才是有意义的细分维度）
    mod_rows = db.execute(
        select(Ticket.module, Ticket.predicted_type, func.count())
        .where(flt)
        .group_by(Ticket.module, Ticket.predicted_type)
    ).all()
    mod_map: dict[str, dict[str, Any]] = {}
    for mod, ptype, c in mod_rows:
        key = mod or "(未分类)"
        d = mod_map.setdefault(
            key,
            {
                "module": key,
                "total": 0,
                "overdue_count": 0,
                "by_type": dict.fromkeys(_TYPES, 0),
            },
        )
        d["total"] += c
        if ptype in d["by_type"]:
            d["by_type"][ptype] += c
    # 各模块超期数（口径同 sla_rate：两列非空且 handle > std）
    overdue_rows = db.execute(
        select(Ticket.module, func.count())
        .where(
            and_(
                flt,
                overdue,
            )
        )
        .group_by(Ticket.module)
    ).all()
    for mod, c in overdue_rows:
        key = mod or "(未分类)"
        if key in mod_map:
            mod_map[key]["overdue_count"] = c
    by_module = sorted(mod_map.values(), key=lambda x: x["total"], reverse=True)[:10]

    # 待处理工单按处理人聚合（仅处理中、处理异常）。
    as_rows = db.execute(
        select(Ticket.assigned_user_id, User.name, func.count())
        .join(User, User.id == Ticket.assigned_user_id, isouter=True)
        .where(flt, pending)
        .group_by(Ticket.assigned_user_id, User.name)
    ).all()
    by_assignee = sorted(
        [
            {"user_id": uid, "name": name or "(未分配)", "total": c}
            for uid, name, c in as_rows
        ],
        key=lambda x: x["total"],
        reverse=True,
    )[:15]

    # 月度趋势（北京时区切月；中位数/P90 在 Python 侧算，跨库一致，见模块 docstring）
    month_expr = _month_expr(db)
    tr_rows = db.execute(
        select(month_expr.label("m"), Ticket.handle_hours).where(flt).order_by(month_expr)
    ).all()
    month_hours: dict[str, list[float]] = {}
    month_counts: dict[str, int] = {}
    for m, hh in tr_rows:
        month_counts[m] = month_counts.get(m, 0) + 1
        if hh is not None:
            month_hours.setdefault(m, []).append(float(hh))
    trend = []
    for m in sorted(month_counts):
        values = sorted(month_hours.get(m, []))
        trend.append(
            {
                "month": m,
                "total": month_counts[m],
                "median_handle_hours": _percentile(values, 0.5),
                "p90_handle_hours": _percentile(values, 0.9),
            }
        )

    # 耗时区间直方图
    hist = []
    for lo, hi in _HIST_BUCKETS:
        cond = [flt, Ticket.handle_hours.is_not(None), Ticket.handle_hours >= lo]
        if hi is not None:
            cond.append(Ticket.handle_hours < hi)
        c = db.execute(select(func.count()).select_from(Ticket).where(and_(*cond))).scalar() or 0
        label = f"{lo}-{hi}h" if hi is not None else f"{lo}h+"
        hist.append({"bucket": label, "count": c})

    # 可选月份列表（全量数据里有工单的月份，降序）——供前端月份筛选下拉，
    # 独立于 start/end（否则选中某月后其它月份就从下拉里消失了）
    month_expr = _month_expr(db)
    month_rows = db.execute(select(month_expr).where(Ticket.deleted_at.is_(None)).distinct()).all()
    available_months = sorted((m for (m,) in month_rows if m), reverse=True)

    # 研发责任人维度：只统计 Bug/需求，并按 hub.owner_user_id（研发责任人）聚合。
    # owner_user_id 为空的历史数据归为“未指定研发责任人”，便于补齐数据。
    dev_flt = and_(flt, Ticket.predicted_type.in_(_DEV_TYPES))
    dev_rows = db.execute(
        select(HubIssue.owner_user_id, User.name, Ticket.predicted_type, func.count())
        .join(HubIssue, HubIssue.id == Ticket.hub_issue_id, isouter=True)
        .join(User, User.id == HubIssue.owner_user_id, isouter=True)
        .where(dev_flt)
        .group_by(HubIssue.owner_user_id, User.name, Ticket.predicted_type)
    ).all()
    dev_map: dict[Any, dict[str, Any]] = {}
    for uid, name, ptype, c in dev_rows:
        d = dev_map.setdefault(
            uid,
            {
                "user_id": uid,
                "name": name or "(未指定研发责任人)",
                "total": 0,
                "by_type": dict.fromkeys(_DEV_TYPES, 0),
            },
        )
        d["total"] += c
        if ptype in d["by_type"]:
            d["by_type"][ptype] += c
    by_dev_staff = sorted(dev_map.values(), key=lambda x: x["total"], reverse=True)[:20]


    return TicketAnalytics(
        kpi=kpi,
        by_module=by_module,
        by_assignee=by_assignee,
        trend=trend,
        handle_hours_hist=hist,
        available_months=available_months,
        by_dev_staff=by_dev_staff,
    )
