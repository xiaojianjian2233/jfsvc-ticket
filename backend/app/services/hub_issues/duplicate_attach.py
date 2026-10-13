"""Attach a newly received external ticket to a strictly matched shared Hub.

The Hub is the shared problem lifecycle, while source tickets keep their own
external-delivery outcome. Customer cancellation is therefore ticket-scoped;
operator/Linear actions fan out only to still-active source tickets.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import AgentDecision, HubIssue, SyncOutbox, Ticket, TicketHubIssueHistory, User
from app.repositories.status_history import StatusHistoryRepository
from app.services.cascade.reply_sync import backfill_reply_to_ticket
from app.services.ksm.cancel_state import KSM_CUSTOMER_CANCELLED_REASON

REOPEN_NOTE = "客户反馈问题未解决退回"

_TERMINAL = frozenset(
    {"answered", "closed", "done", "rejected", "resolved", "superseded", "transferred_return"}
)
_DEV_DONE = frozenset({"answered", "closed", "done", "released", "resolved"})
_RETURNED = frozenset({"returned", "transferred_return"})


@dataclass(slots=True, frozen=True)
class DuplicateAttachResult:
    reactivated_for_linear: bool = False
    queued_return: bool = False
    queued_reply: bool = False


def linked_tickets(db: Session, hub: HubIssue) -> list[Ticket]:
    return (
        db.query(Ticket)
        .filter(
            or_(Ticket.hub_issue_id == hub.id, Ticket.id == hub.ticket_id),
            Ticket.deleted_at.is_(None),
        )
        .order_by(Ticket.id)
        .all()
    )


def has_formal_reply(hub: HubIssue) -> bool:
    return bool(
        hub.reply_content
        and (hub.reply_content_version or 0) >= 1
        and not hub.reply_is_draft
        and hub.reply_authored_by
    )


def all_linked_tickets_cancelled(db: Session, hub: HubIssue) -> bool:
    tickets = linked_tickets(db, hub)
    return bool(tickets) and all(t.closed_reason == KSM_CUSTOMER_CANCELLED_REASON for t in tickets)


def candidate_is_eligible(db: Session, hub: HubIssue) -> bool:
    """Whether a historical Hub may receive a newly ingested strict duplicate."""
    if hub.op_status == "supplementing" or hub.status == "supplementing":
        return False
    if hub.status in _RETURNED or hub.op_status == "transferred_return":
        return bool(_return_note(db, hub))
    if hub.type in ("Bug_fix", "Demand") and hub.status in _DEV_DONE:
        return bool(hub.linear_identifier or hub.linear_uuid or hub.linear_history)
    if hub.status in _DEV_DONE or hub.op_status == "closed":
        return has_formal_reply(hub) or all_linked_tickets_cancelled(db, hub)
    return True


def attach_duplicate_ticket(
    db: Session,
    ticket: Ticket,
    hub: HubIssue,
    *,
    matched_score: float,
) -> DuplicateAttachResult:
    """Attach ``ticket`` and converge it to the historical Hub lifecycle."""
    old_tickets = linked_tickets(db, hub)
    canonical = _canonical_ticket(hub, old_tickets)
    _inherit_handler(db, ticket, hub, canonical)
    ticket.hub_issue_id = hub.id

    reactivated_for_linear = False
    queued_return = False
    queued_reply = False

    if all_linked_tickets_cancelled(db, hub):
        _reopen_cancelled_hub(db, hub, ticket)
    elif hub.type in ("Bug_fix", "Demand") and hub.status in _DEV_DONE:
        _reactivate_dev_hub(db, hub, ticket)
        reactivated_for_linear = True
    elif hub.status in _RETURNED or hub.op_status == "transferred_return":
        note = _return_note(db, hub)
        ticket.status = "transferred_return"
        ticket.process_stage = "完成"
        ticket.cached_reply_content = note or None
        ticket.cached_reply_version = 1 if note else None
        if note and ticket.source_code == "ksm" and ticket.source_ticket_id:
            db.add(
                SyncOutbox(
                    kind="return",
                    target_source_code="ksm",
                    ticket_id=ticket.id,
                    source_ticket_id=ticket.source_ticket_id,
                    hub_issue_id=hub.id,
                    payload={"deal_opinion": note, "requested_by": "system:hub_dedup"},
                )
            )
            queued_return = True
    elif has_formal_reply(hub) and (hub.status in _DEV_DONE or hub.op_status == "answered"):
        ticket.status = canonical.status if canonical is not None else "answered"
        ticket.process_stage = canonical.process_stage if canonical is not None else "完成"
        queued_reply = backfill_reply_to_ticket(db, hub, ticket)
    elif canonical is not None:
        ticket.status = canonical.status
        ticket.process_stage = canonical.process_stage
        ticket.cached_reply_content = canonical.cached_reply_content
        ticket.cached_reply_version = canonical.cached_reply_version

    db.flush()
    hub.occurrence_count = len(linked_tickets(db, hub))
    hub.last_seen_at = datetime.now(UTC)
    db.add(
        TicketHubIssueHistory(
            ticket_id=ticket.id,
            hub_issue_id=hub.id,
            change_reason=f"hub-dedup 严格匹配关联到 {hub.short_code}",
            human_confirmed=False,
        )
    )
    db.add(
        AgentDecision(
            decision_type="dedup_link",
            subject_type="ticket",
            subject_id=ticket.id,
            proposal={
                "related_ids": [hub.id],
                "hub_short_code": hub.short_code,
                "similarity": matched_score,
                "strict": True,
                "reactivated_for_linear": reactivated_for_linear,
                "queued_return": queued_return,
                "queued_reply": queued_reply,
            },
        )
    )
    return DuplicateAttachResult(
        reactivated_for_linear=reactivated_for_linear,
        queued_return=queued_return,
        queued_reply=queued_reply,
    )


def _canonical_ticket(hub: HubIssue, tickets: list[Ticket]) -> Ticket | None:
    if not tickets:
        return None
    by_id = {t.id: t for t in tickets}
    anchor = by_id.get(hub.ticket_id or -1)
    active = [t for t in tickets if t.status not in _TERMINAL]
    return active[0] if active else anchor or tickets[0]


def _inherit_handler(db: Session, ticket: Ticket, hub: HubIssue, canonical: Ticket | None) -> None:
    handler_id = hub.owner_user_id if hub.type in ("Bug_fix", "Demand") else None
    handler_id = handler_id or (canonical.handler_user_id if canonical else None)
    if handler_id is not None:
        user = db.get(User, handler_id)
        if user is not None and user.deleted_at is None and user.is_active:
            ticket.handler_user_id = handler_id
    if canonical is not None:
        ticket.assigned_user_id = canonical.assigned_user_id


def _reopen_cancelled_hub(db: Session, hub: HubIssue, ticket: Ticket) -> None:
    prev = hub.status
    hub.status = "processing"
    hub.actual_resolved_at = None
    hub.closed_at = None
    hub.ticket_id = ticket.id
    if hub.type == "Operation":
        hub.op_status = "processing"
        hub.op_status_changed_at = datetime.now(UTC)
    ticket.status = "processing"
    ticket.process_stage = "服务处理"
    ticket.closed_reason = None
    ticket.cached_reply_content = None
    ticket.cached_reply_version = None
    StatusHistoryRepository(db).record(
        entity_type="hub_issue",
        entity_id=hub.id,
        from_status=prev,
        to_status="processing",
        changed_by="system:hub_dedup",
        reason="全部关联工单曾撤销；收到严格重复的新工单后重新激活",
    )


def _reactivate_dev_hub(db: Session, hub: HubIssue, ticket: Ticket) -> None:
    now = datetime.now(UTC)
    history = list(hub.linear_history or [])
    if hub.linear_uuid or hub.linear_identifier:
        history.append(
            {
                "linear_uuid": hub.linear_uuid,
                "linear_identifier": hub.linear_identifier,
                "linear_status": hub.linear_status,
                "linear_status_synced_at": (
                    hub.linear_status_synced_at.isoformat() if hub.linear_status_synced_at else None
                ),
                "actual_released_at": (
                    hub.actual_released_at.isoformat() if hub.actual_released_at else None
                ),
                "archived_at": now.isoformat(),
                "reason": REOPEN_NOTE,
            }
        )
    hub.linear_history = history
    hub.linear_uuid = None
    hub.linear_identifier = None
    hub.linear_status = None
    hub.linear_status_synced_at = None
    hub.release_notified_at = None
    hub.release_note = None
    hub.feedback_status = None
    hub.feedback_note = None
    hub.feedback_at = None
    hub.actual_released_at = None
    hub.closed_at = None
    # 当前周期的主来源改为本次复发工单，Linear 推送使用新客户上下文。
    hub.ticket_id = ticket.id
    prev = hub.status
    # ``dev_returned`` lets linear_push create a new issue instead of treating
    # the old UUID as idempotent; successful push converges it to processing.
    hub.status = "dev_returned"
    base_note = (hub.reply_content or "").rstrip()
    if not base_note.endswith(REOPEN_NOTE):
        hub.reply_content = f"{base_note}\n{REOPEN_NOTE}".strip()
        hub.reply_content_version = (hub.reply_content_version or 0) + 1
        hub.reply_updated_at = now
        hub.reply_authored_by = "system:hub_dedup"
        hub.reply_is_draft = False
    ticket.status = "processing"
    ticket.process_stage = "研发处理"
    ticket.cached_reply_content = hub.reply_content
    ticket.cached_reply_version = hub.reply_content_version
    StatusHistoryRepository(db).record(
        entity_type="hub_issue",
        entity_id=hub.id,
        from_status=prev,
        to_status="dev_returned",
        changed_by="system:hub_dedup",
        reason=REOPEN_NOTE,
    )


def _return_note(db: Session, hub: HubIssue) -> str:
    row = (
        db.query(SyncOutbox)
        .filter(
            SyncOutbox.hub_issue_id == hub.id,
            SyncOutbox.kind == "return",
            SyncOutbox.status == "sent",
        )
        .order_by(SyncOutbox.id.desc())
        .first()
    )
    if row is not None:
        note = str((row.payload or {}).get("deal_opinion") or "").strip()
        if note:
            return note
    for ticket in linked_tickets(db, hub):
        note = (ticket.cached_reply_content or "").strip()
        if note and ticket.closed_reason != KSM_CUSTOMER_CANCELLED_REASON:
            return note
    return (hub.reply_content or "").strip()
