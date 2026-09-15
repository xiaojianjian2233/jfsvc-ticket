"""Generate review-only answers independently of classification and routing."""

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.logging import get_logger
from app.models import AgentDecision, HubIssue, Ticket
from app.services.agents.operation_answer import _replay_with_retry, _save_draft_reply
from app.services.ai_cs.context import build_hub_question
from app.services.knowledge_feedback.service import build_client

logger = get_logger(__name__)


def generate_answer_draft(
    db: Session,
    *,
    ticket_id: int | None = None,
    hub_id: int | None = None,
    initial: bool = False,
) -> str | None:
    """Save an AI draft/audit only; never send, change status or replace a human reply."""
    kind = "hub_issue" if hub_id is not None else "ticket"
    subject_id = hub_id if hub_id is not None else ticket_id
    if subject_id is None:
        raise ValueError("ticket_id or hub_id required")
    # Serialize a subject's draft calls across web/worker processes. Initial redelivery
    # is idempotent; a later explicit click always makes a fresh agent request.
    if db.get_bind().dialect.name == "postgresql":
        locked = db.scalar(
            text("SELECT pg_try_advisory_xact_lock(:ns, :id)"),
            {"ns": 91401 if kind == "ticket" else 91402, "id": subject_id},
        )
        if not locked:
            return None
    ticket = db.get(Ticket, ticket_id) if ticket_id is not None else None
    hub = db.get(HubIssue, hub_id) if hub_id is not None else None
    subject = hub if hub_id is not None else ticket
    if subject is None or subject.deleted_at is not None:
        return None
    if initial:
        existing = db.scalar(
            select(AgentDecision)
            .where(
                AgentDecision.subject_type == kind,
                AgentDecision.subject_id == subject_id,
                AgentDecision.decision_type == "auto_reply",
            )
            .order_by(AgentDecision.id.desc())
        )
        if existing is not None:
            return str((existing.proposal or {}).get("answer") or "") or None
    settings = get_settings()
    # A non-persistent hub provides ticket context without graduating or classifying
    # the ticket. A negative id avoids matching unrelated NULL hub attachments.
    context_hub = (
        hub
        if hub is not None
        else HubIssue(
            id=-1,
            ticket_id=ticket.id,
            title=ticket.title,
            canonical_body=ticket.body,
            product_line_code=ticket.product_line_code,
            module=ticket.module,
        )
    )
    question = build_hub_question(db, context_hub, settings=settings)
    client = build_client(settings)
    try:
        skill = next(
            (s.strip() for s in settings.ai_cs_managed_skills.split(",") if s.strip()), None
        )
        result = _replay_with_retry(client, question=question, skill=skill, hub_id=hub_id or 0)
    finally:
        client.close()
    answer = (result.answer or "").strip()
    if not answer:
        return None
    db.refresh(subject)
    if subject.deleted_at is not None:
        return None
    if ticket is not None:
        ticket.source_payload = {**(ticket.source_payload or {}), "_ai_answer_draft": answer}
    # A concurrent/manual reply remains authoritative, including closed tickets.
    if (
        hub is not None
        and (hub.type == "Operation" or hub.ticket_id is not None)
        and (
            not hub.reply_content
            or (hub.reply_is_draft and hub.reply_authored_by == "agent:ai_cs:draft")
        )
    ):
        _save_draft_reply(db, hub, content=answer)
    db.add(
        AgentDecision(
            decision_type="auto_reply",
            subject_type=kind,
            subject_id=subject_id,
            proposal={
                "answer": answer,
                "question": question,
                "draft_only": True,
                "initial": initial,
                "branch": "preview",
                "cited_knowledge": result.cited_knowledge,
            },
        )
    )
    db.commit()
    return answer


def generate_initial_ticket_answer(ticket_id: int) -> None:
    """Called first in the post-ingest background chain; failure cannot block triage."""
    from app.db import make_session

    db = make_session()
    try:
        generate_answer_draft(db, ticket_id=ticket_id, initial=True)
    except Exception:
        db.rollback()
        logger.exception("initial_ticket_ai_draft_failed", ticket_id=ticket_id)
    finally:
        db.close()
