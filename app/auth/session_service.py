"""Opaque session tokens: 32 random bytes in the cookie, only their SHA-256 in the DB."""

import hashlib
import secrets
from datetime import timedelta

from fastapi import Response

from app.config import Settings
from app.db import now_iso, now_utc, parse_iso, to_iso
from app.repositories.session_repository import SessionRepository
from app.repositories.user_repository import User, UserRepository

COOKIE_NAME = "booksnap_session"
_TOUCH_INTERVAL = timedelta(days=1)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class SessionService:
    def __init__(self, sessions: SessionRepository, users: UserRepository, settings: Settings) -> None:
        self.sessions = sessions
        self.users = users
        self.settings = settings
        self.ttl = timedelta(days=settings.session_ttl_days)

    async def create(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        await self.sessions.create(hash_token(token), user_id, now_iso(self.ttl))
        return token

    async def resolve(self, token: str | None) -> User | None:
        if not token:
            return None
        token_hash = hash_token(token)
        session = await self.sessions.get(token_hash)
        if session is None:
            return None
        now = now_utc()
        if parse_iso(session.expires_at) <= now:
            await self.sessions.delete(token_hash)
            return None
        if now - parse_iso(session.last_seen_at) > _TOUCH_INTERVAL:
            await self.sessions.touch(token_hash, to_iso(now), to_iso(now + self.ttl))
        return await self.users.get(session.user_id)

    async def revoke(self, token: str | None) -> None:
        if token:
            await self.sessions.delete(hash_token(token))

    def set_cookie(self, response: Response, token: str) -> None:
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=int(self.ttl.total_seconds()),
            httponly=True,
            secure=self.settings.cookie_secure,
            samesite="lax",
            path="/",
        )

    def clear_cookie(self, response: Response) -> None:
        response.delete_cookie(COOKIE_NAME, path="/", secure=self.settings.cookie_secure, httponly=True, samesite="lax")
