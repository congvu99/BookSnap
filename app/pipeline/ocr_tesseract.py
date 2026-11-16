"""Tesseract OCR (local CLI, Vietnamese model) for the pages Gemini refuses as recitation.

A plain OCR engine has no recitation filter and needs no account. It is weaker than
Gemini on phone photos and cannot tell running headers from body text, so it is only
the fallback. Tesseract's plain-text output separates blocks with a blank line; lines
inside a block are joined back into one paragraph, the way the Gemini prompt asks.
"""

import asyncio
import re
import shutil
from collections.abc import Sequence

from app.pipeline.ocr_provider import OcrError, PageText

DEFAULT_COMMAND: tuple[str, ...] = ("tesseract",)
LANGUAGE = "vie"
TIMEOUT_SECONDS = 120.0
_PAGE_NUMBER = re.compile(r"^\W*\d{1,4}\W*$")
_BLANK_LINE = re.compile(r"\n\s*\n")
_SENTENCE_END = ".!?…:"
_CLOSERS = "\"'”’»)]"


class TesseractOcrProvider:
    name = "tesseract"

    def __init__(self, command: Sequence[str] = DEFAULT_COMMAND, *, timeout_seconds: float = TIMEOUT_SECONDS) -> None:
        self._command = tuple(command)
        self._timeout_seconds = timeout_seconds

    @property
    def available(self) -> bool:
        return shutil.which(self._command[0]) is not None

    async def extract(self, image: bytes, mime: str) -> PageText:
        # "stdin stdout": read the image from stdin and print text, so no temp files are needed.
        args = [*self._command, "stdin", "stdout", "-l", LANGUAGE]
        try:
            process = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as exc:
            raise OcrError(f"Không chạy được Tesseract: {exc}", retryable=False) from exc
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(image), self._timeout_seconds)
        except TimeoutError as exc:
            process.kill()
            await process.wait()
            raise OcrError("Tesseract quá thời gian xử lý", retryable=True) from exc
        if process.returncode != 0:
            detail = stderr.decode("utf-8", "replace").strip()[-200:]
            raise OcrError(f"Tesseract lỗi (exit {process.returncode}): {detail}", retryable=False)
        return page_text_from_tesseract(stdout.decode("utf-8", "replace"))


def page_text_from_tesseract(raw: str) -> PageText:
    """Turn Tesseract plain text into paragraphs: blank lines split blocks, lone page numbers are dropped."""
    paragraphs = []
    for block in _BLANK_LINE.split(raw.replace("\f", "\n")):
        paragraph = " ".join(line.strip() for line in block.splitlines() if line.strip())
        if paragraph and not _PAGE_NUMBER.match(paragraph):
            paragraphs.append(paragraph)
    return PageText(paragraphs=paragraphs, continues_on_next_page=_ends_mid_sentence(paragraphs))


def _ends_mid_sentence(paragraphs: list[str]) -> bool:
    # Tesseract không biết đoạn cuối có nối sang trang sau hay không: coi là còn dang dở khi
    # đoạn cuối không kết thúc bằng dấu kết câu (bỏ qua dấu ngoặc/ngoặc kép đóng phía sau).
    if not paragraphs:
        return False
    tail = paragraphs[-1].rstrip().rstrip(_CLOSERS)
    return bool(tail) and tail[-1] not in _SENTENCE_END
