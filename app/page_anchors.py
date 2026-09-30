"""Where each captured page starts inside the book's chunks, computed on read.

Chunks carry no page ids: the chunker joins page texts and re-splits them by sentence. But
`text_chunker` only strips and collapses whitespace, so the sequence of non-whitespace characters
across all chunks equals the one across all chunked pages. Counting non-whitespace characters
therefore maps a page's first character onto (chunk seq, position in that chunk) exactly, for old
books too, and stays correct when the unsealed tail is re-chunked. A chunk edited by hand shifts
later anchors by the number of characters changed; an anchor past the end clamps to the last chunk.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

EXCERPT_CHARS = 80

AnchorStatus = Literal["ready", "pending", "failed", "discarded", "empty"]


class PageLike(Protocol):
    seq: int
    status: str
    text: str | None
    chunked: int


class ChunkLike(Protocol):
    seq: int
    text: str


@dataclass(frozen=True)
class PageAnchor:
    page_seq: int
    status: AnchorStatus
    chunk_seq: int | None
    chunk_frac: float | None  # 0..1 of the chunk's text length (unit-free, so JS can use it as-is)
    excerpt: str


def compute_page_anchors(pages: Sequence[PageLike], chunks: Sequence[ChunkLike]) -> list[PageAnchor]:
    ordered_chunks = sorted(chunks, key=lambda c: c.seq)
    chunk_lens = [_non_ws_len(c.text) for c in ordered_chunks]
    total_chunk_chars = sum(chunk_lens)

    anchors: list[PageAnchor] = []
    consumed = 0  # non-whitespace characters of the chunked pages before the current one
    chunk_idx = 0
    chunk_start = 0  # non-whitespace characters before ordered_chunks[chunk_idx]
    blocked = False

    for expected_seq, p in enumerate(sorted(pages, key=lambda p: p.seq)):
        # Same ordering invariant as the chunker: a gap or unresolved page blocks all later pages.
        blocked = blocked or p.seq != expected_seq
        if p.status == "discarded" and not blocked:
            anchors.append(PageAnchor(p.seq, "discarded", None, None, ""))
            continue
        if blocked or p.status != "ocr_done" or not p.chunked:
            blocked = True
            anchors.append(PageAnchor(p.seq, "failed" if p.status == "failed" else "pending", None, None, ""))
            continue

        text = p.text or ""
        length = _non_ws_len(text)
        if length == 0:
            anchors.append(PageAnchor(p.seq, "empty", None, None, ""))
            continue
        if not ordered_chunks:
            anchors.append(PageAnchor(p.seq, "pending", None, None, ""))
            consumed += length
            continue

        if consumed >= total_chunk_chars:
            chunk_seq, frac = ordered_chunks[-1].seq, 0.0
        else:
            while consumed >= chunk_start + chunk_lens[chunk_idx]:
                chunk_start += chunk_lens[chunk_idx]
                chunk_idx += 1
            chunk = ordered_chunks[chunk_idx]
            idx = _index_of_nth_non_ws(chunk.text, consumed - chunk_start)
            chunk_seq, frac = chunk.seq, round(idx / len(chunk.text), 4)
        anchors.append(PageAnchor(p.seq, "ready", chunk_seq, frac, _excerpt(text)))
        consumed += length

    return anchors


def _non_ws_len(s: str) -> int:
    return sum(1 for ch in s if not ch.isspace())


def _index_of_nth_non_ws(s: str, n: int) -> int:
    seen = 0
    for i, ch in enumerate(s):
        if ch.isspace():
            continue
        if seen == n:
            return i
        seen += 1
    return len(s)


def _excerpt(text: str) -> str:
    flat = " ".join(text.split())
    if len(flat) <= EXCERPT_CHARS:
        return flat
    cut = flat.rfind(" ", 0, EXCERPT_CHARS)
    return flat[: cut if cut > 0 else EXCERPT_CHARS] + "…"
