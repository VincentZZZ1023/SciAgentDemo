import asyncio

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.run_config import get_default_run_config
from app.core.security import get_current_user
from app.models.schemas import RunCreateRequest, RunCreateResponse, RunDetailResponse
from app.services.research_agent_runner import research_agent_runner
from app.store import store

router = APIRouter(tags=["runs"])


@router.post("/api/topics/{topicId}/runs", response_model=RunCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_run(
    topicId: str,
    payload: RunCreateRequest,
    _user: str = Depends(get_current_user),
) -> RunCreateResponse:
    run_config = payload.config or get_default_run_config()

    try:
        run = await store.create_run(
            topicId,
            trigger=payload.trigger,
            initiator=payload.initiator,
            note=payload.note,
            prompt=payload.prompt,
            config=run_config.model_dump(mode="json"),
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found") from exc

    asyncio.create_task(research_agent_runner.run_pipeline(topicId, run["runId"]))
    return RunCreateResponse(**run)


@router.get("/api/runs/{runId}", response_model=RunDetailResponse, response_model_exclude_none=True)
async def get_run(
    runId: str,
    _user: str = Depends(get_current_user),
) -> RunDetailResponse:
    run = await store.get_run(runId)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return RunDetailResponse(**run)
