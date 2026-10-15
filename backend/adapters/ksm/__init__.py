"""KSM (金蝶 ierp) adapter — full migration from feishu-python/app/ksm_client.py."""

from .client import KSMClient
from .exceptions import KSMAuthError, KSMBusinessError, KSMContentSecurityError, KSMError
from .types import (
    HandleOrderRequest,
    KSMConfig,
    LockOrderRequest,
    OrderDetail,
    ReturnOrderRequest,
    SplitOrderRequest,
    SupplyOrderRequest,
)

__all__ = [
    "HandleOrderRequest",
    "KSMAuthError",
    "KSMBusinessError",
    "KSMClient",
    "KSMConfig",
    "KSMContentSecurityError",
    "KSMError",
    "LockOrderRequest",
    "OrderDetail",
    "ReturnOrderRequest",
    "SplitOrderRequest",
    "SupplyOrderRequest",
]
