"""Add approval_resolved_at to runs

Revision ID: 20260301_0004
Revises: 20260227_0003
Create Date: 2026-03-01 00:00:04
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260301_0004"
down_revision = "20260227_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("approval_resolved_at", sa.BigInteger(), nullable=True))
    op.create_index("ix_runs_approval_resolved_at", "runs", ["approval_resolved_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_runs_approval_resolved_at", table_name="runs")
    op.drop_column("runs", "approval_resolved_at")
