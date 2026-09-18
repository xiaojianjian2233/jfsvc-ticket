"""Generate review-only answers independently of classification and routing."""

from contextlib import contextmanager

import redis
from redis.lock import Lock
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.logging import get_logger
from app.models import AgentDecision, HubIssue, Ticket
from app.services.agents.operation_answer import _replay_with_retry, _save_draft_reply
from app.services.ai_cs.context import build_hub_question
from app.services.knowledge_feedback.service import build_client

logger = get_logger(__name__)



@contextmanager
def _draft_lease(kind: str, subject_id: int):
    """A bounded Redis lease serializes calls without holding a DB connection."""
    settings = get_settings()
    client = redis.Redis.from_url(
        settings.redis_url, socket_connect_timeout=3, socket_timeout=3,
    )
    lock = client.lock(
        f"ai-draft:{kind}:{subject_id}",
        timeout=max(900, settings.ai_cs_timeout_seconds * 6),
        blocking=False,
    )
    acquired = False
    try:
        acquired = lock.acquire(blocking=False)
        yield lock if acquired else None
    finally:
        try:
            if acquired:
                try:
                    lock.release()
                except redis.exceptions.LockNotOwnedError:
                    logger.warning("ai_draft_lease_expired", subject_type=kind, subject_id=subject_id)
                except redis.exceptions.RedisError:
                    logger.exception("ai_draft_lease_release_failed")
        finally:
            client.close()


def generate_answer_draft(
    db: Session,
    *,
    ticket_id: int | None = None,
    hub_id: int | None = None,
    initial: bool = False,
) -> str | None:
    kind = "hub_issue" if hub_id is not None else "ticket"
    subject_id = hub_id if hub_id is not None else ticket_id
    if subject_id is None:
        raise ValueError("ticket_id or hub_id required")
    # Callers have completed their writes; end their authorization/read transaction
    # before Redis or external I/O. This service already owns the commit boundary.
    db.commit()
    try:
        with _draft_lease(kind, subject_id) as lease:
            if lease is None:
                return None
            return _generate_answer_draft(
                db, ticket_id=ticket_id, hub_id=hub_id, initial=initial, lease=lease,
            )
    finally:
        # Also release read transactions on idempotent, deleted and error paths.
        db.rollback()


def _generate_answer_draft(
    db: Session,
    *,
    ticket_id: int | None = None,
    hub_id: int | None = None,
    initial: bool = False,
    lease: Lock,
) -> str | None:
    """Save an AI draft/audit only; never send, change status or replace a human reply."""
    kind = "hub_issue" if hub_id is not None else "ticket"
    subject_id = hub_id if hub_id is not None else ticket_id
    if subject_id is None:
        raise ValueError("ticket_id or hub_id required")
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
    # Context is now plain data; return the connection before waiting for the Agent.
    db.commit()
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
    if not lease.owned():
        logger.warning("ai_draft_stale_result_discarded", subject_type=kind, subject_id=subject_id)
        return None
    # Reload and lock only for the short write phase. A human reply made during
    # the network call must be observed, including updates from another session.
    subject = db.scalar(
        select(HubIssue if hub_id is not None else Ticket)
        .where((HubIssue.id if hub_id is not None else Ticket.id) == subject_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if subject is None:
        return None
    ticket = subject if hub_id is None else None
    hub = subject if hub_id is not None else None
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
    """Generate a first draft after classification; isolate errors from routing."""
    from app.db import make_session

    db = make_session()
    try:
        generate_answer_draft(db, ticket_id=ticket_id, initial=True)
    except Exception:
        db.rollback()
        logger.exception("initial_ticket_ai_draft_failed", ticket_id=ticket_id)
    finally:
        db.close()
