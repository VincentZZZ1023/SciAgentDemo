from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import get_current_user
from app.models.schemas import EventKind, RunApproveRequest, RunApproveResponse, Severity
from app.services.approval_manager import approval_manager
from app.services.event_bus import event_bus
from app.services.runner import build_event
from app.store import store

router = APIRouter(prefix="/api/runs", tags=["approvals"])


@router.post("/{runId}/approve", response_model=RunApproveResponse)
async def approve_run_module(
    runId: str,
    payload: RunApproveRequest,
    _user: str = Depends(get_current_user),
) -> RunApproveResponse:
    run = await store.get_run(runId)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")

    module = payload.module.value
    if run.get("awaitingApproval") and run.get("awaitingModule") != module:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Run is waiting for module '{run.get('awaitingModule')}', not '{module}'",
        )

    resolved = await approval_manager.resolve(
        runId,
        module,
        approved=payload.approved,
        note=payload.note,
    )
    if not resolved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No pending approval for this run/module",
        )

    event_payload = {
        "runId": runId,
        "module": module,
        "approved": payload.approved,
    }
    if payload.note:
        event_payload["note"] = payload.note

    event = build_event(
        topic_id=run["topicId"],
        run_id=runId,
        agent_id=payload.module,
        kind=EventKind.approval_resolved,
        severity=Severity.info if payload.approved else Severity.warn,
        summary=(
            f"{module} approval resolved: approved"
            if payload.approved
            else f"{module} approval resolved: rejected"
        ),
        payload=event_payload,
    )
    await store.add_event(event)
    await event_bus.publish(run["topicId"], event)

    return RunApproveResponse(ok=True)

