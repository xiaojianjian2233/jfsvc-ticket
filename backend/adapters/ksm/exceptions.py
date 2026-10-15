"""KSM adapter error hierarchy."""

from __future__ import annotations


class KSMError(Exception):
    """Base class. Wraps any KSM-side failure (HTTP, business, parse)."""


class KSMAuthError(KSMError):
    """401 / token issuance failure. Triggers a single force-refresh retry upstream."""

    def __init__(self, message: str, *, response_summary: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.response_summary = response_summary


class KSMContentSecurityError(KSMError):
    """KSM/WAF rejected business content rather than the access token."""

    def __init__(
        self,
        op: str,
        *,
        response_summary: dict[str, object],
    ) -> None:
        message = (
            f"KSM {op} 被安全网关拒绝（HTTP 403，疑似答复正文包含 SQL、脚本或其他"
            "敏感内容）；请移除敏感正文或改用附件后重试"
            f"；KSM响应摘要={response_summary}"
        )
        super().__init__(message)
        self.op = op
        self.response_summary = response_summary


class KSMBusinessError(KSMError):
    """`status=false` from KSM business endpoint (functional error, NOT a network issue)."""

    def __init__(self, op: str, message: str, error_code: str | None = None) -> None:
        super().__init__(f"KSM {op} failed: {message}")
        self.op = op
        self.message = message
        self.error_code = error_code
