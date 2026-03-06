from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy import cast, desc, func, or_
from sqlalchemy.sql.sqltypes import Integer
from sqlmodel import select

from app.db import SessionLocal
from app.models.db_models import EventTable, RunTable
from app.models.schemas import (
    AdminOverviewResponse,
    AdminSeriesPoint,
    AgentId,
    PendingApprovalItem,
    RecentErrorItem,
)

FIVE_MINUTES_MS = 5 * 60 * 1000
ONE_MINUTE_MS = 60 * 1000
SERIES_MINUTES = 60
RECENT_ERRORS_LIMIT = 30
ACTIVE_RUN_STATUSES = ("queued", "running", "paused")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _to_int(value: object | None) -> int:
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, tuple) and value:
        return _to_int(value[0])
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        try:
            return int(value[0])  # type: ignore[index]
        except Exception:
            return 0


def _count_scalar(session, statement) -> int:
    row = session.exec(statement).first()
    return _to_int(row)


def _extract_count_row(row: object) -> tuple[int, int]:
    values = _as_tuple(row)
    bucket = _to_int(values[0] if len(values) > 0 else 0)
    count = _to_int(values[1] if len(values) > 1 else 0)
    return bucket, count


def _as_tuple(row: object) -> tuple[Any, ...]:
    if isinstance(row, tuple):
        return row
    try:
        return tuple(row)  # type: ignore[arg-type]
    except Exception:
        return ()


def _error_condition(cutoff: int | None = None) -> Any:
    conditions = [
        or_(
            EventTable.severity == "error",
            func.lower(EventTable.kind).like("%failed%"),
            func.lower(EventTable.kind).like("%error%"),
        )
    ]
    if cutoff is not None:
        conditions.insert(0, EventTable.ts >= cutoff)
    return conditions


def _extract_module_from_payload(agent_id: str, payload_json: str | None) -> str:
    if not payload_json:
        return agent_id or "unknown"
    try:
        payload = json.loads(payload_json)
    except json.JSONDecodeError:
        return agent_id or "unknown"
    module = payload.get("module") if isinstance(payload, dict) else None
    if isinstance(module, str) and module:
        return module
    return agent_id or "unknown"


def _extract_message(summary: str, payload_json: str | None) -> str:
    if not payload_json:
        return summary
    try:
        payload = json.loads(payload_json)
    except json.JSONDecodeError:
        return summary

    if isinstance(payload, dict):
        nested_error = payload.get("error")
        if isinstance(nested_error, dict):
            message = nested_error.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()
        direct_message = payload.get("message")
        if isinstance(direct_message, str) and direct_message.strip():
            return direct_message.strip()
    return summary


