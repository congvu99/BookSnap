from dataclasses import dataclass

from app.db import Database, now_iso


@dataclass(frozen=True)
class Session:
    token_hash: str
    user_id: str
    created_at: str
    last_seen_at: str
    expires_at: str


class SessionRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def create(self, token_hash: str, user_id: str, expires_at: str) -> None:
        now = now_iso()
        await self.db.execute(
            "INSERT INTO sessions(token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?)",
            (token_hash, user_id, now, now, expires_at),
        )

    async def get(self, token_hash: str) -> Session | None:
        row = await self.db.fetchone("SELECT * FROM sessions WHERE token_hash=?", (token_hash,))
        return Session(**dict(row)) if row else None

    async def touch(self, token_hash: str, last_seen_at: str, expires_at: str) -> None:
        await self.db.execute(
            "UPDATE sessions SET last_seen_at=?, expires_at=? WHERE token_hash=?",
            (last_seen_at, expires_at, token_hash),
        )

    async def delete(self, token_hash: str) -> None:
        await self.db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))

    async def delete_for_user(self, user_id: str) -> int:
        return await self.db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))

    async def delete_for_user_except(self, user_id: str, keep_token_hash: str) -> int:
        return await self.db.execute("DELETE FROM sessions WHERE user_id=? AND token_hash!=?", (user_id, keep_token_hash))

    async def delete_expired(self) -> int:
        return await self.db.execute("DELETE FROM sessions WHERE expires_at<=?", (now_iso(),))
