from dataclasses import dataclass

import aiosqlite

from app.db import Database, now_iso
from app.repositories.row_mapping import row_to


@dataclass(frozen=True)
class Session:
    token_hash: str
    account_id: str
    user_id: str | None  # selected profile; None until the device picks one
    created_at: str
    last_seen_at: str
    expires_at: str


class SessionRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def create(
        self, token_hash: str, account_id: str, user_id: str | None, expires_at: str, conn: aiosqlite.Connection | None = None
    ) -> None:
        """Pass `conn` to insert inside the caller's transaction."""
        now = now_iso()
        sql = "INSERT INTO sessions(token_hash, account_id, user_id, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?)"
        params = (token_hash, account_id, user_id, now, now, expires_at)
        if conn is None:
            await self.db.execute(sql, params)
        else:
            await conn.execute(sql, params)

    async def get(self, token_hash: str) -> Session | None:
        return row_to(Session, await self.db.fetchone("SELECT * FROM sessions WHERE token_hash=?", (token_hash,)))

    async def touch(self, token_hash: str, last_seen_at: str, expires_at: str) -> None:
        await self.db.execute(
            "UPDATE sessions SET last_seen_at=?, expires_at=? WHERE token_hash=?",
            (last_seen_at, expires_at, token_hash),
        )

    async def delete(self, token_hash: str) -> None:
        await self.db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))

    async def select_profile(self, token_hash: str, account_id: str, user_id: str) -> bool:
        """Point the session at a profile of its own account, in one statement so a concurrent
        profile delete can't leave it pointing at a missing row. False when no such profile."""
        changed = await self.db.execute(
            "UPDATE sessions SET user_id=:u WHERE token_hash=:t"
            " AND EXISTS(SELECT 1 FROM users WHERE id=:u AND account_id=:a)",
            {"u": user_id, "t": token_hash, "a": account_id},
        )
        return changed == 1

    async def delete_for_account(self, account_id: str) -> int:
        return await self.db.execute("DELETE FROM sessions WHERE account_id=?", (account_id,))

    async def delete_for_account_except(self, account_id: str, keep_token_hash: str) -> int:
        return await self.db.execute("DELETE FROM sessions WHERE account_id=? AND token_hash!=?", (account_id, keep_token_hash))

    async def delete_expired(self) -> int:
        return await self.db.execute("DELETE FROM sessions WHERE expires_at<=?", (now_iso(),))
