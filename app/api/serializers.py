"""JSON shapes returned by the API. Kept in one place so the web client has a single contract."""

import math
from datetime import datetime, timedelta

from app.db import parse_iso
from app.page_anchors import PageAnchor
from app.repositories.book_repository import Book, BookSummary
from app.repositories.chunk_repository import Chunk
from app.repositories.page_repository import Page
from app.repositories.user_repository import User


def blocked_at_seq(b: BookSummary) -> int | None:
    """First seq that is failed or missing; every later page waits for it (retry or discard)."""
    if b.pages_total == 0:
        return None
    candidates = [s for s in (b.pages_first_failed_seq, b.pages_first_gap_seq) if s is not None]
    if b.pages_min_seq:
        candidates.append(0)
    return min(candidates) if candidates else None


def missing_seqs(pages: list[Page]) -> list[int]:
    present = {p.seq for p in pages}
    return [s for s in range(max(present) + 1 if present else 0) if s not in present]


def book_state(b: BookSummary) -> str:
    if b.pages_total == 0:
        return "empty"
    if b.pages_processing or b.chunks_processing:
        return "processing"
    if b.chunks_waiting_quota:
        return "waiting_quota"
    if b.pages_failed or b.chunks_failed or blocked_at_seq(b) is not None:
        return "failed"
    return "ready"


def tail_waiting(b: BookSummary) -> bool:
    """Only the unsealed tail is left and it is held back by the grace period (mirrors the grace
    branch of `ChunkRepository.claim_next_pending`): nothing else to speak, no page mid-OCR."""
    return b.chunks_tail_pending > 0 and b.chunks_queued == 0 and b.pages_processing == 0


def tail_wait_seconds(b: BookSummary, grace_seconds: float, now: datetime) -> int | None:
    """Seconds until the grace period ends, computed server-side so clients never depend on
    their own clock. 0 once it has passed (the worker picks the tail up on its next tick)."""
    if not tail_waiting(b):
        return None
    ready_at = parse_iso(b.updated_at) + timedelta(seconds=grace_seconds)
    return max(0, math.ceil((ready_at - now).total_seconds()))


def book_out(b: BookSummary, user: User) -> dict:
    progress = None
    if b.progress_chunk_seq is not None:
        progress = {"chunk_seq": b.progress_chunk_seq, "offset_ms": b.progress_offset_ms, "updated_at": b.progress_updated_at}
    return {
        "id": b.id,
        "title": b.title,
        "created_by": b.created_by,
        "created_by_name": b.created_by_name,
        "can_manage": b.created_by == user.id,
        "tts_provider": b.tts_provider,
        "tts_voice": b.tts_voice,
        "topic": {"id": b.topic_id, "name": b.topic_name} if b.topic_id else None,
        "created_at": b.created_at,
        "updated_at": b.updated_at,
        "state": book_state(b),
        "pages": {
            "total": b.pages_total,
            "done": b.pages_done,
            "failed": b.pages_failed,
            "processing": b.pages_processing,
            "discarded": b.pages_discarded,
            "next_seq": b.next_page_seq,
            "blocked_at_seq": blocked_at_seq(b),
        },
        "chunks": {
            "total": b.chunks_total,
            "done": b.chunks_done,
            "waiting_quota": b.chunks_waiting_quota,
            "failed": b.chunks_failed,
            "processing": b.chunks_processing,
            "queued": b.chunks_queued,
            "tail_waiting": tail_waiting(b),
            "next_not_before": b.next_not_before,
        },
        "duration_ms": b.duration_ms,
        "progress": progress,
    }


def page_out(p: Page) -> dict:
    return {"id": p.id, "seq": p.seq, "status": p.status, "error": p.error, "created_at": p.created_at}


def page_anchor_out(a: PageAnchor) -> dict:
    return {"page_seq": a.page_seq, "status": a.status, "chunk_seq": a.chunk_seq, "chunk_frac": a.chunk_frac, "excerpt": a.excerpt}


# Only these chunks carry a voice the worker actually used; any other chunk gets the book's
# voice copied on its next claim, so its own `provider`/`voice` columns may be stale or empty.
_OWN_VOICE_STATUSES = ("done", "processing")


def chunk_out(c: Chunk, book: Book) -> dict:
    ready = c.status == "done" and c.audio_path is not None
    own_voice = c.status in _OWN_VOICE_STATUSES
    return {
        "id": c.id,
        "seq": c.seq,
        "text": c.text,
        "status": c.status,
        "not_before": c.not_before,
        "provider": c.provider if own_voice else book.tts_provider,
        "voice": c.voice if own_voice else book.tts_voice,
        "duration_ms": c.duration_ms if ready else None,
        "error": c.error,
        "audio_url": f"/api/chunks/{c.id}/audio?v={(c.content_hash or '')[:8]}" if ready else None,
    }
