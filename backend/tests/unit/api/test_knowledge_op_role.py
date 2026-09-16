"""反思诊断与训练临时收紧为 admin-only。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.auth import issue_jwt
from app.models import User


def _bearer(uid: int, *, name: str = "kop", role: str = "knowledge_op") -> dict[str, str]:
    token, _ = issue_jwt(sub=str(uid), name=name, role=role)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def world(db_session: Session) -> Session:
    db_session.add(User(id=3, feishu_uid="ou_kop", name="kop", role="knowledge_op"))
    db_session.add(User(id=1, feishu_uid="ou_admin", name="boss", role="admin"))
    db_session.commit()
    return db_session


# ---- 反思工作台端点组：knowledge_op 放行 -------------------------------------


def test_kop_blocked_from_escalation_queue(app_client: TestClient, world: Session) -> None:
    r = app_client.get("/api/supervisor/escalation-pending-diagnosis", headers=_bearer(3))
    assert r.status_code == 403


def test_kop_blocked_from_ai_cs_status(app_client: TestClient, world: Session) -> None:
    r = app_client.get("/api/supervisor/ai-cs/status", headers=_bearer(3))
    assert r.status_code == 403


def test_supervisor_blocked_from_reflect(app_client: TestClient, world: Session) -> None:
    r = app_client.get(
        "/api/supervisor/escalation-pending-diagnosis",
        headers=_bearer(2, name="carol", role="supervisor"),
    )
    assert r.status_code == 403


def test_admin_allowed_into_reflect(app_client: TestClient, world: Session) -> None:
    r = app_client.get(
        "/api/supervisor/escalation-pending-diagnosis",
        headers=_bearer(1, name="boss", role="admin"),
    )
    assert r.status_code == 200


# ---- 主管专属：knowledge_op 403 ----------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/supervisor/split-proposals",
        "/api/supervisor/dedup-proposals",
        "/api/supervisor/complaint-tickets",
        "/api/supervisor/pending-hub-issues",
        "/api/supervisor/inbox",
        "/api/supervisor/config-warnings",
    ],
)
def test_kop_blocked_from_supervisor_queues(
    app_client: TestClient, world: Session, path: str
) -> None:
    r = app_client.get(path, headers=_bearer(3))
    assert r.status_code == 403, path


def test_kop_blocked_from_internal_skills_read(app_client: TestClient, world: Session) -> None:
    r = app_client.get("/api/admin/skills", headers=_bearer(3))
    assert r.status_code == 403


def test_kop_blocked_from_internal_skills_write(app_client: TestClient, world: Session) -> None:
    r = app_client.post("/api/admin/skills/import-from-files", headers=_bearer(3))
    assert r.status_code == 403


def test_kop_blocked_from_user_admin(app_client: TestClient, world: Session) -> None:
    r = app_client.get("/api/admin/users", headers=_bearer(3))
    assert r.status_code == 403


def test_member_blocked_from_reflect_group(app_client: TestClient, world: Session) -> None:
    r = app_client.get(
        "/api/supervisor/escalation-pending-diagnosis",
        headers=_bearer(9, name="m", role="member"),
    )
    assert r.status_code == 403


# ---- 角色分配 ----------------------------------------------------------------


def test_admin_can_assign_knowledge_op_role(app_client: TestClient, world: Session) -> None:
    r = app_client.patch(
        "/api/admin/users/3",
        json={"role": "knowledge_op"},
        headers=_bearer(1, name="boss", role="admin"),
    )
    # 端点存在且 pattern 放行该角色值（幂等赋同值）
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "knowledge_op"
