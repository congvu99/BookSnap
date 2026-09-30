from types import SimpleNamespace

from app.page_anchors import compute_page_anchors
from app.pipeline.text_chunker import chunk_text


def page(seq: int, text: str | None, status: str = "ocr_done", chunked: bool = True, continues: bool = False):
    return SimpleNamespace(seq=seq, status=status, text=text, chunked=int(chunked), continues=int(continues))


def chunks_for(pages) -> list[SimpleNamespace]:
    """Chunk the pages the way chunker_worker joins them (continuation → space, else blank line)."""
    carry = ""
    prev = None
    for p in pages:
        if p.status != "ocr_done" or not p.chunked or not (p.text or "").strip():
            if p.status == "ocr_done":
                prev = p
            continue
        joiner = " " if prev is not None and prev.continues else "\n\n"
        carry = carry.rstrip() + joiner + p.text.lstrip() if carry else p.text
        prev = p
    return [SimpleNamespace(seq=i, text=t) for i, t in enumerate(chunk_text(carry))]


def frac_of(chunk_text_: str, needle: str) -> float:
    return round(chunk_text_.index(needle) / len(chunk_text_), 4)


SENTENCE = "Đây là một câu văn bình thường trong sách, có dấu tiếng Việt đầy đủ. "


def test_single_page_single_chunk_starts_at_zero():
    pages = [page(0, "Chương Một. Chiều xuống.")]
    [a] = compute_page_anchors(pages, chunks_for(pages))
    assert (a.page_seq, a.status, a.chunk_seq, a.chunk_frac) == (0, "ready", 0, 0.0)


def test_short_pages_merged_into_one_chunk_get_increasing_fracs():
    pages = [page(0, "Alpha mở đầu."), page(1, "Beta ở giữa."), page(2, "Gamma kết thúc.")]
    chunks = chunks_for(pages)
    assert len(chunks) == 1
    anchors = compute_page_anchors(pages, chunks)
    assert [a.chunk_seq for a in anchors] == [0, 0, 0]
    assert anchors[1].chunk_frac == frac_of(chunks[0].text, "Beta")
    assert anchors[2].chunk_frac == frac_of(chunks[0].text, "Gamma")


def test_long_page_spanning_two_chunks_places_next_page_in_later_chunk():
    pages = [page(0, SENTENCE * 30), page(1, "Trang sau bắt đầu ở đây.")]
    chunks = chunks_for(pages)
    assert len(chunks) >= 2
    anchors = compute_page_anchors(pages, chunks)
    target = next(c for c in chunks if "Trang sau" in c.text)
    assert anchors[1].chunk_seq == target.seq
    assert anchors[1].chunk_frac == frac_of(target.text, "Trang sau")


def test_continuation_page_mid_sentence_with_nbsp_points_at_its_first_character():
    pages = [page(0, "Anh ấy bước\u00a0vào và\u00a0", continues=True), page(1, "\u00a0ngồi xuống ghế.")]
    chunks = chunks_for(pages)
    anchors = compute_page_anchors(pages, chunks)
    assert anchors[1].chunk_frac == frac_of(chunks[0].text, "ngồi")


def test_discarded_page_in_the_middle_is_skipped():
    pages = [page(0, "Một."), page(1, None, status="discarded", chunked=True), page(2, "Hai.")]
    chunks = chunks_for(pages)
    anchors = compute_page_anchors(pages, chunks)
    assert anchors[1].status == "discarded" and anchors[1].chunk_seq is None
    assert anchors[2].status == "ready"
    assert anchors[2].chunk_frac == frac_of(chunks[0].text, "Hai")


def test_whitespace_only_page_is_empty():
    pages = [page(0, "Một."), page(1, "  \n "), page(2, "Hai.")]
    anchors = compute_page_anchors(pages, chunks_for(pages))
    assert anchors[1].status == "empty" and anchors[1].chunk_seq is None
    assert anchors[2].status == "ready"


def test_failed_page_blocks_every_later_page():
    pages = [page(0, "Một."), page(1, None, status="failed", chunked=False), page(2, "Hai.", chunked=False)]
    anchors = compute_page_anchors(pages, chunks_for(pages))
    assert [a.status for a in anchors] == ["ready", "failed", "pending"]
    assert anchors[2].chunk_seq is None and anchors[2].excerpt == ""


def test_ocr_done_but_not_yet_chunked_page_is_pending():
    pages = [page(0, "Một."), page(1, "Hai.", chunked=False)]
    chunks = chunks_for([page(0, "Một."), page(1, "Hai.")])  # replace_tail ran, mark_chunked not yet
    anchors = compute_page_anchors(pages, chunks)
    assert [a.status for a in anchors] == ["ready", "pending"]


def test_missing_seq_blocks_later_pages():
    pages = [page(0, "Một."), page(2, "Ba.")]
    anchors = compute_page_anchors(pages, chunks_for(pages[:1]))
    assert [(a.page_seq, a.status) for a in anchors] == [(0, "ready"), (2, "pending")]


def test_chunk_edited_shorter_clamps_to_start_of_last_chunk():
    pages = [page(0, "Một câu đầu."), page(1, "Một câu sau rất dài.")]
    edited = [SimpleNamespace(seq=0, text="Một")]
    anchors = compute_page_anchors(pages, edited)
    assert (anchors[1].status, anchors[1].chunk_seq, anchors[1].chunk_frac) == ("ready", 0, 0.0)


def test_chunked_page_without_any_chunk_is_pending():
    anchors = compute_page_anchors([page(0, "Một.")], [])
    assert anchors[0].status == "pending" and anchors[0].chunk_seq is None


def test_excerpt_collapses_whitespace_and_ellipsises_long_text():
    pages = [page(0, "  Chương\n\nMột   mở đầu. " + SENTENCE * 3)]
    [a] = compute_page_anchors(pages, chunks_for(pages))
    assert a.excerpt.startswith("Chương Một mở đầu.")
    assert len(a.excerpt) <= 81 and a.excerpt.endswith("…")
    assert "  " not in a.excerpt


def test_tail_rechunk_after_adding_a_page_keeps_earlier_anchors_correct():
    first = [page(0, SENTENCE * 5), page(1, "Trang hai mở đầu. " + SENTENCE * 5)]
    more = first + [page(2, "Trang ba mở đầu. " + SENTENCE * 20)]
    # Like chunker_worker: the unsealed tail's text is carried into the new page and re-split in place.
    chunks = chunks_for(first)
    tail = chunks.pop()
    pieces = chunk_text(tail.text.rstrip() + "\n\n" + more[2].text)
    chunks += [SimpleNamespace(seq=tail.seq + i, text=t) for i, t in enumerate(pieces)]
    anchors = compute_page_anchors(more, chunks)
    for a, needle in ((anchors[1], "Trang hai"), (anchors[2], "Trang ba")):
        target = chunks[a.chunk_seq]
        assert a.chunk_frac == frac_of(target.text, needle)


def test_unordered_inputs_are_sorted():
    pages = [page(1, "Beta."), page(0, "Alpha.")]
    chunks = list(reversed(chunks_for(sorted(pages, key=lambda p: p.seq))))
    anchors = compute_page_anchors(pages, chunks)
    assert [a.page_seq for a in anchors] == [0, 1]
    assert all(a.status == "ready" for a in anchors)
