from fastapi import APIRouter, Depends

from app.core.run_config import get_default_run_config
from app.core.security import get_current_user
from app.models.schemas import RunConfig

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("/default", response_model=RunConfig, response_model_exclude_none=True)
async def get_default_config(_user: str = Depends(get_current_user)) -> RunConfig:
    return get_default_run_config()