def build_admin_overview_snapshot() -> AdminOverviewResponse:
    now = _now_ms()
    cutoff = now - FIVE_MINUTES_MS
    current_minute_bucket = now // ONE_MINUTE_MS
    start_minute_bucket = current_minute_bucket - (SERIES_MINUTES - 1)
    series_cutoff = start_minute_bucket * ONE_MINUTE_MS
    known_modules = {agent.value for agent in AgentId}

    with SessionLocal() as session:
        active_runs = _count_scalar(
            session,
            select(func.count())
            .select_from(RunTable)
            .where(RunTable.status.in_(ACTIVE_RUN_STATUSES)),
        )

        approvals_pending = _count_scalar(
            session,
            select(func.count())
            .select_from(RunTable)
            .where(RunTable.awaiting_approval.is_(True)),
        )

        runs_last_5m = _count_scalar(
            session,
            select(func.count())
            .select_from(RunTable)
            .where(RunTable.created_at >= cutoff),
        )

        events_last_5m = _count_scalar(
            session,
            select(func.count())
            .select_from(EventTable)
            .where(EventTable.ts >= cutoff),
        )

        # Preferred rule: severity=error. Fallback rule: kind contains failed/error.
        error_events_last_5m = _count_scalar(
            session,
            select(func.count())
            .select_from(EventTable)
            .where(*_error_condition(cutoff)),
        )

        module_in_flight: dict[str, int] = {
            AgentId.review.value: 0,
            AgentId.ideation.value: 0,
            AgentId.experiment.value: 0,
            "unknown": 0,
        }

        in_flight_rows = session.exec(
            select(RunTable.current_module, func.count())
            .where(RunTable.status == "running")
            .group_by(RunTable.current_module)
        ).all()

        for row in in_flight_rows:
            if isinstance(row, tuple):
                module_raw = row[0]
                count_raw = row[1] if len(row) > 1 else 0
            else:
                module_raw = row[0]
                count_raw = row[1]

            module = (
                module_raw
                if isinstance(module_raw, str) and module_raw in known_modules
                else "unknown"
            )
            module_in_flight[module] = module_in_flight.get(module, 0) + _to_int(count_raw)

        minute_bucket = cast(EventTable.ts / ONE_MINUTE_MS, Integer)
        events_series_rows = session.exec(
            select(minute_bucket, func.count())
            .where(EventTable.ts >= series_cutoff)
            .group_by(minute_bucket)
            .order_by(minute_bucket)
        ).all()
        errors_series_rows = session.exec(
            select(minute_bucket, func.count())
            .where(EventTable.ts >= series_cutoff, *_error_condition())
            .group_by(minute_bucket)
            .order_by(minute_bucket)
        ).all()

        events_by_bucket = {bucket: count for bucket, count in map(_extract_count_row, events_series_rows)}
        errors_by_bucket = {bucket: count for bucket, count in map(_extract_count_row, errors_series_rows)}

        events_series = [
            AdminSeriesPoint(
                t=(minute * ONE_MINUTE_MS),
                count=events_by_bucket.get(minute, 0),
            )
            for minute in range(start_minute_bucket, current_minute_bucket + 1)
        ]
        error_series = [
            AdminSeriesPoint(
                t=(minute * ONE_MINUTE_MS),
                count=errors_by_bucket.get(minute, 0),
            )
            for minute in range(start_minute_bucket, current_minute_bucket + 1)
        ]

        pending_runs_rows = session.exec(
            select(
                RunTable.id,
                RunTable.topic_id,
                RunTable.awaiting_module,
                RunTable.started_at,
                RunTable.created_at,
            )
            .where(RunTable.awaiting_approval.is_(True))
            .order_by(desc(RunTable.created_at))
        ).all()
        pending_run_ids = [
            values[0]
            for values in (_as_tuple(row) for row in pending_runs_rows)
            if len(values) > 0
        ]
        max_event_rows = []
        if pending_run_ids:
            max_event_rows = session.exec(
                select(EventTable.run_id, func.max(EventTable.ts))
                .where(EventTable.run_id.in_(pending_run_ids))
                .group_by(EventTable.run_id)
            ).all()
        run_last_event = {}
        for row in max_event_rows:
            values = _as_tuple(row)
            if len(values) < 2:
                continue
            run_last_event[str(values[0])] = _to_int(values[1])

        pending_approvals = []
        for row in pending_runs_rows:
            values = _as_tuple(row)
            if len(values) < 5:
                continue
            run_id = str(values[0])
            topic_id = str(values[1])
            awaiting_module_raw = values[2]
            awaiting_module = awaiting_module_raw if isinstance(awaiting_module_raw, str) else None
            started_at = _to_int(values[3])
            created_at = _to_int(values[4])
            updated_at = run_last_event.get(run_id, max(started_at, created_at))
            pending_approvals.append(
                PendingApprovalItem(
                    topicId=topic_id,
                    runId=run_id,
                    awaitingModule=awaiting_module,
                    updatedAt=updated_at,
                )
            )

        recent_error_rows = session.exec(
            select(
                EventTable.ts,
                EventTable.run_id,
                EventTable.agent_id,
                EventTable.summary,
                EventTable.payload_json,
            )
            .where(*_error_condition())
            .order_by(desc(EventTable.ts))
            .limit(RECENT_ERRORS_LIMIT)
        ).all()

        recent_errors = []
        for row in recent_error_rows:
            values = _as_tuple(row)
            if len(values) < 5:
                continue
            ts = _to_int(values[0])
            run_id = str(values[1])
            agent_id = str(values[2])
            summary = str(values[3])
            payload_json = values[4] if isinstance(values[4], str) else None
            recent_errors.append(
                RecentErrorItem(
                    ts=ts,
                    runId=run_id,
                    module=_extract_module_from_payload(agent_id, payload_json),
                    message=_extract_message(summary, payload_json),
                )
            )

    error_rate = (
        float(error_events_last_5m) / float(events_last_5m)
        if events_last_5m > 0
        else 0.0
    )

    return AdminOverviewResponse(
        ts=now,
        activeRuns=active_runs,
        runsLast5m=runs_last_5m,
        eventsLast5m=events_last_5m,
        moduleInFlight=module_in_flight,
        approvalsPending=approvals_pending,
        errorRateLast5m=min(max(error_rate, 0.0), 1.0),
        eventsSeries=events_series,
        errorSeries=error_series,
        pendingApprovals=pending_approvals,
        recentErrors=recent_errors,
    )
