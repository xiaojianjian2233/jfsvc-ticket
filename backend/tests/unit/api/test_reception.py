"""Unit tests for Online Reception API (Agents, Sessions, Workbench)."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.auth import issue_jwt
from app.api.reception import generate_session_id
from app.models import ReceptionMessage, ReceptionSession, User


def _bearer(uid: int = 1, *, name: str = "alice", role: str = "admin") -> dict[str, str]:
    token, _ = issue_jwt(sub=str(uid), name=name, role=role)
    return {"Authorization": f"Bearer {token}"}


def test_generate_session_id_format(db_session: Session) -> None:
    sid = generate_session_id(db_session)
    assert sid.startswith("ZXHH")
    assert len(sid) == 16  # ZXHH (4) + YYYYMMDD (8) + 0001 (4)


def test_agents_crud(app_client: TestClient, db_session: Session) -> None:
    # 1. 准备用户
    u1 = User(id=101, feishu_uid="ou_101", name="坐席小李", role="assignee", is_active=True)
    u2 = User(id=102, feishu_uid="ou_102", name="坐席小张", role="assignee", is_active=True)
    db_session.add_all([u1, u2])
    db_session.commit()

    headers = _bearer(101, name="坐席小李")

    # 2. 获取可用用户
    r = app_client.get("/api/reception/eligible-users", headers=headers)
    assert r.status_code == 200
    user_names = [u["name"] for u in r.json()]
    assert "坐席小李" in user_names

    # 3. 添加坐席
    r = app_client.post(
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
    r_dup = app_client.post(
        "/api/reception/agents",
        json={"user_id": 101, "nickname": "小李2", "max_concurrent": 5},
        headers=headers,
    )
    assert r_dup.status_code == 409

    # 5. 编辑坐席
    r_update = app_client.put(
        f"/api/reception/agents/{agent1['id']}",
        json={"nickname": "资深客服小李", "max_concurrent": 10, "status": "online"},
        headers=headers,
    )
    assert r_update.status_code == 200
    assert r_update.json()["nickname"] == "资深客服小李"
    assert r_update.json()["status"] == "online"

    # 6. 查询列表
    r_list = app_client.get("/api/reception/agents?name=小李&statuses=online", headers=headers)
    assert r_list.status_code == 200
    assert r_list.json()["total"] == 1

    # 7. 批量删除
    r_del = app_client.post(
        "/api/reception/agents/batch-remove",
        json={"agent_ids": [agent1["id"]]},
        headers=headers,
    )
    assert r_del.status_code == 200
    assert r_del.json()["removed_count"] == 1


def test_session_list_and_detail(app_client: TestClient, db_session: Session) -> None:
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
    r = app_client.get("/api/reception/sessions?company_name=腾讯&is_human=是", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["id"] == "ZXHH202609180001"
    assert data["items"][0]["tenant_no"] == "TENANT-001"
    assert data["items"][0]["tenant_name"] == "腾讯集团总租户"

    # 2. 详情与消息
    r_detail = app_client.get("/api/reception/sessions/ZXHH202609180001", headers=headers)
    assert r_detail.status_code == 200
    d = r_detail.json()
    assert d["session"]["company_name"] == "腾讯科技（深圳）有限公司"
    assert len(d["messages"]) == 2
    assert d["messages"][0]["sender_type"] == "customer"


def test_workbench_flow(app_client: TestClient, db_session: Session) -> None:
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
    r = app_client.get("/api/reception/workbench/sessions", headers=headers)
    assert r.status_code == 200
    q_data = r.json()
    assert q_data["counts"]["online_queue"] >= 1
    assert q_data["counts"]["online_in_progress"] >= 1

    # 2. 邀请排队进入进行中
    r_inv = app_client.post(
        "/api/reception/workbench/sessions/ZXHH202609180002/invite", headers=headers
    )
    assert r_inv.status_code == 200
    assert r_inv.json()["status"] == "in_progress"

    # 3. 挂起会话
    r_sus = app_client.post(
        "/api/reception/workbench/sessions/ZXHH202609180002/suspend", headers=headers
    )
    assert r_sus.status_code == 200
    assert r_sus.json()["status"] == "pending"

    # 4. 重新激活会话
    r_act = app_client.post(
        "/api/reception/workbench/sessions/ZXHH202609180002/activate", headers=headers
    )
    assert r_act.status_code == 200
    assert r_act.json()["status"] == "in_progress"

    # 5. 发送消息
    r_send = app_client.post(
        "/api/reception/workbench/sessions/ZXHH202609180002/send-message",
        json={"content": "您的问题我们正在跟进中。"},
        headers=headers,
    )
    assert r_send.status_code == 200
    assert r_send.json()["content"] == "您的问题我们正在跟进中。"

    # 6. 转工单
    r_trans = app_client.post(
        "/api/reception/workbench/sessions/ZXHH202609180002/transfer-ticket",
        json={"title": "转研发处理"},
        headers=headers,
    )
    assert r_trans.status_code == 200
    assert r_trans.json()["status"] == "converted"
    assert "TKT-" in r_trans.json()["ticket_short_code"]

    # 7. 关闭会话
    r_close = app_client.post(
        "/api/reception/workbench/sessions/ZXHH202609180003/close", headers=headers
    )
    assert r_close.status_code == 200
    assert r_close.json()["status"] == "closed"

    # 8. 坐席助手搜索
    r_search = app_client.get(
        "/api/reception/workbench/assistant-search?type=knowledge&query=数电", headers=headers
    )
    assert r_search.status_code == 200
    assert len(r_search.json()) >= 1


def test_bot_config_and_client_escalation(app_client: TestClient, db_session: Session) -> None:
    headers = _bearer(999, name="管理员", role="admin")

    # 1. 获取 Bot 配置
    r = app_client.get("/api/reception/bot-config", headers=headers)
    assert r.status_code == 200
    cfg = r.json()
    assert len(cfg["agents"]) >= 3
    assert len(cfg["routing_rules"]) >= 2
    assert cfg["escalation_strategy"]["enable_agent_reception"] is True

    # 2. 更新 Bot 配置
    cfg["escalation_strategy"]["ask_transfer_text"] = "【自定义】请问需要转接人工客服吗？"
    r_put = app_client.put("/api/reception/bot-config", json=cfg, headers=headers)
    assert r_put.status_code == 200
    assert r_put.json()["escalation_strategy"]["ask_transfer_text"] == "【自定义】请问需要转接人工客服吗？"

    # 3. 探针接口
    r_probe = app_client.get("/api/reception/client/probe-human-capacity")
    assert r_probe.status_code == 200
    probe_data = r_probe.json()
    assert "can_transfer_human" in probe_data
    assert "action_type" in probe_data

    # 4. 客户端初始化会话（命中 Agent 接待）
    r_init = app_client.post(
        "/api/reception/client/init-session",
        json={
            "contact_name": "王经理",
            "contact_phone": "13800138000",
            "company_name": "数电科技有限公司",
            "tax_no": "91110108MA00000000",
            "purchased_products": ["数电票标准版"],
        },
    )
    assert r_init.status_code == 200
    init_data = r_init.json()
    sid = init_data["session"]["id"]
    assert init_data["session"]["is_human"] is False
    assert init_data["session"]["status"] == "in_progress"
    # 第一条消息应为 Bot 发出的欢迎语
    msgs = init_data["messages"]
    assert len(msgs) >= 1
    assert msgs[0]["sender_type"] == "bot"

    # 5. 客户发消息，触发 Bot 自动作答
    r_msg = app_client.post(
        f"/api/reception/client/sessions/{sid}/send-message",
        json={"content": "请问红字发票怎么开？", "sender_name": "王经理"},
    )
    assert r_msg.status_code == 200
    # 再次查询消息列表，应包含客户提问与 Bot 的自动回答
    r_all_msgs = app_client.get(f"/api/reception/client/sessions/{sid}/messages")
    assert r_all_msgs.status_code == 200
    all_msgs = r_all_msgs.json()
    assert len(all_msgs) >= 3
    assert any("红字发票" in m["content"] for m in all_msgs if m["sender_type"] == "bot")

    # 6. 客户反馈未解决
    r_unresolved = app_client.post(f"/api/reception/client/sessions/{sid}/unresolved")
    assert r_unresolved.status_code == 200
    unres_data = r_unresolved.json()
    assert unres_data["ok"] is True
    assert unres_data["action_type"] in ("ask_transfer", "guide_ticket")

    # 7. 客户确认转人工
    r_esc = app_client.post(f"/api/reception/client/sessions/{sid}/escalate-human")
    assert r_esc.status_code == 200
    esc_data = r_esc.json()
    assert esc_data["session"]["is_human"] is True
    assert "未解决" in esc_data["session"]["summary"]

    # 8. 一键提交售后工单
    r_ticket = app_client.post(
        f"/api/reception/client/sessions/{sid}/submit-ticket",
        json={
            "title": "数电发票开具红字异常协助",
            "description": "客户咨询红字发票开具多次提示异常，申请专家工单协助排查",
        },
    )
    assert r_ticket.status_code == 200
    assert r_ticket.json()["ok"] is True
    assert r_ticket.json()["status"] == "converted"
    assert "TKT-AUTO-" in r_ticket.json()["ticket_short_code"]

    # 9. 第三方大模型异步消息推送接口测试
    r_init2 = app_client.post(
        "/api/reception/client/init-session",
        json={"contact_name": "李总", "company_name": "测试企业"},
    )
    assert r_init2.status_code == 200
    sid2 = r_init2.json()["session"]["id"]

    r_llm = app_client.post(
        "/api/reception/webhook/llm-reply",
        json={
            "session_id": sid2,
            "content": "这是由外部大模型通过异步接口推送的智能回复内容。",
            "sender_name": "外部GLM智能助手",
        },
    )
    assert r_llm.status_code == 200
    assert r_llm.json()["ok"] is True

    # 验证消息已进入会话
    r_msgs = app_client.get(f"/api/reception/client/sessions/{sid2}/messages")
    assert r_msgs.status_code == 200
    assert any("这是由外部大模型通过异步接口推送" in m["content"] for m in r_msgs.json())
