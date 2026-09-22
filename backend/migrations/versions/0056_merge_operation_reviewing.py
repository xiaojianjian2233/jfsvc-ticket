"""merge Operation reviewing status into processing.

Revision ID: 0056_merge_operation_reviewing
Revises: 0055_ksm_main_product_name, 0055_reception_management

`reviewing` used to describe an AI-generated reply waiting for a person to
confirm it.  That is a reply attribute (`reply_is_draft`), not a processing
state.  Keep the draft flag and merge both current and historical status
records into `processing`.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0056_merge_operation_reviewing"
down_revision: str | Sequence[str] | None = (
    "0055_ksm_main_product_name",
    "0055_reception_management",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NEW_CHECK = (
    "op_status IS NULL OR op_status IN "
    "('processing','answered','closed','supplementing','exception','transferred_return')"
)
_OLD_CHECK = (
    "op_status IS NULL OR op_status IN "
    "('processing','answered','closed','supplementing','reviewing','exception','transferred_return')"
)


def upgrade() -> None:
    # Current values: keep reply_is_draft=True so the human-review queue and
    # manual send flow continue to work after the state merge.
    op.execute("UPDATE hub_issues SET op_status = 'processing' WHERE op_status = 'reviewing'")
    op.execute("UPDATE tickets SET status = 'processing' WHERE status = 'reviewing'")

    # Timeline/history uses the same visible vocabulary as the current state.
    # Both columns are updated so historical transitions cannot render a
    # standalone '待审核' stage.
    op.execute(
        "UPDATE status_history SET from_status = 'processing' WHERE from_status = 'reviewing'"
    )
    op.execute(
        "UPDATE status_history SET to_status = 'processing' WHERE to_status = 'reviewing'"
    )

    op.drop_constraint("ck_hub_issues_op_status", "hub_issues", type_="check")
    op.create_check_constraint("ck_hub_issues_op_status", "hub_issues", _NEW_CHECK)


def downgrade() -> None:
    # A merged value cannot be reliably separated back into the former state;
    # preserve data and only restore the old schema allowance for rollback.
    op.drop_constraint("ck_hub_issues_op_status", "hub_issues", type_="check")
    op.create_check_constraint("ck_hub_issues_op_status", "hub_issues", _OLD_CHECK)
