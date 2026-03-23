"""Add history title fields for topics and runs

Revision ID: 20260318_0006
Revises: 20260305_0005
Create Date: 2026-03-18 00:00:06
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260318_0006"
down_revision = "20260305_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("topics", sa.Column("history_title", sa.String(), nullable=True))
    op.add_column("runs", sa.Column("history_title", sa.String(), nullable=True))

    op.create_index("ix_topics_history_title", "topics", ["history_title"], unique=False)
    op.create_index("ix_runs_history_title", "runs", ["history_title"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_runs_history_title", table_name="runs")
    op.drop_index("ix_topics_history_title", table_name="topics")

    op.drop_column("runs", "history_title")
    op.drop_column("topics", "history_title")
