"""add cross-source ticket product name

Revision ID: 0058_ticket_source_product_name
Revises: 0057_reception_notices
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0058_ticket_source_product_name"
down_revision: str | Sequence[str] | None = "0057_reception_notices"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tickets", sa.Column("source_product_name", sa.String(256), nullable=True))
    # 已有 KSM 工单无须等待重推即可继续展示提单产品。
    op.execute(
        "UPDATE tickets SET source_product_name = ksm_main_product_name "
        "WHERE source_code = 'ksm' AND ksm_main_product_name IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("tickets", "source_product_name")
