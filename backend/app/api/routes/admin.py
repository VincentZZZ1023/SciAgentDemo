from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, WebSocket
from fastapi.websockets import WebSocketDisconnect

from app.core.security import extract_ws_token, require_admin, verify_access_token_claims
from app.models.schemas import AdminOverviewResponse, AgentId, EventKind, Severity, UserRole
from app.services.event_bus import event_bus
from app.services.admin_metrics import build_admin_overview_snapshot
from app.services.runner import build_event

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/overview", response_model=AdminOverviewResponse)
async def admin_overview(_admin: dict[str, str] = Depends(require_admin)) -> AdminOverviewResponse:
    return build_admin_overview_snapshot()


@router.websocket("/ws")
async def admin_ws(websocket: WebSocket, token: str | None = None) -> None:
    ws_token = token or extract_ws_token(websocket)
    if not ws_token:
        await websocket.close(code=4401, reason="Missing token")
        return

    try:
        claims = verify_access_token_claims(ws_token)
    except Exception:
        await websocket.close(code=4401, reason="Invalid token")
        return

    if claims["role"] != UserRole.admin.value:
        await websocket.close(code=4403, reason="Admin access required")
        return

    channel = "admin-overview"
    await event_bus.connect(channel, websocket)
    push_interval_seconds = 1.5

    try:
        while True:
            snapshot = build_admin_overview_snapshot()
            metrics_event = build_event(
                topic_id=channel,
                run_id=f"admin-{snapshot.ts}",
                agent_id=AgentId.review,
                kind=EventKind.admin_metrics,
                severity=Severity.info,
                summary="admin metrics snapshot",
                payload=snapshot.model_dump(mode="json"),
            )
            await event_bus.send_personal(websocket, metrics_event)
            await asyncio.sleep(push_interval_seconds)
    except WebSocketDisconnect:
        pass
    except Exception:
        # Connection closed / send failed / server shutdown.
        pass
    finally:
        await event_bus.disconnect(channel, websocket)
