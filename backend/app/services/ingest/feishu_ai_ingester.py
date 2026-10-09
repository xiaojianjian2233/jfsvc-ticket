"""FeishuAiIngester — 飞书AI 工单入库（复用 ai_cs 载荷契约，走标准 triage 链）.

与 EscalationIngester 的关系：**请求参数形状完全一致**（直接复用
`parse_escalation_payload`），差别只在入库后链路——本来源的工单由 webhook 挂
`run_post_ingest_agents`（triage：classify + 混合单拆分 + 标准毕业门槛），
而非 escalation 的 `run_escalation_agents`（黄金三元组二次分类）。

因此三元组（ai_answer / dissatisfaction）在这里只是**存档**（写进
source_payload['ai_cs'] 供审计/回查），triage 下游用 ticket.body 分类，不读它。
去重域：(source='feishu_ai', source_ticket_id=session_id)。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models import (
    AssignmentScopeModule,
    Attachment,
    HubIssue,
    Module,
    ProductLine,
    Ticket,
    TicketHubIssueHistory,
    User,
)
from app.repositories.status_history import StatusHistoryRepository
from app.repositories.ticket import TicketRepository
from app.services.hub_issues.module_owner import list_module_owners, peek_module_owner
from app.services.identity.resolver import IdentityInput, IdentityResolver

# 复用 ai_cs 的载荷解析层（参数形状完全一致）。IngestError 显式 re-export，
# 供 webhook 层 catch（与 escalation_ingester.IngestError 是同一个异常类）。
from app.services.ingest.escalation_ingester import IngestError as IngestError
from app.services.ingest.escalation_ingester import parse_escalation_payload

logger = get_logger(__name__)

_SOURCE = "feishu_ai"
_TITLE_MAX = 120


def normalize_feishu_predicted_type(raw_type: Any) -> str | None:
    """将飞书工单传入的类型映射为系统标准 predicted_type：
    - 需求 / Demand / demand / feature -> Demand（需求）
    - bug / Bug / Bug_fix / Bug 修复 / 缺陷 -> Bug_fix（Bug 修复）
    """
    if raw_type is None:
        return None
    s = str(raw_type).strip()
    if not s:
        return None
    low = s.lower()
    if s in ("需求", "产品需求", "功能需求") or low in ("demand", "feature", "requirement"):
        return "Demand"
    if (
        s in ("Bug 修复", "Bug修复", "缺陷", "故障")
        or low in ("bug", "bug_fix", "bugfix", "defect")
        or "bug" in low
    ):
        return "Bug_fix"
    if s in ("应用", "运营", "操作指导", "咨询") or low == "operation":
        return "Operation"
    if s in ("内部任务",) or low == "internal_task":
        return "Internal_task"
    if s in ("投诉",) or low == "complaint":
        return "Complaint"
    return None


def resolve_feishu_product_and_module(
    db: Session,
    raw_product: str | None,
    raw_module: str | None,
) -> tuple[str | None, str | None, str | None]:
    """解析飞书工单的提单产品与提单模块，使 产品分类=提单产品、问题模块=提单模块。

    返回 (product_line_code, product_name, module)。
    若提单产品尚不在 product_lines 表中，自动写入一条 ProductLine(code=raw_product, name=raw_product)，
    满足外键约束并保证列表/详情展示的「产品分类」(product_line_name) == 「提单产品」(product_name)。
    """
    prod = (raw_product or "").strip() or None
    mod = (raw_module or "").strip() or None
    eff_plc: str | None = None
    eff_prod_name: str | None = None

    if prod:
        pl_row = (
            db.execute(
                select(ProductLine).where(
                    (ProductLine.code == prod) | (ProductLine.name == prod)
                )
            )
            .scalars()
            .first()
        )
        if pl_row is not None:
            eff_plc = pl_row.code
            eff_prod_name = pl_row.name or prod
        else:
            pl_new = ProductLine(code=prod, name=prod, is_active=True)
            db.add(pl_new)
            db.flush()
            eff_plc = prod
            eff_prod_name = prod

        if mod:
            mod_row = (
                db.execute(
                    select(Module).where(
                        Module.product_line_code == eff_plc,
                        Module.name == mod,
                    )
                )
                .scalars()
                .first()
            )
            if mod_row is None:
                db.add(
                    Module(
                        product_line_code=eff_plc,
                        name=mod,
                        is_active=True,
                        status="enabled",
                    )
                )
                db.flush()

    return eff_plc, eff_prod_name, mod


def resolve_feishu_handler_user(
    db: Session,
    *,
    name: str | None,
    mobile: str | None,
    email: str | None,
) -> User | None:
    """来源是飞书的工单：处理人 = 提单人（按姓名 / 手机 / 邮箱匹配系统用户）。"""
    clean_name = (name or "").strip()
    clean_mobile = (mobile or "").strip()
    clean_email = (email or "").strip()

    if clean_name:
        u = (
            db.execute(
                select(User)
                .where(
                    User.name == clean_name,
                    User.deleted_at.is_(None),
                    User.is_active.is_(True),
                )
                .order_by(User.id)
            )
            .scalars()
            .first()
        )
        if u is not None:
            return u
    if clean_mobile:
        u = (
            db.execute(
                select(User)
                .where(
                    User.mobile == clean_mobile,
                    User.deleted_at.is_(None),
                    User.is_active.is_(True),
                )
                .order_by(User.id)
            )
            .scalars()
            .first()
        )
        if u is not None:
            return u
    if clean_email:
        u = (
            db.execute(
                select(User)
                .where(
                    User.email == clean_email,
                    User.deleted_at.is_(None),
                    User.is_active.is_(True),
                )
                .order_by(User.id)
            )
            .scalars()
            .first()
        )
        if u is not None:
            return u
    return None


def resolve_feishu_rd_owner(
    db: Session,
    product_line_code: str | None,
    module: str | None,
) -> User | None:
    """产品分类、问题模块补充完整后，匹配补充产研责任田责任人。

    优先从 modules.dev_owners（peek_module_owner / list_module_owners）匹配；
    若未配置 dev_owners，回落查询 assignment_scopes_module。
    """
    plc = (product_line_code or "").strip()
    mod = (module or "").strip()
    if not plc or not mod:
        return None

    pl_row = (
        db.execute(
            select(ProductLine).where((ProductLine.code == plc) | (ProductLine.name == plc))
        )
        .scalars()
        .first()
    )
    candidate_codes: list[str] = []
    if pl_row is not None:
        candidate_codes.append(pl_row.code)
        if pl_row.name and pl_row.name not in candidate_codes:
            candidate_codes.append(pl_row.name)
    if plc not in candidate_codes:
        candidate_codes.append(plc)

    for code in candidate_codes:
        owner = peek_module_owner(db, code, mod)
        if owner is not None:
            return owner
        owners = list_module_owners(db, code, mod)
        if owners:
            return owners[0]

    scope_user = (
        db.execute(
            select(User)
            .join(AssignmentScopeModule, AssignmentScopeModule.user_id == User.id)
            .where(
                AssignmentScopeModule.product_line_code.in_(candidate_codes),
                AssignmentScopeModule.module == mod,
                User.deleted_at.is_(None),
                User.is_active.is_(True),
            )
            .order_by(AssignmentScopeModule.id)
        )
        .scalars()
        .first()
    )
    return scope_user


def auto_transfer_feishu_ticket_to_linear(db: Session, ticket: Ticket) -> HubIssue | None:
    """当研发责任田责任人（assigned_user_id）不为空后，系统自动转产研：
    1. 确保关联 Bug_fix / Demand 类型的 HubIssue 已创建并同步责任人；
    2. 将工单的处理环节（process_stage）更新为「产研处理」；
    3. 调用 push_hub_issue_to_linear 将工单传给 Linear 处理。
    """
    if ticket.source_code != _SOURCE:
        return None

    if ticket.assigned_user_id is None and ticket.product_line_code and ticket.module:
        rd_owner = resolve_feishu_rd_owner(db, ticket.product_line_code, ticket.module)
        if rd_owner is not None:
            ticket.assigned_user_id = rd_owner.id

    if ticket.assigned_user_id is None:
        return None

    from app.services.hub_issues.creator import _next_hub_short_code
    from app.services.hub_issues.linear_push import push_hub_issue_to_linear

    hub_type = (
        ticket.predicted_type
        if ticket.predicted_type in ("Bug_fix", "Demand")
        else "Demand"
    )
    if ticket.predicted_type is None:
        ticket.predicted_type = hub_type
        ticket.predicted_confidence = Decimal("1.00")
        ticket.classified_at = datetime.now(UTC)

    ticket.process_stage = "产研处理"

    hub: HubIssue | None = None
    if ticket.hub_issue_id is not None:
        hub = db.get(HubIssue, ticket.hub_issue_id)

    if hub is None or hub.deleted_at is not None:
        hub = (
            db.execute(
                select(HubIssue)
                .where(HubIssue.ticket_id == ticket.id, HubIssue.deleted_at.is_(None))
                .order_by(HubIssue.id.asc())
            )
            .scalars()
            .first()
        )

    if hub is None:
        hub = HubIssue(
            ticket_id=ticket.id,
            short_code=_next_hub_short_code(db),
            type=hub_type,
            title=(ticket.title or ticket.body or "飞书工单").strip()[:512],
            canonical_body=ticket.body,
            product_line_code=ticket.product_line_code,
            product=ticket.source_product_name,
            module=ticket.module,
            status="processing",
            assigned_user_id=ticket.assigned_user_id,
            owner_user_id=ticket.assigned_user_id,
            reply_content=ticket.body or ticket.title or "飞书工单自动转产研",
            occurrence_count=1,
        )
        db.add(hub)
        db.flush()
        ticket.hub_issue_id = hub.id
        db.add(
            TicketHubIssueHistory(
                ticket_id=ticket.id,
                hub_issue_id=hub.id,
                change_reason="created by system:feishu_auto_rd",
                human_confirmed=False,
            )
        )
        StatusHistoryRepository(db).record(
            entity_type="hub_issue",
            entity_id=hub.id,
            from_status=None,
            to_status="processing",
            changed_by="system:feishu_auto_rd",
            reason=f"飞书工单 {ticket.short_code} 匹配产研责任人后自动转产研",
            metadata={"ticket_id": ticket.id, "type": hub_type},
        )
    else:
        if hub.type not in ("Bug_fix", "Demand"):
            hub.type = hub_type
            hub.op_status = None
            hub.op_handler = None
            hub.op_status_changed_at = None
            hub.op_handler_user_id = None
        if ticket.product_line_code:
            hub.product_line_code = ticket.product_line_code
        if ticket.source_product_name:
            hub.product = ticket.source_product_name
        if ticket.module:
            hub.module = ticket.module
        hub.assigned_user_id = ticket.assigned_user_id
        hub.owner_user_id = ticket.assigned_user_id
        if not (hub.reply_content or "").strip():
            hub.reply_content = ticket.body or ticket.title or "飞书工单自动转产研"
        if ticket.hub_issue_id is None:
            ticket.hub_issue_id = hub.id

    db.flush()

    # 推送给 Linear 处理
    push_hub_issue_to_linear(
        hub.id,
        db=db,
        assignee_override_user_id=ticket.assigned_user_id,
    )

    # 确保工单处理环节更新为「产研处理」
    ticket.process_stage = "产研处理"
    if hub.status in ("draft", "created", "pending_review", "pending_linear_review"):
        hub.status = "processing"
    db.flush()
    return hub


@dataclass(slots=True, frozen=True)
class IngestResult:
    ticket_id: int
    short_code: str
    routing_decision: str
    assigned_user_ids: list[int] = field(default_factory=list)
    attachment_ids: list[int] = field(default_factory=list)
    deduped: bool = False


class FeishuAiIngester:
    def __init__(self, db: Session) -> None:
        self._db = db
        self._tickets = TicketRepository(db)
        self._history = StatusHistoryRepository(db)
        self._resolver = IdentityResolver(db)

    def ingest(self, payload: dict[str, Any]) -> IngestResult:
        p = parse_escalation_payload(payload)

        existing = self._tickets.find_by_source(_SOURCE, p.session_id)
        if existing is not None:
            logger.info("feishu_ai_ingest_dedup", session_id=p.session_id, ticket_id=existing.id)
            return IngestResult(
                ticket_id=existing.id,
                short_code=existing.short_code,
                routing_decision="dedup",
                assigned_user_ids=[existing.assigned_user_id] if existing.assigned_user_id else [],
                deduped=True,
            )

        cust_dict = payload.get("customer") if isinstance(payload.get("customer"), dict) else {}
        c_name = (
            str(
                payload.get("customer-name")
                or payload.get("customer_name")
                or payload.get("customerName")
                or cust_dict.get("customer-name")
                or cust_dict.get("customer_name")
                or cust_dict.get("name")
                or p.customer.get("name")
                or ""
            ).strip()
            or None
        )
        c_mobile = (
            str(
                payload.get("customer-mobile")
                or payload.get("customer_mobile")
                or payload.get("customerMobile")
                or cust_dict.get("customer-mobile")
                or cust_dict.get("customer_mobile")
                or cust_dict.get("mobile")
                or p.customer.get("mobile")
                or ""
            ).strip()
            or None
        )
        c_email = (
            str(
                payload.get("customer-email")
                or payload.get("customer_email")
                or payload.get("customerEmail")
                or cust_dict.get("customer-email")
                or cust_dict.get("customer_email")
                or cust_dict.get("email")
                or p.customer.get("email")
                or ""
            ).strip()
            or None
        )
        c_erp_uid = (
            cust_dict.get("erp_uid")
            or payload.get("erp_uid")
            or p.customer.get("erp_uid")
        )
        c_source_user_id = (
            cust_dict.get("source_user_id")
            or payload.get("source_user_id")
            or p.customer.get("source_user_id")
        )

        resolve = self._resolver.resolve(
            IdentityInput(
                source_code=_SOURCE,
                source_user_id=c_source_user_id or c_erp_uid,
                erp_uid=c_erp_uid,
                email=c_email,
                mobile=c_mobile,
                raw_name=c_name,
            )
        )
        # 三元组仅存档（triage 用 ticket.body 分类，不读此块）。conversation/
        # cited_knowledge/skills_used 缺省时不写 key，保持载荷形状与 ai_cs 一致。
        ai_cs_ctx: dict[str, Any] = {
            "original_question": p.original_question,
            "ai_answer": p.ai_answer,
            "dissatisfaction": p.dissatisfaction,
        }
        if p.conversation:
            ai_cs_ctx["conversation"] = p.conversation
        if p.cited_knowledge:
            ai_cs_ctx["cited_knowledge"] = p.cited_knowledge
        if p.skills_used:
            ai_cs_ctx["skills_used"] = p.skills_used

        # 1) 产品分类=提单产品，问题模块=提单模块
        raw_product = (
            str(
                payload.get("product_line_code")
                or payload.get("product")
                or payload.get("product_name")
                or payload.get("productName")
                or payload.get("source_product_name")
                or payload.get("提单产品")
                or payload.get("产品分类")
                or p.product_line_code
                or ""
            ).strip()
            or None
        )
        raw_module = (
            str(
                payload.get("module")
                or payload.get("module_name")
                or payload.get("moduleName")
                or payload.get("source_module")
                or payload.get("提单模块")
                or payload.get("问题模块")
                or p.module
                or ""
            ).strip()
            or None
        )
        eff_plc, eff_prod_name, eff_mod = resolve_feishu_product_and_module(
            self._db, raw_product, raw_module
        )

        # 3) & 7) predicted_type 工单类型：需求 -> Demand，bug -> Bug_fix
        raw_type = (
            payload.get("predicted_type")
            or payload.get("type")
            or payload.get("ticket_type")
            or payload.get("ticketType")
            or payload.get("issue_type")
            or payload.get("工单类型")
            or payload.get("问题类型")
        )
        mapped_type = normalize_feishu_predicted_type(raw_type)
        now = datetime.now(UTC)

        # 2) 处理人 = 提单人
        handler_user = resolve_feishu_handler_user(
            self._db, name=c_name, mobile=c_mobile, email=c_email
        )

        # 8) 产品分类、问题模块补充完整后，匹配补充产研责任田责任人
        rd_owner = resolve_feishu_rd_owner(self._db, eff_plc, eff_mod)

        ticket = Ticket(
            short_code=self._tickets.next_short_code(),
            source_code=_SOURCE,
            source_ticket_id=p.session_id,
            type="Raw",
            status="processing",
            process_stage="产研处理" if rd_owner is not None else "服务处理",
            source_payload={
                "ai_cs": ai_cs_ctx,
                "_original_catalog": {
                    "product_line_code": raw_product,
                    "module": raw_module,
                },
                "contact_name": c_name,
                "contact_mobile": c_mobile,
                "contact_email": c_email,
            },
            customer_identity_id=resolve.customer_identity_id,
            product_line_code=eff_plc,
            source_product_name=eff_prod_name,
            ksm_reporter_product_line=eff_prod_name,
            module=eff_mod,
            ksm_reporter_module=eff_mod,
            module_classified_at=now if (eff_plc or eff_mod) else None,
            predicted_type=mapped_type,
            predicted_confidence=Decimal("1.00") if mapped_type else None,
            classified_at=now if mapped_type else None,
            handler_user_id=handler_user.id if handler_user is not None else None,
            assigned_user_id=rd_owner.id if rd_owner is not None else None,
            # 4) 5) 6) 提单人=联系人，提单人手机=联系人手机，提单人邮箱=联系邮箱
            ksm_linkman=c_name,
            ksm_contact_mobile=c_mobile,
            ksm_contact_email=c_email,
            title=p.original_question[:_TITLE_MAX],
            body=p.original_question,
            reporter={
                "name": c_name,
                "email": c_email,
                "mobile": c_mobile,
                "source_user_id": c_source_user_id,
                "contact_name": c_name,
                "contact_mobile": c_mobile,
                "contact_email": c_email,
            },
        )
        self._tickets.add(ticket)
        self._db.flush()

        attachment_ids: list[int] = []
        for a in p.attachments:
            url = a.get("url") or a.get("source_url")
            if not url:
                continue
            att = Attachment(
                ticket_id=ticket.id,
                source_url=str(url),
                filename=a.get("filename"),
                mime=a.get("mime"),
                kind="image",  # 截图为主；非图后续按 mime 细分
                vision_status="pending",
            )
            self._db.add(att)
            self._db.flush()
            attachment_ids.append(att.id)

        # 9) 当研发责任田责任人不为空后，系统自动转产研，传给 Linear 处理，并将处理环节更新为产研处理
        if ticket.assigned_user_id is not None:
            auto_transfer_feishu_ticket_to_linear(self._db, ticket)

        assigned_ids: list[int] = []
        if ticket.assigned_user_id is not None:
            assigned_ids = [ticket.assigned_user_id]
        elif ticket.handler_user_id is not None:
            assigned_ids = [ticket.handler_user_id]
        dispatch_decision = "assigned" if assigned_ids else "no_match"

        self._history.record(
            entity_type="ticket",
            entity_id=ticket.id,
            from_status=None,
            to_status="processing",
            changed_by="system:ingest",
            reason=f"feishu_ai ingest: {p.session_id}",
            metadata={
                "source": _SOURCE,
                "routing_decision": dispatch_decision,
                "attachment_count": len(attachment_ids),
            },
        )
        logger.info(
            "feishu_ai_ingest_committed",
            ticket_id=ticket.id,
            short_code=ticket.short_code,
            attachments=len(attachment_ids),
            routing_decision=dispatch_decision,
        )
        return IngestResult(
            ticket_id=ticket.id,
            short_code=ticket.short_code,
            routing_decision=dispatch_decision,
            assigned_user_ids=assigned_ids,
            attachment_ids=attachment_ids,
            deduped=False,
        )
