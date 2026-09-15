from unittest.mock import Mock, patch

import pytest

from adapters.ai_cs.types import ReplayResult
from app.models import AgentDecision, HubIssue, Source, SyncOutbox, Ticket
from app.services.agents.answer_draft import generate_answer_draft


def seed(db, kind="Raw"):
    db.add(Source(code="ksm", name="KSM"))
    ticket = Ticket(
        short_code="TKT-draft",
        source_code="ksm",
        source_ticket_id="draft",
        type="Raw",
        predicted_type=kind,
        status="received",
        title=None,
        body='<img src="https://example.com/a.png">',
    )
    db.add(ticket)
    db.commit()
    return ticket


@pytest.mark.parametrize("kind", ["Operation", "Bug_fix", "Demand", "Complaint", None])
def test_initial_all_types_without_title_and_manual_repeat(db_session, kind):
    ticket = seed(db_session, kind)
    client = Mock()
    client.answer_with_images.return_value = ReplayResult(
        answer="图片中的处理建议", cited_knowledge=[], skills_used=[], trace_id="test"
    )
    with patch("app.services.agents.answer_draft.build_client", return_value=client):
        assert generate_answer_draft(db_session, ticket_id=ticket.id, initial=True)
        assert generate_answer_draft(db_session, ticket_id=ticket.id, initial=True)
        assert client.answer_with_images.call_count == 1
        assert generate_answer_draft(db_session, ticket_id=ticket.id)
        assert client.answer_with_images.call_count == 2
    assert client.answer_with_images.call_args.kwargs["images"] == ["https://example.com/a.png"]
    assert ticket.status == "received" and ticket.hub_issue_id is None
    assert ticket.cached_reply_content is None
    assert ticket.source_payload["_ai_answer_draft"] == "图片中的处理建议"
    assert db_session.query(SyncOutbox).count() == 0
    assert db_session.query(AgentDecision).count() == 2


@pytest.mark.parametrize("kind", ["Operation", "Bug_fix", "Demand", "Internal_task"])
def test_manual_preserves_human_reply_and_status(db_session, kind):
    ticket = seed(db_session)
    hub = HubIssue(
        short_code="HUB-draft",
        ticket_id=ticket.id,
        type=kind,
        title="问题",
        status="resolved",
        reply_content="人工已发送内容",
        reply_authored_by="user:1",
        reply_is_draft=False,
    )
    db_session.add(hub)
    db_session.commit()
    client = Mock()
    client.answer_with_images.return_value = ReplayResult(
        answer="新的 AI 草稿", cited_knowledge=[], skills_used=[], trace_id="test"
    )
    with patch("app.services.agents.answer_draft.build_client", return_value=client):
        assert generate_answer_draft(db_session, hub_id=hub.id) == "新的 AI 草稿"
    assert hub.reply_content == "人工已发送内容" and hub.status == "resolved"
    assert not hub.reply_is_draft
    assert db_session.query(SyncOutbox).count() == 0


def test_failure_does_not_change_ticket(db_session):
    ticket = seed(db_session)
    with (
        patch("app.services.agents.answer_draft.build_client", side_effect=RuntimeError("offline")),
        pytest.raises(RuntimeError),
    ):
        generate_answer_draft(db_session, ticket_id=ticket.id)
    assert ticket.status == "received"
    assert not ticket.source_payload
    assert db_session.query(SyncOutbox).count() == 0


def test_ticket_endpoint_authorization_and_repeat(app_client, db_session):
    from app.api.auth import issue_jwt

    ticket = seed(db_session)
    path = f"/api/tickets/{ticket.id}/generate-ai-answer"
    assert app_client.post(path).status_code == 401
    token, _ = issue_jwt(sub="88", name="member", role="member")
    assert app_client.post(path, headers={"Authorization": f"Bearer {token}"}).status_code == 404
    token, _ = issue_jwt(sub="1", name="admin", role="admin")
    with patch("app.services.agents.answer_draft.generate_answer_draft", return_value="新草稿") as call:
        for _ in range(2):
            response = app_client.post(path, headers={"Authorization": f"Bearer {token}"})
            assert response.status_code == 200
            assert response.json()["reply_content"] == "新草稿"
        assert call.call_count == 2


def test_initial_precedes_classification_even_when_classification_fails():
    from app.api.webhooks import run_post_ingest_agents

    order = []
    with (
        patch("app.services.agents.answer_draft.generate_initial_ticket_answer", side_effect=lambda _: order.append("answer")),
        patch("app.api.webhooks.run_ticket_triage", side_effect=lambda _: order.append("classify")),
    ):
        run_post_ingest_agents(123)
    assert order == ["answer", "classify"]
