from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import get_current_user
from app.models.schemas import (
    AgentId,
    EventKind,
    Message,
    MessageCreateRequest,
    MessageListResponse,
    MessageRole,
    Severity,
)
from app.services.event_bus import event_bus
from app.services.runner import build_event
from app.store import store

router = APIRouter(prefix="/api/topics", tags=["messages"])


async def _emit_message_created_event(
    *,
    topic_id: str,
    agent_id: AgentId,
    message: dict,
    fallback_run_id: str | None,
) -> None:
    run_id = message.get("runId") or fallback_run_id or "run-chat-session"

    event = build_event(
        topic_id=topic_id,
        run_id=run_id,
        agent_id=agent_id,
        kind=EventKind.message_created,
        severity=Severity.info,
        summary=f"message created ({message['role']})",
        payload={"message": message},
    )
    await store.add_event(event)
    await event_bus.publish(topic_id, event)


@router.get(
    "/{topicId}/agents/{agentId}/messages",
    response_model=MessageListResponse,
    response_model_exclude_none=True,
)
async def list_messages(
    topicId: str,
    agentId: AgentId,
    _user: str = Depends(get_current_user),
) -> MessageListResponse:
    try:
        messages = await store.list_messages(topicId, agentId)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found") from exc

    return MessageListResponse(messages=[Message(**item) for item in messages])


@router.post(
    "/{topicId}/agents/{agentId}/messages",
    response_model=MessageListResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_messages(
    topicId: str,
    agentId: AgentId,
    payload: MessageCreateRequest,
    _user: str = Depends(get_current_user),
) -> MessageListResponse:
    topic = await store.get_topic(topicId)
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found")

    run_id = topic.get("activeRunId") or topic.get("lastRunId")

    user_message = await store.create_message(
        topic_id=topicId,
        agent_id=agentId,
        role=MessageRole.user,
        content=payload.content,
        run_id=run_id,
    )
    assistant_message = await store.create_message(
        topic_id=topicId,
        agent_id=agentId,
        role=MessageRole.assistant,
        content=f"Echo: {payload.content}",
        run_id=run_id,
    )

    await _emit_message_created_event(
        topic_id=topicId,
        agent_id=agentId,
        message=user_message,
        fallback_run_id=run_id,
    )
    await _emit_message_created_event(
        topic_id=topicId,
        agent_id=agentId,
        message=assistant_message,
        fallback_run_id=run_id,
    )

    return MessageListResponse(
        messages=[Message(**user_message), Message(**assistant_message)]
    )
