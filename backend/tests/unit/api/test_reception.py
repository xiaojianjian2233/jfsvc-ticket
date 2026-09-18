"""Unit tests for Online Reception API (Agents, Sessions, Workbench)."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.auth import issue_jwt
from app.api.reception import generate_session_id
from app.models import ReceptionAgent, ReceptionMessage, ReceptionSession, User


def _bearer(uid: int = 1, *, name: str = "alice", role: str = "admin") -> dict[str, str]:
    token, _ = issue_jwt(sub=str(uid), name=name, role=role)
    return {"Authorization": f"Bearer {token}"}


def test_generate_session_id_format(db_session: Session) -> None:
    sid = generate_session_id(db_session)
    assert sid.startswith("ZXHH")
    assert len(sid) == 16  # ZXHH (4) + YYYYMMDD (8) + 0001 (4)


def test_agents_crud(client: TestClient, db_session: Session) -> None:
    # 1. 准备用户
    u1 = User(id=101, feishu_uid="ou_101", name="坐席小李", role="assignee", is_active=True)
    u2 = User(id=102, feishu_uid="ou_102", name="坐席小张", role="assignee", is_active=True)
    db_session.add_all([u1, u2])
    db_session.commit()

    headers = _bearer(101, name="坐席小李")

    # 2. 获取可用用户
    r = client.get("/api/reception/eligible-users", headers=headers)
    assert r.status_code == 200
    user_names = [u["name"] for u in r.json()]
    assert "坐席小李" in user_names

    # 3. 添加坐席
    r = client.post(
        "/api/reception/agents",
        json={"user_id": 101, "nickname": "小李客服", "max_concurrent": 8},
        headers=headers,
    )
    assert r.status_code == 201
    agent1 = r.json()
    assert agent1["nickname"] == "小李客服"
    assert agent1["max_concurrent"] == 8
    assert agent1["status"] == "offline"

    # 4. 再次添加相同用户应报错 409
    r_dup = client.post(
        "/api/reception/agents",
        json={"user_id": 101, "nickname": "小李2", "max_concurrent": 5},
        headers=headers,
    )
    assert r_dup.status_code == 409

    # 5. 编辑坐席
    r_update = client.put(
        f"/api/reception/agents/{agent1['id']}",
        json={"nickname": "资深客服小李", "max_concurrent": 10, "status": "online"},
        headers=headers,
    )
    assert r_update.status_code == 200
    assert r_update.json()["nickname"] == "资深客服小李"
    assert r_update.json()["status"] == "online"

    # 6. 查询列表
    r_list = client.get("/api/reception/agents?name=小李&statuses=online", headers=headers)
    assert r_list.status_code == 200
    assert r_list.json()["total"] == 1

    # 7. 批量删除
    r_del = client.post(
        "/api/reception/agents/batch-remove",
        json={"agent_ids": [agent1["id"]]},
        headers=headers,
    )
    assert r_del.status_code == 200
    assert r_del.json()["removed_count"] == 1


def test_session_list_and_detail(client: TestClient, db_session: Session) -> None:
    headers = _bearer(1, name="admin", role="admin")

    s1 = ReceptionSession(
        id="ZXHH202609180001",
        company_name="腾讯科技（深圳）有限公司",
        tax_no="91440300708461136T",
        tenant_no="TENANT-001",
        tenant_name="腾讯集团总租户",
        contact_name="张经理",
        contact_phone="13800138000",
        status="in_progress",
        is_human=True,
        agent_name="杨慧莉",
        summary="客户咨询数电发票开具超时与额度调整流程",
        session_type="online",
    )
    m1 = ReceptionMessage(
        session_id=s1.id,
        sender_type="customer",
        sender_name="张经理",
        content="你好，请问我们公司的发票授信额度本月用完了如何申请临时加额？",
    )
    m2 = ReceptionMessage(
        session_id=s1.id,
        sender_type="agent",
        sender_name="杨慧莉",
        content="张经理您好，可以通过电子发票平台提交额度调整申请。",
    )
    db_session.add_all([s1, m1, m2])
    db_session.commit()

    # 1. 列表筛选
    r = client.get("/api/reception/sessions?company_name=腾讯&is_human=是", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["id"] == "ZXHH202609180001"
    assert data["items"][0]["tenant_no"] == "TENANT-001"
    assert data["items"][0]["tenant_name"] == "腾讯集团总租户"

    # 2. 详情与消息
    r_detail = client.get("/api/reception/sessions/ZXHH202609180001", headers=headers)
    assert r_detail.status_code == 200
    d = r_detail.json()
    assert d["session"]["company_name"] == "腾讯科技（深圳）有限公司"
    assert len(d["messages"]) == 2
    assert d["messages"][0]["sender_type"] == "customer"


def test_workbench_flow(client: TestClient, db_session: Session) -> None:
    headers = _bearer(35, name="杨慧莉", role="admin")

    s_queue = ReceptionSession(
        id="ZXHH202609180002",
        company_name="阿里巴巴（中国）网络技术有限公司",
        status="queue",
        session_type="online",
    )
    s_prog = ReceptionSession(
        id="ZXHH202609180003",
        company_name="百度在线网络技术（北京）有限公司",
        status="in_progress",
        session_type="online",
    )
    db_session.add_all([s_queue, s_prog])
    db_session.commit()

    # 1. 查询工作台队列与数量
    r = client.get("/api/reception/workbench/sessions", headers=headers)
    assert r.status_code == 200
    q_data = r.json()
    assert q_data["counts"]["online_queue"] >= 1
    assert q_data["counts"]["online_in_progress"] >= 1

    # 2. 邀请排队进入进行中
    r_inv = client.post("/api/reception/workbench/sessions/ZXHH202609180002/invite", headers=headers)
    assert r_inv.status_code == 200
    assert r_inv.json()["status"] == "in_progress"

    # 3. 挂起会话
    r_sus = client.post(
        "/api/reception/workbench/sessions/ZXHH202609180002/suspend", headers=headers
    )
    assert r_sus.status_code == 200
    assert r_sus.json()["status"] == "pending"

    # 4. 重新激活会话
    r_act = client.post(
        "/api/reception/workbench/sessions/ZXHH202609180002/activate", headers=headers
    )
    assert r_act.status_code == 200
    assert r_act.json()["status"] == "in_progress"

    # 5. 发送消息
    r_send = client.post(
        "/api/reception/workbench/sessions/ZXHH202609180002/send-message",
        json={"content": "您的问题我们正在跟进中。"},
        headers=headers,
    )
    assert r_send.status_code == 200
    assert r_send.json()["content"] == "您的问题我们正在跟进中。"

    # 6. 转工单
    r_trans = client.post(
        "/api/reception/workbench/sessions/ZXHH202609180002/transfer-ticket",
        json={"title": "转研发处理"},
        headers=headers,
    )
    assert r_trans.status_code == 200
    assert r_trans.json()["status"] == "converted"
    assert "TKT-" in r_trans.json()["ticket_short_code"]

    # 7. 关闭会话
    r_close = client.post(
        "/api/reception/workbench/sessions/ZXHH202609180003/close", headers=headers
    )
    assert r_close.status_code == 200
    assert r_close.json()["status"] == "closed"

    # 8. 坐席助手搜索
    r_search = client.get(
        "/api/reception/workbench/assistant-search?type=knowledge&query=数电", headers=headers
    )
    assert r_search.status_code == 200
    assert len(r_search.json()) >= 1
