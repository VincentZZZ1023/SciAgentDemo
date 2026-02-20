from __future__ import annotations

import asyncio
import json
import shutil
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from sqlalchemy import desc
from sqlmodel import SQLModel, Session, create_engine, delete, select

from app.core.config import BACKEND_DIR, get_settings
from app.models.db_models import ArtifactTable, EventTable, RunTable, TopicTable
from app.models.schemas import AgentId, ArtifactRef, Event, EventKind, MessageRole, TraceItemKind

AGENT_ORDER = [AgentId.review, AgentId.ideation, AgentId.experiment]


def now_ms() -> int:
    return int(time.time() * 1000)


def _resolve_database_url() -> str:
    settings = get_settings()
    database_url = settings.database_url

    if database_url.startswith("sqlite:///"):
        raw_path = database_url.replace("sqlite:///", "", 1)
        if raw_path and raw_path != ":memory:":
            db_path = Path(raw_path)
            if not db_path.is_absolute():
                db_path = (BACKEND_DIR / db_path).resolve()
            db_path.parent.mkdir(parents=True, exist_ok=True)
            database_url = f"sqlite:///{db_path.as_posix()}"

    return database_url


def _resolve_artifacts_root() -> Path:
    settings = get_settings()
    root = Path(settings.artifacts_root)
    if not root.is_absolute():
        root = (BACKEND_DIR / root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _json_dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)


def _json_loads(value: str | None) -> object | None:
    if value is None:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


DATABASE_URL = _resolve_database_url()
ARTIFACTS_ROOT = _resolve_artifacts_root()
ENGINE = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)


def init_db() -> None:
    SQLModel.metadata.create_all(ENGINE)
    ARTIFACTS_ROOT.mkdir(parents=True, exist_ok=True)


class DatabaseStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._messages_lock = asyncio.Lock()
        self._messages: dict[str, dict[str, list[dict]]] = defaultdict(
            lambda: defaultdict(list)
        )
        self._artifacts_root = ARTIFACTS_ROOT

    def _resolve_trace_run_id(self, session: Session, topic_id: str) -> str | None:
        active_run_id = session.exec(
            select(RunTable.id)
            .where(
                RunTable.topic_id == topic_id,
                RunTable.status.in_(["queued", "running"]),
            )
            .order_by(desc(RunTable.started_at))
            .limit(1)
        ).first()
        if active_run_id:
            return active_run_id

        latest_run_id = session.exec(
            select(RunTable.id)
            .where(RunTable.topic_id == topic_id)
            .order_by(desc(RunTable.started_at))
            .limit(1)
        ).first()
        return latest_run_id

    def _resolve_topic_runs(self, session: Session, topic_id: str) -> tuple[str | None, str | None]:
        last_run_id = session.exec(
            select(RunTable.id)
            .where(RunTable.topic_id == topic_id)
            .order_by(desc(RunTable.started_at))
            .limit(1)
        ).first()

        active_run_id = session.exec(
            select(RunTable.id)
            .where(
                RunTable.topic_id == topic_id,
                RunTable.status.in_(["queued", "running"]),
            )
            .order_by(desc(RunTable.started_at))
            .limit(1)
        ).first()

        return last_run_id, active_run_id

    def _topic_to_payload(
        self,
        topic: TopicTable,
        *,
        last_run_id: str | None,
        active_run_id: str | None,
    ) -> dict:
        tags_raw = _json_loads(topic.tags_json)
        tags = tags_raw if isinstance(tags_raw, list) else []

        return {
            "topicId": topic.id,
            "title": topic.name,
            "description": topic.description,
            "objective": topic.objective,
            "tags": tags,
            "status": topic.status,
            "createdAt": topic.created_at,
            "updatedAt": topic.updated_at,
            "lastRunId": last_run_id,
            "activeRunId": active_run_id,
            "id": topic.id,
            "name": topic.name,
        }

    def _artifact_to_payload(self, artifact: ArtifactTable) -> dict:
        return {
            "artifactId": artifact.artifact_id,
            "name": artifact.name,
            "uri": f"/api/topics/{artifact.topic_id}/artifacts/{quote(artifact.name)}",
            "contentType": artifact.content_type,
        }

    def _event_to_payload(self, session: Session, row: EventTable) -> dict:
        payload_json = _json_loads(row.payload_json)
        artifacts_json = _json_loads(row.artifacts_json)

        event_payload: dict = {
            "eventId": row.event_id,
            "ts": row.ts,
            "topicId": row.topic_id,
            "runId": row.run_id,
            "agentId": row.agent_id,
            "kind": row.kind,
            "severity": row.severity,
            "summary": row.summary,
        }

        if isinstance(payload_json, dict):
            event_payload["payload"] = payload_json

        if isinstance(artifacts_json, list):
            event_payload["artifacts"] = artifacts_json

        if row.kind == EventKind.artifact_created.value and "artifacts" not in event_payload:
            latest_artifact = session.exec(
                select(ArtifactTable)
                .where(
                    ArtifactTable.topic_id == row.topic_id,
                    ArtifactTable.run_id == row.run_id,
                )
                .order_by(desc(ArtifactTable.created_at))
                .limit(1)
            ).first()
            if latest_artifact is not None:
                event_payload["artifacts"] = [self._artifact_to_payload(latest_artifact)]

        if row.trace_id:
            event_payload["traceId"] = row.trace_id

        return event_payload

    def _build_agent_snapshot(self, session: Session, topic_id: str, default_ts: int) -> list[dict]:
        snapshots: list[dict] = []

        for agent in AGENT_ORDER:
            snapshot = {
                "agentId": agent.value,
                "status": "idle",
                "progress": 0.0,
                "lastUpdate": default_ts,
                "runId": None,
                "lastSummary": "idle",
                "state": "idle",
                "updatedAt": default_ts,
            }

            latest_status_event = session.exec(
                select(EventTable)
                .where(
                    EventTable.topic_id == topic_id,
                    EventTable.agent_id == agent.value,
                    EventTable.kind == EventKind.agent_status_updated.value,
                )
                .order_by(desc(EventTable.ts))
                .limit(1)
            ).first()

            if latest_status_event is not None:
                payload = _json_loads(latest_status_event.payload_json)
                status = None
                progress = None
                if isinstance(payload, dict):
                    status = payload.get("status")
                    progress = payload.get("progress")

                if isinstance(status, str) and status:
                    snapshot["status"] = status
                    snapshot["state"] = status
                if isinstance(progress, (int, float)):
                    snapshot["progress"] = max(0.0, min(float(progress), 1.0))

                snapshot["lastUpdate"] = latest_status_event.ts
                snapshot["updatedAt"] = latest_status_event.ts
                snapshot["runId"] = latest_status_event.run_id
                snapshot["lastSummary"] = latest_status_event.summary

            latest_event = session.exec(
                select(EventTable)
                .where(
                    EventTable.topic_id == topic_id,
                    EventTable.agent_id == agent.value,
                )
                .order_by(desc(EventTable.ts))
                .limit(1)
            ).first()

            if latest_event is not None:
                snapshot["lastUpdate"] = latest_event.ts
                snapshot["updatedAt"] = latest_event.ts
                snapshot["runId"] = latest_event.run_id
                snapshot["lastSummary"] = latest_event.summary

            snapshots.append(snapshot)

        return snapshots

    async def list_topics(self) -> list[dict]:
        with Session(ENGINE) as session:
            topics = session.exec(select(TopicTable).order_by(TopicTable.created_at)).all()
            items: list[dict] = []
            for topic in topics:
                last_run_id, active_run_id = self._resolve_topic_runs(session, topic.id)
                items.append(
                    self._topic_to_payload(
                        topic,
                        last_run_id=last_run_id,
                        active_run_id=active_run_id,
                    )
                )
            return items

    async def get_topic(self, topic_id: str) -> dict | None:
        with Session(ENGINE) as session:
            topic = session.get(TopicTable, topic_id)
            if topic is None:
                return None

            last_run_id, active_run_id = self._resolve_topic_runs(session, topic.id)
            return self._topic_to_payload(
                topic,
                last_run_id=last_run_id,
                active_run_id=active_run_id,
            )

    async def create_topic(
        self,
        *,
        title: str,
        description: str = "",
        objective: str = "",
        tags: list[str] | None = None,
    ) -> dict:
        timestamp = now_ms()
        topic = TopicTable(
            id=f"topic-{uuid4().hex[:8]}",
            name=title,
            description=description,
            objective=objective,
            tags_json=_json_dumps(tags or []),
            status="active",
            created_at=timestamp,
            updated_at=timestamp,
        )

        async with self._lock:
            with Session(ENGINE) as session:
                session.add(topic)
                session.commit()
                session.refresh(topic)

        return self._topic_to_payload(topic, last_run_id=None, active_run_id=None)

    async def create_run(
        self,
        topic_id: str,
        *,
        trigger: str,
        initiator: str,
        note: str | None,
    ) -> dict:
        del trigger, initiator, note  # Reserved for future use.

        timestamp = now_ms()
        clock_part = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
        run_id = f"run-{clock_part}-{uuid4().hex[:4]}"

        async with self._lock:
            with Session(ENGINE) as session:
                topic = session.get(TopicTable, topic_id)
                if topic is None:
                    raise KeyError(topic_id)

                run = RunTable(
                    id=run_id,
                    topic_id=topic_id,
                    status="queued",
                    started_at=timestamp,
                )

                topic.updated_at = timestamp

                session.add(run)
                session.add(topic)
                session.commit()

        return {
            "runId": run_id,
            "topicId": topic_id,
            "status": "queued",
            "createdAt": timestamp,
            "startedAt": timestamp,
        }

    async def update_run_status(self, topic_id: str, run_id: str, status: str) -> None:
        timestamp = now_ms()

        async with self._lock:
            with Session(ENGINE) as session:
                topic = session.get(TopicTable, topic_id)
                if topic is None:
                    raise KeyError(topic_id)

                run = session.get(RunTable, run_id)
                if run is None or run.topic_id != topic_id:
                    raise KeyError(run_id)

                run.status = status
                if status in {"completed", "failed", "stopped"}:
                    run.ended_at = timestamp

                topic.updated_at = timestamp

                session.add(run)
                session.add(topic)
                session.commit()

    async def set_agent_status(
        self,
        topic_id: str,
        *,
        agent_id: AgentId,
        status: str,
        progress: float,
        run_id: str,
        summary: str,
    ) -> dict:
        timestamp = now_ms()
        topic = await self.get_topic(topic_id)
        if topic is None:
            raise KeyError(topic_id)

        return {
            "agentId": agent_id.value,
            "status": status,
            "progress": max(0.0, min(progress, 1.0)),
            "lastUpdate": timestamp,
            "runId": run_id,
            "lastSummary": summary,
            "state": status,
            "updatedAt": timestamp,
        }

    async def add_event(self, event: Event) -> None:
        payload_json = _json_dumps(event.payload) if event.payload is not None else None
        artifacts_json = (
            _json_dumps([artifact.model_dump(mode="json") for artifact in event.artifacts])
            if event.artifacts is not None
            else None
        )

        async with self._lock:
            with Session(ENGINE) as session:
                topic = session.get(TopicTable, event.topicId)
                if topic is None:
                    raise KeyError(event.topicId)

                session.add(
                    EventTable(
                        event_id=event.eventId,
                        topic_id=event.topicId,
                        run_id=event.runId,
                        agent_id=event.agentId.value,
                        kind=event.kind.value,
                        severity=event.severity.value,
                        ts=event.ts,
                        summary=event.summary,
                        payload_json=payload_json,
                        artifacts_json=artifacts_json,
                        trace_id=event.traceId,
                    )
                )

                topic.updated_at = max(topic.updated_at, event.ts)
                session.add(topic)
                session.commit()

    async def create_artifact(
        self,
        *,
        topic_id: str,
        run_id: str,
        name: str,
        content_type: str,
        content: str | dict,
        artifact_id: str | None = None,
    ) -> ArtifactRef:
        safe_name = Path(name).name
        if not safe_name:
            raise ValueError("Invalid artifact name")

        if isinstance(content, dict):
            file_content = json.dumps(content, ensure_ascii=False, indent=2)
        else:
            file_content = content

        created_at = now_ms()
        artifact_key = artifact_id or f"art-{Path(safe_name).stem}-{uuid4().hex[:8]}"

        topic_artifact_dir = self._artifacts_root / topic_id / run_id
        topic_artifact_dir.mkdir(parents=True, exist_ok=True)
        file_path = topic_artifact_dir / safe_name
        file_path.write_text(file_content, encoding="utf-8")

        async with self._lock:
            with Session(ENGINE) as session:
                topic = session.get(TopicTable, topic_id)
                if topic is None:
                    raise KeyError(topic_id)

                artifact = ArtifactTable(
                    artifact_id=artifact_key,
                    topic_id=topic_id,
                    run_id=run_id,
                    name=safe_name,
                    content_type=content_type,
                    path=str(file_path.resolve()),
                    created_at=created_at,
                )

                topic.updated_at = created_at

                session.add(artifact)
                session.add(topic)
                session.commit()

        return ArtifactRef(
            artifactId=artifact_key,
            name=safe_name,
            uri=f"/api/topics/{topic_id}/artifacts/{quote(safe_name)}",
            contentType=content_type,
        )

    async def get_snapshot(self, topic_id: str, *, limit: int = 50) -> dict:
        with Session(ENGINE) as session:
            topic = session.get(TopicTable, topic_id)
            if topic is None:
                raise KeyError(topic_id)

            last_run_id, active_run_id = self._resolve_topic_runs(session, topic.id)

            events_rows = session.exec(
                select(EventTable)
                .where(EventTable.topic_id == topic_id)
                .order_by(desc(EventTable.ts))
                .limit(limit)
            ).all()
            events_rows.reverse()

            artifacts_rows = session.exec(
                select(ArtifactTable)
                .where(ArtifactTable.topic_id == topic_id)
                .order_by(ArtifactTable.created_at)
            ).all()

            agents = self._build_agent_snapshot(session, topic_id, topic.updated_at)

            return {
                "topic": self._topic_to_payload(
                    topic,
                    last_run_id=last_run_id,
                    active_run_id=active_run_id,
                ),
                "agents": agents,
                "events": [self._event_to_payload(session, row) for row in events_rows],
                "artifacts": [self._artifact_to_payload(row) for row in artifacts_rows],
            }

    async def get_artifact_file(self, topic_id: str, name: str) -> dict:
        safe_name = Path(name).name

        with Session(ENGINE) as session:
            artifact = session.exec(
                select(ArtifactTable)
                .where(
                    ArtifactTable.topic_id == topic_id,
                    ArtifactTable.name == safe_name,
                )
                .order_by(desc(ArtifactTable.created_at))
                .limit(1)
            ).first()

            if artifact is None:
                raise KeyError(name)

            path = Path(artifact.path)
            if not path.exists():
                raise FileNotFoundError(path)

            return {
                "path": str(path),
                "contentType": artifact.content_type,
                "name": artifact.name,
            }

    async def delete_topic(self, topic_id: str) -> None:
        async with self._lock:
            with Session(ENGINE) as session:
                topic = session.get(TopicTable, topic_id)
                if topic is None:
                    raise KeyError(topic_id)

                session.exec(delete(EventTable).where(EventTable.topic_id == topic_id))
                session.exec(delete(ArtifactTable).where(ArtifactTable.topic_id == topic_id))
                session.exec(delete(RunTable).where(RunTable.topic_id == topic_id))
                session.delete(topic)
                session.commit()

        async with self._messages_lock:
            self._messages.pop(topic_id, None)

        artifact_dir = self._artifacts_root / topic_id
        if artifact_dir.exists():
            shutil.rmtree(artifact_dir)

    async def list_messages(self, topic_id: str, agent_id: AgentId) -> list[dict]:
        topic = await self.get_topic(topic_id)
        if topic is None:
            raise KeyError(topic_id)

        async with self._messages_lock:
            items = [item.copy() for item in self._messages.get(topic_id, {}).get(agent_id.value, [])]

        items.sort(key=lambda item: item["ts"])
        return items

    async def create_message(
        self,
        *,
        topic_id: str,
        agent_id: AgentId,
        role: MessageRole,
        content: str,
        run_id: str | None = None,
    ) -> dict:
        topic = await self.get_topic(topic_id)
        if topic is None:
            raise KeyError(topic_id)

        message = {
            "messageId": str(uuid4()),
            "topicId": topic_id,
            "runId": run_id,
            "agentId": agent_id.value,
            "role": role.value,
            "content": content,
            "ts": now_ms(),
        }

        async with self._messages_lock:
            self._messages[topic_id][agent_id.value].append(message)

        return message.copy()

    async def get_trace(self, topic_id: str, *, run_id: str | None = None) -> dict:
        with Session(ENGINE) as session:
            topic = session.get(TopicTable, topic_id)
            if topic is None:
                raise KeyError(topic_id)

            selected_run_id = run_id
            if selected_run_id:
                run = session.get(RunTable, selected_run_id)
                if run is None or run.topic_id != topic_id:
                    raise ValueError("Run not found")
            else:
                selected_run_id = self._resolve_trace_run_id(session, topic_id)

            event_statement = select(EventTable).where(EventTable.topic_id == topic_id)
            if selected_run_id:
                event_statement = event_statement.where(EventTable.run_id == selected_run_id)
            event_rows = session.exec(event_statement.order_by(EventTable.ts)).all()

            artifact_statement = select(ArtifactTable).where(ArtifactTable.topic_id == topic_id)
            if selected_run_id:
                artifact_statement = artifact_statement.where(ArtifactTable.run_id == selected_run_id)
            artifact_rows = session.exec(artifact_statement.order_by(ArtifactTable.created_at)).all()

        timeline_items: list[dict] = []
        message_ids: set[str] = set()
        artifact_ids: set[str] = set()

        for row in event_rows:
            payload_raw = _json_loads(row.payload_json)
            payload = payload_raw if isinstance(payload_raw, dict) else {}
            artifacts_raw = _json_loads(row.artifacts_json)
            artifacts = artifacts_raw if isinstance(artifacts_raw, list) else []

            if row.kind == EventKind.message_created.value:
                message = payload.get("message") if isinstance(payload, dict) else None
                if not isinstance(message, dict):
                    continue

                message_id = message.get("messageId")
                if not isinstance(message_id, str) or not message_id:
                    continue
                if message_id in message_ids:
                    continue

                message_ts = message.get("ts")
                ts = message_ts if isinstance(message_ts, int) else row.ts

                message_agent_id = message.get("agentId")
                agent_id = (
                    message_agent_id
                    if isinstance(message_agent_id, str) and message_agent_id in AgentId._value2member_map_
                    else row.agent_id
                )

                role = message.get("role") if isinstance(message.get("role"), str) else "assistant"
                content = message.get("content") if isinstance(message.get("content"), str) else row.summary
                summary = f"{role}: {content[:120]}"

                timeline_items.append(
                    {
                        "id": f"msg-{message_id}",
                        "ts": ts,
                        "agentId": agent_id,
                        "kind": TraceItemKind.message.value,
                        "summary": summary,
                        "payload": {"message": message},
                    }
                )
                message_ids.add(message_id)
                continue

            if row.kind == EventKind.artifact_created.value:
                appended = False
                for index, artifact in enumerate(artifacts):
                    if not isinstance(artifact, dict):
                        continue
                    artifact_id = artifact.get("artifactId")
                    if not isinstance(artifact_id, str) or not artifact_id:
                        artifact_id = f"{row.event_id}-{index}"
                    if artifact_id in artifact_ids:
                        continue

                    name = artifact.get("name") if isinstance(artifact.get("name"), str) else "artifact"
                    timeline_items.append(
                        {
                            "id": f"artifact-{artifact_id}",
                            "ts": row.ts,
                            "agentId": row.agent_id,
                            "kind": TraceItemKind.artifact.value,
                            "summary": f"artifact: {name}",
                            "payload": {"artifact": artifact},
                        }
                    )
                    artifact_ids.add(artifact_id)
                    appended = True

                if not appended:
                    timeline_items.append(
                        {
                            "id": f"artifact-{row.event_id}",
                            "ts": row.ts,
                            "agentId": row.agent_id,
                            "kind": TraceItemKind.artifact.value,
                            "summary": row.summary,
                            "payload": payload or None,
                        }
                    )
                continue

            if row.kind == EventKind.agent_status_updated.value:
                status_payload = payload if isinstance(payload, dict) else {}
                timeline_items.append(
                    {
                        "id": f"status-{row.event_id}",
                        "ts": row.ts,
                        "agentId": row.agent_id,
                        "kind": TraceItemKind.status.value,
                        "summary": row.summary,
                        "payload": status_payload or None,
                    }
                )
                continue

            if row.kind == EventKind.event_emitted.value:
                timeline_items.append(
                    {
                        "id": f"event-{row.event_id}",
                        "ts": row.ts,
                        "agentId": row.agent_id,
                        "kind": TraceItemKind.event.value,
                        "summary": row.summary,
                        "payload": payload or None,
                    }
                )

        async with self._messages_lock:
            topic_messages = self._messages.get(topic_id, {})
            for agent_messages in topic_messages.values():
                for message in agent_messages:
                    message_run_id = message.get("runId")
                    if selected_run_id and message_run_id != selected_run_id:
                        continue

                    message_id = message.get("messageId")
                    if not isinstance(message_id, str) or not message_id or message_id in message_ids:
                        continue

                    role = message.get("role") if isinstance(message.get("role"), str) else "assistant"
                    content = message.get("content") if isinstance(message.get("content"), str) else ""
                    if not content:
                        continue

                    ts = message.get("ts") if isinstance(message.get("ts"), int) else now_ms()
                    agent_id = message.get("agentId")
                    if not isinstance(agent_id, str) or agent_id not in AgentId._value2member_map_:
                        continue

                    timeline_items.append(
                        {
                            "id": f"msg-{message_id}",
                            "ts": ts,
                            "agentId": agent_id,
                            "kind": TraceItemKind.message.value,
                            "summary": f"{role}: {content[:120]}",
                            "payload": {"message": message},
                        }
                    )
                    message_ids.add(message_id)

        for artifact_row in artifact_rows:
            if artifact_row.artifact_id in artifact_ids:
                continue

            payload = self._artifact_to_payload(artifact_row)
            inferred_agent: AgentId = AgentId.ideation
            lowered = artifact_row.name.lower()
            if "survey" in lowered:
                inferred_agent = AgentId.review
            elif "result" in lowered:
                inferred_agent = AgentId.experiment

            timeline_items.append(
                {
                    "id": f"artifact-{artifact_row.artifact_id}",
                    "ts": artifact_row.created_at,
                    "agentId": inferred_agent.value,
                    "kind": TraceItemKind.artifact.value,
                    "summary": f"artifact: {artifact_row.name}",
                    "payload": {"artifact": payload},
                }
            )
            artifact_ids.add(artifact_row.artifact_id)

        timeline_items.sort(key=lambda item: item["ts"])

        return {
            "topicId": topic_id,
            "runId": selected_run_id,
            "items": timeline_items,
        }


store = DatabaseStore()
