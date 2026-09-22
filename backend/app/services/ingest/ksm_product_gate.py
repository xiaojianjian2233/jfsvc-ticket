"""Accept KSM tickets only when either original product identifier matches."""

from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)


def accepts_product(detail: dict[str, Any]) -> bool:
    product = detail.get("product")
    if isinstance(product, dict) and (
        product.get("number") == "C28" or product.get("name") == "金蝶发票云"
    ):
        return True
    logger.info(
        "ksm_product_gate_rejected",
        bill_id=detail.get("billId") or detail.get("id"),
        product_number=product.get("number") if isinstance(product, dict) else None,
        product_name=product.get("name") if isinstance(product, dict) else None,
        reason="missing_or_nonmatching_product",
    )
    return False
