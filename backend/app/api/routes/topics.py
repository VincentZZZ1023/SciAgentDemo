from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse

from app.core.security import get_current_user
from app.models.schemas import (
    AgentSnapshot,
    ArtifactRef,
    Event,
    SnapshotResponse,
    TopicCreateRequest,
    TopicDetail,
    TopicListResponse,
    TopicSummary,
)
from app.store import store

router = APIRouter(prefix="/api/topics", tags=["topics"])


@router.get("", response_model=TopicListResponse)
async def list_topics(_user: str = Depends(get_current_user)) -> TopicListResponse:
    topics = await store.list_topics()
    items = [TopicSummary(**topic) for topic in topics]
    return TopicListResponse(items=items, total=len(items))


@router.post("", response_model=TopicDetail, status_code=status.HTTP_201_CREATED)
async def create_topic(
    payload: TopicCreateRequest,
    _user: str = Depends(get_current_user),
) -> TopicDetail:
    topic = await store.create_topic(
        title=payload.resolved_title,
        description=payload.description,
        objective=payload.objective,
        tags=payload.tags,
    )
    return TopicDetail(**topic)


@router.delete("/{topicId}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_topic(topicId: str, _user: str = Depends(get_current_user)) -> None:
    try:
        await store.delete_topic(topicId)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found") from exc


@router.get("/{topicId}/artifacts/{name}")
async def get_artifact_content(
    topicId: str,
    name: str,
    artifactId: str | None = Query(default=None),
    _user: str = Depends(get_current_user),
) -> FileResponse:
    try:
        artifact = await store.get_artifact_file(topicId, name, artifact_id=artifactId)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found") from exc

    return FileResponse(
        path=Path(artifact["path"]),
        media_type=artifact["contentType"],
        filename=artifact["name"],
    )


@router.get(
    "/{topicId}/snapshot",
    response_model=SnapshotResponse,
    response_model_exclude_none=True,
)
async def get_snapshot(
    topicId: str,
    limit: int = Query(default=50, ge=1, le=500),
    _user: str = Depends(get_current_user),
) -> SnapshotResponse:
    try:
        snapshot = await store.get_snapshot(topicId, limit=limit)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found") from exc

    return SnapshotResponse(
        topic=TopicDetail(**snapshot["topic"]),
        agents=[AgentSnapshot(**item) for item in snapshot["agents"]],
        events=[Event(**item) for item in snapshot["events"]],
        artifacts=[ArtifactRef(**item) for item in snapshot["artifacts"]],
    )
