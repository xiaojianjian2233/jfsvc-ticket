"""Online reception management API endpoints (Agents, Sessions, Workbench)."""

from __future__ import annotations

import json
import random
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, or_
from sqlalchemy.orm import Session

from app.api.deps.auth import AuthedUser, require_user
from app.db import get_session
from app.models import (
    ReceptionAgent,
    ReceptionMessage,
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

    session.status = "in_progress"
    session.is_human = True
    session.agent_user_id = user.user_id
    session.agent_name = user.name

    sys_msg = ReceptionMessage(
        session_id=session.id,
        sender_type="system",
        sender_name="系统通知",
        content=f"坐席【{user.name}】已接入本次会话，正在为您提供服务。",
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

    # 系统自动回复客户
    auto_reply = ReceptionMessage(
        session_id=session.id,
        sender_type="agent",
        sender_name=user.name,
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
    sys_msg = ReceptionMessage(
        session_id=session.id,
        sender_type="system",
        sender_name="系统通知",
        content=f"会话已被坐席【{user.name}】重新激活。",
        is_read=True,
    )
    db.add(sys_msg)
    db.commit()
    return {"ok": True, "status": "in_progress"}


@router.post("/workbench/sessions/{session_id}/close")
def close_session(
    session_id: str,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """【关闭】会话：发送结束通知并标记为已关闭。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    session.status = "closed"
    session.closed_at = datetime.now(UTC)

    auto_msg = ReceptionMessage(
        session_id=session.id,
        sender_type="system",
        sender_name="系统通知",
        content="您的问题已解决，本次会话已结束，后续如有其他使用问题，可发起新的会话咨询。",
        is_read=True,
    )
    db.add(auto_msg)
    db.commit()
    return {"ok": True, "status": "closed"}


@router.post("/workbench/sessions/{session_id}/transfer-ticket")
def transfer_session_to_ticket(
    session_id: str,
    body: TransferTicketBody,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """【转工单】：创建工单并给客户自动回复工单编号。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 生成模拟/关联工单
    random_num = random.randint(5000, 9999)
    ticket_code = f"TKT-{random_num:06d}"
    session.status = "converted"
    session.ticket_short_code = ticket_code

    auto_msg = ReceptionMessage(
        session_id=session.id,
        sender_type="agent",
        sender_name=user.name,
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

    now = datetime.now(UTC)
    msg = ReceptionMessage(
        session_id=session.id,
        sender_type="agent",
        sender_name=user.name,
        content=body.content.strip(),
        is_read=True,
        created_at=now,
    )
    session.last_message_at = now
    session.agent_last_replied_at = now
    session.agent_user_id = user.user_id
    session.agent_name = user.name
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

    now = datetime.now(UTC)
    for s in in_prog_sessions:
        s.agent_user_id = to_agent.user_id
        s.agent_name = to_agent.user_name
        s.updated_at = now
        # 写入系统转交提示
        sys_msg = ReceptionMessage(
            session_id=s.id,
            sender_type="system",
            sender_name="系统通知",
            content=f"会话已由坐席【{from_agent.user_name}】转交给【{to_agent.user_name}】继续为您服务。",
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
        "from_agent": from_agent.user_name,
        "to_agent": to_agent.user_name,
    }


# -----------------------------------------------------------------------------
# 6. 会话轮询自动分发 API (Auto Dispatch)
# -----------------------------------------------------------------------------


@router.post("/workbench/auto-dispatch")
def auto_dispatch_sessions(
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """根据接待时间区间和在线坐席容量，按先进先出与轮询（Round-Robin）原则自动分配排队会话。"""
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
        # 寻找下一个还有剩余容量的坐席
        found = False
        for _ in range(len(agent_capacities)):
            curr = agent_capacities[agent_idx % len(agent_capacities)]
            agent_idx += 1
            if curr["remaining"] > 0:
                target_agent = curr["agent"]
                curr["remaining"] -= 1

                # 分配会话
                s.status = "in_progress"
                s.is_human = True
                s.agent_user_id = target_agent.user_id
                s.agent_name = target_agent.user_name
                s.updated_at = now

                sys_msg = ReceptionMessage(
                    session_id=s.id,
                    sender_type="system",
                    sender_name="系统通知",
                    content=f"已为您分配在线坐席【{target_agent.user_name}】，正在接入会话...",
                    is_read=True,
                    created_at=now,
                )
                db.add(sys_msg)
                dispatched_count += 1
                found = True
                break

        if not found:
            # 所有在线坐席容量均已用尽，剩余会话继续排队
            break

    db.commit()
    return {"dispatched": dispatched_count}
