from datetime import UTC, datetime, timedelta
from decimal import Decimal

from freezegun import freeze_time

from app.models import HubIssue, Ticket, User
from app.services.metrics.analytics import compute_ticket_analytics


def _tk(db, **kw):
    n = db.query(Ticket).count() + 1
    defaults = {
        "short_code": f"TKT-{n:06d}",
        "source_code": "ksm",
        "source_ticket_id": f"S{n}",
        "type": "Raw",
        "status": "done",
        "received_at": datetime(2026, 4, 1, tzinfo=UTC),
    }
    defaults.update(kw)
    t = Ticket(**defaults)
    db.add(t)
    db.flush()
    return t


def test_kpi_counts_by_type_and_sla(db_session):
    _tk(
        db_session,
        predicted_type="Bug_fix",
        handle_hours=Decimal("6"),
        sla_standard_hours=Decimal("8"),
    )
    _tk(
        db_session,
        predicted_type="Operation",
        handle_hours=Decimal("50"),
        sla_standard_hours=Decimal("40"),
    )
    db_session.commit()
    r = compute_ticket_analytics(db_session)
    assert r.kpi.total == 2
    assert r.kpi.by_type["Bug_fix"] == 1
    assert r.kpi.by_type["Operation"] == 1
    # 1 达标(6<=8), 1 超期(50>40) → sla_rate=0.5, 分母 sla_base=2
    assert abs(r.kpi.sla_rate - 0.5) < 1e-6
    assert r.kpi.sla_base == 2
    # 两条都未设 assigned_user_id → 未分配数=2
    assert r.kpi.unassigned_count == 2
    assert r.kpi.unassigned_avg_hours is not None


def test_by_module_and_assignee(db_session):
    _tk(
        db_session,
        module="开票管理",
        predicted_type="Bug_fix",
        assigned_user_id=None,
        handle_hours=Decimal("4"),
    )
    _tk(
        db_session,
        module="开票管理",
        predicted_type="Operation",
        handle_hours=Decimal("10"),
    )
    db_session.commit()
    r = compute_ticket_analytics(db_session)
    m = next(x for x in r.by_module if x["module"] == "开票管理")
    assert m["total"] == 2


def test_by_module_overdue_count(db_session):
    # 只统计仍待处理且接收超过40小时的Bug；已完成不算超期。
    _tk(
        db_session,
        module="收票管理",
        predicted_type="Bug_fix",
        handle_hours=Decimal("50"),
        sla_standard_hours=Decimal("40"),
        status="processing",
    )
    _tk(
        db_session,
        module="收票管理",
        predicted_type="Bug_fix",
        handle_hours=Decimal("6"),
        sla_standard_hours=Decimal("8"),
    )
    db_session.commit()
    r = compute_ticket_analytics(db_session)
    m = next(x for x in r.by_module if x["module"] == "收票管理")
    assert m["total"] == 2
    assert m["overdue_count"] == 1


@freeze_time("2026-09-14 04:00:00")
def test_pending_and_overdue_thresholds(db_session):
    now = datetime(2026, 9, 14, 4, tzinfo=UTC)
    for kind, status, hours in [
        ("Operation", "processing", 24),
        ("Operation", "exception", 25),
        ("Bug_fix", "supplementing", 40),
        ("Demand", "exception", 41),
        ("Operation", "answered", 80),
        ("Bug_fix", "closed", 80),
        ("Demand", "transferred_return", 80),
        ("Internal_task", "processing", 80),
        ("Operation", "received", 80),
    ]:
        _tk(
            db_session, predicted_type=kind, status=status, received_at=now - timedelta(hours=hours)
        )
    db_session.commit()
    result = compute_ticket_analytics(db_session)
    assert result.kpi.pending_count == 4
    assert result.kpi.pending_operation_count == 2
    assert result.kpi.pending_dev_count == 1
    assert result.kpi.completed_count == 1
    assert result.kpi.returned_count == 2
    assert result.kpi.overdue_count == 2
    assert result.kpi.overdue_operation_count == 1
    assert result.kpi.overdue_dev_count == 1


def test_trend_by_month(db_session):
    _tk(db_session, received_at=datetime(2026, 4, 15, tzinfo=UTC), handle_hours=Decimal("10"))
    _tk(db_session, received_at=datetime(2026, 5, 15, tzinfo=UTC), handle_hours=Decimal("20"))
    db_session.commit()
    r = compute_ticket_analytics(db_session)
    months = {x["month"] for x in r.trend}
    assert "2026-04" in months and "2026-05" in months
    # available_months 降序，含全部有工单的月份
    assert r.available_months == ["2026-05", "2026-04"]


def test_by_dev_staff_uses_hub_owner_for_bug_and_demand(db_session):
    db_session.add_all(
        [
            User(id=1, feishu_uid="ou_a", name="研发甲", role="assignee"),
            User(id=2, feishu_uid="ou_b", name="研发乙", role="assignee"),
            HubIssue(id=101, short_code="HUB-000101", type="Bug_fix", title="bug", status="created", owner_user_id=1, ticket_id=1001),
            HubIssue(id=102, short_code="HUB-000102", type="Demand", title="demand", status="created", owner_user_id=2, ticket_id=1002),
        ]
    )
    # assigned_user_id 是受理处理人；看板必须按 hub.owner_user_id（研发责任人）统计。
    _tk(db_session, predicted_type="Bug_fix", assigned_user_id=2, hub_issue_id=101)
    _tk(db_session, predicted_type="Bug_fix", assigned_user_id=2, hub_issue_id=101)
    _tk(db_session, predicted_type="Demand", assigned_user_id=1, hub_issue_id=102)
    _tk(db_session, predicted_type="Internal_task", assigned_user_id=1)
    db_session.commit()

    r = compute_ticket_analytics(db_session)
    a = next(x for x in r.by_dev_staff if x["user_id"] == 1)
    b = next(x for x in r.by_dev_staff if x["user_id"] == 2)
    assert a["total"] == 2
    assert a["by_type"]["Bug_fix"] == 2
    assert b["total"] == 1
    assert b["by_type"]["Demand"] == 1
    assert "Internal_task" not in a["by_type"]


def test_by_dev_staff_keeps_all_named_owners(db_session):
    db_session.add_all(
        [
            User(id=3, feishu_uid="ou_cs", name="刘伟成", role="member"),
            HubIssue(id=103, short_code="HUB-000103", type="Bug_fix", title="bug", status="created", owner_user_id=3, ticket_id=1003),
        ]
    )
    _tk(db_session, predicted_type="Bug_fix", assigned_user_id=None, hub_issue_id=103)
    db_session.commit()

    r = compute_ticket_analytics(db_session)
    assert {x["name"] for x in r.by_dev_staff} == {"刘伟成"}
