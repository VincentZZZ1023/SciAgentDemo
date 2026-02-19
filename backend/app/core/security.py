from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.core.config import get_settings

ALGORITHM = "HS256"
DEMO_USER = {"username": "demo", "password": "demo"}

bearer_scheme = HTTPBearer(auto_error=False)


def authenticate_user(username: str, password: str) -> dict[str, str] | None:
    if username == DEMO_USER["username"] and password == DEMO_USER["password"]:
        return {"username": username}
    return None


def create_access_token(subject: str, expires_minutes: int | None = None) -> str:
    settings = get_settings()
    ttl = expires_minutes or settings.access_token_expire_minutes
    expires_at = datetime.now(tz=timezone.utc) + timedelta(minutes=ttl)
    payload = {
        "sub": subject,
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def verify_access_token(token: str) -> str:
    settings = get_settings()
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise unauthorized from exc

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise unauthorized
    return subject


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    return verify_access_token(credentials.credentials)


def extract_ws_token(websocket: WebSocket) -> str | None:
    token = websocket.query_params.get("token")
    if token:
        return token

    authorization = websocket.headers.get("authorization", "")
    if not authorization:
        return None

    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value


def verify_ws_token(websocket: WebSocket) -> str | None:
    token = extract_ws_token(websocket)
    if not token:
        return None

    try:
        return verify_access_token(token)
    except HTTPException:
        return None
