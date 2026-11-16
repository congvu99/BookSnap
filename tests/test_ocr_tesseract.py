"""Tesseract fallback: CLI wiring (a fake tesseract script), text-to-paragraph parsing, and recitation routing."""

import sys
from pathlib import Path

import pytest

from app.pipeline.ocr_fallback import RecitationFallbackOcrProvider
from app.pipeline.ocr_provider import OcrError, PageText
from app.pipeline.ocr_tesseract import TesseractOcrProvider, page_text_from_tesseract


def _fake_tesseract(tmp_path: Path, body: str) -> TesseractOcrProvider:
    """A provider whose 'tesseract' is a Python script; it sees the same argv and stdin as the real CLI."""
    script = tmp_path / "fake_tesseract.py"
    script.write_text(f"import sys\n{body}\n", encoding="utf-8")
    return TesseractOcrProvider(command=(sys.executable, str(script)), timeout_seconds=5)


async def test_sends_the_image_on_stdin_with_the_vietnamese_model(tmp_path: Path) -> None:
    provider = _fake_tesseract(
        tmp_path,
        "data = sys.stdin.buffer.read()\n"
        "sys.stdout.buffer.write(f'{sys.argv[1:]}|{data.decode()}'.encode('utf-8'))",
    )

    page = await provider.extract(b"anh-trang", "image/jpeg")

    assert page.paragraphs == ["['stdin', 'stdout', '-l', 'vie']|anh-trang"]


async def test_reads_utf8_vietnamese_output(tmp_path: Path) -> None:
    provider = _fake_tesseract(
        tmp_path,
        "sys.stdout.buffer.write('Điều 1. Phạm vi điều chỉnh\\n\\nLuật này quy định\\nvề đầu tư công.\\n'.encode('utf-8'))",
    )

    page = await provider.extract(b"img", "image/jpeg")

    assert page.paragraphs == ["Điều 1. Phạm vi điều chỉnh", "Luật này quy định về đầu tư công."]


async def test_non_zero_exit_is_a_permanent_error(tmp_path: Path) -> None:
    provider = _fake_tesseract(tmp_path, "sys.stderr.write('Error opening data file vie.traineddata')\nsys.exit(1)")

    with pytest.raises(OcrError) as caught:
        await provider.extract(b"img", "image/jpeg")

    assert caught.value.message == "Tesseract lỗi (exit 1): Error opening data file vie.traineddata"
    assert caught.value.retryable is False


async def test_hung_process_is_killed_and_retryable(tmp_path: Path) -> None:
    provider = _fake_tesseract(tmp_path, "import time\ntime.sleep(30)")
    provider._timeout_seconds = 0.5

    with pytest.raises(OcrError) as caught:
        await provider.extract(b"img", "image/jpeg")

    assert caught.value.message == "Tesseract quá thời gian xử lý"
    assert caught.value.retryable is True


async def test_missing_binary_is_reported_not_crashed() -> None:
    provider = TesseractOcrProvider(command=("booksnap-no-such-tesseract",))

    assert provider.available is False
    with pytest.raises(OcrError) as caught:
        await provider.extract(b"img", "image/jpeg")
    assert caught.value.retryable is False


def test_blocks_become_paragraphs_and_page_numbers_are_dropped() -> None:
    raw = "Chương I\nQUY ĐỊNH CHUNG\n\nĐiều 1. Luật này quy định việc\nquản lý nhà nước.\n\n  - 12 -  \n\f"

    page = page_text_from_tesseract(raw)

    assert page.paragraphs == ["Chương I QUY ĐỊNH CHUNG", "Điều 1. Luật này quy định việc quản lý nhà nước."]


@pytest.mark.parametrize(
    ("raw", "continues"),
    [
        ("tổ chức, cá nhân có liên quan đến hoạt động đầu tư", True),
        ("Luật này có hiệu lực từ ngày 01 tháng 01 năm 2025.", False),
        ("“Đầu tư công là hoạt động đầu tư của Nhà nước.”", False),
        ("Các trường hợp sau đây:", False),
        ("", False),
    ],
)
def test_unfinished_last_paragraph_marks_the_page_as_continuing(raw: str, continues: bool) -> None:
    assert page_text_from_tesseract(raw).continues_on_next_page is continues


class _ScriptedOcr:
    def __init__(self, outcome: PageText | OcrError) -> None:
        self.outcome = outcome
        self.calls = 0

    async def extract(self, image: bytes, mime: str) -> PageText:
        self.calls += 1
        if isinstance(self.outcome, OcrError):
            raise self.outcome
        return self.outcome


FALLBACK_TEXT = PageText(paragraphs=["Đọc bởi Tesseract."], continues_on_next_page=False)


async def test_recitation_block_is_read_by_the_fallback() -> None:
    primary = _ScriptedOcr(OcrError("RECITATION", retryable=False, recitation=True))
    fallback = _ScriptedOcr(FALLBACK_TEXT)

    page = await RecitationFallbackOcrProvider(primary, fallback).extract(b"img", "image/jpeg")

    assert page == FALLBACK_TEXT
    assert (primary.calls, fallback.calls) == (1, 1)


async def test_other_primary_errors_do_not_touch_the_fallback() -> None:
    primary = _ScriptedOcr(OcrError("503", retryable=True))
    fallback = _ScriptedOcr(FALLBACK_TEXT)

    with pytest.raises(OcrError):
        await RecitationFallbackOcrProvider(primary, fallback).extract(b"img", "image/jpeg")

    assert fallback.calls == 0
