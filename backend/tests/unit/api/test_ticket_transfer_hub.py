"""Tests for creating a missing primary Hub before a manual dev transfer."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import issue_jwt
from app.models import HubIssue, Ticket, TicketHubIssueHistory, User


def _bearer(uid: int = 1, *, name: str = "alice", role: str = "assignee") -> dict[str, str]:
    token, _ = issue_jwt(sub=str(uid), name=name, role=role)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def transfer_world(db_session: Session) -> Session:
    db_session.add(User(id=1, feishu_uid="ou_transfer", name="alice", role="assignee"))
    db_session.add(
        Ticket(
            id=901,
            short_code="TKT-000901",
            source_code="ksm",
            source_ticket_id="ksm-901",
            type="Raw",
            status="processing",
            title="低置信度工单人工转产研",
            predicted_type="Operation",
            predicted_confidence=0.7,
            assigned_user_id=1,
            handler_user_id=1,
        )
    )
    db_session.commit()
    return db_session


def test_primary_transfer_subtask_creates_and_links_hub(
    app_client: TestClient, transfer_world: Session
) -> None:
    payload = {
        "title": "扫码采集无反应",
        "type": "Bug_fix",
        "product_line_code": "PROLINE6053",
        "module": "收票助手（发票采集）",
        "solution": "已复现扫码后无响应，转产研排查",
        "assigned_user_id": 1,
        "primary_for_transfer": True,
    }

    resp = app_client.post("/api/tickets/901/subtasks", json=payload, headers=_bearer())
    assert resp.status_code == 200, resp.text
    body = resp.json()

    transfer_world.expire_all()
    ticket = transfer_world.get(Ticket, 901)
    hub = transfer_world.get(HubIssue, body["id"])
    assert ticket is not None
    assert hub is not None
    assert ticket.hub_issue_id == hub.id
    assert ticket.predicted_type == "Bug_fix"
    assert ticket.product_line_code == "PROLINE6053"
    assert ticket.module == "收票助手（发票采集）"
    assert hub.type == "Bug_fix"
    assert hub.reply_content == "已复现扫码后无响应，转产研排查"
    assert hub.reply_is_draft is False

    relation = transfer_world.execute(
        select(TicketHubIssueHistory).where(TicketHubIssueHistory.ticket_id == 901)
    ).scalar_one()
    assert relation.hub_issue_id == hub.id
    assert relation.human_confirmed is True

    # 网络超时后的相同请求必须复用已创建的主 Hub，不能再产生第二条记录。
    retry = app_client.post("/api/tickets/901/subtasks", json=payload, headers=_bearer())
    assert retry.status_code == 200, retry.text
    assert retry.json()["id"] == hub.id
    transfer_world.expire_all()
    assert transfer_world.execute(
        select(HubIssue).where(HubIssue.ticket_id == 901, HubIssue.deleted_at.is_(None))
    ).scalars().all() == [hub]


def test_primary_transfer_subtask_rejects_missing_solution(
    app_client: TestClient, transfer_world: Session
) -> None:
    resp = app_client.post(
        "/api/tickets/901/subtasks",
        json={
            "title": "扫码采集无反应",
            "type": "Demand",
            "product_line_code": "PROLINE6053",
            "module": "收票助手（发票采集）",
            "solution": "",
            "primary_for_transfer": True,
        },
        headers=_bearer(),
    )
    assert resp.status_code == 400
    assert "任务解决方案" in resp.text
    transfer_world.expire_all()
    assert transfer_world.get(Ticket, 901).hub_issue_id is None
