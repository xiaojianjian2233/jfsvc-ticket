"""tickets 加 KSM 主产品名称字段（version.mainproductname 原样值）.

Revision ID: 0055_ksm_main_product_name
Revises: 0054_fix_linear_pushed_hubs

新增：
  ksm_main_product_name — KSM subscribeCallback 返回的 version.mainproductname
    原样字符串（如"金蝶发票云【星空旗舰版】公有云"），不经 AI 归类映射。
    仅 KSM 来源工单有值，其它来源留空。

用途：工单列表页「主产品」列，KSM 来源工单直接展示此字段而非
product_line_code → product_lines.name（AI 归类结果）。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0055_ksm_main_product_name"
down_revision: str | Sequence[str] | None = "0054_fix_linear_pushed_hubs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tickets", sa.Column("ksm_main_product_name", sa.String(128), nullable=True))


def downgrade() -> None:
    op.drop_column("tickets", "ksm_main_product_name")
