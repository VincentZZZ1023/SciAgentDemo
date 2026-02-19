from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import get_settings
from app.core.security import authenticate_user, create_access_token, get_current_user
from app.models.schemas import AuthMeResponse, LoginRequest, LoginResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest) -> LoginResponse:
    user = authenticate_user(payload.username, payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    settings = get_settings()
    expires_in = settings.access_token_expire_minutes * 60
    token = create_access_token(subject=user["username"])
    return LoginResponse(access_token=token, token_type="bearer", expires_in=expires_in)


@router.get("/me", response_model=AuthMeResponse)
async def me(current_user: str = Depends(get_current_user)) -> AuthMeResponse:
    return AuthMeResponse(username=current_user)
