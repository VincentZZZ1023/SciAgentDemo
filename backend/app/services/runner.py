from __future__ import annotations

import asyncio
import time
from uuid import uuid4

from app.models.schemas import AgentId, ArtifactRef, Event, EventKind, Severity
from app.services.event_bus import event_bus
from app.store import store


def now_ms() -> int:
    return int(time.time() * 1000)


def build_event(
    *,
    topic_id: str,
    run_id: str,
    agent_id: AgentId,
    kind: EventKind,
    severity: Severity,
    summary: str,
    payload: dict | None = None,
    artifacts: list[ArtifactRef] | None = None,
    trace_id: str | None = None,
) -> Event:
    return Event(
        eventId=str(uuid4()),
        ts=now_ms(),
        topicId=topic_id,
        runId=run_id,
        agentId=agent_id,
        kind=kind,
        severity=severity,
        summary=summary,
        payload=payload,
        artifacts=artifacts,
        traceId=trace_id,
    )


class FakePipelineRunner:
    def __init__(self) -> None:
        self._step_sleep = 0.8

    async def _emit(self, event: Event) -> None:
        await store.add_event(event)
        await event_bus.publish(event.topicId, event)

    async def _create_artifact(
        self,
        *,
        topic_id: str,
        run_id: str,
        name: str,
        content_type: str,
        content: str | dict,
    ) -> ArtifactRef:
        return await store.create_artifact(
            topic_id=topic_id,
            run_id=run_id,
            name=name,
            content_type=content_type,
            content=content,
        )

    async def _update_agent(
        self,
        *,
        topic_id: str,
        run_id: str,
        agent_id: AgentId,
        status: str,
        progress: float,
        summary: str,
        trace_id: str,
    ) -> None:
        await store.set_agent_status(
            topic_id,
            agent_id=agent_id,
            status=status,
            progress=progress,
            run_id=run_id,
            summary=summary,
        )

        severity = Severity.error if status == "failed" else Severity.info
        event = build_event(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=agent_id,
            kind=EventKind.agent_status_updated,
            severity=severity,
            summary=summary,
            payload={"status": status, "progress": progress},
            trace_id=trace_id,
        )
        await self._emit(event)

    async def run_pipeline(self, topic_id: str, run_id: str) -> None:
        trace_id = f"trace-{uuid4()}"

        try:
            await store.update_run_status(topic_id, run_id, "running")

            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.review,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="run started",
                    payload={"phase": "run_started"},
                    trace_id=trace_id,
                )
            )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.review,
                status="running",
                progress=0.1,
                summary="review running",
                trace_id=trace_id,
            )
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.review,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="starting literature review",
                    payload={"stage": "review"},
                    trace_id=trace_id,
                )
            )
            await asyncio.sleep(self._step_sleep)

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.review,
                status="completed",
                progress=1.0,
                summary="review completed",
                trace_id=trace_id,
            )

            survey_artifact = await self._create_artifact(
                topic_id=topic_id,
                run_id=run_id,
                name="survey.md",
                content_type="text/markdown",
                content=(
                    f"# Survey for {topic_id}\n\n"
                    "## Key Papers\n"
                    "- Neural-symbolic reasoning for materials discovery\n"
                    "- LLM-assisted hypothesis generation in chemistry\n\n"
                    "## Summary\n"
                    "Review agent identified promising mechanisms for catalyst screening.\n"
                ),
            )

            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.review,
                    kind=EventKind.artifact_created,
                    severity=Severity.info,
                    summary="review produced survey.md",
                    payload={"handoffTo": "ideation", "artifactRole": "survey"},
                    artifacts=[survey_artifact],
                    trace_id=trace_id,
                )
            )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.ideation,
                status="running",
                progress=0.2,
                summary="ideation running",
                trace_id=trace_id,
            )
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.ideation,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="generating ideas from survey",
                    payload={"stage": "ideation"},
                    trace_id=trace_id,
                )
            )
            await asyncio.sleep(self._step_sleep)

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.ideation,
                status="completed",
                progress=1.0,
                summary="ideation completed",
                trace_id=trace_id,
            )

            ideas_artifact = await self._create_artifact(
                topic_id=topic_id,
                run_id=run_id,
                name="ideas.md",
                content_type="text/markdown",
                content=(
                    f"# Ideas for {topic_id}\n\n"
                    "1. Improve catalyst candidate ranking with symbolic constraints.\n"
                    "2. Use uncertainty-aware active learning for experiment budget control.\n"
                ),
            )

            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.ideation,
                    kind=EventKind.artifact_created,
                    severity=Severity.info,
                    summary="ideation produced ideas.md",
                    payload={"handoffTo": "experiment", "artifactRole": "idea"},
                    artifacts=[ideas_artifact],
                    trace_id=trace_id,
                )
            )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.experiment,
                status="running",
                progress=0.25,
                summary="experiment running",
                trace_id=trace_id,
            )
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.experiment,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="running experiments for idea",
                    payload={"stage": "experiment"},
                    trace_id=trace_id,
                )
            )
            await asyncio.sleep(self._step_sleep)

            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.experiment,
                    kind=EventKind.event_emitted,
                    severity=Severity.error,
                    summary="experiment encountered temporary failure, retrying",
                    payload={"errorCode": "SIM_TEMP_FAILURE", "retryable": True},
                    trace_id=trace_id,
                )
            )
            await asyncio.sleep(self._step_sleep)

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.experiment,
                status="completed",
                progress=1.0,
                summary="experiment completed",
                trace_id=trace_id,
            )

            results_content = {
                "topicId": topic_id,
                "runId": run_id,
                "metrics": {
                    "accuracy": 0.78,
                    "f1": 0.74,
                },
                "notes": "Temporary failure handled with retry strategy.",
            }
            results_artifact = await self._create_artifact(
                topic_id=topic_id,
                run_id=run_id,
                name="results.json",
                content_type="application/json",
                content=results_content,
            )

            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.experiment,
                    kind=EventKind.artifact_created,
                    severity=Severity.info,
                    summary="experiment produced results.json",
                    payload={
                        "handoffTo": "ideation",
                        "artifactRole": "results",
                        "metrics": {
                            "accuracy": 0.78,
                            "f1": 0.74,
                        },
                    },
                    artifacts=[results_artifact],
                    trace_id=trace_id,
                )
            )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.ideation,
                status="running",
                progress=0.7,
                summary="ideation refining from experiment feedback",
                trace_id=trace_id,
            )
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.ideation,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="refining idea from results",
                    payload={"stage": "feedback"},
                    trace_id=trace_id,
                )
            )
            await asyncio.sleep(self._step_sleep)

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.ideation,
                status="completed",
                progress=1.0,
                summary="ideation feedback loop completed",
                trace_id=trace_id,
            )

            await store.update_run_status(topic_id, run_id, "completed")
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.ideation,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="run completed",
                    payload={"phase": "completed"},
                    trace_id=trace_id,
                )
            )
        except Exception as exc:
            try:
                await store.update_run_status(topic_id, run_id, "failed")
            except Exception:
                return

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.experiment,
                status="failed",
                progress=1.0,
                summary="pipeline failed",
                trace_id=trace_id,
            )
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.experiment,
                    kind=EventKind.event_emitted,
                    severity=Severity.error,
                    summary="pipeline crashed",
                    payload={"error": str(exc)},
                    trace_id=trace_id,
                )
            )


fake_runner = FakePipelineRunner()
