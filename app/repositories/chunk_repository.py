from dataclasses import dataclass

from app.db import Database, now_iso
from app.repositories.row_mapping import new_id, row_to, rows_to

CHUNK_STATUSES = ("pending", "processing", "waiting_quota", "done", "failed")

_STILL_ON_CHUNK_PROVIDER = "chunks.provider IS (SELECT tts_provider FROM books WHERE books.id = chunks.book_id)"


class TailBusyError(Exception):
    """The unsealed tail chunk changed between our read and our write: claimed by the TTS
    worker, sealed by a user (seal-tail), or sealed by a manual text edit.

    The chunker should simply skip this tick for this book and try again later.
    """


@dataclass(frozen=True)
class Chunk:
    id: str
    book_id: str
    seq: int
    text: str
    content_hash: str | None
    status: str
    not_before: str | None
    provider: str | None
    voice: str | None
    audio_path: str | None
    duration_ms: int | None
    attempts: int
    error: str | None
    sealed: int
    updated_at: str
    claim_token: str | None = None


class ChunkRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def get(self, chunk_id: str) -> Chunk | None:
        return row_to(Chunk, await self.db.fetchone("SELECT * FROM chunks WHERE id=?", (chunk_id,)))

    async def list_for_book(self, book_id: str) -> list[Chunk]:
        return rows_to(Chunk, await self.db.fetchall("SELECT * FROM chunks WHERE book_id=? ORDER BY seq", (book_id,)))

    async def update_text(self, chunk_id: str, text: str) -> None:
        """Manual edit: the chunk is sealed so the chunker never re-merges it, then re-queued for TTS."""
        await self.db.execute(
            "UPDATE chunks SET text=?, sealed=1, status='pending', not_before=NULL, attempts=0, error=NULL, updated_at=?"
            " WHERE id=?",
            (text, now_iso(), chunk_id),
        )

    async def reset_for_retry(self, chunk_id: str) -> bool:
        changed = await self.db.execute(
            "UPDATE chunks SET status='pending', not_before=NULL, attempts=0, error=NULL, updated_at=?"
            " WHERE id=? AND status IN ('failed', 'waiting_quota')",
            (now_iso(), chunk_id),
        )
        return changed == 1

    # --- worker: chunker --------------------------------------------------------

    async def get_unsealed_tail(self, book_id: str) -> Chunk | None:
        """The single chunk (if any) that the chunker may still extend/re-split."""
        return row_to(
            Chunk, await self.db.fetchone("SELECT * FROM chunks WHERE book_id=? AND sealed=0 AND status='pending' ORDER BY seq DESC LIMIT 1", (book_id,))
        )

    async def seal_tail(self, book_id: str) -> int:
        """User shortcut past the grace period: the tail becomes final, so TTS may claim it now
        and later pages start a new chunk. Returns the number of chunks sealed (0 or 1)."""
        return await self.db.execute(
            "UPDATE chunks SET sealed=1, updated_at=? WHERE book_id=? AND status='pending' AND sealed=0",
            (now_iso(), book_id),
        )

    async def next_free_seq(self, book_id: str) -> int:
        row = await self.db.fetchone("SELECT MAX(seq) AS m FROM chunks WHERE book_id=?", (book_id,))
        m = row["m"] if row else None
        return (m + 1) if m is not None else 0

    async def replace_tail(self, book_id: str, tail: Chunk | None, base_seq: int, pieces: list[str]) -> None:
        """Overwrite the unsealed tail (if any) with freshly (re-)split pieces.

        All pieces but the last are sealed immediately (a later chunk now exists after
        them, per the sealing rule); the last one stays unsealed so it can still be
        extended by a future page. Raises TailBusyError if the tail was claimed for
        TTS concurrently (caller should just retry on the next tick).
        """
        now = now_iso()
        async with self.db.transaction() as conn:
            if tail is not None:
                # sealed=0: a user may have sealed or hand-edited the tail since the chunker read it.
                async with conn.execute("DELETE FROM chunks WHERE id=? AND status='pending' AND sealed=0", (tail.id,)) as cur:
                    if cur.rowcount != 1:
                        raise TailBusyError()
            for i, text in enumerate(pieces):
                sealed = 0 if i == len(pieces) - 1 else 1
                await conn.execute(
                    "INSERT INTO chunks(id, book_id, seq, text, status, sealed, updated_at) VALUES (?,?,?,?,?,?,?)",
                    (new_id(), book_id, base_seq + i, text, "pending", sealed, now),
                )

    # --- worker: TTS -------------------------------------------------------------

    async def claim_next_pending(self, providers: list[str], now: str, grace_cutoff: str) -> Chunk | None:
        """Atomically claim the oldest eligible `pending` chunk for one of `providers`.

        Eligible means: sealed (the chunker will never touch it again), OR the book
        has been idle (no page upload/OCR activity) for at least the grace period and
        has no page still `uploaded`/`ocr_processing` — see worker.py module docstring
        for the full tail-sealing rationale. Claiming seals the chunk: once its text is
        being spoken the chunker must start a new chunk for later pages instead of
        rewriting it. Provider + voice are copied from the book in the same statement
        (D11: no fallback, but the voice can change between claims).
        """
        if not providers:
            return None
        placeholders = ",".join("?" for _ in providers)
        rows = await self.db.execute_returning(
            f"""
            UPDATE chunks SET status='processing', sealed=1, claim_token=?, updated_at=?,
                provider=(SELECT tts_provider FROM books WHERE books.id = chunks.book_id),
                voice=(SELECT tts_voice FROM books WHERE books.id = chunks.book_id)
            WHERE id = (
                SELECT c.id FROM chunks c
                JOIN books b ON b.id = c.book_id
                WHERE c.status='pending'
                  AND b.tts_provider IN ({placeholders})
                  AND (
                    c.sealed = 1
                    OR (
                      b.updated_at <= ?
                      AND NOT EXISTS (
                        SELECT 1 FROM pages p WHERE p.book_id = c.book_id AND p.status IN ('uploaded','ocr_processing')
                      )
                    )
                  )
                ORDER BY c.seq
                LIMIT 1
            )
            AND status='pending'
            RETURNING *
            """,
            (new_id(), now, *providers, grace_cutoff),
        )
        if not rows:
            return None
        return row_to(Chunk, rows[0])

    # Every mark_* is guarded by the claim token: if the chunk was reset (voice change, text
    # edit, retry) and possibly re-claimed while we were synthesizing, our result is stale
    # and must not overwrite the newer run's state.

    async def mark_done(self, chunk: Chunk, content_hash: str, audio_path: str, duration_ms: int) -> bool:
        return await self.db.execute(
            "UPDATE chunks SET status='done', content_hash=?, audio_path=?, duration_ms=?, error=NULL,"
            " not_before=NULL, claim_token=NULL, updated_at=? WHERE id=? AND status='processing' AND claim_token=?",
            (content_hash, audio_path, duration_ms, now_iso(), chunk.id, chunk.claim_token),
        ) == 1

    async def mark_waiting_quota(self, chunk: Chunk, not_before: str, error: str) -> bool:
        """Park the chunk until `not_before` — unless its book switched provider while it was being
        synthesized: then the old provider's quota is irrelevant and it goes straight back to
        `pending` for the new one (the worker still pauses the old provider in memory)."""
        return await self.db.execute(
            f"""
            UPDATE chunks SET
                status = CASE WHEN {_STILL_ON_CHUNK_PROVIDER} THEN 'waiting_quota' ELSE 'pending' END,
                not_before = CASE WHEN {_STILL_ON_CHUNK_PROVIDER} THEN ? END,
                error = CASE WHEN {_STILL_ON_CHUNK_PROVIDER} THEN ? END,
                attempts=attempts+1, claim_token=NULL, updated_at=?
            WHERE id=? AND status='processing' AND claim_token=?
            """,
            (not_before, error, now_iso(), chunk.id, chunk.claim_token),
        ) == 1

    async def mark_failed(self, chunk: Chunk, error: str) -> bool:
        return await self.db.execute(
            "UPDATE chunks SET status='failed', error=?, attempts=attempts+1, claim_token=NULL, updated_at=?"
            " WHERE id=? AND status='processing' AND claim_token=?",
            (error, now_iso(), chunk.id, chunk.claim_token),
        ) == 1

    async def is_audio_referenced(self, audio_path: str) -> bool:
        return await self.db.fetchone("SELECT 1 FROM chunks WHERE audio_path=? LIMIT 1", (audio_path,)) is not None

    async def quota_waits(self, now: str) -> dict[str, tuple[str, int]]:
        """provider -> (earliest retry time, chunk count) for chunks still parked on a quota error."""
        rows = await self.db.fetchall(
            "SELECT provider, MIN(not_before) AS until, COUNT(*) AS waiting FROM chunks"
            " WHERE status='waiting_quota' AND not_before > ? GROUP BY provider",
            (now,),
        )
        return {r["provider"]: (r["until"], r["waiting"]) for r in rows}

    async def requeue_expired_quota(self, now: str) -> int:
        """Chunks whose `not_before` has passed go back to `pending` automatically."""
        return await self.db.execute(
            "UPDATE chunks SET status='pending', updated_at=? WHERE status='waiting_quota' AND not_before <= ?",
            (now_iso(), now),
        )

    async def resume_processing(self) -> int:
        """Startup resume: any chunk a crashed worker left `processing` goes back to `pending`."""
        return await self.db.execute("UPDATE chunks SET status='pending', updated_at=? WHERE status='processing'", (now_iso(),))
