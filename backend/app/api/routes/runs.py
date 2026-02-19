import asyncio

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import get_current_user
from app.models.schemas import RunCreateRequest, RunCreateResponse
from app.services.runner import fake_runner
from app.store import store

router = APIRouter(prefix="/api/topics", tags=["runs"])


@router.post("/{topicId}/runs", response_model=RunCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_run(
    topicId: str,
    payload: RunCreateRequest,
    _user: str = Depends(get_current_user),
) -> RunCreateResponse:
    try:
        run = await store.create_run(
            topicId,
            trigger=payload.trigger,
            initiator=payload.initiator,
            note=payload.note,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found") from exc

    asyncio.create_task(fake_runner.run_pipeline(topicId, run["runId"]))
    return RunCreateResponse(**run)
