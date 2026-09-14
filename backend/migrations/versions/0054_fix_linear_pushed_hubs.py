"""align already pushed linear hubs to processing status

Revision ID: 0054_fix_linear_pushed_hubs
Revises: 0053_sla_levels_expansion
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0054_fix_linear_pushed_hubs"
down_revision: str | Sequence[str] | None = "0053_sla_levels_expansion"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. 纠偏已推送 Linear 但状态被误置为 draft/created 的存量任务为 processing
    op.execute(
        """
        UPDATE hub_issues
        SET status = 'processing'
        WHERE (linear_uuid IS NOT NULL OR linear_identifier IS NOT NULL)
          AND status IN ('draft', 'created')
          AND (linear_status IS NULL OR linear_status NOT IN ('发布完成', '已发版', '已取消', '产研退回', 'Done', 'Completed', 'Released', 'Canceled'))
        """
    )

    # 2. 同步对齐关联未结案工单的处理环节为「研发处理」
    op.execute(
        """
        UPDATE tickets t
        SET process_stage = '研发处理'
        FROM hub_issues h
        WHERE (t.hub_issue_id = h.id OR t.id = h.ticket_id)
          AND (h.linear_uuid IS NOT NULL OR h.linear_identifier IS NOT NULL)
          AND h.status = 'processing'
          AND t.status NOT IN ('closed', 'done', 'transferred_return', 'answered')
          AND (t.process_stage IS NULL OR t.process_stage != '研发处理')
        """
    )


def downgrade() -> None:
    pass
