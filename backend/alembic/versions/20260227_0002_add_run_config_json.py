"""Add config_json to runs for RunConfig persistence

Revision ID: 20260227_0002
Revises: 20260227_0001
Create Date: 2026-02-27 00:00:02
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260227_0002"
down_revision = "20260227_0001"
branch_labels = None
depends_on = None


def _json_column_type() -> sa.types.TypeEngine:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB()
    return sa.JSON()


def upgrade() -> None:
    op.add_column(
        "runs",
        sa.Column(
            "config_json",
            _json_column_type(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("runs", "config_json")

