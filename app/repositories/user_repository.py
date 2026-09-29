from dataclasses import dataclass

import aiosqlite

from app.db import Database, now_iso
from app.repositories.row_mapping import new_id, row_to


@dataclass(frozen=True)
class User:
    id: str
    username: str
    display_name: str
    password_hash: str
    created_at: str


@dataclass(frozen=True)
class UserStats:
    books_created: int
    pages_captured: int
    books_listening: int
    bookmarks: int


class UsernameTakenError(Exception):
    pass


class UserRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def create(self, username: str, display_name: str, password_hash: str) -> User:
        user = User(new_id(), username.lower(), display_name, password_hash, now_iso())
        try:
            await self.db.execute(
                "INSERT INTO users(id, username, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                (user.id, user.username, user.display_name, user.password_hash, user.created_at),
            )
        except aiosqlite.IntegrityError as exc:
            raise UsernameTakenError(username) from exc
        return user

    async def get(self, user_id: str) -> User | None:
        return row_to(User, await self.db.fetchone("SELECT * FROM users WHERE id=?", (user_id,)))

    async def get_by_username(self, username: str) -> User | None:
        return row_to(User, await self.db.fetchone("SELECT * FROM users WHERE username=?", (username.lower(),)))

    async def update_password_hash(self, user_id: str, password_hash: str) -> None:
        await self.db.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash, user_id))

    async def update_display_name(self, user_id: str, display_name: str) -> None:
        await self.db.execute("UPDATE users SET display_name=? WHERE id=?", (display_name, user_id))

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
