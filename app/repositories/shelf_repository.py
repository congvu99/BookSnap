"""Per-profile "Kệ của tôi": a profile's own pick of books from the shared library."""

from app.db import Database, now_iso


class ShelfRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def add(self, user_id: str, book_id: str) -> None:
        await self.db.execute(
            "INSERT OR IGNORE INTO shelf_items(user_id, book_id, added_at) VALUES (?,?,?)", (user_id, book_id, now_iso())
        )

    async def remove(self, user_id: str, book_id: str) -> None:
        await self.db.execute("DELETE FROM shelf_items WHERE user_id=? AND book_id=?", (user_id, book_id))
