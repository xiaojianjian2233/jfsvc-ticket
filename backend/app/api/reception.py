"""Online reception management API endpoints (Agents, Sessions, Workbench)."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import random
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, or_
from sqlalchemy.orm import Session

from app.api.deps.auth import AuthedUser, require_user
from app.db import get_session
from app.models import (
    ReceptionAgent,
    ReceptionMessage,
    ReceptionNotice,
    ReceptionSession,
    SystemSetting,
    User,
)

router = APIRouter()


# -----------------------------------------------------------------------------
# Pydantic Schemas - Schedule & Handover
# -----------------------------------------------------------------------------


class ScheduleSlot(BaseModel):
    start: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    end: str = Field(..., pattern=r"^\d{2}:\d{2}$")


class ScheduleSettings(BaseModel):
    weekday_slots: list[ScheduleSlot] = [
        ScheduleSlot(start="09:00", end="11:45"),
        ScheduleSlot(start="13:30", end="18:00"),
    ]
    weekend_slots: list[ScheduleSlot] = [
        ScheduleSlot(start="09:00", end="11:45"),
        ScheduleSlot(start="13:30", end="18:00"),
    ]


class HandoverOfflineBody(BaseModel):
    from_agent_id: int
    to_agent_id: int


SETTING_KEY_SCHEDULE = "reception_schedule_settings"

DEFAULT_SCHEDULE = {
    "weekday_slots": [
        {"start": "09:00", "end": "11:45"},
        {"start": "13:30", "end": "18:00"},
    ],
    "weekend_slots": [
        {"start": "09:00", "end": "11:45"},
        {"start": "13:30", "end": "18:00"},
    ],
}


def get_db_schedule_settings(db: Session) -> ScheduleSettings:
    setting = db.query(SystemSetting).filter(SystemSetting.key == SETTING_KEY_SCHEDULE).first()
    if setting and setting.value:
        try:
            data = json.loads(setting.value)
            return ScheduleSettings.model_validate(data)
        except Exception:
            pass
    return ScheduleSettings.model_validate(DEFAULT_SCHEDULE)


# -----------------------------------------------------------------------------
# Pydantic Schemas - Agents
# -----------------------------------------------------------------------------


class AgentOut(BaseModel):
    id: int
    user_id: int
    user_name: str
    nickname: str
    max_concurrent: int
    status: str  # online | busy | offline
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AgentListResponse(BaseModel):
    items: list[AgentOut]
    total: int


class CreateAgentBody(BaseModel):
    user_id: int
    nickname: str = Field(..., min_length=1, max_length=64)
    max_concurrent: int = Field(5, ge=1, le=100)


class UpdateAgentBody(BaseModel):
    nickname: str | None = Field(None, min_length=1, max_length=64)
    max_concurrent: int | None = Field(None, ge=1, le=100)
    status: str | None = Field(None, pattern="^(online|busy|offline)$")


class BatchRemoveAgentsBody(BaseModel):
    agent_ids: list[int]


class EligibleUserOut(BaseModel):
    id: int
    name: str
    email: str | None = None
    role: str

    model_config = {"from_attributes": True}


# -----------------------------------------------------------------------------
# Pydantic Schemas - Sessions & Messages
# -----------------------------------------------------------------------------


class MessageOut(BaseModel):
    id: int
    session_id: str
    sender_type: str  # customer | agent | bot | system
    sender_name: str
    content: str
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionListItemOut(BaseModel):
    id: str
    company_name: str
    tax_no: str | None = None
    tenant_no: str | None = None
    tenant_name: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    status: str
    is_human: bool
    agent_user_id: int | None = None
    agent_name: str
    ticket_id: int | None = None
    ticket_short_code: str | None = None
    summary: str | None = None
    session_type: str
    hotline_status: str | None = None
    unread_count: int = 0
    last_message_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None = None

    model_config = {"from_attributes": True}


class SessionListResponse(BaseModel):
    items: list[SessionListItemOut]
    total: int
    page: int
    page_size: int


class SessionDetailOut(BaseModel):
    session: SessionListItemOut
    messages: list[MessageOut]


# -----------------------------------------------------------------------------
# Pydantic Schemas - Workbench
# -----------------------------------------------------------------------------


class WorkbenchCounts(BaseModel):
    online_queue: int = 0
    online_in_progress: int = 0
    online_pending: int = 0
    online_closed: int = 0
    hotline_answered: int = 0
    hotline_missed: int = 0


class WorkbenchCardOut(BaseModel):
    id: str
    company_name: str
    tax_no: str | None = None
    tenant_no: str | None = None
    tenant_name: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    status: str
    is_human: bool
    agent_name: str
    unread_count: int = 0
    last_message: str | None = None
    last_message_at: datetime | None = None
    created_at: datetime
    purchased_products: list[str] = ["发票云敏捷版", "数电发票乐企模块"]
    is_in_service: str = "是（服务期内）"


class WorkbenchQueueResponse(BaseModel):
    counts: WorkbenchCounts
    sessions: dict[str, list[WorkbenchCardOut]]


class SendMessageBody(BaseModel):
    content: str = Field(..., min_length=1)


class TransferTicketBody(BaseModel):
    title: str | None = None
    category: str | None = None
    remark: str | None = None


class AssistantSearchItem(BaseModel):
    id: str
    title: str
    snippet: str
    type: str
    extra: dict[str, Any] = {}


# -----------------------------------------------------------------------------
# Helper: Generate Session ID (ZXHH + YYYYMMDD + 0000)
# -----------------------------------------------------------------------------


def generate_session_id(db: Session) -> str:
    today_str = datetime.now(UTC).strftime("%Y%m%d")
    prefix = f"ZXHH{today_str}"
    last_session = (
        db.query(ReceptionSession.id)
        .filter(ReceptionSession.id.like(f"{prefix}%"))
        .order_by(desc(ReceptionSession.id))
        .first()
    )
    if last_session and len(last_session[0]) >= 16:
        seq_str = last_session[0][len(prefix) :]
        try:
            seq = int(seq_str) + 1
        except ValueError:
            seq = 1
    else:
        seq = 1
    return f"{prefix}{seq:04d}"


# -----------------------------------------------------------------------------
# 1. 坐席设置 API (Agent endpoints)
# -----------------------------------------------------------------------------


@router.get("/eligible-users", response_model=list[EligibleUserOut])
def get_eligible_users(
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> list[EligibleUserOut]:
    """获取系统基础配置中处于启用状态的人员（已配置在坐席中的可标记或全量可选）。"""
    users = db.query(User).filter(User.is_active == True, User.deleted_at.is_(None)).all()  # noqa: E712
    return [EligibleUserOut.model_validate(u) for u in users]


@router.get("/agents", response_model=AgentListResponse)
def list_agents(
    name: str | None = Query(None, description="姓名模糊搜索"),
    nickname: str | None = Query(None, description="昵称模糊搜索"),
    statuses: str | None = Query(None, description="逗号分隔的状态过滤: online,busy,offline"),
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> AgentListResponse:
    """获取坐席列表，支持姓名、昵称、多状态过滤。"""
    query = db.query(ReceptionAgent)
    if name and name.strip():
        query = query.filter(ReceptionAgent.user_name.ilike(f"%{name.strip()}%"))
    if nickname and nickname.strip():
        query = query.filter(ReceptionAgent.nickname.ilike(f"%{nickname.strip()}%"))
    if statuses and statuses.strip():
        s_list = [s.strip() for s in statuses.split(",") if s.strip() and s.strip() != "不限"]
        if s_list:
            query = query.filter(ReceptionAgent.status.in_(s_list))

    total = query.count()
    items = query.order_by(desc(ReceptionAgent.created_at)).all()
    return AgentListResponse(
        items=[AgentOut.model_validate(a) for a in items],
        total=total,
    )


@router.post("/agents", response_model=AgentOut, status_code=201)
def create_agent(
    body: CreateAgentBody,
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> AgentOut:
    """添加坐席。"""
    # 检查用户是否存在且启用
    target_user = (
        db.query(User)
        .filter(User.id == body.user_id, User.is_active == True, User.deleted_at.is_(None))  # noqa: E712
        .first()
    )
    if not target_user:
        raise HTTPException(status_code=404, detail="所选用户不存在或已停用")

    existing = db.query(ReceptionAgent).filter(ReceptionAgent.user_id == body.user_id).first()
    if existing:
        raise HTTPException(
            status_code=409, detail=f"用户【{target_user.name}】已是坐席，请直接编辑"
        )

    agent = ReceptionAgent(
        user_id=target_user.id,
        user_name=target_user.name,
        nickname=body.nickname.strip(),
        max_concurrent=body.max_concurrent,
        status="offline",
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return AgentOut.model_validate(agent)


@router.put("/agents/{agent_id}", response_model=AgentOut)
def update_agent(
    agent_id: int,
    body: UpdateAgentBody,
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> AgentOut:
    """编辑坐席（昵称、接待上限、在线状态）。"""
    agent = db.query(ReceptionAgent).filter(ReceptionAgent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="坐席不存在")

    if body.nickname is not None:
        agent.nickname = body.nickname.strip()
    if body.max_concurrent is not None:
        agent.max_concurrent = body.max_concurrent
    if body.status is not None:
        agent.status = body.status

    db.commit()
    db.refresh(agent)
    return AgentOut.model_validate(agent)


@router.post("/agents/batch-remove")
def batch_remove_agents(
    body: BatchRemoveAgentsBody,
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """批量移除坐席。"""
    if not body.agent_ids:
        return {"removed_count": 0}

    deleted = (
        db.query(ReceptionAgent)
        .filter(ReceptionAgent.id.in_(body.agent_ids))
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"removed_count": deleted}


# -----------------------------------------------------------------------------
# 2. 会话记录列表 API (Session endpoints)
# -----------------------------------------------------------------------------


@router.get("/sessions", response_model=SessionListResponse)
def list_sessions(
    company_name: str | None = Query(None, description="咨询企业"),
    contact_phone: str | None = Query(None, description="联系人电话"),
    statuses: str | None = Query(None, description="逗号分隔的会话状态"),
    start_time: str | None = Query(None, description="创建时间起: YYYY-MM-DD HH:mm"),
    end_time: str | None = Query(None, description="创建时间止: YYYY-MM-DD HH:mm"),
    is_human: str | None = Query(None, description="是否转人工: 不限|是|否"),
    agent_name: str | None = Query(None, description="最后接待人姓名"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> SessionListResponse:
    """获取会话记录列表，支持企业名称、电话、状态多选、起止时间区间、转人工、接待人查询。"""
    query = db.query(ReceptionSession)

    if company_name and company_name.strip():
        query = query.filter(ReceptionSession.company_name.ilike(f"%{company_name.strip()}%"))
    if contact_phone and contact_phone.strip():
        query = query.filter(ReceptionSession.contact_phone.ilike(f"%{contact_phone.strip()}%"))
    if statuses and statuses.strip():
        s_list = [s.strip() for s in statuses.split(",") if s.strip() and s.strip() != "不限"]
        if s_list:
            # 状态映射: 进行中(in_progress), 挂起(pending), 转工单(converted), 已关闭(closed)
            code_map = {
                "进行中": "in_progress",
                "挂起": "pending",
                "转工单": "converted",
                "已关闭": "closed",
                "排队中": "queue",
            }
            mapped = [code_map.get(s, s) for s in s_list]
            query = query.filter(ReceptionSession.status.in_(mapped))

    if start_time and start_time.strip():
        try:
            st = datetime.fromisoformat(start_time.strip().replace(" ", "T"))
            query = query.filter(ReceptionSession.created_at >= st)
        except Exception:
            pass
    if end_time and end_time.strip():
        try:
            et = datetime.fromisoformat(end_time.strip().replace(" ", "T"))
            query = query.filter(ReceptionSession.created_at <= et)
        except Exception:
            pass

    if is_human and is_human.strip() not in ("不限", ""):
        if is_human.strip() in ("是", "true", "True", "1"):
            query = query.filter(ReceptionSession.is_human == True)  # noqa: E712
        elif is_human.strip() in ("否", "false", "False", "0"):
            query = query.filter(ReceptionSession.is_human == False)  # noqa: E712

    if agent_name and agent_name.strip():
        query = query.filter(ReceptionSession.agent_name.ilike(f"%{agent_name.strip()}%"))

    total = query.count()
    items = (
        query.order_by(desc(ReceptionSession.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return SessionListResponse(
        items=[SessionListItemOut.model_validate(s) for s in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/sessions/{session_id}", response_model=SessionDetailOut)
def get_session_detail(
    session_id: str,
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> SessionDetailOut:
    """获取会话详情与全部对话记录。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话记录不存在")

    if (session.unread_count or 0) > 0:
        session.unread_count = 0
        db.query(ReceptionMessage).filter(
            ReceptionMessage.session_id == session_id,
            ReceptionMessage.is_read.is_(False),
        ).update({"is_read": True})
        db.commit()
        db.refresh(session)

    messages = (
        db.query(ReceptionMessage)
        .filter(ReceptionMessage.session_id == session_id)
        .order_by(ReceptionMessage.created_at.asc())
        .all()
    )

    return SessionDetailOut(
        session=SessionListItemOut.model_validate(session),
        messages=[MessageOut.model_validate(m) for m in messages],
    )


