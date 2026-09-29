from dataclasses import dataclass

from app.db import Database, now_iso
from app.repositories.row_mapping import row_to, rows_to

EXCERPT_CHARS = 160


@dataclass(frozen=True)
class Bookmark:
    user_id: str
    book_id: str
    chunk_seq: int
    created_at: str


@dataclass(frozen=True)
class BookmarkListing:
    book_id: str
    book_title: str
    chunk_seq: int
    created_at: str
    chunk_text: str | None


class BookmarkRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def add(self, user_id: str, book_id: str, chunk_seq: int) -> Bookmark:
        """Idempotent: re-adding keeps the original created_at. One statement, so a concurrent
        DELETE can never slip between the write and the read-back."""
        rows = await self.db.execute_returning(
            "INSERT INTO bookmarks(user_id, book_id, chunk_seq, created_at) VALUES (?,?,?,?)"
            " ON CONFLICT(user_id, book_id, chunk_seq) DO UPDATE SET created_at=bookmarks.created_at"
            " RETURNING *",
            (user_id, book_id, chunk_seq, now_iso()),
        )
        return row_to(Bookmark, rows[0])  # type: ignore[return-value]

    async def remove(self, user_id: str, book_id: str, chunk_seq: int) -> None:
        await self.db.execute(
            "DELETE FROM bookmarks WHERE user_id=? AND book_id=? AND chunk_seq=?", (user_id, book_id, chunk_seq)
        )

    async def seqs_for_book(self, user_id: str, book_id: str) -> list[int]:
        rows = await self.db.fetchall(
            "SELECT chunk_seq FROM bookmarks WHERE user_id=? AND book_id=? ORDER BY chunk_seq", (user_id, book_id)
        )
        return [r["chunk_seq"] for r in rows]

    async def list_for_user(self, user_id: str) -> list[BookmarkListing]:
        """Newest first; chunk_text is NULL when the bookmarked seq no longer has a chunk."""
        rows = await self.db.fetchall(
            "SELECT bm.book_id, b.title AS book_title, bm.chunk_seq, bm.created_at, c.text AS chunk_text"
            " FROM bookmarks bm JOIN books b ON b.id = bm.book_id"
            " LEFT JOIN chunks c ON c.book_id = bm.book_id AND c.seq = bm.chunk_seq"
            " WHERE bm.user_id=? ORDER BY bm.created_at DESC, bm.book_id, bm.chunk_seq",
            (user_id,),
        )
        return rows_to(BookmarkListing, rows)
