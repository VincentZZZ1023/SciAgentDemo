from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import get_current_user
from app.models.schemas import (
    AgentCommandRequest,
    AgentCommandResponse,
    AgentId,
    EventKind,
    Severity,
)
from app.services.event_bus import event_bus
from app.services.runner import build_event, now_ms
from app.store import store

router = APIRouter(prefix="/api/topics", tags=["commands"])


@router.post(
    "/{topicId}/agents/{agentId}/command",
    response_model=AgentCommandResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def command_agent(
    topicId: str,
    agentId: AgentId,
    payload: AgentCommandRequest,
    _user: str = Depends(get_current_user),
) -> AgentCommandResponse:
    topic = await store.get_topic(topicId)
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found")

    run_id = (
        payload.runId
        or topic.get("activeRunId")
        or topic.get("lastRunId")
        or f"run-cmd-{uuid4().hex[:8]}"
    )

    if payload.text:
        summary = f"用户输入: {payload.text}"
        event_payload = {"text": payload.text}
    else:
        summary = f"agent command: {payload.command}"
        event_payload = {
            "command": payload.command,
            "args": payload.args,
        }

    event = build_event(
        topic_id=topicId,
        run_id=run_id,
        agent_id=agentId,
        kind=EventKind.event_emitted,
        severity=Severity.info,
        summary=summary,
        payload=event_payload,
    )

    await store.add_event(event)
    await event_bus.publish(topicId, event)

    return AgentCommandResponse(
        ok=True,
        accepted=True,
        commandId=f"cmd-{uuid4().hex[:8]}",
        topicId=topicId,
        agentId=agentId,
        runId=run_id,
        queuedAt=now_ms(),
    )
