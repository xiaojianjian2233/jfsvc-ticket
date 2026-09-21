from unittest.mock import Mock, patch

import pytest

from adapters.ai_cs.types import ReplayResult
from app.models import AgentDecision, HubIssue, Source, SyncOutbox, Ticket
from app.services.agents.answer_draft import generate_answer_draft


@pytest.fixture(autouse=True)
def draft_lease():
    lease = Mock()
    lease.owned.return_value = True
    with patch("app.services.agents.answer_draft._draft_lease") as acquire:
        acquire.return_value.__enter__.return_value = lease
        yield acquire


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
    assert app_client.post(path, headers={"Authorization": f"Bearer {token}"}).status_code == 403
    token, _ = issue_jwt(sub="1", name="admin", role="admin")
    with patch(
        "app.services.agents.answer_draft.generate_answer_draft", return_value="新草稿"
    ) as call:
        for _ in range(2):
            response = app_client.post(path, headers={"Authorization": f"Bearer {token}"})
            assert response.status_code == 200
            assert response.json()["reply_content"] == "新草稿"
        assert call.call_count == 2


def test_initial_uses_resolved_catalog_before_routing():
    from app.api.webhooks import run_post_ingest_agents
    from app.services.agents.triage import TriageResult

    order = []
    triage = TriageResult(
        type="Bug_fix",
        confidence=0.9,
        reason="test",
        is_mixed=False,
        sub_problems=(),
        cost_usd=0.0,
        model="fake",
        raw={},
    )
    with (
        patch(
            "app.services.agents.answer_draft.generate_initial_ticket_answer",
            side_effect=lambda _: order.append("answer"),
        ),
        patch(
            "app.api.webhooks.run_ticket_triage",
            side_effect=lambda _: (order.append("classify"), triage)[1],
        ),
        patch("app.api.webhooks._resolve_module", side_effect=lambda _: order.append("catalog")),
        patch(
            "app.api.webhooks._route_by_type",
            side_effect=lambda *args, **kwargs: order.append("route"),
        ),
    ):
        run_post_ingest_agents(123)
    assert order == ["classify", "catalog", "answer", "route"]


def test_initial_still_runs_when_classification_fails():
    from app.api.webhooks import run_post_ingest_agents

    order = []
    with (
        patch(
            "app.services.agents.answer_draft.generate_initial_ticket_answer",
            side_effect=lambda _: order.append("answer"),
        ),
        patch("app.api.webhooks.run_ticket_triage", side_effect=lambda _: order.append("classify")),
        patch("app.api.webhooks._resolve_module", side_effect=lambda _: order.append("catalog")),
    ):
        run_post_ingest_agents(123)
    assert order == ["classify", "catalog", "answer"]


def test_escalation_resolves_catalog_before_initial_answer():
    from app.api.webhooks import run_escalation_agents

    order = []
    with (
        patch("app.api.webhooks.classify_escalation_ticket", return_value=None),
        patch("app.api.webhooks._resolve_module", side_effect=lambda _: order.append("catalog")),
        patch(
            "app.services.agents.answer_draft.generate_initial_ticket_answer",
            side_effect=lambda _: order.append("answer"),
        ),
        patch("app.api.webhooks._route_by_type") as route,
    ):
        run_escalation_agents(123)
    assert order == ["catalog", "answer"]
    route.assert_not_called()


def test_agent_wait_has_no_database_transaction(db_session):
    ticket = seed(db_session)

    def replay(*args, **kwargs):
        assert not db_session.in_transaction()
        return ReplayResult(answer="draft", cited_knowledge=[], skills_used=[], trace_id="test")

    with (
        patch("app.services.agents.answer_draft._replay_with_retry", side_effect=replay),
        patch("app.services.agents.answer_draft.build_client"),
    ):
        assert generate_answer_draft(db_session, ticket_id=ticket.id) == "draft"
    assert not db_session.in_transaction()


def test_busy_subject_does_not_call_agent(db_session, draft_lease):
    ticket = seed(db_session)
    draft_lease.return_value.__enter__.return_value = None
    with patch("app.services.agents.answer_draft.build_client") as client:
        assert generate_answer_draft(db_session, ticket_id=ticket.id) is None
        client.assert_not_called()
    assert not db_session.in_transaction()


def test_expired_lease_does_not_save_stale_answer(db_session, draft_lease):
    ticket = seed(db_session)
    draft_lease.return_value.__enter__.return_value.owned.return_value = False
    with patch("app.services.agents.answer_draft.build_client") as client:
        client.return_value.answer_with_images.return_value = ReplayResult(
            answer="stale", cited_knowledge=[], skills_used=[], trace_id="test"
        )
        assert generate_answer_draft(db_session, ticket_id=ticket.id) is None
    assert db_session.query(AgentDecision).count() == 0


def test_human_reply_arriving_during_agent_wait_is_preserved(db_session):
    from sqlalchemy.orm import Session

    ticket = seed(db_session)
    hub = HubIssue(
        short_code="HUB-race", ticket_id=ticket.id, type="Operation", title="问题", status="created"
    )
    db_session.add(hub)
    db_session.commit()
    hub_id = hub.id

    def replay(*args, **kwargs):
        assert not db_session.in_transaction()
        with Session(db_session.get_bind()) as other:
            current = other.get(HubIssue, hub_id)
            current.reply_content = "人工新答复"
            current.reply_authored_by = "user:1"
            current.reply_is_draft = False
            other.commit()
        return ReplayResult(answer="AI旧结果", cited_knowledge=[], skills_used=[], trace_id="test")

    with (
        patch("app.services.agents.answer_draft._replay_with_retry", side_effect=replay),
        patch("app.services.agents.answer_draft.build_client"),
    ):
        generate_answer_draft(db_session, hub_id=hub_id)
    db_session.refresh(hub)
    assert hub.reply_content == "人工新答复"
    assert not hub.reply_is_draft
