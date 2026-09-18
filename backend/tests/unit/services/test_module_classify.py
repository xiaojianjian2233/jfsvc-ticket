"""module_classify + module_resolve 测试。

module_classify：两步（产品线→模块）候选校验、越界拒绝、低置信。
module_resolve：只采信 AI 结果；来源分类不参与判定，失败统一兜底 PROLINE6067。
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy.orm import Session

from app.core.llm_router import LLMResponse
from app.core.llm_router.providers import LLMProvider
from app.core.llm_router.router import LLMRouter
from app.models import Module, ProductLine, Ticket
from app.services.agents import module_classify as mc
from app.services.agents.module_classify import classify_module
from app.services.agents.module_resolve import resolve_module


class _SeqProvider(LLMProvider):
    """按调用次序返回预置 content（module_classify 两步各一次）。"""

    name = "fake"

    def __init__(self, contents: list[str]) -> None:
        self._contents = list(contents)

    def complete(self, messages, **kw):  # type: ignore[no-untyped-def]
        c = self._contents.pop(0) if self._contents else "{}"
        return LLMResponse(content=c, provider="fake", model="fake")


def _router(contents: list[str]) -> LLMRouter:
    return LLMRouter([_SeqProvider(contents)])


def _j(choice: str, conf: float) -> str:
    return json.dumps({"choice": choice, "confidence": conf, "reason": "r"})


@pytest.fixture
def catalog(db_session: Session) -> Session:
    db_session.add(ProductLine(code="PL_A", name="产品线A", is_active=True))
    db_session.add(ProductLine(code="PL_B", name="产品线B", is_active=True))
    db_session.add(ProductLine(code="PROLINE6067", name="其他非发票云问题", is_active=True))
    db_session.add(Module(product_line_code="PL_A", name="开票模块", is_active=True))
    db_session.add(Module(product_line_code="PL_A", name="收票模块", is_active=True))
    db_session.add(Module(product_line_code="PROLINE6067", name="其他非发票云问题", is_active=True))
    db_session.commit()
    return db_session


def _ticket(db: Session, **ov) -> Ticket:  # type: ignore[no-untyped-def]
    base = {
        "short_code": "TKT-MC-1",
        "source_code": "ksm",
        "source_ticket_id": "b1",
        "type": "Raw",
        "status": "received",
        "title": "开票失败",
        "body": "点开票报错",
    }
    base.update(ov)
    t = Ticket(**base)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


# ---- module_classify ---------------------------------------------------------


def test_classify_two_step_success(catalog: Session, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(mc, "_load_prompt", lambda: "提示词")
    router = _router([_j("PL_A", 0.9), _j("开票模块", 0.85)])
    res = classify_module(catalog, title="开票失败", body="报错", router=router)
    assert res is not None
    assert res.product_line_code == "PL_A"
    assert res.module == "开票模块"
    assert res.confidence == 0.85  # 取两步较低


def test_classify_rejects_out_of_candidate_line(catalog: Session, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """产品线选了候选外的 code → 校验失败 → None。"""
    monkeypatch.setattr(mc, "_load_prompt", lambda: "提示词")
    router = _router([_j("NOT_EXIST", 0.9)])
    res = classify_module(catalog, title="x", body="y", router=router)
    assert res is None


def test_classify_rejects_out_of_candidate_module(catalog: Session, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(mc, "_load_prompt", lambda: "提示词")
    router = _router([_j("PL_A", 0.9), _j("不存在的模块", 0.9)])
    res = classify_module(catalog, title="x", body="y", router=router)
    assert res is None


def test_classify_no_active_lines(db_session: Session, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(mc, "_load_prompt", lambda: "提示词")
    res = classify_module(db_session, title="x", body="y", router=_router([]))
    assert res is None


# ---- module_resolve 四级回退 -------------------------------------------------


def test_resolve_ai_hit(catalog: Session, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("MODULE_CLASSIFY_ENABLED", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(mc, "_load_prompt", lambda: "提示词")
    monkeypatch.setattr(
        "app.services.agents.module_resolve.classify_module",
        lambda db, **kw: mc.ModuleClassifyResult("PL_A", "开票模块", 0.9, "r", 0.0, "m"),
    )
    t = _ticket(catalog, product_line_code=None, module=None)
    res = resolve_module(catalog, t)
    assert res.source == "ai"
    assert t.product_line_code == "PL_A" and t.module == "开票模块"
    # commit 覆盖真实入库路径：classify_module 审计行须过 ck_agent_decisions_type 约束
    # （否则 CheckViolation 回滚，归类值也存不进——曾漏改约束致 SIT 归类全失败）。
    catalog.commit()
    from app.models import AgentDecision

    row = (
        catalog.query(AgentDecision)
        .filter_by(decision_type="classify_module", subject_id=t.id)
        .one()
    )
    assert row.proposal["predicted_module"] == "开票模块"
    get_settings.cache_clear()


def test_resolve_low_confidence_ignores_source_and_falls_back(
    catalog: Session, monkeypatch
) -> None:  # type: ignore[no-untyped-def]
    """AI 低置信时不采信来源原值，统一进入系统兜底。"""
    monkeypatch.setenv("MODULE_CLASSIFY_ENABLED", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(
        "app.services.agents.module_resolve.classify_module",
        lambda db, **kw: mc.ModuleClassifyResult("PL_A", "开票模块", 0.3, "r", 0.0, "m"),
    )
    t = _ticket(catalog, product_line_code="PL_A", module="收票模块")
    res = resolve_module(catalog, t)
    assert res.source == "fallback"
    assert t.product_line_code == "PROLINE6067" and t.module == "其他非发票云问题"
    get_settings.cache_clear()


def test_resolve_does_not_use_source_similarity(catalog: Session, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """AI 不可用时不按来源模块做相似匹配。"""
    monkeypatch.setenv("MODULE_CLASSIFY_ENABLED", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(
        "app.services.agents.module_resolve.classify_module",
        lambda db, **kw: None,  # AI 直接降级
    )
    t = _ticket(catalog, product_line_code="旧码", module="开票")
    res = resolve_module(catalog, t)
    assert res.source == "fallback"
    assert t.module == "其他非发票云问题"
    get_settings.cache_clear()


def test_resolve_fallback(catalog: Session, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """全落空 → 兜底 PROLINE6067 / 其他非发票云问题。"""
    monkeypatch.setenv("MODULE_CLASSIFY_ENABLED", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(
        "app.services.agents.module_resolve.classify_module",
        lambda db, **kw: None,
    )
    t = _ticket(catalog, product_line_code="旧码", module="完全无关的东西xyz")
    res = resolve_module(catalog, t)
    assert res.source == "fallback"
    assert t.product_line_code == "PROLINE6067"
    assert t.module == "其他非发票云问题"
    get_settings.cache_clear()


def test_resolve_disabled_noop(catalog: Session) -> None:
    """开关关 → AI 不跑且不采信来源分类，使用系统兜底。"""
    t = _ticket(catalog, product_line_code="PL_A", module="开票模块")
    res = resolve_module(catalog, t)
    assert res.source == "fallback"
    assert t.product_line_code == "PROLINE6067"
    assert t.module == "其他非发票云问题"


def test_resolve_original_catalog_kept(catalog: Session, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """源系统原值留档到 source_payload._original_catalog。"""
    monkeypatch.setenv("MODULE_CLASSIFY_ENABLED", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr("app.services.agents.module_resolve.classify_module", lambda db, **kw: None)
    t = _ticket(catalog, product_line_code="旧码", module="旧模块xyz")
    resolve_module(catalog, t)
    assert (t.source_payload or {})["_original_catalog"] == {
        "product_line_code": "旧码",
        "module": "旧模块xyz",
    }
    get_settings.cache_clear()


# ---- 来源分类隔离 -----------------------------------------------------------


def test_resolve_zhichi_source_does_not_become_line_hint(catalog: Session, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """智齿来源模块即使像产品线名，也不作为 AI 产品线暗示。"""
    monkeypatch.setenv("MODULE_CLASSIFY_ENABLED", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    captured = {}

    def _fake(db, *, title=None, body=None, line_hint=None, router=None):  # type: ignore[no-untyped-def]
        captured["line_hint"] = line_hint
        return mc.ModuleClassifyResult("PL_A", "开票模块", 0.9, "r", 0.0, "m")

    monkeypatch.setattr("app.services.agents.module_resolve.classify_module", _fake)
    # 智齿工单：module 填的是产品线名
    t = _ticket(catalog, product_line_code=None, module="产品线A")
    res = resolve_module(catalog, t)
    assert captured["line_hint"] is None
    assert res.source == "ai"
    assert res.product_line_code == "PL_A" and res.module == "开票模块"
    get_settings.cache_clear()


def test_resolve_source_module_does_not_reverse_lookup_line(catalog: Session, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """来源模块即使精确命中目录，也不反推产品线。"""
    monkeypatch.setenv("MODULE_CLASSIFY_ENABLED", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr("app.services.agents.module_resolve.classify_module", lambda db, **kw: None)
    t = _ticket(catalog, product_line_code=None, module="收票模块")
    res = resolve_module(catalog, t)
    assert res.source == "fallback"
    assert res.product_line_code == "PROLINE6067"
    assert res.module == "其他非发票云问题"
    get_settings.cache_clear()


def test_resolve_source_line_name_only_reaches_global_fallback(
    catalog: Session, monkeypatch
) -> None:  # type: ignore[no-untyped-def]
    """来源产品线名称不锁线；AI 不可用时仅使用全局系统兜底。"""
    monkeypatch.setenv("MODULE_CLASSIFY_ENABLED", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr("app.services.agents.module_resolve.classify_module", lambda db, **kw: None)
    # module=产品线名"其他非发票云问题" → line_hint=PROLINE6067；该线下模块="其他非发票云问题"
    t = _ticket(catalog, product_line_code=None, module="其他非发票云问题")
    res = resolve_module(catalog, t)
    assert res.product_line_code == "PROLINE6067"
    assert res.module == "其他非发票云问题"
