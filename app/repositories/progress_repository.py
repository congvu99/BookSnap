from dataclasses import dataclass

from app.db import Database, now_iso
from app.repositories.row_mapping import row_to


@dataclass(frozen=True)
class Progress:
    user_id: str
    book_id: str
    chunk_seq: int
    offset_ms: int
    updated_at: str


class ProgressRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def get(self, user_id: str, book_id: str) -> Progress | None:
        return row_to(
            Progress,
            await self.db.fetchone("SELECT * FROM progress WHERE user_id=? AND book_id=?", (user_id, book_id)),
        )

    async def upsert(self, user_id: str, book_id: str, chunk_seq: int, offset_ms: int) -> Progress:
        now = now_iso()
        await self.db.execute(
            "INSERT INTO progress(user_id, book_id, chunk_seq, offset_ms, updated_at) VALUES (?,?,?,?,?)"
            " ON CONFLICT(user_id, book_id) DO UPDATE SET chunk_seq=excluded.chunk_seq,"
            " offset_ms=excluded.offset_ms, updated_at=excluded.updated_at",
            (user_id, book_id, chunk_seq, offset_ms, now),
        )
        return Progress(user_id, book_id, chunk_seq, offset_ms, now)
