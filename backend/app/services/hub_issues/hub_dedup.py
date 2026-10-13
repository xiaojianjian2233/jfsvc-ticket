"""hub 级严格语义去重。

新接入的非拆单工单在毕业时查找同产品线、同类型的历史 Hub。只有文字完全一致，
或者向量相似度与 LLM 置信度都达到严格门槛时才共享原 Hub；不再生成第二个
持久 Hub。适用于全部 Hub 类型，研发类也可在尚未推 Linear 时被新工单命中。

降级（embedding/LLM 失败）一律返回 None=不去重，宁可多建一个 issue 也不漏推。
向量存 hub_issues.embedding（JSON），Python 余弦（同 ADR-0015）。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.llm_router import LLMMessage, LLMRouter, LLMRouterError
from app.core.llm_router.embeddings import EmbeddingClient, EmbeddingError, cosine_similarity
from app.core.logging import get_logger
from app.models import HubIssue
from app.services.hub_issues.duplicate_attach import candidate_is_eligible
from app.services.skills.prompt_store import load_prompt

logger = get_logger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parent.parent.parent.parent / "prompts"


def _hub_text(hub: HubIssue) -> str:
    return f"{hub.title or ''}\n{(hub.canonical_body or '')[:1500]}".strip()


def _normalized_hub_text(hub: HubIssue) -> str:
    return re.sub(r"\s+", "", _hub_text(hub)).casefold()


@dataclass(slots=True, frozen=True)
class DedupMatch:
    hub_id: int
    similarity: float
    exact_text: bool


def ensure_hub_embedding(
    db: Session, hub: HubIssue, *, client: EmbeddingClient | None = None
) -> list[float] | None:
    """给 hub 算并存 embedding（已有则直接返回）。失败返回 None。"""
    if hub.embedding:
        return hub.embedding
    try:
        client = client or EmbeddingClient.from_settings()
        vec = client.embed([_hub_text(hub)]).vectors[0]
    except (EmbeddingError, ValueError) as e:
        logger.warning("hub_embed_failed", hub_issue_id=hub.id, error=str(e))
        return None
    hub.embedding = vec
    db.flush()
    return vec


def _candidate_query(hub: HubIssue):  # type: ignore[no-untyped-def]
    """候选只限同产品线、同类型的真实 Hub。"""
    return select(HubIssue).where(
        HubIssue.id != hub.id,
        HubIssue.deleted_at.is_(None),
        HubIssue.product_line_code == hub.product_line_code,
        HubIssue.type == hub.type,  # 不跨类型合并
    )


def find_duplicate_hub(
    db: Session,
    hub: HubIssue,
    *,
    embedding_client: EmbeddingClient | None = None,
    router: LLMRouter | None = None,
) -> int | None:
    """返回与 hub 重复的已有 hub_id，否则 None。永不抛（降级 None）。"""
    match = find_duplicate_match(db, hub, embedding_client=embedding_client, router=router)
    return match.hub_id if match is not None else None


def find_duplicate_match(
    db: Session,
    hub: HubIssue,
    *,
    embedding_client: EmbeddingClient | None = None,
    router: LLMRouter | None = None,
) -> DedupMatch | None:
    """Strict duplicate match with lifecycle eligibility and evidence."""
    settings = get_settings()
    rows = [
        row
        for row in db.execute(_candidate_query(hub)).scalars().all()
        if candidate_is_eligible(db, row)
    ]

    # 字面完全一致不依赖向量服务；即使 embedding/LLM 故障，也能做确定性关联。
    current_text = _normalized_hub_text(hub)
    exact = sorted(
        (row for row in rows if _normalized_hub_text(row) == current_text),
        key=lambda row: row.id,
    )
    if exact:
        row = exact[0]
        logger.info(
            "hub_dedup_exact_hit",
            hub_issue_id=hub.id,
            dup_hub_id=row.id,
            similarity=1.0,
        )
        return DedupMatch(hub_id=row.id, similarity=1.0, exact_text=True)

    vec = ensure_hub_embedding(db, hub, client=embedding_client)
    if vec is None:
        return None
    rows = [row for row in rows if row.embedding]
    scored = sorted(
        ((cosine_similarity(vec, r.embedding or []), r) for r in rows),
        key=lambda t: t[0],
        reverse=True,
    )
    strict_threshold = max(settings.hub_dedup_threshold, settings.hub_dedup_strict_threshold)
    top = [(s, r) for s, r in scored if s >= strict_threshold][: settings.hub_dedup_top_k]
    if not top:
        return None

    cand_list = [
        {
            "hub_id": r.id,
            "title": r.title,
            "problem_summary": (r.canonical_body or "")[:300],
            "similarity": round(s, 3),
        }
        for s, r in top
    ]
    try:
        prompt = load_prompt("hub_dedup") + (
            "\n\n当前执行严格匹配：适用于 Operation、Bug_fix、Demand 和 "
            "Internal_task 全部类型；只有完全是同一个问题才允许 is_dup=true，"
            f"且 confidence 必须不低于 {settings.hub_dedup_strict_confidence:.2f}。"
        )
        router = router or LLMRouter.from_settings()
        resp = router.complete(
            [
                LLMMessage(role="system", content=prompt),
                LLMMessage(
                    role="user",
                    content=(
                        f"当前 hub：title={hub.title!r} body={(hub.canonical_body or '')[:800]!r}\n"
                        f"候选：{json.dumps(cand_list, ensure_ascii=False)}"
                    ),
                ),
                LLMMessage(role="user", content="只输出 JSON。"),
            ],
            agent="hub_dedup",
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        parsed = _parse(
            resp.content,
            {r.id for _, r in top},
            min_confidence=settings.hub_dedup_strict_confidence,
        )
    except (LLMRouterError, _HubDedupError) as e:
        logger.warning("hub_dedup_llm_failed", hub_issue_id=hub.id, error=str(e))
        return None

    if parsed.get("is_dup") and parsed.get("dup_hub_id"):
        dup_id = int(parsed["dup_hub_id"])
        logger.info("hub_dedup_hit", hub_issue_id=hub.id, dup_hub_id=dup_id)
        score = next(score for score, row in top if row.id == dup_id)
        return DedupMatch(hub_id=dup_id, similarity=score, exact_text=False)
    return None


class _HubDedupError(Exception):
    pass


def _parse(content: str, candidate_ids: set[int], *, min_confidence: float = 0.0) -> dict[str, Any]:
    try:
        data = json.loads(content.strip())
    except json.JSONDecodeError as e:
        raise _HubDedupError(f"non-JSON: {content[:120]!r}") from e
    if not isinstance(data, dict):
        raise _HubDedupError("not an object")
    if data.get("is_dup"):
        dup = data.get("dup_hub_id")
        if not isinstance(dup, int) or dup not in candidate_ids:
            raise _HubDedupError(f"dup_hub_id {dup!r} not in candidates")
        confidence = data.get("confidence")
        if not isinstance(confidence, int | float) or float(confidence) < min_confidence:
            data["is_dup"] = False
            data["dup_hub_id"] = None
    return data
