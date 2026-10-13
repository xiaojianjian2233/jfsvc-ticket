"""共享 Hub 重复工单生命周期边界测试。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import HubIssue, Source, SyncOutbox, Ticket
from app.services.cascade.reply_sync import author_reply
from app.services.cascade.status_cascade import apply_hub_status
from app.services.hub_issues.duplicate_attach import (
    REOPEN_NOTE,
    attach_duplicate_ticket,
    candidate_is_eligible,
)
from app.services.ksm.cancel_state import (
    KSM_CANCELLED_NOTE,
    KSM_CUSTOMER_CANCELLED_REASON,
    apply_ksm_cancelled,
)


def _source(db: Session) -> None:
    db.add(Source(code="ksm", name="KSM"))
    db.flush()


def _ticket(db: Session, n: int, **overrides) -> Ticket:  # type: ignore[no-untyped-def]
    values = {
        "short_code": f"TKT-SHARED-{n}",
        "source_code": "ksm",
        "source_ticket_id": f"R-SHARED-{n}",
        "type": "Raw",
        "status": "processing",
        "process_stage": "服务处理",
        "title": "开票后状态不同步",
        "body": "同一客户操作后状态仍未同步",
        "predicted_type": "Operation",
    }
    values.update(overrides)
    row = Ticket(**values)
    db.add(row)
    db.flush()
    return row


def _hub(db: Session, ticket: Ticket, **overrides) -> HubIssue:  # type: ignore[no-untyped-def]
    values = {
        "ticket_id": ticket.id,
        "short_code": f"HUB-SHARED-{ticket.id}",
        "type": "Operation",
        "title": ticket.title,
        "canonical_body": ticket.body,
        "status": "processing",
        "op_status": "processing",
        "op_handler": "agent",
        "occurrence_count": 1,
    }
    values.update(overrides)
    hub = HubIssue(**values)
    db.add(hub)
    db.flush()
    ticket.hub_issue_id = hub.id
    db.flush()
    return hub


def test_cancelling_one_of_two_tickets_does_not_close_shared_hub(
    db_session: Session,
) -> None:
    _source(db_session)
    cancelled = _ticket(db_session, 1)
    active = _ticket(db_session, 2)
    hub = _hub(db_session, cancelled)
    active.hub_issue_id = hub.id
    db_session.flush()

    apply_ksm_cancelled(db_session, cancelled)
    db_session.flush()

    assert cancelled.status == "closed"
    assert cancelled.closed_reason == KSM_CUSTOMER_CANCELLED_REASON
    assert cancelled.cached_reply_content == KSM_CANCELLED_NOTE
    assert active.status == "processing"
    assert hub.status == "processing"
    assert hub.op_status == "processing"
    assert hub.reply_content is None


def test_last_active_ticket_cancel_closes_shared_hub(db_session: Session) -> None:
    _source(db_session)
    first = _ticket(db_session, 3)
    second = _ticket(db_session, 4)
    hub = _hub(db_session, first)
    second.hub_issue_id = hub.id
    db_session.flush()

    apply_ksm_cancelled(db_session, first)
    apply_ksm_cancelled(db_session, second)
    db_session.flush()

    assert hub.status == "closed"
    assert hub.op_status == "closed"


def test_shared_reply_skips_customer_cancelled_ticket(db_session: Session) -> None:
    _source(db_session)
    cancelled = _ticket(db_session, 5)
    active = _ticket(db_session, 6)
    hub = _hub(db_session, cancelled)
    active.hub_issue_id = hub.id
    apply_ksm_cancelled(db_session, cancelled)
    db_session.flush()

    result = author_reply(
        db_session,
        hub.id,
        content="请重新同步后再查看。",
        authored_by="user:handler",
    )

    db_session.refresh(cancelled)
    db_session.refresh(active)
    assert result.cascaded_ticket_ids == [active.id]
    assert cancelled.cached_reply_content == KSM_CANCELLED_NOTE
    assert active.cached_reply_content == "请重新同步后再查看。"
    assert db_session.query(SyncOutbox).filter_by(ticket_id=cancelled.id).count() == 0
    assert db_session.query(SyncOutbox).filter_by(ticket_id=active.id, kind="reply").count() == 1


def test_cancelled_only_hub_is_eligible_and_reactivated(db_session: Session) -> None:
    _source(db_session)
    old = _ticket(db_session, 7)
    hub = _hub(db_session, old)
    apply_ksm_cancelled(db_session, old)
    new = _ticket(db_session, 8, status="received")

    assert candidate_is_eligible(db_session, hub) is True
    result = attach_duplicate_ticket(db_session, new, hub, matched_score=1.0)
    db_session.flush()

    assert result.reactivated_for_linear is False
    assert hub.status == "processing"
    assert hub.op_status == "processing"
    assert new.hub_issue_id == hub.id
    assert new.status == "processing"
    assert new.closed_reason is None
    assert old.status == "closed"
    assert old.cached_reply_content == KSM_CANCELLED_NOTE


def test_supplementing_and_unanswered_closed_hubs_are_not_eligible(
    db_session: Session,
) -> None:
    _source(db_session)
    ticket = _ticket(db_session, 9)
    supplementing = _hub(db_session, ticket, status="supplementing", op_status="supplementing")
    assert candidate_is_eligible(db_session, supplementing) is False

    ticket2 = _ticket(db_session, 10)
    closed = _hub(db_session, ticket2, status="closed", op_status="closed")
    ticket2.status = "closed"
    assert candidate_is_eligible(db_session, closed) is False


def test_completed_dev_hub_reopens_and_archives_old_linear_cycle(
    db_session: Session,
) -> None:
    _source(db_session)
    old = _ticket(
        db_session,
        11,
        status="answered",
        process_stage="完成",
        predicted_type="Demand",
        cached_reply_content="旧处理说明",
        cached_reply_version=1,
    )
    hub = _hub(
        db_session,
        old,
        type="Demand",
        status="released",
        op_status=None,
        op_handler=None,
        linear_uuid="linear-old-uuid",
        linear_identifier="CNPRD-100",
        linear_status="Done",
        reply_content="旧处理说明",
        reply_content_version=1,
        reply_authored_by="user:owner",
    )
    new = _ticket(db_session, 12, status="received", predicted_type="Demand")

    result = attach_duplicate_ticket(db_session, new, hub, matched_score=0.99)
    db_session.flush()

    assert result.reactivated_for_linear is True
    assert hub.status == "dev_returned"
    assert hub.linear_uuid is None
    assert hub.linear_identifier is None
    assert hub.linear_history is not None
    assert hub.linear_history[-1]["linear_identifier"] == "CNPRD-100"
    assert hub.reply_content == f"旧处理说明\n{REOPEN_NOTE}"
    assert hub.ticket_id == new.id
    assert new.status == "processing"
    assert new.process_stage == "研发处理"
    assert old.status == "answered"  # 旧周期已结束工单不回滚
    assert old.cached_reply_content == "旧处理说明"

    old_stage = old.process_stage
    apply_hub_status(
        db_session,
        hub,
        to_status="in_progress",
        changed_by="agent:linear_status_sync",
    )
    db_session.flush()
    assert new.status == "processing"
    assert new.process_stage == "研发处理"
    assert old.status == "answered"
    assert old.process_stage == old_stage


def test_returned_hub_auto_returns_new_duplicate_with_same_note(db_session: Session) -> None:
    _source(db_session)
    old = _ticket(
        db_session,
        13,
        status="transferred_return",
        process_stage="完成",
        cached_reply_content="请转其他模块处理",
    )
    hub = _hub(
        db_session,
        old,
        status="returned",
        op_status="transferred_return",
    )
    db_session.add(
        SyncOutbox(
            kind="return",
            target_source_code="ksm",
            ticket_id=old.id,
            source_ticket_id=old.source_ticket_id,
            hub_issue_id=hub.id,
            payload={"deal_opinion": "请转其他模块处理"},
            status="sent",
        )
    )
    db_session.flush()
    new = _ticket(db_session, 14, status="received")

    result = attach_duplicate_ticket(db_session, new, hub, matched_score=1.0)
    db_session.flush()

    assert result.queued_return is True
    assert new.status == "transferred_return"
    assert new.process_stage == "完成"
    pending = (
        db_session.query(SyncOutbox)
        .filter_by(ticket_id=new.id, kind="return", status="pending")
        .one()
    )
    assert pending.payload["deal_opinion"] == "请转其他模块处理"
