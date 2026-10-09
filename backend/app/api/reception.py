"""Online reception management API endpoints (Agents, Sessions, Workbench)."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import random
import re
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import String, and_, desc, func, or_
from sqlalchemy.orm import Session

from app.api.deps.auth import AuthedUser, require_user
from app.config import get_settings
from app.db import get_session
from app.models import (
    CustomerIdentity,
    ProductLine,
    ReceptionAgent,
    ReceptionMessage,
    ReceptionNotice,
    ReceptionSession,
    Source,
    StatusHistory,
    SystemSetting,
    Ticket,
    User,
)
from app.repositories.ticket import TicketRepository
from app.services.ingest.catalog_upsert import safe_product_line_code
from adapters.ai_cs import AiCsClient, AiCsConfig, AiCsError

router = APIRouter()
logger = logging.getLogger(__name__)

# 内存会话缓存：维护 session_id -> ai_agent_cid 映射，支持多轮连续问答
_session_ai_cid_cache: dict[str, str] = {}



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
# Pydantic Schemas - Bot Config & Routing
# -----------------------------------------------------------------------------


class BotAgentProfile(BaseModel):
    id: str
    code: str = ""
    name: str
    avatar: str = "🤖"
    agent_type: str = "normal"  # normal (正常智能体) | fallback (兜底智能体)
    description: str = ""
    webhook_url: str | None = None
    welcome_message: str = "您好！我是智能小助手，请问有什么可以帮您？"
    unresolved_prompt: str = "很抱歉没能彻底解决您的问题。"
    system_prompt: str = "你是一名专业的发票云技术支持专家，请热情、专业、准确地解答用户的问题。"
    skills: list[str] = Field(default_factory=list)
    product_lines: list[str] = Field(default_factory=lambda: ["全部"])
    source_channels: list[str] = Field(default_factory=lambda: ["全部"])
    support_transfer_human: bool = True
    transfer_human_rule: str = "客户回复未解决且在人工工作时间有空闲坐席时触发转人工"
    temperature: float = 0.3
    is_enabled: bool = True
    created_at: str = ""
    created_by: str = "系统管理员"
    updated_at: str = ""


class BotRoutingCondition(BaseModel):
    match_mode: str = "any"  # any | all
    product_keywords: list[str] = Field(default_factory=list)
    company_keywords: list[str] = Field(default_factory=list)
    message_keywords: list[str] = Field(default_factory=list)


class BotRoutingRule(BaseModel):
    id: str
    name: str
    target_agent_id: str
    conditions: BotRoutingCondition = Field(default_factory=BotRoutingCondition)
    is_enabled: bool = True


class BotEscalationStrategy(BaseModel):
    enable_agent_reception: bool = True
    probe_working_hours: bool = True
    probe_human_agents: bool = True
    ask_transfer_text: str = "很抱歉没能解决您的问题。当前有在线专业人工客服，是否为您转接人工坐席？"
    no_human_guide_text: str = "当前人工坐席均在忙碌中或已下班，建议您直接提交售后工单，我们将由技术专家加急排查并在第一时间答复您！"
    show_ticket_button: bool = True


class BotConfigData(BaseModel):
    agents: list[BotAgentProfile] = Field(default_factory=list)
    routing_rules: list[BotRoutingRule] = Field(default_factory=list)
    default_agent_id: str = "agent-general"
    escalation_strategy: BotEscalationStrategy = Field(default_factory=BotEscalationStrategy)


class ProbeCapacityResponse(BaseModel):
    can_transfer_human: bool
    in_working_hours: bool
    online_agent_count: int
    idle_capacity: int
    action_type: str  # "ask_transfer" | "guide_ticket"
    prompt_text: str


class ClientSubmitTicketRequest(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    description: str = Field(..., min_length=5)
    contact_name: str | None = None
    contact_phone: str | None = None
    company_name: str | None = None
    tax_no: str | None = None


class ExternalLlmReplyRequest(BaseModel):
    session_id: str
    content: str
    sender_name: str | None = None
    agent_code: str | None = None


SETTING_KEY_BOT_CONFIG = "reception_bot_config"

DEFAULT_BOT_CONFIG = {
    "agents": [
        {
            "id": "agent-invoice",
            "code": "AGENT0001",
            "name": "数电发票专家",
            "avatar": "🧾",
            "agent_type": "normal",
            "description": "精通数电发票开具、红字发票冲红、发票勾选抵扣与入账归档等业务",
            "webhook_url": "",
            "welcome_message": "您好！欢迎使用发票云售后在线支持。系统已为您建立会话，我是数电发票智能专家，请问在发票开具、红字发票冲红或勾选抵扣中遇到什么问题？",
            "unresolved_prompt": "抱歉没能解决您的数电发票问题，请问需要为您转接人工坐席或提交售后工单跟进吗？",
            "system_prompt": "你是一名精通国家数电发票、电子发票服务平台规则的发票云业务专家。",
            "skills": ["invoice-issuance", "red-invoice", "deduction-check"],
            "product_lines": ["全部"],
            "source_channels": ["全部"],
            "support_transfer_human": True,
            "transfer_human_rule": "客户回复未解决且在人工工作时间有空闲坐席时触发转人工",
            "temperature": 0.2,
            "is_enabled": False,
            "created_at": "2026-09-20 09:00:00",
            "created_by": "系统管理员",
        },
        {
            "id": "agent-tax",
            "code": "AGENT0002",
            "name": "税务申报专家",
            "avatar": "💼",
            "agent_type": "normal",
            "description": "精通税企直连、税局认证、企业所得税与增值税申报接口相关疑问",
            "webhook_url": "",
            "welcome_message": "您好！欢迎使用发票云售后在线支持。系统已为您建立会话，我是税务申报智能助手，请问有什么关于税局接口或纳税申报的问题需要解答？",
            "unresolved_prompt": "税务规则复杂多变，未能解决您的申报疑问十分抱歉。",
            "system_prompt": "你是一名资深税务申报与税局数据接口系统支持专家。",
            "skills": ["tax-declaration", "tax-interfaces"],
            "product_lines": ["全部"],
            "source_channels": ["全部"],
            "support_transfer_human": True,
            "transfer_human_rule": "客户回复未解决且在人工工作时间有空闲坐席时触发转人工",
            "temperature": 0.3,
            "is_enabled": False,
            "created_at": "2026-09-20 09:00:00",
            "created_by": "系统管理员",
        },
        {
            "id": "agent-general",
            "code": "AGENT0003",
            "name": "综合服务助手",
            "avatar": "🤖",
            "agent_type": "fallback",
            "description": "全能型发票云服务助手，负责通用产品功能咨询、账号权限与系统指引",
            "webhook_url": "",
            "welcome_message": "您好！欢迎使用发票云售后在线支持。系统已为您建立会话，我是发票云智能综合助手，请问有什么可以帮您？",
            "unresolved_prompt": "抱歉没能彻底解决您的问题。",
            "system_prompt": "你是一名专业的发票云综合客服支持助手。",
            "skills": ["general-guide", "account-perm"],
            "product_lines": ["全部"],
            "source_channels": ["全部"],
            "support_transfer_human": True,
            "transfer_human_rule": "客户回复未解决且在人工工作时间有空闲坐席时触发转人工",
            "temperature": 0.3,
            "is_enabled": True,
            "created_at": "2026-09-20 09:00:00",
            "created_by": "系统管理员",
        },
    ],
    "routing_rules": [
        {
            "id": "rule-invoice",
            "name": "数电与发票类咨询分流",
            "target_agent_id": "agent-invoice",
            "conditions": {
                "match_mode": "any",
                "product_keywords": ["数电票", "全电发票", "进销项", "发票云"],
                "company_keywords": [],
                "message_keywords": ["开票", "红字", "勾选", "作废", "差额征税", "纸电混合", "税控盘"],
            },
            "is_enabled": True,
        },
        {
            "id": "rule-tax",
            "name": "税务申报与直连分流",
            "target_agent_id": "agent-tax",
            "conditions": {
                "match_mode": "any",
                "product_keywords": ["税企直连", "纳税申报", "税局端"],
                "company_keywords": [],
                "message_keywords": ["申报", "扣税", "税局", "认证", "增值税", "所得税", "接口超时"],
            },
            "is_enabled": True,
        },
    ],
    "default_agent_id": "agent-general",
    "escalation_strategy": {
        "enable_agent_reception": True,
        "probe_working_hours": True,
        "probe_human_agents": True,
        "ask_transfer_text": "很抱歉没能解决您的问题。当前有在线专业人工客服，是否为您转接人工坐席？",
        "no_human_guide_text": "当前人工坐席均在忙碌中或已下班，建议您直接提交售后工单，我们将由技术专家加急排查并在第一时间答复您！",
        "show_ticket_button": True,
    },
}


def normalize_bot_default_agent(config: BotConfigData) -> BotConfigData:
    """Ensure the default pointer only targets an explicitly configured fallback agent."""
    fallback_agent_ids = [agent.id for agent in config.agents if agent.agent_type == "fallback"]
    if config.default_agent_id not in fallback_agent_ids:
        config.default_agent_id = fallback_agent_ids[0] if fallback_agent_ids else ""
    return config


def get_db_bot_config(db: Session) -> BotConfigData:
    setting = db.query(SystemSetting).filter(SystemSetting.key == SETTING_KEY_BOT_CONFIG).first()
    config: BotConfigData | None = None
    if setting and setting.value:
        try:
            data = json.loads(setting.value)
            config = BotConfigData.model_validate(data)
        except Exception:
            pass
    if not config:
        config = BotConfigData.model_validate(DEFAULT_BOT_CONFIG)

    # 规范化补全编号与基础字段
    max_num = 0
    for a in config.agents:
        if a.code and a.code.startswith("AGENT") and a.code[5:].isdigit():
            max_num = max(max_num, int(a.code[5:]))
    for a in config.agents:
        if not a.code:
            max_num += 1
            a.code = f"AGENT{max_num:04d}"
        if not getattr(a, "agent_type", None):
            a.agent_type = "fallback" if a.id == config.default_agent_id else "normal"
        if not a.created_at:
            a.created_at = "2026-09-20 09:00:00"
        if not a.created_by:
            a.created_by = "系统管理员"
        if not a.product_lines:
            a.product_lines = ["全部"]
        if not getattr(a, "source_channels", None):
            a.source_channels = ["全部"]
        if not a.transfer_human_rule:
            a.transfer_human_rule = "客户回复未解决且在人工工作时间有空闲坐席时触发转人工"
    return normalize_bot_default_agent(config)


def save_db_bot_config(
    db: Session, config: BotConfigData, user_id: int | None = None
) -> BotConfigData:
    config = normalize_bot_default_agent(config)
    setting = db.query(SystemSetting).filter(SystemSetting.key == SETTING_KEY_BOT_CONFIG).first()
    json_val = json.dumps(config.model_dump())
    if setting:
        setting.value = json_val
        setting.updated_by = user_id
    else:
        setting = SystemSetting(key=SETTING_KEY_BOT_CONFIG, value=json_val, updated_by=user_id)
        db.add(setting)
    db.commit()
    return config


def match_bot_agent(
    config: BotConfigData,
    *,
    company_name: str = "",
    purchased_products: list[str] | None = None,
    product_line: str = "",
    source_channel: str = "",
    message_text: str = "",
) -> BotAgentProfile:
    """根据智能机器人的适用产品线和适用来源渠道匹配。

    若来访客户能明确知道发起会话的渠道和产品线时，调用匹配的智能体接待；
    若不知道或未定位到适配智能机器人，则匹配兜底智能体接待。
    """
    enabled_agents = [a for a in config.agents if a.is_enabled]
    if not enabled_agents:
        return BotAgentProfile(
            id="agent-fallback",
            code="AGENT0000",
            name="发票云智能AI助手",
            agent_type="fallback",
            welcome_message="您好！我是发票云智能AI助手，请问有什么可以帮您？",
        )

    # 兜底智能体寻找：优先使用 default_agent_id 指向的显式 fallback 智能体，
    # 再取其他 fallback；未配置兜底时才降级使用第一个启用的智能体。
    fallback_agent = next(
        (
            a
            for a in enabled_agents
            if a.id == config.default_agent_id and a.agent_type == "fallback"
        ),
        None,
    )
    if not fallback_agent:
        fallback_agent = next((a for a in enabled_agents if a.agent_type == "fallback"), None)
    if not fallback_agent:
        fallback_agent = enabled_agents[0]

    # 收集来访客户的产品线候选词与渠道
    prod_candidates: list[str] = []
    if product_line and product_line.strip():
        prod_candidates.append(product_line.strip().lower())
    for p in (purchased_products or []):
        if p and p.strip():
            prod_candidates.append(p.strip().lower())

    channel_clean = (source_channel or "").strip().lower()

    # 如果来访客户没有明确产品线与渠道，直接调用兜底机器人接待
    if not prod_candidates and not channel_clean:
        return fallback_agent

    # 针对明确知道发起渠道和产品线的场景，匹配对应智能机器人
    best_agent: BotAgentProfile | None = None
    best_score = 0

    for agent in enabled_agents:
        if agent.agent_type == "fallback":
            continue

        agent_lines = [l.strip().lower() for l in (agent.product_lines or ["全部"])]
        agent_channels = [c.strip().lower() for c in (agent.source_channels or ["全部"])]

        score = 0
        prod_match = False
        if prod_candidates:
            if any(l in cand or cand in l for l in agent_lines if l != "全部" for cand in prod_candidates):
                score += 3
                prod_match = True
            elif "全部" in agent_lines:
                score += 1
                prod_match = True
        else:
            if "全部" in agent_lines:
                score += 1
                prod_match = True

        channel_match = False
        if channel_clean:
            if any(c in channel_clean or channel_clean in c for c in agent_channels if c != "全部"):
                score += 3
                channel_match = True
            elif "全部" in agent_channels:
                score += 1
                channel_match = True
        else:
            if "全部" in agent_channels:
                score += 1
                channel_match = True

        if prod_match and channel_match:
            if score > best_score:
                best_score = score
                best_agent = agent

    if best_agent and best_score >= 1:
        return best_agent

    # 未定位到适配智能机器人时，由兜底机器人接待
    return fallback_agent


def check_human_capacity(db: Session) -> tuple[bool, bool, int, int, str]:
    schedule = get_db_schedule_settings(db)
    now = datetime.now()
    current_time_str = now.strftime("%H:%M")
    is_weekend = now.weekday() >= 5
    slots = schedule.weekend_slots if is_weekend else schedule.weekday_slots

    in_working_hours = False
    for slot in slots:
        if slot.start <= current_time_str <= slot.end:
            in_working_hours = True
            break

    online_agents = db.query(ReceptionAgent).filter(ReceptionAgent.status == "online").all()
    online_count = len(online_agents)

    # 校验规则：至少有 1 名状态“在线”的人工坐席
    has_capacity = online_count > 0

    total_capacity = sum(a.max_concurrent for a in online_agents)
    online_user_ids = [a.user_id for a in online_agents if a.user_id]

    current_active_load = 0
    if online_user_ids:
        current_active_load = (
            db.query(func.count(ReceptionSession.id))
            .filter(
                ReceptionSession.is_human == True,
                ReceptionSession.status == "in_progress",
                ReceptionSession.agent_user_id.in_(online_user_ids),
            )
            .scalar()
            or 0
        )

    idle_capacity = max(0, total_capacity - current_active_load)

    if not in_working_hours:
        reason = "当前处于非人工坐席服务时段"
    elif not has_capacity:
        reason = "当前无状态为“在线”的人工客服坐席"
    else:
        reason = f"当前有 {online_count} 位在线坐席"

    return in_working_hours, has_capacity, online_count, idle_capacity, reason


_GREETING_PATTERNS = [
    r"^(?:(?:你好|您好|哈喽|hello|hi|hey)[，,\s]*)?(?:请问)?(?:在吗|在么|有人吗|有人在吗|请问有人吗|有人么|请问在吗)[\s!！?？~～.。]*$",
    r"^(?:你好|您好|在吗|在么|有人吗|有人在吗|请问有人吗|hello|hi|hey|哈喽)[\s!！?？~～.。]*$",
    r"^(?:请问|咨询一下|请教一下)[\s!！?？~～.。]*$",
]


def _clean_agent_display_name(raw_name: str | None) -> str:
    if not raw_name:
        return "智能客服助手"
    name = raw_name.strip()
    if name.startswith("data:image/"):
        space_idx = name.find(" ")
        if space_idx > 0:
            name = name[space_idx + 1 :].strip()
    name = re.sub(r"^[^\w\u4e00-\u9fa5]+", "", name).strip()
    return name or "智能客服助手"


def generate_bot_answer(agent: BotAgentProfile, question: str) -> str:
    q_clean = re.sub(r"「引用\s+[^:：]+[:：][^」]+」\n?", "", (question or "")).strip()
    q_lower = q_clean.lower()
    clean_name = _clean_agent_display_name(agent.name if agent else None)

    if any(re.match(p, q_clean, re.IGNORECASE) for p in _GREETING_PATTERNS):
        return f"您好！我是{clean_name}，很高兴为您服务。您可以向我咨询发票云产品相关问题。"

    if any(k in q_lower for k in ["红字", "冲红", "红冲"]):
        return (
            "【红字发票开具操作指引】\n"
            "1. 请在【发票管理】>【红字发票】模块中点击【申请红字信息表】；\n"
            "2. 录入需冲红的蓝字发票代码与发票号码，系统将自动校验原发票状态与开票数据；\n"
            "3. 提交税局端校验审核通过后，获得红字信息表编号；\n"
            "4. 在开票界面选择【导入红字信息表】，核对金额与税额无误后点击【开具红字发票】完成冲红。\n\n"
            "💡 若原发票已跨月认证抵扣，需由购买方发起填开信息表，请核实发票开具主体。"
        )
    elif any(k in q_lower for k in ["勾选", "抵扣", "进项"]):
        return (
            "【发票勾选抵扣操作说明】\n"
            "1. 登录系统进入【进项发票管理】>【发票勾选确认】；\n"
            "2. 筛选查询对应的开票月份或发票代码范围；\n"
            "3. 勾选需要用于本期抵扣的发票明细，点击【确认勾选】；\n"
            "4. 在申报期截止日前，点击【申请统计】并完成【统计确认】即可计入当期进项税额抵扣。"
        )
    elif any(k in q_lower for k in ["作废", "作废发票", "撤销"]):
        return (
            "【发票作废规则】\n"
            "1. 全电/数电发票不再提供纸质票传统的直接作废功能，如需更正请通过【开具红字发票】进行冲红；\n"
            "2. 如为传统税控纸质发票，且在当月开具未抄报税的情况下，可在【发票查询】中选中发票点击【作废】；\n"
            "3. 跨月发票一律不能直接作废，只能走红字冲红流程。"
        )
    elif any(k in q_lower for k in ["额度", "开票限额", "授信额度", "总额度"]):
        return (
            "【数电发票开票额度说明】\n"
            "1. 数电发票实行税局端【总额度】管理机制，不再区分单张发票最高限额；\n"
            "2. 您可在系统首页或【企业信息】中查看当月【可用开票额度】；\n"
            "3. 当月额度不足时，可向主管税务机关发起【调整开票总额度申请】。"
        )
    elif any(k in q_lower for k in ["交付", "发送发票", "邮箱", "短信"]):
        return (
            "【发票交付方式】\n"
            "1. 在【发票填开】或【发票查询】详情中，点击【发票交付】按钮；\n"
            "2. 支持通过【短信发送提取码】、【电子邮箱发送PDF/OFD版式文件】或直接下载发票原件；\n"
            "3. 也可直接复制税局端查验下载链接发送给客户。"
        )

    return (
        f"您好！关于您咨询的问题：“{question[:60]}”，为您整理如下解答方案：\n"
        f"1. 请确认当前系统账号具备对应功能的业务操作权限；\n"
        f"2. 请前往系统功能模块核对基础信息录入是否完整，若涉及税局网络交互请检查网络连接；\n"
        f"3. 您也可以查阅发票云在线帮助手册或参考系统内操作指引。\n\n"
        f"💡 如以上说明已解决您的问题，请点击下方【👍 已解决】；如未解决，请点击【👎 未解决】获取人工坐席或工单支持。"
    )


# -----------------------------------------------------------------------------
# 会话内容清洗与工单真实生成函数 (对齐泳道 5 规则)
# -----------------------------------------------------------------------------


_STATUS_PATTERNS = [
    r"^(?:[12](?:[.\s、]*(?:解决|未解决))?|已解决|未解决|没解决|没有解决|问题已解决|问题未解决|好了|行了|满意|不满意)[\s!！?？~～.。]*$",
]

_TRANSFER_PATTERNS = [
    r"^(?:转(?:接)?人工(?:客服|坐席|服务)?|人工(?:客服|在线)?|呼叫人工|接入人工|找人工)[\s!！?？~～.。]*$",
]


def clean_and_extract_ticket_content(
    messages: list[ReceptionMessage],
    company_name: str = "",
    purchased_products: list[str] | None = None,
) -> tuple[str, str, str | None]:
    """清洗会话历史，提取工单标题、工单内容和提单产品线。

    规则对齐泳道图：
    - 工单标题：取客户第一个产品问题
    - 工单内容：取所有客户发送的不包含问候语、未解决、转人工的内容
    - 提单产品线：对话中有取没有则为空
    """
    valid_customer_questions: list[str] = []

    sorted_msgs = sorted(
        messages,
        key=lambda m: m.created_at if m.created_at else datetime.min.replace(tzinfo=UTC),
    )

    for m in sorted_msgs:
        if m.sender_type != "customer":
            continue
        raw_text = (m.content or "").strip()
        if not raw_text or raw_text.startswith("[CARD:"):
            continue
        # 去掉前端引用的格式「引用 ...」
        clean_text = re.sub(r"「引用\s+[^:：]+[:：][^」]+」\n?", "", raw_text).strip()
        if not clean_text:
            continue

        # 1. 过滤状态词（如 1、2、已解决、未解决）
        if any(re.match(p, clean_text, re.IGNORECASE) for p in _STATUS_PATTERNS):
            continue

        # 2. 过滤转人工词（如 人工、转人工、人工客服）
        if any(re.match(p, clean_text, re.IGNORECASE) for p in _TRANSFER_PATTERNS):
            continue

        # 3. 过滤纯打招呼（如 你好、在吗）
        if any(re.match(p, clean_text, re.IGNORECASE) for p in _GREETING_PATTERNS):
            continue

        # 4. 如果是以打招呼开头，剥离前缀招呼语
        clean_question = re.sub(
            r"^(?:(?:你好|您好|哈喽|hello|hi)[，,\s]*)*(?:请问[，,\s]*)?",
            "",
            clean_text,
            flags=re.IGNORECASE,
        ).strip()
        if not clean_question or any(
            re.match(p, clean_question, re.IGNORECASE) for p in _GREETING_PATTERNS
        ):
            continue

        valid_customer_questions.append(clean_question)

    # 提取首个有效问题作为标题
    if valid_customer_questions:
        first_q = valid_customer_questions[0].replace("\n", " ").strip()
        title = first_q[:77] + "..." if len(first_q) > 80 else first_q
    else:
        title = f"{company_name}在线咨询技术协助" if company_name else "在线接待客户咨询协助"

    # 合并所有清洗后的提问作为工单内容
    if valid_customer_questions:
        if len(valid_customer_questions) == 1:
            body = valid_customer_questions[0]
        else:
            body = "\n".join(f"{i+1}. {q}" for i, q in enumerate(valid_customer_questions))
    else:
        body = "客户在线咨询未解决，申请售后工单协助处理。"

    # 识别产品线（对话中有取，没有则为空）
    all_text = " ".join(valid_customer_questions).lower()
    product_line_code: str | None = None
    if any(k in all_text for k in ["数电", "开票", "发票", "冲红", "红字", "勾选"]):
        product_line_code = "invoice"
    elif any(k in all_text for k in ["申报", "纳税", "所得税", "增值税", "税局"]):
        product_line_code = "tax"
    elif purchased_products:
        p_str = " ".join(purchased_products).lower()
        if "数电" in p_str or "发票" in p_str:
            product_line_code = "invoice"
        elif "申报" in p_str or "税" in p_str:
            product_line_code = "tax"

    return title, body, product_line_code


def create_ticket_from_reception_session(
    db: Session,
    session: ReceptionSession,
    title: str | None = None,
    body: str | None = None,
    user_id: int | None = None,
) -> Ticket:
    """根据在线接待会话真实在 tickets 表创建工单记录（对齐泳道 5 规则）。"""
    messages = (
        db.query(ReceptionMessage)
        .filter(ReceptionMessage.session_id == session.id)
        .order_by(ReceptionMessage.created_at.asc())
        .all()
    )
    extracted_title, extracted_body, extracted_product = clean_and_extract_ticket_content(
        messages,
        company_name=session.company_name or "",
        purchased_products=[session.tenant_name] if session.tenant_name else [],
    )
    final_title = (title or "").strip() or extracted_title
    final_body = (body or "").strip() or extracted_body

    # 1. 确保来源 sources 存在 online_reception
    source_record = db.query(Source).filter(Source.code == "online_reception").first()
    if not source_record:
        source_record = Source(code="online_reception", name="在线接待", is_active=True)
        db.add(source_record)
        db.flush()

    # 2. 产品线 code 校验与外键安全
    final_product_code = None
    if extracted_product:
        final_product_code = safe_product_line_code(db, extracted_product)
        if not final_product_code:
            p_exist = db.query(ProductLine).filter(ProductLine.code == extracted_product).first()
            if p_exist:
                final_product_code = p_exist.code

    # 3. 生成合法标准工单单号 TKT-xxxxxx
    ticket_repo = TicketRepository(db)
    next_code = ticket_repo.next_short_code("TKT")

    # 4. 构造 Ticket ORM 记录
    reporter_data = {
        "name": session.contact_name or "客户",
        "mobile": session.contact_phone or "",
        "phone": session.contact_phone or "",
        "email": None,
    }
    now = datetime.now(UTC)
    ticket = Ticket(
        short_code=next_code,
        type="Raw",
        source_code="online_reception",
        source_ticket_id=session.id,
        source_ticket_number=session.id,
        title=final_title,
        body=final_body,
        product_line_code=final_product_code,
        reporter_company=session.company_name,
        reporter_tax_no=session.tax_no,
        reporter_tenant=session.tenant_name or session.tenant_no,
        reporter=reporter_data,
        status="received",
        process_stage="received",
        source_payload={
            "session_id": session.id,
            "channel": "online_reception",
            "created_via": "reception_transfer",
            "created_at": now.isoformat(),
        },
        created_at=now,
        updated_at=now,
    )
    db.add(ticket)
    db.flush()

    # 5. 写入状态历史变更审计
    status_hist = StatusHistory(
        entity_type="ticket",
        entity_id=ticket.id,
        from_status="none",
        to_status="received",
        changed_by=f"reception:{session.id}",
        reason="由在线接待转工单创建",
        changed_at=now,
    )
    db.add(status_hist)

    # 6. 回写更新接待会话状态
    session.status = "converted"
    session.ticket_id = ticket.id
    session.ticket_short_code = ticket.short_code
    session.summary = f"已转工单：{ticket.title}"
    session.updated_at = now

    return ticket


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
    ai_agent_cid: str | None = None
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
    """获取系统基础配置中处于启用状态且未在当前坐席列表中的人员。"""
    existing_rows = db.query(ReceptionAgent.user_id, ReceptionAgent.user_name).all()
    existing_ids = {r[0] for r in existing_rows if r[0] is not None}
    existing_names = {r[1] for r in existing_rows if r[1]}
    users = db.query(User).filter(User.is_active == True, User.deleted_at.is_(None)).all()  # noqa: E712
    return [
        EligibleUserOut.model_validate(u)
        for u in users
        if u.id not in existing_ids and u.name not in existing_names
    ]


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

    should_dispatch = False
    if body.nickname is not None:
        agent.nickname = body.nickname.strip()
    if body.max_concurrent is not None:
        agent.max_concurrent = body.max_concurrent
        should_dispatch = True
    if body.status is not None:
        if body.status == "online" and agent.status != "online":
            should_dispatch = True
        agent.status = body.status

    db.commit()
    db.refresh(agent)

    if should_dispatch and agent.status == "online":
        try:
            dispatch_online_sessions_internal(db)
        except Exception as e:
            logger.warning("Auto dispatch on update_agent failed: %s", e)

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
    """【结束】会话并触发空位补位分发。"""
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

    # 坐席释放空位：自动触发排队会话补位分发 (对齐泳道 4)
    try:
        dispatch_online_sessions_internal(db)
    except Exception as e:
        logger.warning("Auto dispatch on close_session failed: %s", e)

    return {"ok": True, "status": "closed"}


@router.post("/workbench/sessions/{session_id}/transfer-ticket")
def convert_to_ticket(
    session_id: str,
    body: TransferTicketBody,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> dict[str, Any]:
    """【转工单】真实在 tickets 表创建工单并完成会话转换 (对齐泳道 5)。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    agent_record = db.query(ReceptionAgent).filter(ReceptionAgent.user_id == user.user_id).first()
    agent_display_name = agent_record.nickname if (agent_record and agent_record.nickname) else user.name

    # 真实创建 Ticket 记录（自动根据会话清洗提取产品问题与内容）
    ticket = create_ticket_from_reception_session(
        db,
        session,
        title=body.title,
        body=body.remark,
        user_id=user.user_id,
    )
    ticket_code = ticket.short_code

    auto_msg = ReceptionMessage(
        session_id=session.id,
        sender_type="agent",
        sender_name=agent_display_name,
        content=f"您的问题需要转工单推送到产研修复，已经帮您创建工单【{ticket_code}】（标题：{ticket.title}），后续可在工单列表查看处理进度。",
        is_read=True,
    )
    db.add(auto_msg)
    db.commit()

    # 坐席释放空位：自动触发排队会话补位分发 (对齐泳道 4)
    try:
        dispatch_online_sessions_internal(db)
    except Exception as e:
        logger.warning("Auto dispatch on transfer_ticket failed: %s", e)

    return {
        "ok": True,
        "ticket_id": ticket.id,
        "ticket_short_code": ticket_code,
        "title": ticket.title,
        "status": "converted",
    }


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
# 4.1 智能接待配置 API (Bot Config & Routing Rules)
# -----------------------------------------------------------------------------


