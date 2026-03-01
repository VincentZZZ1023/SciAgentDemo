"""Initial schema for SciAgentDemo

Revision ID: 20260227_0001
Revises:
Create Date: 2026-02-27 00:00:01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260227_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "topics",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("objective", sa.String(), nullable=False),
        sa.Column("tags_json", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_topics_id", "topics", ["id"], unique=False)
    op.create_index("ix_topics_name", "topics", ["name"], unique=False)
    op.create_index("ix_topics_created_at", "topics", ["created_at"], unique=False)
    op.create_index("ix_topics_updated_at", "topics", ["updated_at"], unique=False)

    op.create_table(
        "runs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("topic_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("started_at", sa.BigInteger(), nullable=False),
        sa.Column("ended_at", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_runs_id", "runs", ["id"], unique=False)
    op.create_index("ix_runs_topic_id", "runs", ["topic_id"], unique=False)
    op.create_index("ix_runs_status", "runs", ["status"], unique=False)
    op.create_index("ix_runs_created_at", "runs", ["created_at"], unique=False)
    op.create_index("ix_runs_started_at", "runs", ["started_at"], unique=False)
    op.create_index("ix_runs_ended_at", "runs", ["ended_at"], unique=False)
    op.create_index("ix_runs_topic_created_at", "runs", ["topic_id", "created_at"], unique=False)

    op.create_table(
        "events",
        sa.Column("event_id", sa.String(), nullable=False),
        sa.Column("topic_id", sa.String(), nullable=False),
        sa.Column("run_id", sa.String(), nullable=False),
        sa.Column("agent_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("severity", sa.String(), nullable=False),
        sa.Column("ts", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("summary", sa.String(), nullable=False),
        sa.Column("payload_json", sa.String(), nullable=True),
        sa.Column("artifacts_json", sa.String(), nullable=True),
        sa.Column("trace_id", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"]),
        sa.PrimaryKeyConstraint("event_id"),
    )
    op.create_index("ix_events_event_id", "events", ["event_id"], unique=False)
    op.create_index("ix_events_topic_id", "events", ["topic_id"], unique=False)
    op.create_index("ix_events_run_id", "events", ["run_id"], unique=False)
    op.create_index("ix_events_agent_id", "events", ["agent_id"], unique=False)
    op.create_index("ix_events_kind", "events", ["kind"], unique=False)
    op.create_index("ix_events_severity", "events", ["severity"], unique=False)
    op.create_index("ix_events_ts", "events", ["ts"], unique=False)
    op.create_index("ix_events_created_at", "events", ["created_at"], unique=False)
    op.create_index("ix_events_trace_id", "events", ["trace_id"], unique=False)
    op.create_index("ix_events_topic_created_at", "events", ["topic_id", "created_at"], unique=False)
    op.create_index("ix_events_run_created_at", "events", ["run_id", "created_at"], unique=False)

    op.create_table(
        "artifacts",
        sa.Column("artifact_id", sa.String(), nullable=False),
        sa.Column("topic_id", sa.String(), nullable=False),
        sa.Column("run_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"]),
        sa.PrimaryKeyConstraint("artifact_id"),
    )
    op.create_index("ix_artifacts_artifact_id", "artifacts", ["artifact_id"], unique=False)
    op.create_index("ix_artifacts_topic_id", "artifacts", ["topic_id"], unique=False)
    op.create_index("ix_artifacts_run_id", "artifacts", ["run_id"], unique=False)
    op.create_index("ix_artifacts_name", "artifacts", ["name"], unique=False)
    op.create_index("ix_artifacts_created_at", "artifacts", ["created_at"], unique=False)
    op.create_index("ix_artifacts_topic_run", "artifacts", ["topic_id", "run_id"], unique=False)

    op.create_table(
        "messages",
        sa.Column("message_id", sa.String(), nullable=False),
        sa.Column("topic_id", sa.String(), nullable=False),
        sa.Column("run_id", sa.String(), nullable=True),
        sa.Column("agent_id", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.String(), nullable=False),
        sa.Column("ts", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"]),
        sa.PrimaryKeyConstraint("message_id"),
    )
    op.create_index("ix_messages_message_id", "messages", ["message_id"], unique=False)
    op.create_index("ix_messages_topic_id", "messages", ["topic_id"], unique=False)
    op.create_index("ix_messages_run_id", "messages", ["run_id"], unique=False)
    op.create_index("ix_messages_agent_id", "messages", ["agent_id"], unique=False)
    op.create_index("ix_messages_role", "messages", ["role"], unique=False)
    op.create_index("ix_messages_ts", "messages", ["ts"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_messages_ts", table_name="messages")
    op.drop_index("ix_messages_role", table_name="messages")
    op.drop_index("ix_messages_agent_id", table_name="messages")
    op.drop_index("ix_messages_run_id", table_name="messages")
    op.drop_index("ix_messages_topic_id", table_name="messages")
    op.drop_index("ix_messages_message_id", table_name="messages")
    op.drop_table("messages")

    op.drop_index("ix_artifacts_topic_run", table_name="artifacts")
    op.drop_index("ix_artifacts_created_at", table_name="artifacts")
    op.drop_index("ix_artifacts_name", table_name="artifacts")
    op.drop_index("ix_artifacts_run_id", table_name="artifacts")
    op.drop_index("ix_artifacts_topic_id", table_name="artifacts")
    op.drop_index("ix_artifacts_artifact_id", table_name="artifacts")
    op.drop_table("artifacts")

    op.drop_index("ix_events_run_created_at", table_name="events")
    op.drop_index("ix_events_topic_created_at", table_name="events")
    op.drop_index("ix_events_trace_id", table_name="events")
    op.drop_index("ix_events_created_at", table_name="events")
    op.drop_index("ix_events_ts", table_name="events")
    op.drop_index("ix_events_severity", table_name="events")
    op.drop_index("ix_events_kind", table_name="events")
    op.drop_index("ix_events_agent_id", table_name="events")
    op.drop_index("ix_events_run_id", table_name="events")
    op.drop_index("ix_events_topic_id", table_name="events")
    op.drop_index("ix_events_event_id", table_name="events")
    op.drop_table("events")

    op.drop_index("ix_runs_topic_created_at", table_name="runs")
    op.drop_index("ix_runs_ended_at", table_name="runs")
    op.drop_index("ix_runs_started_at", table_name="runs")
    op.drop_index("ix_runs_created_at", table_name="runs")
    op.drop_index("ix_runs_status", table_name="runs")
    op.drop_index("ix_runs_topic_id", table_name="runs")
    op.drop_index("ix_runs_id", table_name="runs")
    op.drop_table("runs")

    op.drop_index("ix_topics_updated_at", table_name="topics")
    op.drop_index("ix_topics_created_at", table_name="topics")
    op.drop_index("ix_topics_name", table_name="topics")
    op.drop_index("ix_topics_id", table_name="topics")
    op.drop_table("topics")

