from fastapi import APIRouter, Depends, WebSocket, status
from fastapi.websockets import WebSocketDisconnect

from app.core.security import extract_ws_token, require_admin, verify_access_token_claims
from app.models.schemas import AdminOverviewResponse, AgentId, EventKind, Severity, UserRole
from app.services.event_bus import event_bus
from app.services.runner import build_event, now_ms

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _build_overview_snapshot() -> AdminOverviewResponse:
    return AdminOverviewResponse(
        ts=now_ms(),
        activeRuns=0,
        runsLast5m=0,
        eventsLast5m=0,
        moduleInFlight={
            AgentId.review.value: 0,
            AgentId.ideation.value: 0,
            AgentId.experiment.value: 0,
        },
        approvalsPending=0,
        errorRateLast5m=0.0,
    )


@router.get("/overview", response_model=AdminOverviewResponse)
async def admin_overview(_admin: dict[str, str] = Depends(require_admin)) -> AdminOverviewResponse:
    # Placeholder snapshot. T4 will wire real metrics aggregation.
    return _build_overview_snapshot()


@router.websocket("/ws")
async def admin_ws(websocket: WebSocket, token: str | None = None) -> None:
    ws_token = token or extract_ws_token(websocket)
    if not ws_token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Missing token")
        return

    try:
        claims = verify_access_token_claims(ws_token)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
        return

    if claims["role"] != UserRole.admin.value:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Admin access required")
        return

    channel = "admin-overview"
    await event_bus.connect(channel, websocket)

    snapshot = _build_overview_snapshot()
    metrics_event = build_event(
        topic_id=channel,
        run_id="admin-0000",
        agent_id=AgentId.review,
        kind=EventKind.admin_metrics,
        severity=Severity.info,
        summary="admin metrics snapshot",
        payload=snapshot.model_dump(mode="json"),
    )

    try:
        await event_bus.send_personal(websocket, metrics_event)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await event_bus.disconnect(channel, websocket)

