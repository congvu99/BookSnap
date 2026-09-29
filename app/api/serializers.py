"""JSON shapes returned by the API. Kept in one place so the web client has a single contract."""

from app.repositories.book_repository import BookSummary
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
            "next_not_before": b.next_not_before,
        },
        "duration_ms": b.duration_ms,
        "progress": progress,
    }


def page_out(p: Page) -> dict:
    return {"id": p.id, "seq": p.seq, "status": p.status, "error": p.error, "created_at": p.created_at}


def chunk_out(c: Chunk) -> dict:
    ready = c.status == "done" and c.audio_path is not None
    return {
        "id": c.id,
        "seq": c.seq,
        "text": c.text,
        "status": c.status,
        "not_before": c.not_before,
        "provider": c.provider,
        "voice": c.voice,
        "duration_ms": c.duration_ms if ready else None,
        "error": c.error,
        "audio_url": f"/api/chunks/{c.id}/audio?v={(c.content_hash or '')[:8]}" if ready else None,
    }
