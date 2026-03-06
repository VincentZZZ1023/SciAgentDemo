from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import get_current_user
from app.models.schemas import EventKind, RunApproveRequest, RunApproveResponse, Severity
from app.services.approval_manager import approval_manager
from app.services.event_bus import event_bus
from app.services.runner import build_event
from app.store import now_ms, store

router = APIRouter(prefix="/api/runs", tags=["approvals"])


@router.post("/{runId}/approve", response_model=RunApproveResponse)
async def approve_run_module(
    runId: str,
    payload: RunApproveRequest,
    _user: str = Depends(get_current_user),
) -> RunApproveResponse:
    async def emit_noop_warn(*, reason: str, detail: str, run_payload: dict) -> None:
        warn_event = build_event(
            topic_id=run_payload["topicId"],
            run_id=runId,
            agent_id=payload.module,
            kind=EventKind.event_emitted,
            severity=Severity.warn,
            summary=f"approval ignored: {reason}",
            payload={
                "runId": runId,
                "module": payload.module.value,
                "approved": payload.approved,
                "reason": reason,
                "detail": detail,
            },
        )
        await store.add_event(warn_event)
        await event_bus.publish(run_payload["topicId"], warn_event)

    run = await store.get_run(runId)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")

    module = payload.module.value
    awaiting_approval = bool(run.get("awaitingApproval"))
    awaiting_module = run.get("awaitingModule")

    if awaiting_approval and awaiting_module != module:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Run is waiting for module '{awaiting_module}', not '{module}'",
        )

    if not awaiting_approval:
        already_resolved = run.get("approvalResolvedAt") is not None
        detail = "Run is not awaiting approval"
        await emit_noop_warn(
            reason="run_not_awaiting_approval",
            detail=detail,
            run_payload=run,
        )
        return RunApproveResponse(
            ok=True,
            noOp=True,
            alreadyResolved=already_resolved,
            detail=detail,
        )

    resolved = await approval_manager.resolve(
        runId,
        module,
        approved=payload.approved,
        note=payload.note,
    )
    if not resolved:
        latest_run = await store.get_run(runId)
        already_resolved = bool(
            latest_run is not None
            and not latest_run.get("awaitingApproval")
            and latest_run.get("approvalResolvedAt") is not None
        )
        detail = "Approval already resolved"
        await emit_noop_warn(
            reason="approval_already_resolved",
            detail=detail,
            run_payload=latest_run or run,
        )
        return RunApproveResponse(
            ok=True,
            noOp=True,
            alreadyResolved=already_resolved or True,
            detail=detail,
        )

    await store.update_run_runtime(
        runId,
        topic_id=run["topicId"],
        status="running",
        current_module=module,
        awaiting_approval=False,
        awaiting_module=None,
        approval_resolved_at=now_ms(),
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

    return RunApproveResponse(
        ok=True,
        noOp=False,
        alreadyResolved=False,
        detail="Approval resolved",
    )