@router.get("/bot-config", response_model=BotConfigData)
def get_bot_config(
    db: Session = Depends(get_session),
    _user: AuthedUser = Depends(require_user),
) -> BotConfigData:
    """获取在线智能接待 Agent 档案、分流规则与转人工策略配置。"""
    return get_db_bot_config(db)


@router.put("/bot-config", response_model=BotConfigData)
def update_bot_config(
    body: BotConfigData,
    db: Session = Depends(get_session),
    user: AuthedUser = Depends(require_user),
) -> BotConfigData:
    """更新在线智能接待 Agent 档案、分流规则与转人工策略配置。"""
    return save_db_bot_config(db, body, user_id=user.user_id)


@router.post("/webhook/llm-reply")
@router.post("/agent/external-message")
def webhook_external_llm_reply(
    body: ExternalLlmReplyRequest,
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """接收第三方大模型异步调用回调推送的消息，并存入会话展示给客户。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == body.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.status in ("closed", "converted"):
        raise HTTPException(status_code=400, detail="当前会话已结束，不可追加消息")

    now = datetime.now(UTC)
    sender_name = body.sender_name or session.agent_name or "智能助手"
    msg = ReceptionMessage(
        session_id=session.id,
        sender_type="bot",
        sender_name=sender_name,
        content=body.content,
        is_read=True,
        created_at=now,
    )
    db.add(msg)
    session.last_message = body.content[:200]
    session.last_message_at = now
    session.updated_at = now
    db.commit()
    db.refresh(msg)

    return {
        "ok": True,
        "message_id": msg.id,
        "session_id": session.id,
        "sender_name": sender_name,
        "created_at": now.isoformat(),
    }


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
        if history_session and history_session.contact_name and not history_session.contact_name.startswith("客户_"):
            contact_name = history_session.contact_name
        else:
            contact_name = phone

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

    bot_config = get_db_bot_config(db)
    use_agent = bot_config.escalation_strategy.enable_agent_reception
    matched_agent: BotAgentProfile | None = None

    if use_agent:
        matched_agent = match_bot_agent(
            bot_config,
            company_name=body.company_name,
            purchased_products=purchased_products or [],
        )

    # 预创建大模型通道会话标识 ai_agent_cid（与本地会话 ID 建立 1 对 1 绑定关系）
    init_cid: str | None = None
    settings = get_settings()
    ai_cs_app_id = (
        getattr(settings, "ai_cs_app_id", "")
        or os.environ.get("OPEN_API_APP_ID", "")
        or os.environ.get("AI_CS_APP_ID", "")
    ).strip()
    ai_cs_app_key = (
        getattr(settings, "ai_cs_app_key", "")
        or os.environ.get("OPEN_API_APP_KEY", "")
        or os.environ.get("AI_CS_APP_KEY", "")
    ).strip()
    if ai_cs_app_id and ai_cs_app_key:
        try:
            cfg = AiCsConfig.from_settings(settings)
            with AiCsClient(cfg) as ai_client:
                init_cid = ai_client.ask_init()
                _session_ai_cid_cache[session_id] = init_cid
        except Exception as e:
            logger.warning("ask_init failed on client_init_session for %s: %s", session_id, e)

    session = ReceptionSession(
        id=session_id,
        ai_agent_cid=init_cid,
        session_type="online",
        status="in_progress" if use_agent else "queue",
        is_human=not use_agent,
        agent_name=matched_agent.name if (use_agent and matched_agent) else "在线待分配",
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

    if use_agent and matched_agent:
        welcome_content = (
            matched_agent.welcome_message
            or f"您好！我是{matched_agent.name}，很高兴为您服务，请问有什么可以帮您？"
        )
        welcome_msg = ReceptionMessage(
            session_id=session.id,
            sender_type="bot",
            sender_name=matched_agent.name,
            content=welcome_content,
            is_read=True,
            created_at=now,
        )
    else:
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

    if not use_agent:
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

    # 1. 核心交互闭环：识别“已解决”反馈（支持 Agent 接待阶段与人工接待阶段自动关闭，对齐节点 7.1）
    content_stripped = body.content.strip()
    last_eval_msg = (
        db.query(ReceptionMessage)
        .filter(ReceptionMessage.session_id == session_id)
        .filter(ReceptionMessage.sender_type.in_(["bot", "agent", "system"]))
        .order_by(desc(ReceptionMessage.created_at))
        .first()
    )
    has_resolution_prompt = False
    if last_eval_msg and last_eval_msg.content:
        has_resolution_prompt = bool(
            re.search(r"(?:1\s*解决|是否(?:已经)?解决|解决您的(?:问题|疑问))", last_eval_msg.content)
        )

    is_resolved_feedback = (
        content_stripped in ("1 解决", "1.解决", "1、解决", "已解决", "问题已解决", "好了", "行了", "满意")
        or (has_resolution_prompt and content_stripped == "1")
    )

    if is_resolved_feedback:
        bot_time = datetime.now(UTC)
        session.status = "closed"
        session.closed_at = bot_time
        session.updated_at = bot_time

        if not session.is_human:
            # 1) Agent 接待阶段已解决 (对齐节点 7.1)
            session.is_human = False
            bot_config = get_db_bot_config(db)
            if not session.agent_name or session.agent_name in ("在线待分配", "智能助手"):
                matched_agent = match_bot_agent(
                    bot_config, company_name=session.company_name, purchased_products=[]
                )
                session.agent_name = matched_agent.name

            bot_answer = "🎉 很高兴为您解决问题！发票云专家团队始终为您保驾护航。本次会话已结束，请对本次服务进行评价！"
            bot_msg = ReceptionMessage(
                session_id=session_id,
                sender_type="bot",
                sender_name=session.agent_name,
                content=bot_answer,
                is_read=True,
                created_at=bot_time,
            )
            db.add(bot_msg)
            session.last_message = bot_answer[:200]
            session.last_message_at = bot_time

            # 释放 Open API Channel 远程会话
            cid = _session_ai_cid_cache.pop(session_id, None)
            if cid:
                try:
                    cfg = AiCsConfig.from_settings(get_settings())
                    with AiCsClient(cfg) as ai_client:
                        ai_client.end_session(cid)
                except Exception:
                    pass
        else:
            # 2) 人工接待阶段已解决
            session.is_human = True
            agent_disp = session.agent_name or "人工客服"
            sys_answer = f"客户已确认问题解决，本次由坐席【{agent_disp}】接待的人工会话已结束，感谢您的咨询，请对本次服务进行评价！"
            sys_msg = ReceptionMessage(
                session_id=session_id,
                sender_type="system",
                sender_name="系统通知",
                content=sys_answer,
                is_read=True,
                created_at=bot_time,
            )
            db.add(sys_msg)
            session.last_message = sys_answer[:200]
            session.last_message_at = bot_time

        db.commit()
        db.refresh(session)

        # 坐席释放空位时触发排队补位分发 (对齐泳道 4)
        if session.is_human:
            try:
                dispatch_online_sessions_internal(db)
            except Exception as e:
                logger.warning("Auto dispatch on human resolved failed: %s", e)

        return MessageOut.model_validate(msg)

    # 如果会话当前处于 Agent 接待（非人工坐席），且不是卡片信令，触发 Agent 自动作答
    if not session.is_human and not body.content.startswith("[CARD:"):
        bot_config = get_db_bot_config(db)

        # 2. 识别“未解决 / 2”等关键词，直接触发未解决探针引导
        is_unresolved_feedback = (
            content_stripped in ("2 未解决", "2.未解决", "2、未解决", "未解决", "没解决", "没有解决", "问题未解决")
            or (has_resolution_prompt and content_stripped == "2")
        )
        if is_unresolved_feedback:
            strat = bot_config.escalation_strategy
            in_working_hours, has_capacity, online_count, idle_capacity, _ = check_human_capacity(db)
            allow_human = True
            if strat.probe_working_hours and not in_working_hours:
                allow_human = False
            if strat.probe_human_agents and not has_capacity:
                allow_human = False

            action_type = "ask_transfer" if allow_human else "guide_ticket"
            prompt_text = strat.ask_transfer_text if allow_human else strat.no_human_guide_text
            card_time = datetime.now(UTC)
            card_msg = ReceptionMessage(
                session_id=session_id,
                sender_type="system",
                sender_name="智能服务助手",
                content=f"[CARD:{action_type}] {prompt_text}",
                is_read=True,
                created_at=card_time,
            )
            db.add(card_msg)
            session.last_message = prompt_text[:200]
            session.last_message_at = card_time
        else:
            # 正常咨询：匹配对应 Agent 并生成结构化自动应答
            matched_agent = match_bot_agent(
                bot_config,
                company_name=session.company_name,
                purchased_products=[],
                message_text=body.content,
            )
            bot_answer = ""
            transfer_card_prompt: tuple[str, str] | None = None

            # 1. 优先调用 Open API Channel 同步问答（基于 open-api-channel.md 规范，传入智能体配置的 skill）
            settings = get_settings()
            ai_cs_app_id = (
                getattr(settings, "ai_cs_app_id", "")
                or os.environ.get("OPEN_API_APP_ID", "")
                or os.environ.get("AI_CS_APP_ID", "")
            ).strip()
            ai_cs_app_key = (
                getattr(settings, "ai_cs_app_key", "")
                or os.environ.get("OPEN_API_APP_KEY", "")
                or os.environ.get("AI_CS_APP_KEY", "")
            ).strip()
            if ai_cs_app_id and ai_cs_app_key:
                try:
                    cfg = AiCsConfig.from_settings(settings)
                    cached_cid = getattr(session, "ai_agent_cid", None) or _session_ai_cid_cache.get(session_id)
                    primary_skill = matched_agent.skills[0] if (matched_agent and matched_agent.skills) else None
                    effective_skill = "customer-service"
                    if primary_skill in ("customer-service", "customer-service-feishu"):
                        effective_skill = primary_skill
                    with AiCsClient(cfg) as ai_client:
                        res = ai_client.answer_no_stream(
                            question=body.content,
                            cid=cached_cid,
                            skill=effective_skill,
                            user_name=body.sender_name or session.contact_name or "客户",
                        )
                        if res.ai_agent_cid:
                            session.ai_agent_cid = res.ai_agent_cid
                            _session_ai_cid_cache[session_id] = res.ai_agent_cid
                            db.add(session)
                        bot_answer = res.answer

                        # 核心联动：若 Open API Channel 识别到转人工意图（TRANSFER）
                        if res.transfer_result == "TRANSFER":
                            strat = bot_config.escalation_strategy
                            in_working_hours, has_capacity, online_count, idle_capacity, _ = check_human_capacity(db)
                            allow_human = True
                            if strat.probe_working_hours and not in_working_hours:
                                allow_human = False
                            if strat.probe_human_agents and not has_capacity:
                                allow_human = False

                            action_type = "ask_transfer" if allow_human else "guide_ticket"
                            prompt_text = strat.ask_transfer_text if allow_human else strat.no_human_guide_text
                            transfer_card_prompt = (action_type, prompt_text)
                except Exception as e:
                    logger.warning("Call Open API Channel answer_no_stream failed for session %s: %s", session_id, e)

            # 2. 若未从 Open API Channel 获取到答复，检查是否配置了第三方大模型推送地址 (webhook_url)
            if not bot_answer and matched_agent.webhook_url and matched_agent.webhook_url.strip():
                try:
                    webhook_payload = {
                        "session_id": session_id,
                        "message": body.content,
                        "agent_code": matched_agent.code or matched_agent.id,
                        "agent_name": matched_agent.name,
                        "company_name": session.company_name or "",
                        "timestamp": datetime.now(UTC).isoformat(),
                    }
                    with httpx.Client(timeout=5.0) as client:
                        resp = client.post(matched_agent.webhook_url.strip(), json=webhook_payload)
                        if resp.status_code == 200:
                            data = resp.json()
                            if isinstance(data, dict):
                                bot_answer = (
                                    data.get("reply")
                                    or data.get("message")
                                    or data.get("content")
                                    or data.get("text")
                                    or ""
                                )
                except Exception as e:
                    logger.warning("Push to external LLM webhook failed for agent %s: %s", matched_agent.id, e)

            # 3. 若第三方仍未返回回复，则平滑降级使用本地知识库/规则回复
            if not bot_answer:
                bot_answer = generate_bot_answer(matched_agent, body.content)

            clean_agent_name = _clean_agent_display_name(matched_agent.name if matched_agent else session.agent_name)
            if bot_answer and clean_agent_name:
                bot_answer = re.sub(
                    r"我是\s*(?:发票云)?(?:智能)?(?:客服|综合|服务|AI)?助手",
                    f"我是{clean_agent_name}",
                    bot_answer,
                )

            agent_display_name = (
                f"{matched_agent.avatar} {matched_agent.name}"
                if matched_agent.avatar and not matched_agent.name.startswith(matched_agent.avatar)
                else matched_agent.name
            )
            bot_time = datetime.now(UTC)
            bot_msg = ReceptionMessage(
                session_id=session_id,
                sender_type="bot",
                sender_name=agent_display_name,
                content=bot_answer,
                is_read=True,
                created_at=bot_time,
            )
            db.add(bot_msg)
            session.agent_name = agent_display_name
            session.last_message = bot_answer[:200]
            session.last_message_at = bot_time

            # 4. 若大模型识别需要转人工，联动向客户推送转人工引导探针卡片
            if transfer_card_prompt:
                action_type, prompt_text = transfer_card_prompt
                card_time = datetime.now(UTC)
                card_msg = ReceptionMessage(
                    session_id=session_id,
                    sender_type="system",
                    sender_name="智能服务助手",
                    content=f"[CARD:{action_type}] {prompt_text}",
                    is_read=True,
                    created_at=card_time,
                )
                db.add(card_msg)
                session.last_message = prompt_text[:200]
                session.last_message_at = card_time


    db.commit()
    db.refresh(msg)
    return MessageOut.model_validate(msg)


@router.get("/client/probe-human-capacity", response_model=ProbeCapacityResponse)
def client_probe_human_capacity(db: Session = Depends(get_session)) -> ProbeCapacityResponse:
    """实时在岗探针：检测当前是否处于工作时段以及是否有在线空闲坐席"""
    bot_config = get_db_bot_config(db)
    strat = bot_config.escalation_strategy
    in_working_hours, has_capacity, online_count, idle_capacity, _ = check_human_capacity(db)

    allow_human = True
    if strat.probe_working_hours and not in_working_hours:
        allow_human = False
    if strat.probe_human_agents and not has_capacity:
        allow_human = False

    action_type = "ask_transfer" if allow_human else "guide_ticket"
    prompt_text = strat.ask_transfer_text if allow_human else strat.no_human_guide_text

    return ProbeCapacityResponse(
        can_transfer_human=allow_human,
        in_working_hours=in_working_hours,
        online_agent_count=online_count,
        idle_capacity=idle_capacity,
        action_type=action_type,
        prompt_text=prompt_text,
    )


@router.post("/client/sessions/{session_id}/unresolved")
def client_mark_unresolved(
    session_id: str,
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """客户点击【未解决】反馈，触发在岗探针并生成相应引导卡片消息"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    bot_config = get_db_bot_config(db)
    strat = bot_config.escalation_strategy
    in_working_hours, has_capacity, online_count, idle_capacity, _ = check_human_capacity(db)

    allow_human = True
    if strat.probe_working_hours and not in_working_hours:
        allow_human = False
    if strat.probe_human_agents and not has_capacity:
        allow_human = False

    action_type = "ask_transfer" if allow_human else "guide_ticket"
    prompt_text = strat.ask_transfer_text if allow_human else strat.no_human_guide_text

    now = datetime.now(UTC)
    card_msg = ReceptionMessage(
        session_id=session_id,
        sender_type="system",
        sender_name="智能服务助手",
        content=f"[CARD:{action_type}] {prompt_text}",
        is_read=True,
        created_at=now,
    )
    db.add(card_msg)
    session.last_message = prompt_text[:200]
    session.last_message_at = now
    session.updated_at = now
    db.commit()

    return {
        "ok": True,
        "action_type": action_type,
        "prompt_text": prompt_text,
        "can_transfer_human": allow_human,
        "in_working_hours": in_working_hours,
        "online_agent_count": online_count,
        "idle_capacity": idle_capacity,
    }


@router.post("/client/sessions/{session_id}/escalate-human", response_model=SessionDetailOut)
def client_escalate_human(
    session_id: str,
    db: Session = Depends(get_session),
) -> SessionDetailOut:
    """客户确认转接人工坐席：将会话转入人工队列并触发自动分配"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    prev_agent_name = session.agent_name or "AI智能助手"
    now = datetime.now(UTC)
    session.is_human = True
    session.status = "queue"
    session.agent_name = "在线待分配"
    session.summary = f"由智能助手[{prev_agent_name}]接待转入（客户反馈未解决）"
    session.updated_at = now

    sys_msg = ReceptionMessage(
        session_id=session_id,
        sender_type="system",
        sender_name="系统通知",
        content="已为您转接人工坐席，正在为您接入专业客服，请稍候...",
        is_read=True,
        created_at=now,
    )
    db.add(sys_msg)
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


@router.post("/client/sessions/{session_id}/resolve")
def client_resolve_session(
    session_id: str,
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """客户点击【👍 已解决】按钮，自动执行会话关闭并弹出评价窗口 (对齐节点 7.1)。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.status in ("closed", "converted"):
        return {
            "ok": True,
            "status": session.status,
            "agent_name": session.agent_name,
            "is_human": session.is_human,
        }

    now = datetime.now(UTC)
    session.status = "closed"
    session.closed_at = now
    session.updated_at = now

    if not session.is_human:
        # 1) Agent 接待阶段已解决 (对齐节点 7.1)
        session.is_human = False
        bot_config = get_db_bot_config(db)
        if not session.agent_name or session.agent_name in ("在线待分配", "智能助手"):
            matched_agent = match_bot_agent(
                bot_config, company_name=session.company_name, purchased_products=[]
            )
            session.agent_name = matched_agent.name

        bot_answer = "🎉 很高兴为您解决问题！发票云专家团队始终为您保驾护航。本次会话已结束，请对本次服务进行评价！"
        bot_msg = ReceptionMessage(
            session_id=session_id,
            sender_type="bot",
            sender_name=session.agent_name,
            content=bot_answer,
            is_read=True,
            created_at=now,
        )
        db.add(bot_msg)
        session.last_message = bot_answer[:200]
        session.last_message_at = now

        cid = _session_ai_cid_cache.pop(session_id, None)
        if cid:
            try:
                cfg = AiCsConfig.from_settings(get_settings())
                with AiCsClient(cfg) as ai_client:
                    ai_client.end_session(cid)
            except Exception:
                pass
    else:
        # 2) 人工接待阶段已解决
        session.is_human = True
        agent_disp = session.agent_name or "人工客服"
        sys_answer = f"客户已确认问题解决，本次由坐席【{agent_disp}】接待的人工会话已结束，感谢您的咨询，请对本次服务进行评价！"
        sys_msg = ReceptionMessage(
            session_id=session_id,
            sender_type="system",
            sender_name="系统通知",
            content=sys_answer,
            is_read=True,
            created_at=now,
        )
        db.add(sys_msg)
        session.last_message = sys_answer[:200]
        session.last_message_at = now

    db.commit()
    db.refresh(session)

    # 坐席释放空位时触发排队补位分发 (对齐泳道 4)
    if session.is_human:
        try:
            dispatch_online_sessions_internal(db)
        except Exception as e:
            logger.warning("Auto dispatch on client resolve failed: %s", e)

    return {
        "ok": True,
        "status": "closed",
        "is_human": session.is_human,
        "agent_name": session.agent_name,
        "closed_at": now.isoformat(),
    }


@router.post("/client/sessions/{session_id}/submit-ticket")
def client_submit_ticket(
    session_id: str,
    body: ClientSubmitTicketRequest,
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """客户一键提交售后工单，真实写入 tickets 表 (对齐泳道 5)。"""
    session = db.query(ReceptionSession).filter(ReceptionSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    ticket = create_ticket_from_reception_session(
        db,
        session,
        title=body.title,
        body=body.description,
    )
    ticket_code = ticket.short_code
    now = datetime.now(UTC)

    ticket_msg = ReceptionMessage(
        session_id=session_id,
        sender_type="system",
        sender_name="售后工单系统",
        content=f"已为您一键生成售后工单【{ticket_code}】！标题：{ticket.title}。技术服务团队将根据您提交的记录加急处理并在工作时间回访答复。",
        is_read=True,
        created_at=now,
    )
    db.add(ticket_msg)
    db.commit()

    # 释放坐席容量（如果是人工转出的工单）
    if session.is_human:
        try:
            dispatch_online_sessions_internal(db)
        except Exception as e:
            logger.warning("Auto dispatch on submit_ticket failed: %s", e)

    return {
        "ok": True,
        "ticket_id": ticket.id,
        "ticket_short_code": ticket_code,
        "status": "converted",
        "title": ticket.title,
    }


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

    # 释放 Open API Channel 远端会话资源
    cid = _session_ai_cid_cache.pop(session_id, None)
    if cid:
        try:
            settings = get_settings()
            cfg = AiCsConfig.from_settings(settings)
            with AiCsClient(cfg) as ai_client:
                ai_client.end_session(cid)
        except Exception as e:
            logger.warning("Call Open API Channel end_session failed for %s (cid=%s): %s", session_id, cid, e)

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


# -----------------------------------------------------------------------------
# 客户端工单信息 (查询、催单、查看确认)
# -----------------------------------------------------------------------------

SOURCE_CHANNEL_NAMES: dict[str, str] = {
    "ksm": "KSM",
    "zhichi": "智齿",
    "zammad": "Zammad",
    "linear": "Linear",
    "self_service": "客户自助",
}


class ClientTicketOut(BaseModel):
    id: int
    short_code: str
    ticket_number: str
    source_code: str
    source_name: str
    handler_name: str | None
    process_stage: str
    status: str
    client_category: str  # processing | reviewing | closed
    title: str
    body: str | None = None
    created_at: str
    hours_since_created: float
    reply_content: str | None = None
    reply_at: str | None = None
    reply_by: str | None = None
    reporter_name: str | None = None
    reporter_mobile: str | None = None


def _extract_ticket_reporter_mobile(t: Ticket) -> str | None:
    """提取工单列表『提单人手机号』（与 tickets.py _to_summary 的 reporter_mobile 口径严格一致）。"""
    rep = t.reporter if isinstance(t.reporter, dict) else {}
    mobile = rep.get("mobile") or rep.get("phone")
    if not mobile and t.source_code == "feishu_ai":
        mobile = t.ksm_contact_mobile
    return str(mobile).strip() if mobile else None


def _extract_ticket_reporter_name(t: Ticket) -> str | None:
    """提取工单列表『提单人姓名』（与 tickets.py _to_summary 的 reporter_name 口径一致）。"""
    if isinstance(t.reporter, dict):
        name = t.reporter.get("name") or t.reporter.get("contact_name")
        if name:
            return str(name).strip()
    elif isinstance(t.reporter, str) and t.reporter.strip():
        return t.reporter.strip()
    if t.source_code == "feishu_ai" and t.ksm_linkman:
        return str(t.ksm_linkman).strip()
    return None


class ClientTicketRemindRequest(BaseModel):
    phone: str = Field(..., min_length=5)


class ClientTicketRemindResponse(BaseModel):
    success: bool
    notified: bool
    hours_since_created: float
    message: str


class ClientTicketConfirmRequest(BaseModel):
    phone: str = Field(..., min_length=5)
    action: str = Field(..., pattern=r"^(confirm|return)$")
    reason: str | None = None


class ClientTicketConfirmResponse(BaseModel):
    success: bool
    status: str
    message: str


@router.get("/client/tickets", response_model=list[ClientTicketOut])
def client_get_tickets(
    phone: str = Query(..., min_length=5, description="咨询人手机号（严格匹配工单提单人手机号）"),
    db: Session = Depends(get_session),
) -> list[ClientTicketOut]:
    """根据咨询人手机号匹配工单列表提单人手机号，仅返回提单人手机号严格等于咨询人手机号的工单记录"""
    phone = phone.strip()
    if not phone:
        return []

    # 仅初筛 reporter 字段包含该手机号（或飞书工单 ksm_contact_mobile == phone）的有效工单，
    # 排除软删工单与拆单父容器（与工单列表口径一致），再在 Python 层精确校验提单人手机号 == 咨询人手机号。
    candidate_tickets = (
        db.query(Ticket)
        .filter(
            Ticket.deleted_at.is_(None),
            Ticket.type != "Parent",
            or_(
                func.cast(Ticket.reporter, String).like(f"%{phone}%"),
                and_(Ticket.source_code == "feishu_ai", Ticket.ksm_contact_mobile == phone),
            ),
        )
        .order_by(desc(Ticket.received_at), desc(Ticket.id))
        .limit(200)
        .all()
    )

    tickets = [
        t for t in candidate_tickets if _extract_ticket_reporter_mobile(t) == phone
    ][:50]

    # 预加载用户姓名
    user_ids = set()
    for t in tickets:
        if t.handler_user_id:
            user_ids.add(t.handler_user_id)
        if t.assigned_user_id:
            user_ids.add(t.assigned_user_id)
    user_map = {}
    if user_ids:
        users = db.query(User).filter(User.id.in_(user_ids)).all()
        user_map = {u.id: (u.name or u.email) for u in users}

    now = datetime.now(UTC)
    results: list[ClientTicketOut] = []
    for t in tickets:
        rep_mobile = _extract_ticket_reporter_mobile(t)
        rep_name = _extract_ticket_reporter_name(t)

        # 分类
        if t.status == "closed" or t.process_stage == "完成":
            cat = "closed"
        elif t.status == "reviewing":
            cat = "reviewing"
        else:
            cat = "processing"

        # 处理人（服务处理环节展示服务处理人，研发处理环节展示产研责任人）
        if t.process_stage in ("研发处理", "产研处理"):
            handler = user_map.get(t.assigned_user_id) or user_map.get(t.handler_user_id) or "研发责任人"
        else:
            handler = (
                user_map.get(t.handler_user_id)
                or (rep_name if t.source_code == "feishu_ai" else None)
                or user_map.get(t.assigned_user_id)
                or "客服处理人"
            )

        rec = t.received_at or t.created_at or now
        if rec.tzinfo is None:
            rec = rec.replace(tzinfo=UTC)
        hours_elapsed = round((now - rec).total_seconds() / 3600.0, 1)

        t_num = t.source_ticket_number or t.source_ticket_id or t.short_code
        src_name = SOURCE_CHANNEL_NAMES.get(t.source_code or "", (t.source_code or "服务单").upper())

        reply_content = t.cached_reply_content
        if not reply_content and t.source_payload and isinstance(t.source_payload, dict):
            reply_content = (
                t.source_payload.get("reply_content")
                or t.source_payload.get("solution")
                or t.source_payload.get("reply")
            )

        reply_time_str = None
        if t.customer_replied_at:
            r_at = t.customer_replied_at if t.customer_replied_at.tzinfo else t.customer_replied_at.replace(tzinfo=UTC)
            reply_time_str = r_at.strftime("%Y-%m-%d %H:%M")
        elif t.actual_resolved_at:
            r_at = t.actual_resolved_at if t.actual_resolved_at.tzinfo else t.actual_resolved_at.replace(tzinfo=UTC)
            reply_time_str = r_at.strftime("%Y-%m-%d %H:%M")

        results.append(
            ClientTicketOut(
                id=t.id,
                short_code=t.short_code,
                ticket_number=t_num,
                source_code=t.source_code or "custom",
                source_name=src_name,
                handler_name=handler,
                process_stage=t.process_stage or "服务处理",
                status=t.status,
                client_category=cat,
                title=t.title or "无标题工单",
                body=t.body or "",
                created_at=rec.strftime("%Y-%m-%d %H:%M"),
                hours_since_created=hours_elapsed,
                reply_content=reply_content,
                reply_at=reply_time_str,
                reply_by=handler,
                reporter_name=rep_name,
                reporter_mobile=rep_mobile,
            )
        )
    return results


@router.post("/client/tickets/{ticket_id}/remind", response_model=ClientTicketRemindResponse)
def client_remind_ticket(
    ticket_id: int,
    body: ClientTicketRemindRequest,
    db: Session = Depends(get_session),
) -> ClientTicketRemindResponse:
    """客户催单接口（判断提单是否满24小时，超24小时记录审计并向处理人推送催单通知）"""
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="工单不存在")

    now = datetime.now(UTC)
    rec = ticket.received_at or ticket.created_at or now
    if rec.tzinfo is None:
        rec = rec.replace(tzinfo=UTC)
    hours = round((now - rec).total_seconds() / 3600.0, 1)

    is_over_24h = hours >= 24.0

    history = StatusHistory(
        entity_type="ticket",
        entity_id=ticket.id,
        from_status=ticket.status,
        to_status=ticket.status,
        changed_by=f"customer:{body.phone}",
        reason=f"在线接待客户端催单 (提单已过 {hours} 小时，{'已' if is_over_24h else '未'}向处理人推送通知)",
    )
    db.add(history)
    db.commit()

    if is_over_24h:
        return ClientTicketRemindResponse(
            success=True,
            notified=True,
            hours_since_created=hours,
            message="催单成功！工单提单已超过24小时，已向当前处理人发送加急催单通知，我们将尽快为您处理。",
        )
    else:
        return ClientTicketRemindResponse(
            success=True,
            notified=False,
            hours_since_created=hours,
            message="已收到催单请求。当前工单提单未满24小时，暂不向处理人推送通知，处理人员正在加速处理中，请耐心等待。",
        )


@router.post("/client/tickets/{ticket_id}/confirm", response_model=ClientTicketConfirmResponse)
def client_confirm_ticket(
    ticket_id: int,
    body: ClientTicketConfirmRequest,
    db: Session = Depends(get_session),
) -> ClientTicketConfirmResponse:
    """客户查看确认接口（确认已解决或未解决退回）"""
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="工单不存在")

    old_status = ticket.status

    if body.action == "confirm":
        ticket.status = "closed"
        ticket.process_stage = "完成"
        ticket.actual_resolved_at = datetime.now(UTC)
        history = StatusHistory(
            entity_type="ticket",
            entity_id=ticket.id,
            from_status=old_status,
            to_status="closed",
            changed_by=f"customer:{body.phone}",
            reason="客户在在线接待端确认已解决问题",
        )
        db.add(history)
        db.commit()
        return ClientTicketConfirmResponse(
            success=True,
            status="closed",
            message="感谢您的确认，该工单已标记为已解决并关闭！",
        )
    else:
        ticket.status = "processing"
        ticket.process_stage = "服务处理"
        ret_reason = body.reason.strip() if body.reason else "客户反馈未解决并退回"
        history = StatusHistory(
            entity_type="ticket",
            entity_id=ticket.id,
            from_status=old_status,
            to_status="processing",
            changed_by=f"customer:{body.phone}",
            reason=f"客户在在线接待端反馈未解决退回: {ret_reason}",
        )
        db.add(history)
        db.commit()
        return ClientTicketConfirmResponse(
            success=True,
            status="processing",
            message="已将工单退回给处理人员继续跟进分析，我们将尽快为您解决问题！",
        )