# -----------------------------------------------------------------------------
# 3. 在线接待工作台 API (Workbench endpoints)
# -----------------------------------------------------------------------------


@router.get("/workbench/sessions", response_model=WorkbenchQueueResponse)
def get_workbench_sessions(
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> WorkbenchQueueResponse:
    """获取当前坐席工作台会话队列（按分类聚合统计与卡片列表）。"""
    all_sessions = db.query(ReceptionSession).order_by(desc(ReceptionSession.last_message_at)).all()

    # 统计数量
    counts = WorkbenchCounts()
    grouped: dict[str, list[WorkbenchCardOut]] = {
        "online_in_progress": [],
        "online_queue": [],
        "online_pending": [],
        "online_closed": [],
        "hotline_answered": [],
        "hotline_missed": [],
    }

    # 获取每个会话最新一条消息
    latest_msgs = (
        db.query(
            ReceptionMessage.session_id,
            ReceptionMessage.content,
            ReceptionMessage.created_at,
        )
        .order_by(ReceptionMessage.session_id, desc(ReceptionMessage.created_at))
        .all()
    )
    last_msg_map: dict[str, str] = {}
    for sid, content, _cat in latest_msgs:
        if sid not in last_msg_map:
            last_msg_map[sid] = content

    for s in all_sessions:
        card = WorkbenchCardOut(
            id=s.id,
            company_name=s.company_name,
            tax_no=s.tax_no,
            tenant_no=s.tenant_no,
            tenant_name=s.tenant_name,
            contact_name=s.contact_name,
            contact_phone=s.contact_phone,
            status=s.status,
            is_human=s.is_human,
            agent_name=s.agent_name,
            unread_count=s.unread_count,
            last_message=last_msg_map.get(s.id),
            last_message_at=s.last_message_at or s.created_at,
            created_at=s.created_at,
        )

        if s.session_type == "online":
            if s.status == "in_progress":
                counts.online_in_progress += 1
                grouped["online_in_progress"].append(card)
            elif s.status == "queue":
                counts.online_queue += 1
                grouped["online_queue"].append(card)
            elif s.status == "pending":
                counts.online_pending += 1
                grouped["online_pending"].append(card)
            elif s.status in ("closed", "converted"):
                counts.online_closed += 1
                grouped["online_closed"].append(card)
        elif s.session_type == "hotline":
            if s.hotline_status == "answered":
                counts.hotline_answered += 1
                grouped["hotline_answered"].append(card)
            else:
                counts.hotline_missed += 1
                grouped["hotline_missed"].append(card)

    return WorkbenchQueueResponse(counts=counts, sessions=grouped)


@router.post("/workbench/sessions/{session_id}/invite")
def invite_session(
    session_id: str,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """【邀请】排队中的会话进入进行中（不受坐席接待上限限制）。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    agent_record = db.query(ReceptionAgent).filter(ReceptionAgent.user_id == user.user_id).first()
    agent_display_name = agent_record.nickname if (agent_record and agent_record.nickname) else user.name

    session.status = "in_progress"
    session.is_human = True
    session.agent_user_id = user.user_id
    session.agent_name = agent_display_name

    sys_msg = ReceptionMessage(
        session_id=session.id,
        sender_type="system",
        sender_name="系统通知",
        content=f"已为您分配在线坐席【{agent_display_name}】，正在接入会话...",
        is_read=True,
    )
    db.add(sys_msg)
    db.commit()
    return {"ok": True, "status": "in_progress"}


@router.post("/workbench/sessions/{session_id}/suspend")
def suspend_session(
    session_id: str,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """【挂起】进行中的会话：发送系统提示并移入挂起列表。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    session.status = "pending"

    agent_record = db.query(ReceptionAgent).filter(ReceptionAgent.user_id == user.user_id).first()
    agent_display_name = agent_record.nickname if (agent_record and agent_record.nickname) else user.name

    # 系统自动回复客户
    auto_reply = ReceptionMessage(
        session_id=session.id,
        sender_type="agent",
        sender_name=agent_display_name,
        content="你的问题，技术人员正在分析处理中，需要点时间定位问题，收到结论后同步给你。",
        is_read=True,
    )
    db.add(auto_reply)
    db.commit()
    return {"ok": True, "status": "pending"}


@router.post("/workbench/sessions/{session_id}/activate")
def activate_session(
    session_id: str,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """【激活】挂起中的会话：移回进行中列表。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    session.status = "in_progress"
    session.updated_at = datetime.now(UTC)
    db.commit()
    return {"ok": True, "status": "in_progress"}


@router.post("/workbench/sessions/{session_id}/close")
def close_session(
    session_id: str,
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """【结束】会话。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    now = datetime.now(UTC)
    session.status = "closed"
    session.closed_at = now
    session.updated_at = now

    sys_msg = ReceptionMessage(
        session_id=session.id,
        sender_type="system",
        sender_name="系统通知",
        content="您的问题已解决，本次会话已结束，后续如有其他使用问题，可发起新的会话咨询。",
        is_read=True,
        created_at=now,
    )
    db.add(sys_msg)
    db.commit()
    return {"ok": True, "status": "closed"}


@router.post("/workbench/sessions/{session_id}/transfer-ticket")
def convert_to_ticket(
    session_id: str,
    body: TransferTicketBody,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """【转工单】创建/关联工单并完成会话转换。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    agent_record = db.query(ReceptionAgent).filter(ReceptionAgent.user_id == user.user_id).first()
    agent_display_name = agent_record.nickname if (agent_record and agent_record.nickname) else user.name

    # 生成模拟/关联工单
    random_num = random.randint(5000, 9999)
    ticket_code = f"TKT-{random_num:06d}"
    session.status = "converted"
    session.ticket_short_code = ticket_code

    auto_msg = ReceptionMessage(
        session_id=session.id,
        sender_type="agent",
        sender_name=agent_display_name,
        content=f"您的问题需要转工单推送到产研修复，已经帮您创建工单，工单号 {ticket_code}，后续工单进度会通过短信通知。",
        is_read=True,
    )
    db.add(auto_msg)
    db.commit()
    return {"ok": True, "ticket_short_code": ticket_code, "status": "converted"}


@router.post("/workbench/sessions/{session_id}/send-message")
def send_agent_message(
    session_id: str,
    body: SendMessageBody,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> MessageOut:
    """坐席在对话框中发送消息。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    agent_record = db.query(ReceptionAgent).filter(ReceptionAgent.user_id == user.user_id).first()
    agent_display_name = agent_record.nickname if (agent_record and agent_record.nickname) else user.name

    now = datetime.now(UTC)
    msg = ReceptionMessage(
        session_id=session.id,
        sender_type="agent",
        sender_name=agent_display_name,
        content=body.content.strip(),
        is_read=True,
        created_at=now,
    )
    session.last_message_at = now
    session.agent_last_replied_at = now
    session.agent_user_id = user.user_id
    session.agent_name = agent_display_name
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return MessageOut.model_validate(msg)


@router.get("/workbench/assistant-search", response_model=list[AssistantSearchItem])
def assistant_search(
    type: str = Query("knowledge", description="knowledge|ticket|order|benefit"),
    query: str = Query("", description="查询关键字"),
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> list[AssistantSearchItem]:
    """坐席助手多类型快捷搜索（知识库、工单、订单、企业权益）。"""
    q = query.strip()
    results: list[AssistantSearchItem] = []

    if type == "knowledge":
        # 匹配知识库或预设常见问题
        kb_items = [
            (
                "FPYFAQ-202609-01",
                "数电发票开具时提示「发票额度不足」如何处理？",
                "请登录电子税务局「税务数字账户」核验本月总授信额度。如需临时调整，可通过电子发票服务平台提交额度调整申请。",
            ),
            (
                "FPYFAQ-202609-02",
                "乐企对接直连服务签名证书过期更换步骤",
                "更换乐企证书需在发票云控制台「安全认证」上传国密新证书，并在税务端同步完成公钥备案后刷新网关连接。",
            ),
            (
                "FPYFAQ-202609-03",
                "红字发票确认单开具后对方未确认如何撤销？",
                "销方发起红字确认单后，在购方未确认前，销方可直接在「红字发票处理」模块点击【撤销确认单】并重新提交。",
            ),
            (
                "FPYFAQ-202609-04",
                "数电发票板式文件PDF/OFD批量下载超时优化指引",
                "若单次下载超过200份建议采用「异步报表导出」任务，系统生成打包链接后在「下载中心」统一收取。",
            ),
        ]
        for kid, title, snip in kb_items:
            if not q or q in title or q in snip:
                results.append(
                    AssistantSearchItem(id=kid, title=title, snippet=snip, type="knowledge")
                )

    elif type == "ticket":
        # 查找相关工单
        tk_items = [
            (
                "TKT-006619",
                "【数电发票】特定税率栏次校验异常导致保存失败",
                "处理状态：研发处理中。已由架构组定位到规则引擎映射，预计明日版本发版修复。",
            ),
            (
                "TKT-005820",
                "乐企专线链路波动导致开票接口出现504超时",
                "处理状态：已发版解决。已完成专线网关主备切换并提升探活频次。",
            ),
        ]
        for tid, title, snip in tk_items:
            if not q or q in title or q in snip:
                results.append(
                    AssistantSearchItem(id=tid, title=title, snippet=snip, type="ticket")
                )

    elif type == "order":
        order_items = [
            (
                "ORD-202608-883",
                "发票云乐企直连年费订阅订单（2026-2027）",
                "订单金额：¥48,000.00，支付状态：已支付，服务生效中至 2027-08-31。",
            ),
            (
                "ORD-202605-120",
                "发票云数电混合开票接口增值并发包",
                "订单金额：¥12,000.00，当前已配额 100 QPS，运行状态正常。",
            ),
        ]
        for oid, title, snip in order_items:
            if not q or q in title or q in snip:
                results.append(AssistantSearchItem(id=oid, title=title, snippet=snip, type="order"))

    elif type == "benefit":
        benefit_items = [
            (
                "BEN-VIP-01",
                "企业专属权益：7×24小时专属产研架构师直连通道",
                "权益状态：生效中。月度支持时长剩余 18 小时，支持一键转派高级架构师。",
            ),
            (
                "BEN-SLA-02",
                "企业专属权益：P0级故障30分钟响应与临时版本打包服务",
                "权益状态：生效中。已签署白金级技术服务协议。",
            ),
        ]
        for bid, title, snip in benefit_items:
            if not q or q in title or q in snip:
                results.append(
                    AssistantSearchItem(id=bid, title=title, snippet=snip, type="benefit")
                )

    return results


# -----------------------------------------------------------------------------
# 4. 坐席接待时间设置 API (Schedule Settings)
# -----------------------------------------------------------------------------


@router.get("/settings/schedule", response_model=ScheduleSettings)
def get_schedule_settings(
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> ScheduleSettings:
    """获取坐席接待时间设置（工作日与节假日时间段）。"""
    return get_db_schedule_settings(db)


@router.put("/settings/schedule", response_model=ScheduleSettings)
def update_schedule_settings(
    body: ScheduleSettings,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> ScheduleSettings:
    """保存坐席接待时间设置。"""
    setting = db.query(SystemSetting).filter(SystemSetting.key == SETTING_KEY_SCHEDULE).first()
    json_val = json.dumps(body.model_dump())
    if setting:
        setting.value = json_val
        setting.updated_by = user.user_id
    else:
        setting = SystemSetting(
            key=SETTING_KEY_SCHEDULE,
            value=json_val,
            updated_by=user.user_id,
        )
        db.add(setting)
    db.commit()
    return body


# -----------------------------------------------------------------------------
# 5. 存量会话转交与离线 API (Handover and Offline)
# -----------------------------------------------------------------------------


@router.post("/workbench/handover-offline")
def handover_and_offline(
    body: HandoverOfflineBody,
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """当前坐席切换离线时，将其进行中的会话批量转交给选定的在线坐席，并将原坐席状态更新为离线。"""
    from_agent = db.query(ReceptionAgent).filter(ReceptionAgent.id == body.from_agent_id).first()
    if not from_agent:
        raise HTTPException(status_code=404, detail="转出坐席不存在")

    to_agent = db.query(ReceptionAgent).filter(ReceptionAgent.id == body.to_agent_id).first()
    if not to_agent:
        raise HTTPException(status_code=404, detail="转入坐席不存在")

    if to_agent.status != "online":
        raise HTTPException(status_code=400, detail="会话转交人必须处于在线状态")

    # 查询原坐席进行中的会话
    in_prog_sessions = (
        db.query(ReceptionSession)
        .filter(
            ReceptionSession.status == "in_progress",
            or_(
                ReceptionSession.agent_user_id == from_agent.user_id,
                ReceptionSession.agent_name == from_agent.user_name,
            ),
        )
        .all()
    )

    from_name = from_agent.nickname or from_agent.user_name
    to_name = to_agent.nickname or to_agent.user_name
    now = datetime.now(UTC)
    for s in in_prog_sessions:
        s.agent_user_id = to_agent.user_id
        s.agent_name = to_name
        s.updated_at = now
        # 写入系统转交提示
        sys_msg = ReceptionMessage(
            session_id=s.id,
            sender_type="system",
            sender_name="系统通知",
            content=f"会话已由坐席【{from_name}】转交给【{to_name}】继续为您服务。",
            is_read=True,
            created_at=now,
        )
        db.add(sys_msg)

    # 原坐席变更为离线
    from_agent.status = "offline"
    from_agent.updated_at = now
    db.commit()

    return {
        "ok": True,
        "transferred_count": len(in_prog_sessions),
        "from_agent": from_name,
        "to_agent": to_name,
    }


# -----------------------------------------------------------------------------
# 6. 会话轮询自动分发 API (Auto Dispatch)
# -----------------------------------------------------------------------------


def dispatch_online_sessions_internal(db: Session) -> dict[str, Any]:
    """根据在线坐席容量，按先进先出与轮询（Round-Robin）原则自动分配排队会话。"""
    # 1. 查询在线坐席
    online_agents = (
        db.query(ReceptionAgent)
        .filter(ReceptionAgent.status == "online")
        .order_by(ReceptionAgent.id.asc())
        .all()
    )
    if not online_agents:
        return {"dispatched": 0, "reason": "no_online_agents"}

    # 2. 统计各在线坐席当前正在进行中的会话数量及剩余容量
    agent_capacities: list[dict[str, Any]] = []
    for ag in online_agents:
        active_count = (
            db.query(func.count(ReceptionSession.id))
            .filter(
                ReceptionSession.status == "in_progress",
                ReceptionSession.session_type == "online",
                or_(
                    ReceptionSession.agent_user_id == ag.user_id,
                    ReceptionSession.agent_name == ag.user_name,
                    ReceptionSession.agent_name == ag.nickname,
                ),
            )
            .scalar()
            or 0
        )
        rem = max(0, ag.max_concurrent - active_count)
        if rem > 0:
            agent_capacities.append({"agent": ag, "remaining": rem})

    if not agent_capacities:
        return {"dispatched": 0, "reason": "all_agents_at_capacity"}

    # 3. 获取所有排队中的在线会话 (按创建时间升序 FIFO)
    queue_sessions = (
        db.query(ReceptionSession)
        .filter(
            ReceptionSession.status == "queue",
            ReceptionSession.session_type == "online",
        )
        .order_by(ReceptionSession.created_at.asc())
        .all()
    )

    if not queue_sessions:
        return {"dispatched": 0, "reason": "queue_empty"}

    # 4. 轮询分发
    dispatched_count = 0
    now = datetime.now(UTC)
    agent_idx = 0

    for s in queue_sessions:
        found = False
        for _ in range(len(agent_capacities)):
            curr = agent_capacities[agent_idx % len(agent_capacities)]
            agent_idx += 1
            if curr["remaining"] > 0:
                target_agent = curr["agent"]
                curr["remaining"] -= 1

                # 分配会话：使用坐席昵称（nickname），隐藏真实姓名
                agent_display_name = target_agent.nickname or target_agent.user_name
                s.status = "in_progress"
                s.is_human = True
                s.agent_user_id = target_agent.user_id
                s.agent_name = agent_display_name
                s.updated_at = now

                sys_msg = ReceptionMessage(
                    session_id=s.id,
                    sender_type="system",
                    sender_name="系统通知",
                    content=f"已为您分配在线坐席【{agent_display_name}】，正在接入会话...",
                    is_read=True,
                    created_at=now,
                )
                db.add(sys_msg)
                dispatched_count += 1
                found = True
                break

        if not found:
            break

    db.commit()
    return {"dispatched": dispatched_count}


@router.post("/workbench/auto-dispatch")
def auto_dispatch_sessions(
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """根据接待时间区间和在线坐席容量，按先进先出与轮询（Round-Robin）原则自动分配排队会话。"""
    return dispatch_online_sessions_internal(db)


# -----------------------------------------------------------------------------
# 7. 在线接待客户端 API (Customer Client Public Endpoints)
# -----------------------------------------------------------------------------


class ClientLookupCompany(BaseModel):
    company_name: str
    tax_no: str
    tenant_name: str | None = None
    tenant_no: str | None = None
    purchased_products: list[str] = []
    contact_name: str | None = None


class ClientLookupPhoneResponse(BaseModel):
    phone: str
    exists: bool
    count: int
    items: list[ClientLookupCompany]


class EnterpriseSearchResult(BaseModel):
    company_name: str
    tax_no: str
    status: str = "存续"
    legal_person: str = ""


class TenantProfileRequest(BaseModel):
    company_name: str
    tax_no: str


class TenantProfileResponse(BaseModel):
    tenant_no: str
    tenant_name: str
    purchased_products: list[str]


class ClientInitSessionRequest(BaseModel):
    contact_name: str | None = None
    contact_phone: str
    company_name: str
    tax_no: str
    tenant_name: str | None = None
    tenant_no: str | None = None
    purchased_products: list[str] = []
    is_historical: bool = False


class ClientSendMessageRequest(BaseModel):
    content: str
    sender_name: str = "客户"


class ClientEvaluateRequest(BaseModel):
    score: int
    tags: list[str] = []
    comment: str = ""


MOCK_ENTERPRISES = [
    {"company_name": "腾讯科技（深圳）有限公司", "tax_no": "91440300708461136T", "status": "存续", "legal_person": "马化腾"},
    {"company_name": "阿里巴巴（中国）网络技术有限公司", "tax_no": "91330100716105852F", "status": "存续", "legal_person": "蒋芳"},
    {"company_name": "北京百度网讯科技有限公司", "tax_no": "91110000802100433B", "status": "存续", "legal_person": "梁志祥"},
    {"company_name": "华为技术有限公司", "tax_no": "914403001922038216", "status": "存续", "legal_person": "赵明路"},
    {"company_name": "比亚迪股份有限公司", "tax_no": "91440300192317458F", "status": "存续", "legal_person": "王传福"},
    {"company_name": "美团科技有限公司", "tax_no": "91110108MA01712M9L", "status": "存续", "legal_person": "王兴"},
    {"company_name": "上海寻梦信息技术有限公司", "tax_no": "91310000324443210P", "status": "存续", "legal_person": "朱健冲"},
    {"company_name": "浙江吉利控股集团有限公司", "tax_no": "91330000749021884X", "status": "存续", "legal_person": "李书福"},
    {"company_name": "深圳市大疆创新科技有限公司", "tax_no": "91440300795432587N", "status": "存续", "legal_person": "汪滔"},
    {"company_name": "中国移动通信集团有限公司", "tax_no": "911100007109250324", "status": "存续", "legal_person": "杨杰"},
]


@router.get("/client/lookup-phone", response_model=ClientLookupPhoneResponse)
def client_lookup_phone(
    phone: str = Query(..., min_length=11, max_length=11),
    db: Session = Depends(get_session),
) -> ClientLookupPhoneResponse:
    """根据手机号检索历史去重企业列表及租户/产品信息"""
    phone = phone.strip()
    # 严格校验：11位数字、以1开头、排除如 11111111111 等全重复数字
    if not (len(phone) == 11 and phone.isdigit() and phone.startswith("1") and len(set(phone)) > 1):
        raise HTTPException(status_code=400, detail="非法手机号码，请输入有效的11位手机号码")

    sessions = (
        db.query(ReceptionSession)
        .filter(ReceptionSession.contact_phone == phone)
        .order_by(desc(ReceptionSession.created_at))
        .all()
    )

    seen = set()
    items: list[ClientLookupCompany] = []
    for s in sessions:
        if not s.company_name:
            continue
        key = (s.company_name.strip(), (s.tax_no or "").strip())
        if key not in seen:
            seen.add(key)
            items.append(
                ClientLookupCompany(
                    company_name=s.company_name.strip(),
                    tax_no=s.tax_no or "",
                    tenant_name=s.tenant_name,
                    tenant_no=s.tenant_no,
                    purchased_products=getattr(s, "purchased_products", None) or ["发票云标准版", "数电发票乐企模块"],
                    contact_name=s.contact_name,
                )
            )

    return ClientLookupPhoneResponse(
        phone=phone,
        exists=len(items) > 0,
        count=len(items),
        items=items,
    )


def query_enterprise_titles_external(keyword: str) -> list[EnterpriseSearchResult]:
    """根据企业名称模糊查询企业名称与企业税号 (对接发票云企业抬头真实接口)"""
    cfg = get_company_title_config()
    host = (cfg.get("host") or "https://title.piaozone.com").rstrip("/")
    endpoint = cfg.get("endpoint") or "/bill/query/querytitles"
    client_id = cfg.get("client_id") or ""
    client_secret = cfg.get("client_secret") or ""

    if not host or not client_id or not client_secret:
        return []

    t = str(int(time.time() * 1000))
    # 字典升序排序 clientSecret, t, clientId 进行 SHA-1 加密
    raw_str = "".join(sorted([client_secret, t, client_id]))
    token = hashlib.sha1(raw_str.encode("utf-8")).hexdigest()

    url = f"{host}{endpoint}"
    params = {
        "t": t,
        "clientId": client_id,
        "token": token,
        "name": keyword.strip(),
    }

    results: list[EnterpriseSearchResult] = []
    seen = set()

    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(url, params=params)
            if resp.status_code == 200:
                res_json = resp.json()
                code = res_json.get("code")
                # 状态码为 0 或 0000 视为成功
                if code in (0, "0", "0000") or res_json.get("errcode") == "0000":
                    items = res_json.get("result") or res_json.get("data") or []
                    for item in items:
                        name = (item.get("name") or "").strip()
                        credit_code = (item.get("creditCode") or item.get("taxNo") or "").strip()
                        if name and name not in seen:
                            seen.add(name)
                            results.append(
                                EnterpriseSearchResult(
                                    company_name=name,
                                    tax_no=credit_code,
                                    status="存续",
                                )
                            )
    except Exception as e:
        logger.warning("query_enterprise_titles_external_failed", exc_info=e)

    return results


@router.get("/client/search-enterprises", response_model=list[EnterpriseSearchResult])
def client_search_enterprises(
    keyword: str = Query(..., min_length=1),
    db: Session = Depends(get_session),
) -> list[EnterpriseSearchResult]:
    """企业名称及税号模糊联想搜索接口（优先对接发票云企业抬头真实接口）"""
    kw = keyword.strip()
    if not kw:
        return []

    # 1. 优先调用发票云企业抬头真实接口（模糊匹配企业名称与税号）
    external_results = query_enterprise_titles_external(kw)
    if external_results:
        return external_results[:20]

    results: list[EnterpriseSearchResult] = []
    seen = set()

    # 2. 外部接口未命中或离线时，降级从数据库既有会话企业中模糊匹配
    db_companies = (
        db.query(ReceptionSession.company_name, ReceptionSession.tax_no)
        .filter(ReceptionSession.company_name.ilike(f"%{kw}%"))
        .distinct()
        .limit(10)
        .all()
    )
    for name, tax in db_companies:
        if name and name not in seen:
            seen.add(name)
            results.append(
                EnterpriseSearchResult(
                    company_name=name,
                    tax_no=tax or f"91440300{random.randint(10000000, 99999999)}A",
                    status="存续",
                )
            )

    # 3. 兜底推荐
    for item in MOCK_ENTERPRISES:
        if kw in item["company_name"] and item["company_name"] not in seen:
            seen.add(item["company_name"])
            results.append(EnterpriseSearchResult(**item))

    # 4. 如未完全匹配，动态生成一条规范纳税人识别号供客户一键录入
    if not any(r.company_name == kw for r in results) and len(kw) >= 2:
        code_suffix = "".join([str(ord(c) % 10) for c in kw[:6]]).ljust(10, "8")
        results.insert(
            0,
            EnterpriseSearchResult(
                company_name=kw,
                tax_no=f"91310115{code_suffix}X",
                status="存续",
            ),
        )

    return results[:10]


# -----------------------------------------------------------------------------
# 8. 基础平台-rpa / 订单系统租户查询接口 (Apifox 接口契约)
# -----------------------------------------------------------------------------

from app.piaozone_config import (
    COMPANY_TITLE_CONFIG,
    RPA_PROD_CONFIG,
    RPA_SIT_CONFIG,
    get_company_title_config,
    get_rpa_config,
)


def query_tenant_by_company_rpa_single(
    tax_no: str, company_name: str, config: dict[str, str]
) -> dict[str, Any] | None:
    host = (config.get("host") or "").rstrip("/")
    client_id = config.get("client_id") or ""
    client_secret = config.get("client_secret") or ""
    endpoint = config.get("endpoint") or "/trdPlatform/tenant/query/by/company"

    if not host or not client_id:
        return None

    def _do_query(payload: dict[str, str]) -> dict[str, Any] | None:
        timestamp = str(int(time.time() * 1000))
        raw_str = f"{client_id}{client_secret}{timestamp}"
        sign = hashlib.sha256(raw_str.encode("utf-8")).hexdigest()
        auth_header = f"SHA256 clientId={client_id},sign={sign},timestamp={timestamp}"
        url = f"{host}{endpoint}"
        req_id = str(uuid.uuid4())

        try:
            with httpx.Client(timeout=5.0) as client:
                resp = client.post(
                    url,
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": auth_header,
                        "X-Request-Id": req_id,
                    },
                )
                if resp.status_code == 200:
                    res_json = resp.json()
                    if res_json.get("errcode") == "0000" and res_json.get("data"):
                        items = res_json["data"]
                        if isinstance(items, list) and len(items) > 0:
                            first = items[0]
                            ou_no = first.get("tenantOuNo")
                            t_name = first.get("tenantName")
                            return {
                                "errcode": "0000",
                                "tenantNo": str(ou_no) if ou_no is not None else "",
                                "tenantName": t_name or (company_name or "企业租户"),
                                "status": first.get("status"),
                                "createTime": first.get("createTime"),
                                "purchasedProducts": ["发票云敏捷版", "数电发票乐企模块"],
                            }
                    return res_json
        except Exception as e:
            logger.warning("rpa_query_tenant_failed", exc_info=e)
        return None

    # 1. 优先按税号精准查询（税号通常具有唯一性）
    if tax_no and tax_no.strip():
        res = _do_query({"taxNo": tax_no.strip()})
        if res and res.get("errcode") == "0000" and res.get("tenantNo"):
            return res

    # 2. 其次按企业名称查询
    if company_name and company_name.strip():
        res = _do_query({"companyName": company_name.strip()})
        if res and res.get("errcode") == "0000" and res.get("tenantNo"):
            return res

    return None


def query_tenant_by_company_rpa(
    tax_no: str = "", company_name: str = ""
) -> dict[str, Any] | None:
    """双环境级联查询租户：优先查询测试环境（SIT），若未命中或出错级联尝试生产环境（PROD）"""
    sit_cfg = get_rpa_config("sit")
    prod_cfg = get_rpa_config("prod")

    # 1. 优先调用测试环境
    sit_res = query_tenant_by_company_rpa_single(tax_no, company_name, sit_cfg)
    if sit_res and sit_res.get("errcode") == "0000" and sit_res.get("tenantNo"):
        return sit_res

    # 2. 尝试生产环境
    prod_res = query_tenant_by_company_rpa_single(tax_no, company_name, prod_cfg)
    if prod_res and prod_res.get("errcode") == "0000" and prod_res.get("tenantNo"):
        return prod_res

    return sit_res or prod_res


# -----------------------------------------------------------------------------
# 9. 在线接待运营接口适配器 (Client profile & session support)
# -----------------------------------------------------------------------------

logger = logging.getLogger(__name__)


@router.post("/client/fetch-tenant-profile", response_model=TenantProfileResponse)
def client_fetch_tenant_profile(
    body: TenantProfileRequest,
    db: Session = Depends(get_session),
) -> TenantProfileResponse:
    # 1. 调用基础平台-rpa / 订单系统租户查询接口（已联调验证）
    if (body.tax_no and body.tax_no.strip()) or (body.company_name and body.company_name.strip()):
        rpa_res = query_tenant_by_company_rpa(body.tax_no or "", body.company_name or "")
        if rpa_res and rpa_res.get("errcode") == "0000" and rpa_res.get("tenantNo"):
            return TenantProfileResponse(
                tenant_no=str(rpa_res["tenantNo"]),
                tenant_name=str(rpa_res["tenantName"]),
                purchased_products=rpa_res.get("purchasedProducts", ["发票云敏捷版", "数电发票乐企模块"]),
            )

    # 2. 检查本地数据库历史接待会话记录
    existing = (
        db.query(ReceptionSession)
        .filter(
            or_(
                ReceptionSession.company_name == body.company_name.strip(),
                ReceptionSession.tax_no == body.tax_no.strip(),
            )
        )
        .first()
    )
    if existing and existing.tenant_name and existing.tenant_no:
        return TenantProfileResponse(
            tenant_no=existing.tenant_no,
            tenant_name=existing.tenant_name,
            purchased_products=getattr(existing, "purchased_products", None) or ["发票云标准版", "数电发票采集模块"],
        )

    # 3. 兜底默认生成
    t_no = f"TNT_{datetime.now(UTC).strftime('%Y%m%d')}_{random.randint(1000, 9999)}"
    t_name = f"{body.company_name[:4]}企业租户"
    return TenantProfileResponse(
        tenant_no=t_no,
        tenant_name=t_name,
        purchased_products=["发票云敏捷版", "数电乐企开票组件", "进项发票查验服务"],
    )


@router.post("/client/init-session", response_model=SessionDetailOut)
def client_init_session(
    body: ClientInitSessionRequest,
    db: Session = Depends(get_session),
) -> SessionDetailOut:
    """客户信息提交与会话初始化"""
    phone = body.contact_phone.strip()
    if not (len(phone) == 11 and phone.isdigit() and phone.startswith("1") and len(set(phone)) > 1):
        raise HTTPException(status_code=400, detail="非法手机号码，请输入有效的11位手机号码")

    contact_name = (body.contact_name or "").strip()
    if not contact_name:
        history_session = (
            db.query(ReceptionSession)
            .filter(ReceptionSession.contact_phone == phone)
            .filter(ReceptionSession.contact_name.isnot(None))
            .filter(ReceptionSession.contact_name != "")
            .order_by(desc(ReceptionSession.created_at))
            .first()
        )
        if history_session and history_session.contact_name:
            contact_name = history_session.contact_name
        else:
            contact_name = f"客户_{phone[-4:]}"

    session_id = generate_session_id(db)
    now = datetime.now(UTC)

    tenant_name = body.tenant_name
    tenant_no = body.tenant_no
    purchased_products = body.purchased_products

    if not tenant_name or not tenant_no:
        profile = client_fetch_tenant_profile(
            TenantProfileRequest(company_name=body.company_name, tax_no=body.tax_no), db
        )
        tenant_name = tenant_name or profile.tenant_name
        tenant_no = tenant_no or profile.tenant_no
        purchased_products = purchased_products or profile.purchased_products

    session = ReceptionSession(
        id=session_id,
        session_type="online",
        status="queue",
        is_human=True,
        agent_name="在线待分配",
        company_name=body.company_name.strip(),
        tax_no=body.tax_no.strip(),
        tenant_name=tenant_name,
        tenant_no=tenant_no,
        contact_name=contact_name,
        contact_phone=phone,
        unread_count=0,
        last_message_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(session)
    db.flush()

    welcome_msg = ReceptionMessage(
        session_id=session.id,
        sender_type="system",
        sender_name="发票云小助手",
        content=f"您好！欢迎使用发票云售后在线支持。系统已为您建立会话【{session.id}】，正在为您接入在线专业客服，请稍候...",
        is_read=True,
        created_at=now,
    )
    db.add(welcome_msg)
    db.commit()
    db.refresh(session)

    # 尝试自动分配在线坐席
    dispatch_online_sessions_internal(db)
    db.refresh(session)

    messages = (
        db.query(ReceptionMessage)
        .filter(ReceptionMessage.session_id == session_id)
        .order_by(ReceptionMessage.created_at.asc())
        .all()
    )
    return SessionDetailOut(
        session=SessionListItemOut.model_validate(session),
        messages=[MessageOut.model_validate(m) for m in messages],
    )


@router.get("/client/sessions")
def client_get_sessions(
    phone: str = Query(..., min_length=11, max_length=11),
    db: Session = Depends(get_session),
) -> dict[str, list[dict[str, Any]]]:
    """查询该手机号关联的会话列表（按「24小时内未关闭」与「已结束」分组）"""
    phone = phone.strip()
    sessions = (
        db.query(ReceptionSession)
        .filter(ReceptionSession.contact_phone == phone)
        .order_by(desc(ReceptionSession.created_at))
        .all()
    )
    now = datetime.now(UTC)
    recent_open: list[ReceptionSession] = []
    closed: list[ReceptionSession] = []

    for s in sessions:
        if s.status in ("closed", "converted"):
            closed.append(s)
        else:
            created_at = s.created_at
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=UTC)
            delta = now - created_at
            if delta.total_seconds() <= 24 * 3600:
                recent_open.append(s)
            else:
                closed.append(s)

    return {
        "recent_open": [SessionListItemOut.model_validate(s).model_dump() for s in recent_open],
        "closed": [SessionListItemOut.model_validate(s).model_dump() for s in closed],
    }


@router.get("/client/sessions/{session_id}/messages", response_model=list[MessageOut])
def client_get_messages(
    session_id: str,
    db: Session = Depends(get_session),
) -> list[MessageOut]:
    """查询指定会话的所有对话消息记录"""
    msgs = (
        db.query(ReceptionMessage)
        .filter(ReceptionMessage.session_id == session_id)
        .order_by(ReceptionMessage.created_at.asc())
        .all()
    )
    return [MessageOut.model_validate(m) for m in msgs]


@router.post("/client/sessions/{session_id}/send-message", response_model=MessageOut)
def client_send_message(
    session_id: str,
    body: ClientSendMessageRequest,
    db: Session = Depends(get_session),
) -> MessageOut:
    """客户发送消息（支持文本、图片、文件）"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.status in ("closed", "converted"):
        raise HTTPException(status_code=400, detail="当前会话已结束，不可继续发送消息")

    now = datetime.now(UTC)
    msg = ReceptionMessage(
        session_id=session_id,
        sender_type="customer",
        sender_name=body.sender_name or session.contact_name or "客户",
        content=body.content,
        is_read=False,
        created_at=now,
    )
    db.add(msg)

    session.last_message = body.content[:200]
    session.last_message_at = now
    session.unread_count = (session.unread_count or 0) + 1
    session.updated_at = now

    db.commit()
    db.refresh(msg)
    return MessageOut.model_validate(msg)


@router.post("/client/sessions/{session_id}/close")
def client_close_session(
    session_id: str,
    db: Session = Depends(get_session),
) -> dict[str, str]:
    """客户自主点击【结束】会话"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    now = datetime.now(UTC)
    session.status = "closed"
    session.closed_at = now
    session.updated_at = now

    sys_msg = ReceptionMessage(
        session_id=session_id,
        sender_type="system",
        sender_name="系统通知",
        content="客户已自主结束会话。感谢您的咨询，请对本次服务进行评价！",
        is_read=True,
        created_at=now,
    )
    db.add(sys_msg)
    db.commit()
    return {"status": "ok", "closed_at": now.isoformat()}


@router.post("/client/sessions/{session_id}/evaluate")
def client_evaluate_session(
    session_id: str,
    body: ClientEvaluateRequest,
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """客户对已结束的会话进行满意度评价"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    now = datetime.now(UTC)
    eval_text = (
        f"【客户服务评价】评分：{body.score}星 | "
        f"标签：{', '.join(body.tags) if body.tags else '无'} | "
        f"意见反馈：{body.comment or '无'}"
    )
    sys_msg = ReceptionMessage(
        session_id=session_id,
        sender_type="system",
        sender_name="服务评价",
        content=eval_text,
        is_read=True,
        created_at=now,
    )
    db.add(sys_msg)
    db.commit()
    return {"status": "ok", "evaluation": body.model_dump()}


# -----------------------------------------------------------------------------
# 消息通知配置 (Notice Management & Client Notices)
# -----------------------------------------------------------------------------


class NoticeItemOut(BaseModel):
    id: int
    notice_no: str
    title: str
    content: str
    start_time: str
    end_time: str
    start_date: str
    end_date: str
    popup_prompt: bool
    status: str
    effective_status: str
    created_by: str
    created_at: str
    updated_by: str
    updated_at: str


class NoticeCreateBody(BaseModel):
    title: str = Field(..., max_length=50)
    start_date: str
    end_date: str
    popup_prompt: bool = True
    content: str


class NoticeUpdateBody(BaseModel):
    title: str | None = Field(None, max_length=50)
    start_date: str | None = None
    end_date: str | None = None
    popup_prompt: bool | None = None
    content: str | None = None


class BatchNoticeIdsBody(BaseModel):
    ids: list[int]


def generate_notice_no(db: Session) -> str:
    """生成系统唯一消息编号: INFYYYYMMDD0000"""
    today_str = datetime.now(UTC).strftime("%Y%m%d")
    prefix = f"INF{today_str}"
    last_notice = (
        db.query(ReceptionNotice.notice_no)
        .filter(ReceptionNotice.notice_no.like(f"{prefix}%"))
        .order_by(desc(ReceptionNotice.notice_no))
        .first()
    )
    if last_notice and len(last_notice[0]) >= 15:
        seq_str = last_notice[0][len(prefix) :]
        try:
            seq = int(seq_str) + 1
        except ValueError:
            seq = 0
    else:
        seq = 0
    return f"{prefix}{seq:04d}"


def parse_date_to_datetime(date_str: str, is_end: bool = False) -> datetime:
    clean = date_str.strip()
    if " " in clean:
        clean = clean.split(" ")[0]
    if "T" in clean:
        clean = clean.split("T")[0]
    parts = [int(p) for p in clean.split("-")]
    if is_end:
        return datetime(parts[0], parts[1], parts[2], 23, 59, 59, tzinfo=UTC)
    else:
        return datetime(parts[0], parts[1], parts[2], 0, 0, 0, tzinfo=UTC)


def format_notice_out(n: ReceptionNotice) -> NoticeItemOut:
    now = datetime.now(UTC)
    nst = n.start_time if n.start_time.tzinfo else n.start_time.replace(tzinfo=UTC)
    net = n.end_time if n.end_time.tzinfo else n.end_time.replace(tzinfo=UTC)
    is_active = (n.status == "published") and (nst <= now <= net)
    eff_status = "published" if is_active else "unpublished"

    return NoticeItemOut(
        id=n.id,
        notice_no=n.notice_no,
        title=n.title,
        content=n.content,
        start_time=nst.strftime("%Y-%m-%d %H:%M:%S"),
        end_time=net.strftime("%Y-%m-%d %H:%M:%S"),
        start_date=nst.strftime("%Y-%m-%d"),
        end_date=net.strftime("%Y-%m-%d"),
        popup_prompt=n.popup_prompt,
        status=n.status,
        effective_status=eff_status,
        created_by=n.created_by,
        created_at=n.created_at.strftime("%Y-%m-%d %H:%M:%S") if n.created_at else "",
        updated_by=n.updated_by,
        updated_at=n.updated_at.strftime("%Y-%m-%d %H:%M:%S") if n.updated_at else "",
    )


@router.get("/notices", response_model=list[NoticeItemOut])
def list_notices(
    statuses: list[str] = Query(None),
    start_time: str | None = None,
    end_time: str | None = None,
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> list[NoticeItemOut]:
    """获取消息通知列表，支持按状态和创建时间区间筛选，按创建时间倒序返回"""
    q = db.query(ReceptionNotice)
    if start_time:
        try:
            st = datetime.fromisoformat(start_time.strip().replace(" ", "T"))
            if st.tzinfo is None:
                st = st.replace(tzinfo=UTC)
            q = q.filter(ReceptionNotice.created_at >= st)
        except Exception:
            pass
    if end_time:
        try:
            et = datetime.fromisoformat(end_time.strip().replace(" ", "T"))
            if et.tzinfo is None:
                et = et.replace(tzinfo=UTC)
            q = q.filter(ReceptionNotice.created_at <= et)
        except Exception:
            pass

    records = q.order_by(desc(ReceptionNotice.created_at)).all()
    results: list[NoticeItemOut] = []

    valid_statuses = set()
    if statuses:
        for s in statuses:
            if s and s != "all" and s != "不限":
                valid_statuses.add(s)

    for n in records:
        item = format_notice_out(n)
        if valid_statuses and item.effective_status not in valid_statuses:
            continue
        results.append(item)
    return results


@router.post("/notices", response_model=NoticeItemOut)
def create_notice(
    body: NoticeCreateBody,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> NoticeItemOut:
    """新建消息通知记录"""
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="通知标题不能为空")
    if not body.start_date.strip() or not body.end_date.strip():
        raise HTTPException(status_code=400, detail="生效开始日期与结束日期不能为空")
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="消息通知内容不能为空")

    st = parse_date_to_datetime(body.start_date, is_end=False)
    et = parse_date_to_datetime(body.end_date, is_end=True)
    if st > et:
        raise HTTPException(status_code=400, detail="生效开始日期不能晚于结束日期")

    notice_no = generate_notice_no(db)
    now = datetime.now(UTC)
    operator_name = user.name or "系统管理员"

    notice = ReceptionNotice(
        notice_no=notice_no,
        title=body.title.strip(),
        content=body.content,
        start_time=st,
        end_time=et,
        popup_prompt=body.popup_prompt,
        status="published",
        created_by=operator_name,
        created_at=now,
        updated_by=operator_name,
        updated_at=now,
    )
    db.add(notice)
    db.commit()
    db.refresh(notice)
    return format_notice_out(notice)


@router.get("/notices/{notice_id}", response_model=NoticeItemOut)
def get_notice_detail(
    notice_id: int,
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> NoticeItemOut:
    """获取消息通知详情"""
    n = db.query(ReceptionNotice).filter(ReceptionNotice.id == notice_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="消息通知记录不存在")
    return format_notice_out(n)


@router.put("/notices/{notice_id}", response_model=NoticeItemOut)
def update_notice(
    notice_id: int,
    body: NoticeUpdateBody,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> NoticeItemOut:
    """编辑/更新消息通知记录"""
    notice = db.query(ReceptionNotice).filter(ReceptionNotice.id == notice_id).first()
    if not notice:
        raise HTTPException(status_code=404, detail="消息通知记录不存在")

    now = datetime.now(UTC)
    operator_name = user.name or "系统管理员"

    if body.title is not None:
        if not body.title.strip():
            raise HTTPException(status_code=400, detail="通知标题不能为空")
        notice.title = body.title.strip()

    if body.start_date is not None and body.end_date is not None:
        st = parse_date_to_datetime(body.start_date, is_end=False)
        et = parse_date_to_datetime(body.end_date, is_end=True)
        if st > et:
            raise HTTPException(status_code=400, detail="生效开始日期不能晚于结束日期")
        notice.start_time = st
        notice.end_time = et

    if body.popup_prompt is not None:
        notice.popup_prompt = body.popup_prompt

    if body.content is not None:
        if not body.content.strip():
            raise HTTPException(status_code=400, detail="消息通知内容不能为空")
        notice.content = body.content

    notice.updated_by = operator_name
    notice.updated_at = now
    db.commit()
    db.refresh(notice)
    return format_notice_out(notice)


@router.post("/notices/batch-publish")
def batch_publish_notices(
    body: BatchNoticeIdsBody,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """批量上架消息通知"""
    if not body.ids:
        return {"status": "ok", "updated_count": 0}

    now = datetime.now(UTC)
    operator_name = user.name or "系统管理员"
    notices = db.query(ReceptionNotice).filter(ReceptionNotice.id.in_(body.ids)).all()

    for n in notices:
        n.status = "published"
        net = n.end_time if n.end_time.tzinfo else n.end_time.replace(tzinfo=UTC)
        if net < now:
            n.end_time = datetime(now.year, now.month, now.day, 23, 59, 59, tzinfo=UTC)
        n.updated_by = operator_name
        n.updated_at = now

    db.commit()
    return {"status": "ok", "updated_count": len(notices)}


@router.post("/notices/batch-unpublish")
def batch_unpublish_notices(
    body: BatchNoticeIdsBody,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """批量下架消息通知"""
    if not body.ids:
        return {"status": "ok", "updated_count": 0}

    now = datetime.now(UTC)
    operator_name = user.name or "系统管理员"
    notices = db.query(ReceptionNotice).filter(ReceptionNotice.id.in_(body.ids)).all()

    for n in notices:
        n.status = "unpublished"
        n.updated_by = operator_name
        n.updated_at = now

    db.commit()
    return {"status": "ok", "updated_count": len(notices)}


@router.post("/notices/batch-delete")
def batch_delete_notices(
    body: BatchNoticeIdsBody,
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """批量删除已下架的消息通知（若选中的记录包含上架状态则拒绝删除）"""
    if not body.ids:
        return {"status": "ok", "deleted_count": 0}

    now = datetime.now(UTC)
    notices = db.query(ReceptionNotice).filter(ReceptionNotice.id.in_(body.ids)).all()

    for n in notices:
        nst = n.start_time if n.start_time.tzinfo else n.start_time.replace(tzinfo=UTC)
        net = n.end_time if n.end_time.tzinfo else n.end_time.replace(tzinfo=UTC)
        is_active = (n.status == "published") and (nst <= now <= net)
        if is_active:
            raise HTTPException(
                status_code=400,
                detail=f"消息【{n.notice_no}】当前处于上架状态，请先下架后再删除！",
            )

    deleted_count = len(notices)
    for n in notices:
        db.delete(n)

    db.commit()
    return {"status": "ok", "deleted_count": deleted_count}


class ClientNoticeOut(BaseModel):
    id: str
    title: str
    content: str
    is_important: bool = False
    publish_time: str
    publisher: str = "金蝶发票云服务团队"
    category: str = "系统通知"
    popup_prompt: bool = True


@router.get("/client/notices", response_model=list[ClientNoticeOut])
def client_get_notices(db: Session = Depends(get_session)) -> list[ClientNoticeOut]:
    """获取面向客户端的重要通知列表（从数据库拉取当前上架且在生效期内的通知）"""
    now = datetime.now(UTC)
    notices = (
        db.query(ReceptionNotice)
        .filter(
            ReceptionNotice.status == "published",
            ReceptionNotice.start_time <= now,
            ReceptionNotice.end_time >= now,
        )
        .order_by(desc(ReceptionNotice.created_at))
        .all()
    )
    if notices:
        results: list[ClientNoticeOut] = []
        for n in notices:
            st = n.start_time if n.start_time.tzinfo else n.start_time.replace(tzinfo=UTC)
            results.append(
                ClientNoticeOut(
                    id=n.notice_no,
                    title=n.title,
                    content=n.content,
                    is_important=True,
                    publish_time=st.strftime("%Y-%m-%d %H:%M"),
                    publisher=n.created_by or "金蝶发票云服务团队",
                    category="重要通知",
                    popup_prompt=n.popup_prompt,
                )
            )
        return results

    # 数据库尚无记录时的默认种子通知
    return [
        ClientNoticeOut(
            id="NOTICE-20260921-01",
            title="关于数电发票乐企直连通道升级维护的通知",
            content="尊敬的纳税人用户：为了提供更稳定优质的数电发票乐企对接服务，国家税务总局定于本周五晚 22:00 至周六早 06:00 进行乐企平台与电子底账系统底层升级。升级期间开票、受票及勾选认证服务可能出现短时响应延迟或连接波动。建议各企业财务提前做好发票开具与勾选安排，紧急开票可使用离线开票备用模式。升级完成后服务将自动恢复，如有疑问请随时联系本在线技术支持团队。",
            is_important=True,
            publish_time="2026-09-21 10:00",
            publisher="国家税务总局运维中心",
            category="系统维护",
            popup_prompt=False,
        ),
        ClientNoticeOut(
            id="NOTICE-20260918-02",
            title="金蝶发票云 2026 年第 3 季度征期服务保障方案",
            content="为全力保障 9 月大征期期间企业税控与数电发票系统平稳运行，金蝶发票云售后技术团队已启动 7×24 小时征期应急响应机制。专家坐席全量在线，针对批量开票卡顿、税控盘升级校验、红字信息表开具异常等常见问题提供 1 对 1 快速排障支持，确保企业纳税申报与发票交付万无一失。",
            is_important=True,
            publish_time="2026-09-18 09:30",
            publisher="金蝶发票云服务团队",
            category="征期保障",
            popup_prompt=False,
        ),
    ]

