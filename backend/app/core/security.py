from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TypedDict
from uuid import uuid4
import time

import bcrypt
from fastapi import Depends, HTTPException, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import select

from app.core.config import get_settings
from app.db import SessionLocal
from app.models.db_models import UserTable
from app.models.schemas import UserRole

ALGORITHM = "HS256"


class UserClaims(TypedDict):
    userId: str
    username: str
    role: str


class AuthenticatedUser(TypedDict):
    id: str
    email: str
    role: str


bearer_scheme = HTTPBearer(auto_error=False)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _normalize_login(login: str) -> str:
    return login.strip().lower()


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def _to_auth_user(row: UserTable) -> AuthenticatedUser:
    return {
        "id": row.id,
        "email": row.email,
        "role": row.role,
    }


def authenticate_user(username: str, password: str) -> AuthenticatedUser | None:
    login = _normalize_login(username)
    if not login or not password:
        return None

    with SessionLocal() as session:
        user = session.exec(select(UserTable).where(UserTable.email == login).limit(1)).first()
        if user is None:
            return None
        if not _verify_password(password, user.password_hash):
            return None
        return _to_auth_user(user)


def register_user(username: str, password: str, role: str = UserRole.user.value) -> AuthenticatedUser:
    login = _normalize_login(username)
    if not login:
        raise ValueError("username or email is required")
    if not password:
        raise ValueError("password is required")
    if len(password) < 4:
        raise ValueError("password must be at least 4 characters")
    if role not in {UserRole.user.value, UserRole.admin.value}:
        raise ValueError("invalid role")

    with SessionLocal() as session:
        existing = session.exec(select(UserTable).where(UserTable.email == login).limit(1)).first()
        if existing is not None:
            raise ValueError("email or username already exists")

        user = UserTable(
            id=f"user-{uuid4().hex[:10]}",
            email=login,
            password_hash=_hash_password(password),
            role=role,
            created_at=_now_ms(),
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return _to_auth_user(user)


def seed_default_users() -> None:
    settings = get_settings()
    seeds: list[tuple[str, str, str]] = []

    if settings.demo_email.strip() and settings.demo_password:
        seeds.append((settings.demo_email, settings.demo_password, UserRole.user.value))
    if settings.admin_email.strip() and settings.admin_password:
        seeds.append((settings.admin_email, settings.admin_password, UserRole.admin.value))

    if not seeds:
        return

    try:
        with SessionLocal() as session:
            changed = False
            for email, password, role in seeds:
                login = _normalize_login(email)
                if not login:
                    continue
                existing = session.exec(select(UserTable).where(UserTable.email == login).limit(1)).first()
                if existing is None:
                    session.add(
                        UserTable(
                            id=f"user-{uuid4().hex[:10]}",
                            email=login,
                            password_hash=_hash_password(password),
                            role=role,
                            created_at=_now_ms(),
                        )
                    )
                    changed = True
                    continue

                if existing.role != role:
                    existing.role = role
                    session.add(existing)
                    changed = True

            if changed:
                session.commit()
    except SQLAlchemyError as exc:
        raise RuntimeError(
            "Failed to seed default users. Ensure DB migrations are up to date: "
            "`cd backend && alembic upgrade head`."
        ) from exc


def create_access_token(
    subject: str,
    role: str,
    *,
    user_id: str | None = None,
    expires_minutes: int | None = None,
) -> str:
    settings = get_settings()
    ttl = expires_minutes or settings.access_token_expire_minutes
    expires_at = datetime.now(tz=timezone.utc) + timedelta(minutes=ttl)
    payload = {
        "sub": subject,
        "role": role,
        "userId": user_id or subject,
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def verify_access_token_claims(token: str) -> UserClaims:
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

    role = payload.get("role")
    if not isinstance(role, str) or role not in {UserRole.user.value, UserRole.admin.value}:
        role = UserRole.user.value

    user_id_raw = payload.get("userId")
    if not isinstance(user_id_raw, str) or not user_id_raw:
        user_id_raw = subject

    return {
        "userId": user_id_raw,
        "username": subject,
        "role": role,
    }


def verify_access_token(token: str) -> str:
    claims = verify_access_token_claims(token)
    return claims["username"]


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    return verify_access_token(credentials.credentials)


async def get_current_user_claims(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> UserClaims:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    return verify_access_token_claims(credentials.credentials)


async def require_admin(claims: UserClaims = Depends(get_current_user_claims)) -> UserClaims:
    if claims["role"] != UserRole.admin.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return claims


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
