from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.security import get_current_user
from app.models.schemas import TraceItem, TraceResponse
from app.store import store

router = APIRouter(prefix="/api/topics", tags=["trace"])


@router.get(
    "/{topicId}/trace",
    response_model=TraceResponse,
    response_model_exclude_none=True,
)
async def get_topic_trace(
    topicId: str,
    runId: str | None = Query(default=None),
    _user: str = Depends(get_current_user),
) -> TraceResponse:
    try:
        trace = await store.get_trace(topicId, run_id=runId)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return TraceResponse(
        topicId=trace["topicId"],
        runId=trace.get("runId"),
        items=[TraceItem(**item) for item in trace["items"]],
    )
