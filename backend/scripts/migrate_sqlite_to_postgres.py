from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db import DATABASE_URL, ENGINE
from app.models.db_models import ArtifactTable, EventTable, MessageTable, RunTable, TopicTable


def _load_sqlite_rows(conn: sqlite3.Connection, table_name: str) -> list[dict[str, Any]]:
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT * FROM {table_name}")
    except sqlite3.OperationalError:
        return []
    columns = [c[0] for c in cur.description]
    return [dict(zip(columns, row)) for row in cur.fetchall()]


def _parse_json_object(value: Any, *, default: dict[str, Any] | None = None) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return default or {}


def _existing_ids(session: Session, model: type, id_field: str) -> set[str]:
    column = getattr(model, id_field)
    return set(session.exec(select(column)).all())


def migrate(sqlite_path: Path, *, dry_run: bool = False) -> None:
    if ENGINE.dialect.name != "postgresql":
        raise RuntimeError(
            f"Target database is not PostgreSQL. Current DATABASE_URL={DATABASE_URL!r}"
        )

    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite file not found: {sqlite_path}")

    src = sqlite3.connect(str(sqlite_path))
    src.row_factory = sqlite3.Row

    try:
        topics = _load_sqlite_rows(src, "topics")
        runs = _load_sqlite_rows(src, "runs")
        events = _load_sqlite_rows(src, "events")
        artifacts = _load_sqlite_rows(src, "artifacts")
        messages = _load_sqlite_rows(src, "messages")

        print(
            "[migrate] sqlite rows:",
            f"topics={len(topics)}",
            f"runs={len(runs)}",
            f"events={len(events)}",
            f"artifacts={len(artifacts)}",
            f"messages={len(messages)}",
        )

        with Session(ENGINE) as session:
            existing_topic_ids = _existing_ids(session, TopicTable, "id")
            existing_run_ids = _existing_ids(session, RunTable, "id")
            existing_event_ids = _existing_ids(session, EventTable, "event_id")
            existing_artifact_ids = _existing_ids(session, ArtifactTable, "artifact_id")
            existing_message_ids = _existing_ids(session, MessageTable, "message_id")

            inserted = {
                "topics": 0,
                "runs": 0,
                "events": 0,
                "artifacts": 0,
                "messages": 0,
            }

            for row in topics:
                row_id = str(row.get("id", ""))
                if not row_id or row_id in existing_topic_ids:
                    continue
                session.add(
                    TopicTable(
                        id=row_id,
                        name=str(row.get("name", "")),
                        description=str(row.get("description", "")),
                        objective=str(row.get("objective", "")),
                        tags_json=str(row.get("tags_json", "[]")),
                        status=str(row.get("status", "active")),
                        created_at=int(row.get("created_at", 0) or 0),
                        updated_at=int(row.get("updated_at", 0) or 0),
                    )
                )
                existing_topic_ids.add(row_id)
                inserted["topics"] += 1
            session.flush()

            for row in runs:
                row_id = str(row.get("id", ""))
                if not row_id or row_id in existing_run_ids:
                    continue
                session.add(
                    RunTable(
                        id=row_id,
                        topic_id=str(row.get("topic_id", "")),
                        status=str(row.get("status", "queued")),
                        created_at=int(row.get("created_at", 0) or 0),
                        started_at=int(row.get("started_at", 0) or 0),
                        ended_at=(
                            int(row.get("ended_at"))
                            if row.get("ended_at") is not None
                            else None
                        ),
                        current_module=(
                            str(row.get("current_module"))
                            if row.get("current_module") is not None
                            else None
                        ),
                        awaiting_approval=bool(row.get("awaiting_approval", False)),
                        awaiting_module=(
                            str(row.get("awaiting_module"))
                            if row.get("awaiting_module") is not None
                            else None
                        ),
                        config_json=_parse_json_object(row.get("config_json"), default={}),
                    )
                )
                existing_run_ids.add(row_id)
                inserted["runs"] += 1
            session.flush()

            for row in events:
                row_id = str(row.get("event_id", ""))
                if not row_id or row_id in existing_event_ids:
                    continue
                session.add(
                    EventTable(
                        event_id=row_id,
                        topic_id=str(row.get("topic_id", "")),
                        run_id=str(row.get("run_id", "")),
                        agent_id=str(row.get("agent_id", "review")),
                        kind=str(row.get("kind", "event_emitted")),
                        severity=str(row.get("severity", "info")),
                        ts=int(row.get("ts", 0) or 0),
                        created_at=int(row.get("created_at", row.get("ts", 0)) or 0),
                        summary=str(row.get("summary", "")),
                        payload_json=(
                            str(row.get("payload_json"))
                            if row.get("payload_json") is not None
                            else None
                        ),
                        artifacts_json=(
                            str(row.get("artifacts_json"))
                            if row.get("artifacts_json") is not None
                            else None
                        ),
                        trace_id=(
                            str(row.get("trace_id")) if row.get("trace_id") is not None else None
                        ),
                    )
                )
                existing_event_ids.add(row_id)
                inserted["events"] += 1
            session.flush()

            for row in artifacts:
                row_id = str(row.get("artifact_id", ""))
                if not row_id or row_id in existing_artifact_ids:
                    continue
                session.add(
                    ArtifactTable(
                        artifact_id=row_id,
                        topic_id=str(row.get("topic_id", "")),
                        run_id=str(row.get("run_id", "")),
                        name=str(row.get("name", "")),
                        content_type=str(row.get("content_type", "text/plain")),
                        path=str(row.get("path", "")),
                        created_at=int(row.get("created_at", 0) or 0),
                    )
                )
                existing_artifact_ids.add(row_id)
                inserted["artifacts"] += 1
            session.flush()

            for row in messages:
                row_id = str(row.get("message_id", ""))
                if not row_id or row_id in existing_message_ids:
                    continue
                session.add(
                    MessageTable(
                        message_id=row_id,
                        topic_id=str(row.get("topic_id", "")),
                        run_id=(
                            str(row.get("run_id")) if row.get("run_id") is not None else None
                        ),
                        agent_id=str(row.get("agent_id", "review")),
                        role=str(row.get("role", "user")),
                        content=str(row.get("content", "")),
                        ts=int(row.get("ts", 0) or 0),
                    )
                )
                existing_message_ids.add(row_id)
                inserted["messages"] += 1

            if dry_run:
                session.rollback()
                print("[migrate] dry-run mode: rolled back all inserts")
            else:
                session.commit()

            print(
                "[migrate] inserted:",
                f"topics={inserted['topics']}",
                f"runs={inserted['runs']}",
                f"events={inserted['events']}",
                f"artifacts={inserted['artifacts']}",
                f"messages={inserted['messages']}",
            )
    finally:
        src.close()


def main() -> None:
    parser = argparse.ArgumentParser(
    description="Migrate xcientist data from legacy SQLite to PostgreSQL."
    )
    parser.add_argument(
        "--sqlite-path",
        default="data.db",
        help="Path to SQLite file (default: backend/data.db when running under backend/).",
    )
    parser.add_argument("--dry-run", action="store_true", help="Validate rows without committing.")
    args = parser.parse_args()

    sqlite_path = Path(args.sqlite_path).expanduser()
    if not sqlite_path.is_absolute():
        sqlite_path = (Path.cwd() / sqlite_path).resolve()

    migrate(sqlite_path, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
