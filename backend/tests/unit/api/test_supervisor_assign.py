"""Tests for POST /api/supervisor/assign (manual指派端点)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.auth import issue_jwt
from app.models import Source, Ticket, User


def _bearer(user_id: int, *, name: str = "test", role: str = "supervisor") -> dict[str, str]:
    token, _ = issue_jwt(sub=str(user_id), name=name, role=role)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def assign_world(db_session: Session) -> Session:
    db_session.add(Source(code="ksm", name="KSM"))
    db_session.add_all(
        [
            User(id=1, feishu_uid="ou_carol", name="carol", role="supervisor"),
            User(id=2, feishu_uid="ou_bob", name="bob", role="member"),
            User(id=3, feishu_uid="ou_dev", name="dev", role="assignee"),
        ]
    )
    db_session.flush()
    db_session.add_all(
        [
            Ticket(
                id=100,
                short_code="A-1",
                source_code="ksm",
                source_ticket_id="ksm-1",
                type="Raw",
                status="received",
            ),
            Ticket(
                id=101,
                short_code="A-2",
                source_code="ksm",
                source_ticket_id="ksm-2",
                type="Raw",
                status="received",
            ),
            Ticket(
                id=102,
                short_code="A-3",
                source_code="ksm",
                source_ticket_id="ksm-3",
                type="Raw",
                status="received",
            ),
        ]
    )
    db_session.commit()
    return db_session


def test_assign_endpoint_success(app_client: TestClient, assign_world: Session) -> None:
    resp = app_client.post(
        "/api/supervisor/assign",
        json={"ticket_ids": [100], "assigned_user_id": 3},
        headers=_bearer(1),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["assigned_count"] == 1
    assert body["not_found_count"] == 0
    assert body["results"][0]["success"] is True
    assert body["results"][0]["ticket_id"] == 100

    assign_world.expire_all()
    ticket = assign_world.get(Ticket, 100)
    assert ticket is not None
    # 转交改处理人（handler_user_id），责任人不动
    assert ticket.handler_user_id == 3


def test_assign_endpoint_member_target_rejected(
    app_client: TestClient, assign_world: Session
) -> None:
    """member 是只读角色，不能作为转交目标。"""
    resp = app_client.post(
        "/api/supervisor/assign",
        json={"ticket_ids": [101], "assigned_user_id": 2},  # bob is 'member'
        headers=_bearer(1),
    )
    assert resp.status_code == 422, resp.text


def test_assign_endpoint_requires_supervisor(app_client: TestClient, assign_world: Session) -> None:
    # member 试图移交别人的工单（ticket 102 handler is None != 2）-> 403
    resp = app_client.post(
        "/api/supervisor/assign",
        json={"ticket_ids": [102], "assigned_user_id": 3},
        headers=_bearer(2, role="member"),
    )
    assert resp.status_code == 403


def test_assign_endpoint_member_cannot_transfer_own_ticket(
    app_client: TestClient, assign_world: Session
) -> None:
    # 历史数据即使仍把 member 记为处理人，也不允许执行移交。
    t = assign_world.get(Ticket, 102)
    assert t is not None
    t.handler_user_id = 2
    assign_world.commit()

    resp = app_client.post(
        "/api/supervisor/assign",
        json={"ticket_ids": [102], "assigned_user_id": 3},
        headers=_bearer(2, role="member"),
    )
    assert resp.status_code == 403
