"""Pure text chunker: turn accumulated page text into TTS-sized chunks.

Rules (see plan.md D-decisions / phase-02 spec):
- Split on sentence enders `. ! ? … : ;` and newlines. A run of consecutive enders
  (e.g. "...", "?!") counts as a single boundary; a boundary only "counts" when
  followed by whitespace or end of line, so things like "3.14" are not split.
- Merge sentences into chunks, aiming for ~TARGET_CHARS, never exceeding MAX_CHARS.
  MIN_CHARS is a soft target used while merging (we keep adding sentences until we
  reach it); the very last chunk of a text may end up shorter since there is
  nothing left to merge.
- A single sentence longer than MAX_CHARS is split at the nearest comma within the
  limit, falling back to the nearest whitespace, and only as an absolute last
  resort (no comma/space at all) at a hard character cut — this never happens for
  real prose but keeps the function total instead of raising.

This module knows nothing about pages, books or the database: the worker is
responsible for deciding what text to feed in (including cross-page joins).
"""

MIN_CHARS = 400
TARGET_CHARS = 1200
MAX_CHARS = 1500

_SENTENCE_ENDERS = ".!?…:;"


def chunk_text(text: str) -> list[str]:
    """Split `text` into chunks of at most MAX_CHARS, never cutting mid-word."""
    text = text.strip()
    if not text:
        return []
    sentences = _split_sentences(text)
    if not sentences:
        return []
    return _merge(sentences)


def _split_sentences(text: str) -> list[str]:
    sentences: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        sentences.extend(_split_line(line))
    return [s for s in sentences if s]


def _split_line(line: str) -> list[str]:
    out: list[str] = []
    current: list[str] = []
    i = 0
    n = len(line)
    while i < n:
        ch = line[i]
        current.append(ch)
        if ch in _SENTENCE_ENDERS:
            j = i + 1
            while j < n and line[j] in _SENTENCE_ENDERS:
                current.append(line[j])
                j += 1
            i = j
            if i >= n or line[i].isspace():
                out.append("".join(current).strip())
                current = []
            continue
        i += 1
    if current:
        out.append("".join(current).strip())
    return out


def _merge(sentences: list[str]) -> list[str]:
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        for piece in _split_long_sentence(sentence):
            candidate = f"{current} {piece}".strip() if current else piece
            if len(candidate) <= MAX_CHARS:
                current = candidate
                if len(current) >= TARGET_CHARS:
                    chunks.append(current)
                    current = ""
            else:
                if current:
                    chunks.append(current)
                current = piece
                if len(current) >= MAX_CHARS:
                    chunks.append(current)
                    current = ""
    if current:
        chunks.append(current)
    return chunks


def _split_long_sentence(sentence: str) -> list[str]:
    if len(sentence) <= MAX_CHARS:
        return [sentence]
    pieces: list[str] = []
    remaining = sentence
    while len(remaining) > MAX_CHARS:
        cut = _find_cut(remaining, MAX_CHARS)
        pieces.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        pieces.append(remaining)
    return pieces


def _find_cut(s: str, limit: int) -> int:
    window = s[:limit]
    comma = window.rfind(",")
    if comma > 0:
        return comma + 1
    space = window.rfind(" ")
    if space > 0:
        return space
    return limit  # pathological: no comma/space at all; last-resort hard cut
