"""KSMClient — class-based migration of feishu-python/app/ksm_client.py.

Behavior parity:
  * Same endpoint paths under `/ierp/kapi/...`
  * Same payload field names
  * Same retry policy: a single force-refresh retry on 401 (KSM returns
    `errorCode=401, error_desc="未经授权..."` in the JSON body, not HTTP 401)
  * Same business-failure rule: raise on `status=false`
  * Token TTL fallback (30 min) when KSM omits expire_time

Differences vs feishu-python:
  * Class-based (no module globals)
  * `httpx.Client` instead of `requests` — drop-in API but with cleaner timeouts
  * Per-instance TokenCache (testable; multi-tenant ready)
  * Typed request DTOs from `.types`
  * Custom exceptions (KSMAuthError / KSMBusinessError) instead of bare ValueError
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

import httpx

from app.core.logging import get_logger

from .._token_cache import TokenCache
from .exceptions import KSMAuthError, KSMBusinessError, KSMContentSecurityError
from .types import (
    HandleOrderRequest,
    KSMConfig,
    LockOrderRequest,
    OrderDetail,
    ReturnOrderRequest,
    SplitOrderRequest,
    SupplyOrderRequest,
)

logger = get_logger(__name__)

_TOKEN_TTL_FALLBACK = 30 * 60  # KSM 偶发不返回 expire_time 时使用 30 分钟兜底
_RESPONSE_EXCERPT_LIMIT = 320
_TRACE_HEADER_NAMES = (
    "x-request-id",
    "x-trace-id",
    "trace-id",
    "x-correlation-id",
)
_SQL_OR_SCRIPT_PATTERNS = (
    re.compile(r"\bupdate\s+[\w.\"`]+\s+set\b", re.IGNORECASE),
    re.compile(r"\bselect\b[\s\S]{0,240}\bfrom\b", re.IGNORECASE),
    re.compile(r"\bdelete\s+from\b", re.IGNORECASE),
    re.compile(r"\binsert\s+into\b", re.IGNORECASE),
    re.compile(r"\b(?:drop|alter|truncate)\s+table\b", re.IGNORECASE),
    re.compile(r"(?:--|/\*)\s*(?:select|update|delete|insert|sql|清空|状态)", re.IGNORECASE),
    re.compile(r"<script\b|javascript:", re.IGNORECASE),
)
_SECURITY_RESPONSE_HINTS = (
    "sql injection",
    "waf",
    "web application firewall",
    "request blocked",
    "blocked by policy",
    "security policy",
    "非法请求",
    "安全策略",
    "攻击",
)


def _redact_response_text(value: str) -> str:
    """Keep a diagnostic excerpt without persisting tokens or common PII."""
    compact = " ".join(value.split())
    compact = re.sub(
        r"(?i)(access[_-]?token|app[_-]?token|authorization|cookie|secret|password)"
        r"([\s\"':=]+)([^\s,;\"']+)",
        r"\1\2<redacted>",
        compact,
    )
    compact = re.sub(r"(?i)bearer\s+[a-z0-9._~+/=-]+", "Bearer <redacted>", compact)
    compact = re.sub(
        r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
        "<redacted-email>",
        compact,
    )
    compact = re.sub(r"(?<!\d)1[3-9]\d{9}(?!\d)", "<redacted-mobile>", compact)
    return compact[:_RESPONSE_EXCERPT_LIMIT]


def _safe_response_summary(response: httpx.Response) -> dict[str, object]:
    summary: dict[str, object] = {"status": response.status_code}
    content_type = response.headers.get("content-type")
    if content_type:
        summary["content_type"] = content_type[:120]
    for header in _TRACE_HEADER_NAMES:
        value = response.headers.get(header)
        if value:
            summary["request_id"] = value[:160]
            break
    body_excerpt = _redact_response_text(response.text)
    if body_excerpt:
        summary["body_excerpt"] = body_excerpt
    return summary


def _has_sensitive_business_content(payload: dict[str, Any]) -> bool:
    content = str(payload.get("dealOpinion") or "")
    return any(pattern.search(content) for pattern in _SQL_OR_SCRIPT_PATTERNS)


def _looks_like_content_security_block(
    *,
    op_name: str,
    content_security_hint: bool,
    response_summary: dict[str, object],
) -> bool:
    if op_name != "handleKsmOrder":
        return False
    excerpt = str(response_summary.get("body_excerpt") or "").lower()
    return content_security_hint or any(hint in excerpt for hint in _SECURITY_RESPONSE_HINTS)


class KSMClient:
    def __init__(
        self,
        config: KSMConfig,
        *,
        http_client: httpx.Client | None = None,
        timeout_seconds: float = 60.0,
    ) -> None:
        self._cfg = config
        self._timeout = timeout_seconds
        self._owns_http = http_client is None
        self._http = http_client or httpx.Client(timeout=timeout_seconds)
        self._token_cache = TokenCache(name="ksm.access_token")

    # ---- lifecycle -----------------------------------------------------

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> KSMClient:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # ---- auth ----------------------------------------------------------

    def _refresh_access_token(self) -> tuple[str, float]:
        """Two-step: getAppToken → login. Returns (access_token, ttl_seconds)."""
        try:
            app_token = self._fetch_app_token()
            access_token, expire_time_ms = self._login(app_token)
        except httpx.HTTPError as e:
            raise KSMAuthError(f"KSM token refresh failed: {e}") from e
        if expire_time_ms:
            ttl = max(expire_time_ms / 1000.0 - _ts_now(), _TOKEN_TTL_FALLBACK)
        else:
            ttl = float(_TOKEN_TTL_FALLBACK)
        return access_token, ttl

    def _fetch_app_token(self) -> str:
        resp = self._http.post(
            f"{self._cfg.base_url}/ierp/api/getAppToken.do",
            json={
                "appId": self._cfg.app_id,
                "appSecuret": self._cfg.app_secret,  # 是 "Securet" 不是 "Secret"
                "tenantid": self._cfg.tenant_id,
                "accountId": self._cfg.account_id,
                "language": "zh_CN",
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        token = resp.json().get("data", {}).get("app_token")
        if not token:
            raise KSMAuthError("getAppToken returned empty app_token")
        return str(token)

    def _login(self, app_token: str) -> tuple[str, int | None]:
        resp = self._http.post(
            f"{self._cfg.base_url}/ierp/api/login.do",
            json={
                "user": self._cfg.user,
                "apptoken": app_token,
                "tenantid": self._cfg.tenant_id,
                "accountId": self._cfg.account_id,
                "usertype": "UserName",
                "language": "zh_CN",
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json().get("data", {})
        access_token = data.get("access_token")
        if not access_token:
            raise KSMAuthError("login returned empty access_token")
        return access_token, data.get("expire_time")  # ms timestamp or None

    def _get_token(self, *, force: bool = False) -> str:
        return self._token_cache.get(self._refresh_access_token, force=force)

    # ---- request helper ------------------------------------------------

    def _call_with_retry(
        self,
        op_name: str,
        request_fn: Callable[[str], dict[str, Any]],
        *,
        content_security_hint: bool = False,
    ) -> dict[str, Any]:
        """Single force-refresh retry on either unauthorized shape KSM uses:
        business-layer (`errorCode=401` in a 200 JSON body — the documented
        contract) or transport-layer (`raise_for_status()` raising on a real
        HTTP 401/403 — observed in production, e.g. TKT-006280/R20260828-1894:
        a `403 Forbidden` on handleKsmOrder with an expired token that was
        never force-refreshed because `_is_unauthorized` only ever saw the
        exception, not a JSON body to inspect). A first 401/403 gets one token
        refresh. If the retry is still 403, handleKsmOrder requests with SQL/
        script or explicit WAF response hints are classified as content-security
        blocks; otherwise the failure remains an auth/operation-permission error.
        Any other HTTP error status propagates unchanged.
        """
        token = self._get_token()
        try:
            result = request_fn(token)
        except httpx.HTTPStatusError as e:
            if e.response.status_code not in (401, 403):
                raise
            logger.warning(
                "ksm_http_unauthorized_retry",
                op=op_name,
                status=e.response.status_code,
                response_summary=_safe_response_summary(e.response),
            )
            token = self._get_token(force=True)
            try:
                return request_fn(token)
            except httpx.HTTPStatusError as e2:
                if e2.response.status_code not in (401, 403):
                    raise
                response_summary = _safe_response_summary(e2.response)
                if e2.response.status_code == 403 and _looks_like_content_security_block(
                    op_name=op_name,
                    content_security_hint=content_security_hint,
                    response_summary=response_summary,
                ):
                    logger.warning(
                        "ksm_content_security_blocked",
                        op=op_name,
                        response_summary=response_summary,
                    )
                    raise KSMContentSecurityError(
                        op_name,
                        response_summary=response_summary,
                    ) from e2
                # 强刷新后仍 401/403，且没有正文安全拦截特征：按真正的鉴权/
                # 操作权限问题处理。摘要仅保留白名单头和脱敏截断正文。
                logger.warning(
                    "ksm_http_auth_failed_after_refresh",
                    op=op_name,
                    response_summary=response_summary,
                )
                raise KSMAuthError(
                    f"{op_name} 认证或操作权限校验失败（强刷新后仍 HTTP "
                    f"{e2.response.status_code}）；KSM响应摘要={response_summary}",
                    response_summary=response_summary,
                ) from e2
        if _is_unauthorized(result):
            logger.warning("ksm_unauthorized_retry", op=op_name)
            token = self._get_token(force=True)
            result = request_fn(token)
        return result

    def _post_business(
        self, op: str, path: str, payload: dict[str, Any], *, raise_on_business_fail: bool = True
    ) -> dict[str, Any]:
        def call(token: str) -> dict[str, Any]:
            resp = self._http.post(
                f"{self._cfg.base_url}{path}",
                params={"access_token": token},
                json=payload,
                timeout=self._timeout,
            )
            resp.raise_for_status()
            return resp.json()  # type: ignore[no-any-return]

        result = self._call_with_retry(
            op,
            call,
            content_security_hint=_has_sensitive_business_content(payload),
        )
        if raise_on_business_fail and not result.get("status"):
            raise KSMBusinessError(
                op=op,
                message=str(result.get("message", "")),
                error_code=str(result.get("errorCode")) if result.get("errorCode") else None,
            )
        return result

    # ---- public ops (parity with feishu-python) ------------------------

    def lock_order(self, req: LockOrderRequest) -> dict[str, Any]:
        return self._post_business(
            "lockKsmOrder",
            "/ierp/kapi/v2/kded/kded_wos/lockKsmOrder",
            {
                "billId": req.bill_id,
                "account": req.account,
                "accountNumber": req.account_number,
                "accountName": req.account_name,
                "dealOpinion": req.deal_opinion,
            },
        )

    def handle_order(self, req: HandleOrderRequest) -> dict[str, Any]:
        if req.is_deal:
            is_deal_val, bill_type_val, deal_method_val = "2", "服务咨询", "指导解决"
        else:
            is_deal_val, bill_type_val, deal_method_val = "", req.bill_type, req.deal_method

        payload: dict[str, Any] = {
            "billId": req.bill_id,
            "account": req.account,
            "accountNumber": req.account_number,
            "accountName": req.account_name,
            "email": req.customer_email or req.email,
            "mobile": req.customer_mobile or req.mobile,
            "linkman": req.linkman or req.account_name,
            "productId": req.product_id,
            "versionId": req.version_id,
            "moduleId": req.module_id,
            "backType": req.back_type,
            "isDeal": is_deal_val,
            "dealOpinion": req.deal_opinion,
            "dealMethod": deal_method_val,
            "billType": bill_type_val,
            "handleInfo": {"currentNodeID": req.node_id},
        }
        if req.files:
            payload["files"] = req.files
        return self._post_business(
            "handleKsmOrder", "/ierp/kapi/v2/kded/kded_wos/handleKsmOrder", payload
        )

    def split_order(self, req: SplitOrderRequest) -> dict[str, Any]:
        return self._post_business(
            "splitKsmOrder",
            "/ierp/kapi/v2/kded/kded_wos/splitKsmOrder",
            {
                "billId": req.bill_id,
                "splitFeedbackNumber": req.split_count,
                "account": req.account,
                "accountNumber": req.account_number,
                "accountName": req.account_name,
            },
        )

    def supply_order(self, req: SupplyOrderRequest) -> dict[str, Any]:
        return self._post_business(
            "supplyKsmOrder",
            "/ierp/kapi/v2/kded/kded_wos/supplyKsmOrder",
            {
                "billId": req.bill_id,
                "account": req.account,
                "accountNumber": req.account_number,
                "accountName": req.account_name,
                "dealOpinion": req.deal_opinion,
                "currentNodeID": req.node_id,
            },
        )

    def return_order(self, req: ReturnOrderRequest) -> dict[str, Any]:
        return self._post_business(
            "returnKsmOrder",
            "/ierp/kapi/v2/kded/kded_wos/returnKsmOrder",
            {
                "billId": req.bill_id,
                "account": req.account,
                "accountNumber": req.account_number,
                "accountName": req.account_name,
                "dealOpinion": req.deal_opinion,
                "opercacheID": req.opercache_id,
                "currentNodeID": req.current_node_id,
            },
        )

    def get_order_detail(self, *, bill_id: str, notice_num: str, subscribe_num: str) -> OrderDetail:
        # bill_id intentionally unused in the request body (KSM contract);
        # included in the signature for caller-side traceability.
        _ = bill_id
        result = self._post_business(
            "subscribeCallback",
            "/ierp/kapi/app/open/subscribeCallback",
            {"noticeNum": notice_num, "subscribeNum": subscribe_num},
            raise_on_business_fail=False,
        )
        data = result.get("data")
        if not data:
            raise KSMBusinessError(op="subscribeCallback", message="no data in response")
        return data  # type: ignore[no-any-return]

    def download_attachment(self, url: str) -> bytes:
        """Direct download. KSM 服务器拒绝默认 UA，要伪装成浏览器。
        follow_redirects=True：KSM 附件 URL 可能是 http:// → https:// 308 重定向。"""
        resp = self._http.get(
            url,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=self._timeout,
            follow_redirects=True,
        )
        resp.raise_for_status()
        return resp.content


# ---- module-level helpers ---------------------------------------------------


def _is_unauthorized(result: dict[str, Any]) -> bool:
    return str(result.get("errorCode")) == "401" and "未经授权" in str(
        result.get("error_desc") or ""
    )


def _ts_now() -> float:
    import time

    return time.time()
