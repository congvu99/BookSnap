from dataclasses import dataclass

import aiosqlite

from app.db import Database, now_iso
from app.repositories.row_mapping import new_id, row_to, rows_to

PAGE_STATUSES = ("uploaded", "ocr_processing", "ocr_done", "failed", "discarded")


@dataclass(frozen=True)
class Page:
    id: str
    book_id: str
    seq: int
    status: str
    image_path: str | None
    image_mime: str | None
    client_upload_id: str | None
    text: str | None
    continues: int
    chunked: int
    attempts: int
    error: str | None
    created_at: str
    updated_at: str


class PageSeqConflictError(Exception):
    def __init__(self, existing: Page | None) -> None:
        super().__init__("page seq already used")
        self.existing = existing


class PageRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def create(
        self, book_id: str, seq: int, image_path: str, image_mime: str, client_upload_id: str | None, page_id: str | None = None
    ) -> Page:
        now = now_iso()
        page_id = page_id or new_id()
        try:
            await self.db.execute(
                "INSERT INTO pages(id, book_id, seq, status, image_path, image_mime, client_upload_id, created_at, updated_at)"
                " VALUES (?,?,?,'uploaded',?,?,?,?,?)",
                (page_id, book_id, seq, image_path, image_mime, client_upload_id, now, now),
            )
        except aiosqlite.IntegrityError as exc:
            raise PageSeqConflictError(await self.get_by_seq(book_id, seq)) from exc
        page = await self.get(page_id)
        assert page is not None
        return page

    async def get(self, page_id: str) -> Page | None:
        return row_to(Page, await self.db.fetchone("SELECT * FROM pages WHERE id=?", (page_id,)))

    async def get_by_seq(self, book_id: str, seq: int) -> Page | None:
        return row_to(Page, await self.db.fetchone("SELECT * FROM pages WHERE book_id=? AND seq=?", (book_id, seq)))

    async def list_for_book(self, book_id: str) -> list[Page]:
        return rows_to(Page, await self.db.fetchall("SELECT * FROM pages WHERE book_id=? ORDER BY seq", (book_id,)))

    async def image_paths_for_book(self, book_id: str) -> list[str]:
        rows = await self.db.fetchall(
            "SELECT image_path FROM pages WHERE book_id=? AND image_path IS NOT NULL", (book_id,)
        )
        return [r["image_path"] for r in rows]

    async def discard(self, book_id: str, seq: int) -> Page | None:
        """Mark a failed page discarded, or fill a missing seq with a discarded placeholder.

        A missing seq may be anything up to the book's next seq: the upload queue discards a
        failed page before any later page reached the server. Returns None when not discardable."""
        now = now_iso()
        async with self.db.transaction() as conn:
            async with conn.execute("SELECT * FROM pages WHERE book_id=? AND seq=?", (book_id, seq)) as cur:
                existing = await cur.fetchone()
            if existing is not None:
                if existing["status"] not in ("failed", "discarded"):
                    return None
                await conn.execute(
                    "UPDATE pages SET status='discarded', image_path=NULL, image_mime=NULL, updated_at=? WHERE id=?",
                    (now, existing["id"]),
                )
                page_id = existing["id"]
            else:
                async with conn.execute("SELECT MAX(seq) AS m FROM pages WHERE book_id=?", (book_id,)) as cur:
                    row = await cur.fetchone()
                next_seq = -1 if row["m"] is None else row["m"]
                if seq > next_seq + 1:
                    return None
                page_id = new_id()
                await conn.execute(
                    "INSERT INTO pages(id, book_id, seq, status, created_at, updated_at) VALUES (?,?,?,'discarded',?,?)",
                    (page_id, book_id, seq, now, now),
                )
        return await self.get(page_id)

    async def reset_for_retry(self, page_id: str) -> bool:
        """failed → uploaded, only when the source image is still on disk."""
        changed = await self.db.execute(
            "UPDATE pages SET status='uploaded', attempts=0, error=NULL, updated_at=?"
            " WHERE id=? AND status='failed' AND image_path IS NOT NULL",
            (now_iso(), page_id),
        )
        return changed == 1

    # --- worker: OCR pipeline -------------------------------------------------

    async def claim_next_uploaded(self) -> Page | None:
        """Atomically pick the oldest `uploaded` page and move it to `ocr_processing`."""
        rows = await self.db.execute_returning(
            "UPDATE pages SET status='ocr_processing', updated_at=?"
            " WHERE id=(SELECT id FROM pages WHERE status='uploaded' ORDER BY created_at LIMIT 1)"
            " AND status='uploaded' RETURNING *",
            (now_iso(),),
        )
        return row_to(Page, rows[0]) if rows else None

    async def mark_ocr_done(self, page_id: str, text: str, continues: bool) -> bool:
        """Save OCR output and drop the (now unneeded) source image path — D4."""
        changed = await self.db.execute(
            "UPDATE pages SET status='ocr_done', text=?, continues=?, image_path=NULL, image_mime=NULL,"
            " error=NULL, updated_at=? WHERE id=? AND status='ocr_processing'",
            (text, int(continues), now_iso(), page_id),
        )
        return changed == 1

    async def mark_failed(self, page_id: str, error: str) -> bool:
        changed = await self.db.execute(
            "UPDATE pages SET status='failed', error=?, attempts=attempts+1, updated_at=?"
            " WHERE id=? AND status='ocr_processing'",
            (error, now_iso(), page_id),
        )
        return changed == 1

    async def resume_processing(self) -> int:
        """Startup resume: any page a crashed worker left `ocr_processing` goes back to `uploaded`."""
        return await self.db.execute("UPDATE pages SET status='uploaded', updated_at=? WHERE status='ocr_processing'", (now_iso(),))

    # --- worker: chunker -------------------------------------------------------

    async def list_unchunked(self) -> list[Page]:
        """Pages whose text has not been folded into `chunks` yet, across all books."""
        return rows_to(Page, await self.db.fetchall("SELECT * FROM pages WHERE chunked=0 ORDER BY book_id, seq"))

    async def mark_chunked(self, page_ids: list[str]) -> None:
        if not page_ids:
            return
        now = now_iso()
        await self.db.executemany(
            "UPDATE pages SET chunked=1, updated_at=? WHERE id=?", [(now, pid) for pid in page_ids]
        )

    # --- worker: cleanup ---------------------------------------------------------

    async def list_failed_with_expired_image(self, cutoff_iso: str) -> list[Page]:
        return rows_to(
            Page,
            await self.db.fetchall(
                "SELECT * FROM pages WHERE status='failed' AND image_path IS NOT NULL AND updated_at <= ?",
                (cutoff_iso,),
            ),
        )

    async def clear_image(self, page_id: str) -> None:
        await self.db.execute(
            "UPDATE pages SET image_path=NULL, image_mime=NULL, updated_at=? WHERE id=?", (now_iso(), page_id)
        )

    async def all_image_paths(self) -> list[str]:
        rows = await self.db.fetchall("SELECT image_path FROM pages WHERE image_path IS NOT NULL")
        return [r["image_path"] for r in rows]
