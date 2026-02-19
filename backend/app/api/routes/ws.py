from fastapi import APIRouter, Query, WebSocket, status
from fastapi.websockets import WebSocketDisconnect

from app.core.security import extract_ws_token, verify_access_token
from app.models.schemas import AgentId, EventKind, Severity
from app.services.event_bus import event_bus
from app.services.runner import build_event
from app.store import store

router = APIRouter(tags=["ws"])


@router.websocket("/api/ws")
async def topic_ws(
    websocket: WebSocket,
    topicId: str = Query(..., min_length=1),
    token: str | None = Query(default=None),
) -> None:
    topic = await store.get_topic(topicId)
    if topic is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Unknown topicId")
        return

    ws_token = token or extract_ws_token(websocket)
    if not ws_token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Missing token")
        return

    try:
        user = verify_access_token(ws_token)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
        return

    await event_bus.connect(topicId, websocket)

    connected_event = build_event(
        topic_id=topicId,
        run_id=topic.get("activeRunId") or topic.get("lastRunId") or "run-ws-session",
        agent_id=AgentId.review,
        kind=EventKind.event_emitted,
        severity=Severity.info,
        summary="connected",
        payload={"type": "connected", "user": user},
    )

    try:
        await event_bus.send_personal(websocket, connected_event)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await event_bus.disconnect(topicId, websocket)
