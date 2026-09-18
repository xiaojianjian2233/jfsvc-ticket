"""add reception management tables (agents, sessions, messages)

Revision ID: 0055_reception_management
Revises: 0054_fix_linear_pushed_hubs
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0055_reception_management"
down_revision: str | Sequence[str] | None = "0054_fix_linear_pushed_hubs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. 创建 reception_agents 坐席表
    op.create_table(
        "reception_agents",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("user_name", sa.String(length=128), nullable=False),
        sa.Column("nickname", sa.String(length=64), nullable=False),
        sa.Column("max_concurrent", sa.Integer(), server_default="5", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="offline", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('online','busy','offline')", name="ck_reception_agents_status"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_reception_agents_user_id"),
    )
    op.create_index("ix_reception_agents_status", "reception_agents", ["status"], unique=False)

    # 2. 创建 reception_sessions 会话主表
    op.create_table(
        "reception_sessions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("company_name", sa.String(length=256), nullable=False),
        sa.Column("tax_no", sa.String(length=64), nullable=True),
        sa.Column("tenant_no", sa.String(length=64), nullable=True),
        sa.Column("tenant_name", sa.String(length=128), nullable=True),
        sa.Column("contact_name", sa.String(length=64), nullable=True),
        sa.Column("contact_phone", sa.String(length=32), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="in_progress", nullable=False),
        sa.Column("is_human", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("agent_user_id", sa.Integer(), nullable=True),
        sa.Column("agent_name", sa.String(length=64), server_default="Agent", nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=True),
        sa.Column("ticket_short_code", sa.String(length=32), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("session_type", sa.String(length=16), server_default="online", nullable=False),
        sa.Column("hotline_status", sa.String(length=16), nullable=True),
        sa.Column("unread_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("agent_last_replied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('queue','in_progress','pending','converted','closed')",
            name="ck_reception_sessions_status",
        ),
        sa.CheckConstraint(
            "session_type IN ('online','hotline')", name="ck_reception_sessions_type"
        ),
        sa.ForeignKeyConstraint(["agent_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reception_sessions_status", "reception_sessions", ["status"], unique=False)
    op.create_index(
        "ix_reception_sessions_agent", "reception_sessions", ["agent_user_id"], unique=False
    )
    op.create_index(
        "ix_reception_sessions_created_at", "reception_sessions", ["created_at"], unique=False
    )
    op.create_index(
        "ix_reception_sessions_company", "reception_sessions", ["company_name"], unique=False
    )

    # 3. 创建 reception_messages 消息记录表
    op.create_table(
        "reception_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(length=32), nullable=False),
        sa.Column("sender_type", sa.String(length=16), nullable=False),
        sa.Column("sender_name", sa.String(length=64), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_read", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "sender_type IN ('customer','agent','bot','system')",
            name="ck_reception_messages_sender_type",
        ),
        sa.ForeignKeyConstraint(["session_id"], ["reception_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_reception_messages_session",
        "reception_messages",
        ["session_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("reception_messages")
    op.drop_table("reception_sessions")
    op.drop_table("reception_agents")
