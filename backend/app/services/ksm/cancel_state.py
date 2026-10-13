"""KSM customer-cancelled state reconciliation.

KSM ``status=5`` is the authoritative signal that the reporter cancelled the
ticket. Both first ingest and re-push paths use this module so ticket, Hub,
outbox and the user-visible processing note cannot drift apart.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import HubIssue, SyncOutbox, Ticket
from app.repositories.status_history import StatusHistoryRepository
from app.services.hub_issues.op_status import OP_CLOSED, apply_op_status

KSM_CANCELLED_NOTE = "客户主动撤销关闭工单"
KSM_CUSTOMER_CANCELLED_REASON = "customer_cancelled"

_TERMINAL_TICKET_STATUSES = frozenset(
    {"answered", "closed", "done", "rejected", "resolved", "superseded", "transferred_return"}
)


def apply_ksm_cancelled(
    db: Session,
    ticket: Ticket,
    *,
    changed_by: str = "system:ksm_ingest",
    reason: str = "KSM 客户主动撤销（status=5）",
) -> bool:
    """Close a customer-cancelled KSM ticket and every directly related Hub.

    Pending/failed outbound work is made ``skipped`` so a delayed retry cannot
    mutate a source ticket that the customer has already cancelled. The caller
    owns the transaction. Returns whether the ticket status changed.
    """

    now = datetime.now(UTC)
    history = StatusHistoryRepository(db)
    changed = ticket.status != "closed"

    ticket.process_stage = "完成"
    ticket.cached_reply_content = KSM_CANCELLED_NOTE
    ticket.cached_reply_version = max(ticket.cached_reply_version or 0, 1)
    ticket.closed_reason = KSM_CUSTOMER_CANCELLED_REASON
    ticket.actual_resolved_at = ticket.actual_resolved_at or now
    ticket.ksm_takeover_status = None
    ticket.ksm_takeover_error = None
    if changed:
        previous = ticket.status
        ticket.status = "closed"
        history.record(
            entity_type="ticket",
            entity_id=ticket.id,
            from_status=previous,
            to_status="closed",
            changed_by=changed_by,
            reason=reason,
            metadata={"processing_note": KSM_CANCELLED_NOTE, "ksm_status": "5"},
        )

    hub_filters = [HubIssue.ticket_id == ticket.id]
    if ticket.hub_issue_id is not None:
        hub_filters.append(HubIssue.id == ticket.hub_issue_id)
    hubs = (
        db.query(HubIssue)
        .filter(or_(*hub_filters), HubIssue.deleted_at.is_(None))
        .order_by(HubIssue.id)
        .all()
    )
    for hub in hubs:
        active_ticket = (
            db.query(Ticket.id)
            .filter(
                or_(Ticket.hub_issue_id == hub.id, Ticket.id == hub.ticket_id),
                Ticket.deleted_at.is_(None),
                Ticket.status.notin_(list(_TERMINAL_TICKET_STATUSES)),
            )
            .first()
        )
        # 客户撤销是工单级事件。只有该 Hub 已无其它有效工单时才关闭 Hub；
        # Hub 的公共处理说明必须保留，不能被单个客户的撤销说明覆盖。
        if active_ticket is None and hub.status != "closed":
            previous_hub_status = hub.status
            hub.status = "closed"
            history.record(
                entity_type="hub_issue",
                entity_id=hub.id,
                from_status=previous_hub_status,
                to_status="closed",
                changed_by=changed_by,
                reason=reason,
                metadata={"processing_note": KSM_CANCELLED_NOTE, "ksm_status": "5"},
            )
        if active_ticket is None and hub.type == "Operation" and hub.op_status != OP_CLOSED:
            apply_op_status(
                db,
                hub,
                to_status=OP_CLOSED,
                handler=hub.op_handler or "agent",
                reason=reason,
            )
        if active_ticket is None:
            hub.actual_resolved_at = hub.actual_resolved_at or now

    rows = (
        db.query(SyncOutbox)
        .filter(
            SyncOutbox.ticket_id == ticket.id,
            SyncOutbox.status.in_(("pending", "failed")),
        )
        .all()
    )
    for row in rows:
        row.status = "skipped"
        row.sent_at = None
        row.last_error = (
            f"KSM status=5 confirmed customer cancellation at {now.isoformat()}; "
            "outbound action cancelled"
        )

    return changed
