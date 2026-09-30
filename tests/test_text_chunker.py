import re

import pytest

from app.pipeline.text_chunker import MAX_CHARS, MIN_CHARS, chunk_text, spoken_text


def _words(text: str) -> list[str]:
    return re.findall(r"\w+", text, flags=re.UNICODE)


def test_empty_and_whitespace_only_page_yields_no_chunks():
    assert chunk_text("") == []
    assert chunk_text("   \n\n  ") == []


def test_heading_only_short_page_is_a_single_chunk():
    assert chunk_text("Chương Một") == ["Chương Một"]


def test_no_chunk_exceeds_max_and_none_are_empty():
    paragraph = "Đây là một câu bình thường có dấu tiếng Việt rất đầy đủ. " * 60
    for chunk in chunk_text(paragraph):
        assert chunk
        assert len(chunk) <= MAX_CHARS


def test_typical_book_text_merges_towards_target_not_min_only():
    text = ("Một câu ngắn gọn nhưng có ý nghĩa sâu sắc về cuộc đời con người. ") * 40
    chunks = chunk_text(text)
    assert len(chunks) >= 2
    # every non-final chunk should have reached the target merge size before flushing
    for chunk in chunks[:-1]:
        assert len(chunk) >= MIN_CHARS


def test_long_sentence_over_max_splits_at_nearest_comma():
    long_clause = "một, " * 400  # comma-separated, way over MAX_CHARS
    sentence = long_clause.strip().rstrip(",") + "."
    chunks = chunk_text(sentence)
    assert all(len(c) <= MAX_CHARS for c in chunks)
    # split points landed on commas, not mid-word
    for c in chunks[:-1]:
        assert c.endswith(",") or c.endswith("một")


def test_long_sentence_without_comma_splits_at_whitespace_never_mid_word():
    sentence = ("từ " * 500).strip() + "."
    chunks = chunk_text(sentence)
    assert all(len(c) <= MAX_CHARS for c in chunks)
    original_words = _words(sentence)
    rejoined_words = _words(" ".join(chunks))
    assert rejoined_words == original_words


def test_pathological_single_token_longer_than_max_does_not_crash():
    sentence = "a" * (MAX_CHARS + 100) + "."
    chunks = chunk_text(sentence)
    assert sum(len(c) for c in chunks) >= MAX_CHARS  # degraded hard-cut, but total is preserved
    assert "".join(chunks).replace(" ", "") == sentence.replace(" ", "")


def test_vietnamese_quotes_and_ellipsis_are_preserved_and_not_treated_as_extra_boundaries():
    text = 'Anh ấy nói: “Tôi sẽ về…”. Cô đáp lại «Vâng» rồi im lặng.'
    chunks = chunk_text(text)
    combined = " ".join(chunks)
    for ch in "“”«»…":
        assert ch in combined


def test_sentence_enders_are_not_split_mid_number():
    text = "Giá là 3.14 đồng cho mỗi cuốn sách trong bộ sưu tập của thư viện lớn nhất."
    chunks = chunk_text(text)
    assert any("3.14" in c for c in chunks)


@pytest.mark.parametrize(
    "raw",
    [
        "Câu một. Câu hai! Câu ba? Câu bốn... Câu năm: chi tiết; câu sáu.",
        "Dòng một\nDòng hai\nDòng ba",
    ],
)
def test_concatenation_preserves_all_words_in_order(raw):
    chunks = chunk_text(raw)
    assert _words(" ".join(chunks)) == _words(raw)


def test_cross_page_join_without_blank_line_reads_as_one_paragraph():
    # This mirrors what worker._chunk_book feeds the chunker when a page's last
    # paragraph continues on the next page: no "\n\n" is inserted between them.
    carry = "Con đường làng quanh co dẫn"
    page_text = "tới ngôi nhà nhỏ ở cuối xóm, nơi bà tôi sống một mình."
    joined = carry + " " + page_text
    chunks = chunk_text(joined)
    assert len(chunks) == 1
    assert chunks[0] == joined


def test_heading_stays_on_its_own_line_above_the_paragraph():
    page = "Chương một: Mùa nước nổi\n\nBuổi sáng hôm ấy, sương còn phủ trắng mặt sông. Ông Tư chống xuồng."
    assert chunk_text(page) == ["Chương một: Mùa nước nổi\nBuổi sáng hôm ấy, sương còn phủ trắng mặt sông. Ông Tư chống xuồng."]


def test_sentences_within_one_paragraph_join_with_a_space():
    assert chunk_text("Câu một. Câu hai.\n\nĐoạn hai.") == ["Câu một. Câu hai.\nĐoạn hai."]


def test_spoken_text_adds_a_pause_after_a_heading_only():
    assert spoken_text("Chương một\nBuổi sáng hôm ấy.") == "Chương một. Buổi sáng hôm ấy."
    assert spoken_text("Anh nói: “Đi thôi.”\nCô gật đầu.") == "Anh nói: “Đi thôi.” Cô gật đầu."


def test_spoken_text_leaves_a_sentence_that_continues_in_the_next_chunk_open():
    assert spoken_text("Con đường làng quanh co dẫn") == "Con đường làng quanh co dẫn"
    assert spoken_text("Chương hai\nCon đường làng quanh co dẫn") == "Chương hai. Con đường làng quanh co dẫn"


def test_chunk_text_preserves_non_whitespace_sequence():
    # Page anchors rely on this: the chunker only touches whitespace, so counting non-whitespace
    # characters maps a position in the page text onto the same position in the chunks.
    long_sentence = "Một mệnh đề rất dài, " * 90 + "kết thúc ở đây."
    text = "Chương Một\n\n  Chiều xuống. Tôi ngồi \t trên bậc thềm!?\n" + long_sentence + "\nHết… Thật rồi."
    chunks = chunk_text(text)
    assert len(chunks) > 1
    assert "".join("".join(chunks).split()) == "".join(text.split())
