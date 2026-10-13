"""preserve repeated Linear cycles for a shared hub

Revision ID: 0060_hub_linear_history
Revises: 0059_reception_ai_agent_cid
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0060_hub_linear_history"
down_revision: str | Sequence[str] | None = "0059_reception_ai_agent_cid"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("hub_issues", sa.Column("linear_history", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("hub_issues", "linear_history")
