"""KSM returned-state reconciliation.

Both a successful ``returnKsmOrder`` call and an inbound KSM snapshot with
``status=6`` mean the same domain event: the ticket has been handed back to
KSM for reassignment.  Keeping that transition here prevents the outbound
and inbound paths from drifting apart.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import or_, update
from sqlalchemy.orm import Session

from app.models import HubIssue, SyncOutbox, Ticket
from app.repositories.status_history import StatusHistoryRepository
from app.services.hub_issues.op_status import OP_TRANSFERRED_RETURN, apply_op_status

_TICKET_TERMINAL_STATUSES = frozenset(
    {"done", "closed", "rejected", "superseded", "transferred_return"}
)


def apply_ksm_returned(
    db: Session,
    ticket: Ticket,
    *,
    changed_by: str,
    reason: str,
    reconcile_return_outbox: bool = False,
) -> bool:
    """Move one ticket and its hub to the KSM-returned state.

    ``reconcile_return_outbox`` is used only by the inbound KSM path.  When
    KSM itself confirms ``status=6``, pending/failed return attempts must stop
    retrying even if our original request did not produce the transition.
    ``skipped`` accurately records that no further outbound action is needed;
    the audit reason explains that KSM was already returned externally.

    The caller owns the transaction.  Returns whether the ticket status
    changed during this call.
    """

    history = StatusHistoryRepository(db)
    changed = ticket.status != "transferred_return"

    ticket.process_stage = "完成"
    ticket.ksm_takeover_status = None
    ticket.ksm_takeover_error = None
    if changed:
        previous = ticket.status
        ticket.status = "transferred_return"
        history.record(
            entity_type="ticket",
            entity_id=ticket.id,
            from_status=previous,
            to_status="transferred_return",
            changed_by=changed_by,
            reason=reason,
        )

    hub = db.get(HubIssue, ticket.hub_issue_id) if ticket.hub_issue_id else None
    if hub is None:
        hub = (
            db.query(HubIssue)
            .filter(HubIssue.ticket_id == ticket.id, HubIssue.deleted_at.is_(None))
            .order_by(HubIssue.id)
            .first()
        )

    if hub is not None:
        active = (
            db.query(Ticket.id)
            .filter(
                or_(Ticket.hub_issue_id == hub.id, Ticket.id == hub.ticket_id),
                Ticket.deleted_at.is_(None),
                Ticket.status.notin_(list(_TICKET_TERMINAL_STATUSES)),
            )
            .first()
        )
        if active is None and hub.status != "returned":
            previous_hub_status = hub.status
            hub.status = "returned"
            history.record(
                entity_type="hub_issue",
                entity_id=hub.id,
                from_status=previous_hub_status,
                to_status="returned",
                changed_by=changed_by,
                reason=reason,
            )
            if hub.type == "Operation" and hub.op_status != OP_TRANSFERRED_RETURN:
                apply_op_status(
                    db,
                    hub,
                    to_status=OP_TRANSFERRED_RETURN,
                    handler=hub.op_handler or "agent",
                    reason=reason,
                )

    # Draft/subtask hubs directly owned by this ticket must not remain active.
    db.execute(
        update(HubIssue)
        .where(
            HubIssue.ticket_id == ticket.id,
            HubIssue.deleted_at.is_(None),
            HubIssue.status.notin_(("released", "answered", "closed", "returned")),
        )
        .values(status="returned")
    )

    if reconcile_return_outbox:
        now = datetime.now(UTC)
        rows = (
            db.query(SyncOutbox)
            .filter(
                SyncOutbox.ticket_id == ticket.id,
                SyncOutbox.kind == "return",
                SyncOutbox.status.in_(("pending", "failed")),
            )
            .all()
        )
        for row in rows:
            row.status = "skipped"
            row.sent_at = None
            row.last_error = (
                f"KSM status=6 confirmed external return at {now.isoformat()}; "
                "local state reconciled"
            )

    return changed
