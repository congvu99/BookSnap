from dataclasses import dataclass

from app.db import Database, now_iso
from app.repositories.row_mapping import new_id, row_to, rows_to


@dataclass(frozen=True)
class Book:
    id: str
    title: str
    created_by: str
    tts_provider: str
    tts_voice: str
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class BookSummary(Book):
    created_by_name: str
    topic_id: str | None
    topic_name: str | None
    pages_total: int
    pages_done: int
    pages_failed: int
    pages_processing: int
    pages_discarded: int
    pages_min_seq: int | None
    pages_first_failed_seq: int | None
    pages_first_gap_seq: int | None
    next_page_seq: int
    chunks_total: int
    chunks_done: int
    chunks_waiting_quota: int
    chunks_failed: int
    chunks_processing: int
    next_not_before: str | None
    duration_ms: int
    progress_chunk_seq: int | None
    progress_offset_ms: int | None
    progress_updated_at: str | None


_SUMMARY_SQL = """
SELECT b.*, u.display_name AS created_by_name, t.name AS topic_name,
       COALESCE(ps.total, 0) AS pages_total,
       COALESCE(ps.done, 0) AS pages_done,
       COALESCE(ps.failed, 0) AS pages_failed,
       COALESCE(ps.processing, 0) AS pages_processing,
       COALESCE(ps.discarded, 0) AS pages_discarded,
       ps.min_seq AS pages_min_seq,
       ps.first_failed AS pages_first_failed_seq,
       pg.first_gap AS pages_first_gap_seq,
       COALESCE(ps.max_seq + 1, 0) AS next_page_seq,
       COALESCE(cs.total, 0) AS chunks_total,
       COALESCE(cs.done, 0) AS chunks_done,
       COALESCE(cs.waiting, 0) AS chunks_waiting_quota,
       COALESCE(cs.failed, 0) AS chunks_failed,
       COALESCE(cs.processing, 0) AS chunks_processing,
       cs.next_not_before AS next_not_before,
       COALESCE(cs.duration_ms, 0) AS duration_ms,
       pr.chunk_seq AS progress_chunk_seq,
       pr.offset_ms AS progress_offset_ms,
       pr.updated_at AS progress_updated_at
FROM books b
JOIN users u ON u.id = b.created_by
LEFT JOIN topics t ON t.id = b.topic_id
LEFT JOIN (
    SELECT book_id, COUNT(*) AS total,
           SUM(status = 'ocr_done') AS done,
           SUM(status = 'failed') AS failed,
           SUM(status IN ('uploaded', 'ocr_processing')) AS processing,
           SUM(status = 'discarded') AS discarded,
           MIN(CASE WHEN status = 'failed' THEN seq END) AS first_failed,
           MIN(seq) AS min_seq,
           MAX(seq) AS max_seq
    FROM pages GROUP BY book_id
) ps ON ps.book_id = b.id
LEFT JOIN (
    SELECT p.book_id, MIN(p.seq + 1) AS first_gap
    FROM pages p
    WHERE NOT EXISTS (SELECT 1 FROM pages q WHERE q.book_id = p.book_id AND q.seq = p.seq + 1)
      AND p.seq < (SELECT MAX(r.seq) FROM pages r WHERE r.book_id = p.book_id)
    GROUP BY p.book_id
) pg ON pg.book_id = b.id
LEFT JOIN (
    SELECT book_id, COUNT(*) AS total,
           SUM(status = 'done') AS done,
           SUM(status = 'waiting_quota') AS waiting,
           SUM(status = 'failed') AS failed,
           SUM(status IN ('pending', 'processing')) AS processing,
           MIN(CASE WHEN status = 'waiting_quota' THEN not_before END) AS next_not_before,
           SUM(CASE WHEN status = 'done' THEN duration_ms ELSE 0 END) AS duration_ms
    FROM chunks GROUP BY book_id
) cs ON cs.book_id = b.id
LEFT JOIN progress pr ON pr.book_id = b.id AND pr.user_id = ?
"""


class BookRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def create(
        self, title: str, created_by: str, tts_provider: str, tts_voice: str, topic_id: str | None = None
    ) -> Book:
        now = now_iso()
        book = Book(new_id(), title, created_by, tts_provider, tts_voice, now, now)
        await self.db.execute(
            "INSERT INTO books(id, title, created_by, tts_provider, tts_voice, topic_id, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (book.id, book.title, book.created_by, book.tts_provider, book.tts_voice, topic_id, now, now),
        )
        return book

    async def set_topic(self, book_id: str, topic_id: str | None) -> None:
        await self.db.execute("UPDATE books SET topic_id=?, updated_at=? WHERE id=?", (topic_id, now_iso(), book_id))

    async def get(self, book_id: str) -> Book | None:
        return row_to(Book, await self.db.fetchone("SELECT * FROM books WHERE id=?", (book_id,)))

    async def get_summary(self, book_id: str, user_id: str) -> BookSummary | None:
        row = await self.db.fetchone(_SUMMARY_SQL + " WHERE b.id = ?", (user_id, book_id))
        return row_to(BookSummary, row)

    async def list_summaries(self, user_id: str) -> list[BookSummary]:
        rows = await self.db.fetchall(_SUMMARY_SQL + " ORDER BY b.updated_at DESC", (user_id,))
        return rows_to(BookSummary, rows)

    async def list_in_progress_for_user(self, user_id: str, limit: int = 10) -> list[BookSummary]:
        rows = await self.db.fetchall(
            _SUMMARY_SQL + " WHERE pr.user_id IS NOT NULL ORDER BY pr.updated_at DESC LIMIT ?",
            (user_id, limit),
        )
        return rows_to(BookSummary, rows)

    async def update_title(self, book_id: str, title: str) -> None:
        await self.db.execute("UPDATE books SET title=?, updated_at=? WHERE id=?", (title, now_iso(), book_id))

    async def change_voice(self, book_id: str, tts_provider: str, tts_voice: str) -> None:
        """Switch the book's voice and queue every chunk for regeneration in one transaction.

        Existing audio stays on disk until the worker replaces it, so nothing is lost if the
        new provider is unavailable; `audio_url` is only exposed for `done` chunks.
        """
        now = now_iso()
        async with self.db.transaction() as conn:
            await conn.execute(
                "UPDATE books SET tts_provider=?, tts_voice=?, updated_at=? WHERE id=?",
                (tts_provider, tts_voice, now, book_id),
            )
            await conn.execute(
                "UPDATE chunks SET status='pending', not_before=NULL, attempts=0, error=NULL, updated_at=?"
                " WHERE book_id=?",
                (now, book_id),
            )

    async def touch(self, book_id: str) -> None:
        await self.db.execute("UPDATE books SET updated_at=? WHERE id=?", (now_iso(), book_id))

    async def delete(self, book_id: str) -> None:
        await self.db.execute("DELETE FROM books WHERE id=?", (book_id,))
