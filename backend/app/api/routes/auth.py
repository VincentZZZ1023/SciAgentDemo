from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import get_settings
from app.core.security import authenticate_user, create_access_token, get_current_user_claims, register_user
from app.models.schemas import AuthMeResponse, AuthTokenResponse, AuthUser, LoginRequest, RegisterRequest, UserRole

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _build_auth_response(*, user: dict[str, str]) -> AuthTokenResponse:
    settings = get_settings()
    expires_in = settings.access_token_expire_minutes * 60
    token = create_access_token(subject=user["email"], role=user["role"], user_id=user["id"])
    auth_user = AuthUser(id=user["id"], email=user["email"], role=UserRole(user["role"]))
    return AuthTokenResponse(
        token=token,
        user=auth_user,
        access_token=token,
        token_type="bearer",
        expires_in=expires_in,
        role=auth_user.role,
    )


@router.post("/login", response_model=AuthTokenResponse)
async def login(payload: LoginRequest) -> AuthTokenResponse:
    user = authenticate_user(payload.username or "", payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username/email or password",
        )

    return _build_auth_response(user=user)


@router.post("/register", response_model=AuthTokenResponse)
async def register(payload: RegisterRequest) -> AuthTokenResponse:
    try:
        user = register_user(payload.username or payload.email or "", payload.password, role=UserRole.user.value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return _build_auth_response(user=user)


@router.get("/me", response_model=AuthMeResponse)
async def me(current_user: dict[str, str] = Depends(get_current_user_claims)) -> AuthMeResponse:
    username = current_user["username"]
    return AuthMeResponse(
        id=current_user["userId"],
        email=username,
        username=username,
        role=UserRole(current_user["role"]),
    )
