"""add AI agent conversation id to reception sessions

Revision ID: 0059_reception_ai_agent_cid
Revises: 0058_ticket_source_product_name
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0059_reception_ai_agent_cid"
down_revision: str | Sequence[str] | None = "0058_ticket_source_product_name"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "reception_sessions",
        sa.Column("ai_agent_cid", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("reception_sessions", "ai_agent_cid")
