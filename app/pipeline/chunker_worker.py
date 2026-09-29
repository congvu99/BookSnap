"""Folds newly-OCR'd pages into chunks, respecting the ordering invariant.

See `worker.py`'s module docstring for the full rationale (tail-chunk sealing,
ordering invariant, blocking vs. discarded pages). This module is a pure
DB-driven step with no concurrency of its own — the caller (`Worker`) runs it
from a single loop, so there is never more than one tick in flight per process.
"""

import logging

from app.app_context import AppContext
from app.pipeline import text_chunker
from app.repositories.chunk_repository import TailBusyError

log = logging.getLogger(__name__)


async def chunk_tick(ctx: AppContext) -> bool:
    """Process every book with unchunked pages once. Returns True if anything changed."""
    unchunked = await ctx.pages.list_unchunked()
    book_ids = sorted({p.book_id for p in unchunked})
    changed = False
    for book_id in book_ids:
        changed = await _chunk_book(ctx, book_id) or changed
    return changed


async def _chunk_book(ctx: AppContext, book_id: str) -> bool:
    pages = await ctx.pages.list_for_book(book_id)
    by_seq = {p.seq: p for p in pages}
    tail = await ctx.chunks.get_unsealed_tail(book_id)
    carry = tail.text if tail else ""
    incorporated: list[str] = []

    # Seqs must be contiguous from 0: a missing seq (upload still pending or lost) or a
    # failed page blocks everything after it until it is retried or explicitly discarded.
    for seq in range(max(by_seq) + 1 if by_seq else 0):
        page = by_seq.get(seq)
        if page is None:
            break
        if page.chunked:
            continue
        if page.status == "discarded":
            incorporated.append(page.id)
            continue
        if page.status != "ocr_done":
            break

        prev = by_seq.get(seq - 1)
        # `prev` is already resolved (chunked or discarded) by the loop's ordering invariant,
        # so only its `continues` flag matters. An empty carry means the tail was sealed by a
        # TTS claim: the continuation starts a new chunk.
        join_directly = bool(carry) and prev is not None and prev.status == "ocr_done" and bool(prev.continues)
        if carry and page.text:
            carry = carry.rstrip() + (" " if join_directly else "\n\n") + page.text.lstrip()
        elif page.text:
            carry = page.text
        incorporated.append(page.id)

    if not incorporated:
        return False

    pieces = text_chunker.chunk_text(carry)
    base_seq = tail.seq if tail is not None else await ctx.chunks.next_free_seq(book_id)
    if pieces:
        try:
            await ctx.chunks.replace_tail(book_id, tail, base_seq, pieces)
        except TailBusyError:
            log.info("chunk outcome=busy book_id=%s", book_id)
            return False  # tail claimed by TTS concurrently; retry next tick
    # else: carry became empty (shouldn't normally happen) — leave the existing tail alone.

    await ctx.pages.mark_chunked(incorporated)
    await ctx.books.touch(book_id)
    log.info("chunk outcome=ok book_id=%s pages=%d pieces=%d", book_id, len(incorporated), len(pieces))
    return True
