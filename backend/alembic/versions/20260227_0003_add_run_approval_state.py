"""Add runtime approval state columns to runs

Revision ID: 20260227_0003
Revises: 20260227_0002
Create Date: 2026-02-27 00:00:03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260227_0003"
down_revision = "20260227_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("current_module", sa.String(), nullable=True))
    op.add_column(
        "runs",
        sa.Column(
            "awaiting_approval",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column("runs", sa.Column("awaiting_module", sa.String(), nullable=True))

    op.create_index("ix_runs_current_module", "runs", ["current_module"], unique=False)
    op.create_index("ix_runs_awaiting_approval", "runs", ["awaiting_approval"], unique=False)
    op.create_index("ix_runs_awaiting_module", "runs", ["awaiting_module"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_runs_awaiting_module", table_name="runs")
    op.drop_index("ix_runs_awaiting_approval", table_name="runs")
    op.drop_index("ix_runs_current_module", table_name="runs")

    op.drop_column("runs", "awaiting_module")
    op.drop_column("runs", "awaiting_approval")
    op.drop_column("runs", "current_module")

