"""The family account: the single login that owns every profile (`users` rows)."""

from dataclasses import dataclass

import aiosqlite

from app.db import Database, now_iso
from app.repositories.row_mapping import new_id, row_to


@dataclass(frozen=True)
class Account:
    id: str
    username: str
    password_hash: str
    created_at: str


class AccountRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def any_exists(self, conn: aiosqlite.Connection | None = None) -> bool:
        sql = "SELECT EXISTS(SELECT 1 FROM accounts)"
        if conn is None:
            row = await self.db.fetchone(sql)
        else:
            async with conn.execute(sql) as cur:
                row = await cur.fetchone()
        return bool(row and row[0])

    async def create(self, conn: aiosqlite.Connection, username: str, password_hash: str) -> Account:
        """Insert inside the caller's transaction (registration creates account + profile + session together)."""
        account = Account(new_id(), username.lower(), password_hash, now_iso())
        await conn.execute(
            "INSERT INTO accounts(id, username, password_hash, created_at) VALUES (?,?,?,?)",
            (account.id, account.username, account.password_hash, account.created_at),
        )
        return account

    async def get(self, account_id: str) -> Account | None:
        return row_to(Account, await self.db.fetchone("SELECT * FROM accounts WHERE id=?", (account_id,)))

    async def get_by_username(self, username: str) -> Account | None:
        return row_to(Account, await self.db.fetchone("SELECT * FROM accounts WHERE username=?", (username.lower(),)))

    async def update_password_hash(self, account_id: str, password_hash: str) -> None:
        await self.db.execute("UPDATE accounts SET password_hash=? WHERE id=?", (password_hash, account_id))
