"""module_resolve — 产品模块归类链（决定生效 product_line_code + module）。

保证生效值必落在现有 active 目录内，绝不自建。来源系统产品/模块只留档，
不参与生效值判定：
  ① AI（module_classify）置信度够 → 用 AI 的 (产品线, 模块)
  ② AI 不确定或不可用 → 兜底「其他非发票云问题」(PROLINE6067)

覆盖 ticket.product_line_code/module 为规范值；源系统原值存 source_payload
["_original_catalog"] 留档；AI 原始判定写 predicted_* + 审计。不 commit（调用方管）。
永不抛（降级到兜底）。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.logging import get_logger
from app.models import AgentDecision, Module, Ticket
from app.services.agents.module_classify import classify_module

logger = get_logger(__name__)

_SKILL_NAME = "module_classify"


@dataclass(slots=True, frozen=True)
class ModuleResolveResult:
    product_line_code: str
    module: str
    source: str  # 'ai' | 'fallback'


def _active_module_exists(db: Session, plc: str, module: str) -> bool:
    row = db.execute(
        select(Module.id).where(
            Module.product_line_code == plc,
            Module.name == module,
            Module.is_active.is_(True),
        )
    ).first()
    return row is not None


def resolve_module(
    db: Session, ticket: Ticket, *, settings: Settings | None = None
) -> ModuleResolveResult:
    """归类链主入口。覆盖 ticket 生效值 + 写 predicted_*/留档/审计。不 commit。"""
    settings = settings or get_settings()

    orig_plc = ticket.product_line_code
    orig_module = ticket.module

    # ---- ① AI 判定。明确不传来源产品线暗示，避免上游分类影响系统分析。----
    ai_plc: str | None = None
    ai_module: str | None = None
    ai_conf = 0.0
    if settings.module_classify_enabled:
        ai = classify_module(db, title=ticket.title, body=ticket.body, line_hint=None)
        if ai is not None:
            ai_plc, ai_module, ai_conf = ai.product_line_code, ai.module, ai.confidence
            ticket.predicted_product_line_code = ai_plc
            ticket.predicted_module = ai_module
            ticket.predicted_module_confidence = Decimal(f"{ai_conf:.2f}")
            ticket.module_classified_at = datetime.now(UTC)
            db.add(
                AgentDecision(
                    decision_type="classify_module",
                    subject_type="ticket",
                    subject_id=ticket.id,
                    proposal={
                        "predicted_product_line_code": ai_plc,
                        "predicted_module": ai_module,
                        "confidence": ai_conf,
                        "reason": ai.reason,
                        "model": ai.model,
                        "cost_usd": ai.cost_usd,
                        "skill": _SKILL_NAME,
                    },
                )
            )

    result: ModuleResolveResult | None = None

    # ---- ① AI 够置信 + 结果在 active 目录内 → 用之 ----
    if (
        ai_conf >= settings.module_classify_confidence
        and ai_plc
        and ai_module
        and _active_module_exists(db, ai_plc, ai_module)
    ):
        result = ModuleResolveResult(ai_plc, ai_module, "ai")

    # ---- ② 统一系统兜底；不使用来源系统产品/模块做精确或相似匹配。----
    if result is None:
        result = ModuleResolveResult(
            settings.module_fallback_product_line_code,
            settings.module_fallback_module,
            "fallback",
        )

    # 源系统原值留档（仅首次，不覆盖已有留档）
    payload = dict(ticket.source_payload or {})
    if "_original_catalog" not in payload:
        payload["_original_catalog"] = {"product_line_code": orig_plc, "module": orig_module}
        ticket.source_payload = payload

    # 覆盖生效值为规范值
    ticket.product_line_code = result.product_line_code
    ticket.module = result.module
    ticket.module_classified_at = datetime.now(UTC)

    logger.info(
        "module_resolved",
        ticket_id=ticket.id,
        source=result.source,
        product_line_code=result.product_line_code,
        module=result.module,
        orig_plc=orig_plc,
        orig_module=orig_module,
        ai_conf=ai_conf,
    )
    return result
