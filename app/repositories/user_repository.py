from dataclasses import dataclass

import aiosqlite

from app.db import Database, now_iso
from app.repositories.row_mapping import new_id, row_to, rows_to


@dataclass(frozen=True)
class User:
    """A profile inside the family account; `users.id` is what every user_id column refers to."""

    id: str
    account_id: str
    display_name: str
    avatar: str
    created_at: str


@dataclass(frozen=True)
class UserStats:
    books_created: int
    pages_captured: int
    books_listening: int
    bookmarks: int


class UserRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def create(self, conn: aiosqlite.Connection, account_id: str, display_name: str, avatar: str) -> User:
        """Insert inside the caller's transaction."""
        user = User(new_id(), account_id, display_name, avatar, now_iso())
        await conn.execute(
            "INSERT INTO users(id, account_id, display_name, avatar, created_at) VALUES (?,?,?,?,?)",
            (user.id, user.account_id, user.display_name, user.avatar, user.created_at),
        )
        return user

    async def add_to_account(self, account_id: str, display_name: str, avatar: str | None, max_profiles: int) -> User | None:
        """Create a profile unless the account already has `max_profiles`; None when full.

        Without an explicit avatar, colours rotate through c1..c8 in creation order.
        """
        async with self.db.transaction() as conn:
            async with conn.execute("SELECT COUNT(*) FROM users WHERE account_id=?", (account_id,)) as cur:
                count = (await cur.fetchone())[0]  # type: ignore[index]
            if count >= max_profiles:
                return None
            return await self.create(conn, account_id, display_name, avatar or f"c{count % 8 + 1}")

    async def get(self, user_id: str) -> User | None:
        return row_to(User, await self.db.fetchone("SELECT * FROM users WHERE id=?", (user_id,)))

    async def list_for_account(self, account_id: str) -> list[User]:
        # created_at has 1-second resolution; rowid breaks ties in insertion (= creation) order.
        rows = await self.db.fetchall("SELECT * FROM users WHERE account_id=? ORDER BY created_at, rowid", (account_id,))
        return rows_to(User, rows)

    async def update_display_name(self, user_id: str, display_name: str) -> None:
        await self.db.execute("UPDATE users SET display_name=? WHERE id=?", (display_name, user_id))

    async def update_in_account(self, account_id: str, user_id: str, display_name: str | None, avatar: str | None) -> User | None:
        """Rename/recolour a profile of this account; None when it isn't one."""
        await self.db.execute(
            "UPDATE users SET display_name=COALESCE(:name, display_name), avatar=COALESCE(:avatar, avatar)"
            " WHERE id=:id AND account_id=:account",
            {"name": display_name, "avatar": avatar, "id": user_id, "account": account_id},
        )
        user = await self.get(user_id)
        return user if user is not None and user.account_id == account_id else None

    async def delete_with_heir(self, account_id: str, user_id: str) -> tuple[str, int] | None:
        """Delete a profile, first handing its books and topics to the oldest remaining profile.

        Progress, bookmarks and shelf go with it (ON DELETE CASCADE); sessions on it fall back to
        "no profile picked" (ON DELETE SET NULL). Returns (heir_id, books_reassigned), or None when
        the profile isn't in this account or is the last one.
        """
        async with self.db.transaction() as conn:
            async with conn.execute(
                "SELECT id FROM users WHERE account_id=? ORDER BY created_at, rowid", (account_id,)
            ) as cur:
                ids = [row[0] for row in await cur.fetchall()]
            if user_id not in ids or len(ids) < 2:
                return None
            heir_id = next(i for i in ids if i != user_id)
            async with conn.execute("UPDATE books SET created_by=? WHERE created_by=?", (heir_id, user_id)) as cur:
                books_reassigned = cur.rowcount
            await conn.execute("UPDATE topics SET created_by=? WHERE created_by=?", (heir_id, user_id))
            await conn.execute("DELETE FROM users WHERE id=?", (user_id,))
            return heir_id, books_reassigned

    async def stats(self, user_id: str) -> UserStats:
        row = await self.db.fetchone(
            "SELECT (SELECT COUNT(*) FROM books WHERE created_by=:u) AS books_created,"
            " (SELECT COUNT(*) FROM pages p JOIN books b ON b.id = p.book_id"
            "   WHERE b.created_by=:u AND p.status != 'discarded') AS pages_captured,"
            " (SELECT COUNT(*) FROM progress WHERE user_id=:u) AS books_listening,"
            " (SELECT COUNT(*) FROM bookmarks WHERE user_id=:u) AS bookmarks",
            {"u": user_id},
        )
        assert row is not None
        return UserStats(**dict(row))
