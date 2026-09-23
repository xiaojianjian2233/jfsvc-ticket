"""add reception_notices table

Revision ID: 0057_reception_notices
Revises: 0056_merge_operation_reviewing
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0057_reception_notices"
down_revision: str | Sequence[str] | None = "0056_merge_operation_reviewing"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reception_notices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("notice_no", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=128), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("popup_prompt", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default="published",
            nullable=False,
        ),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('published','unpublished')", name="ck_reception_notices_status"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("notice_no", name="uq_reception_notices_notice_no"),
    )
    op.create_index("ix_reception_notices_notice_no", "reception_notices", ["notice_no"], unique=True)
    op.create_index("ix_reception_notices_status", "reception_notices", ["status"], unique=False)
    op.create_index("ix_reception_notices_created_at", "reception_notices", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_reception_notices_created_at", table_name="reception_notices")
    op.drop_index("ix_reception_notices_status", table_name="reception_notices")
    op.drop_index("ix_reception_notices_notice_no", table_name="reception_notices")
    op.drop_table("reception_notices")
