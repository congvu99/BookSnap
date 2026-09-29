"""OCR provider contract shared by every backend (currently only Gemini)."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class PageText:
    paragraphs: list[str]
    continues_on_next_page: bool

    @property
    def text(self) -> str:
        return "\n\n".join(p.strip() for p in self.paragraphs if p.strip())


class OcrError(Exception):
    """Raised by OcrProvider.extract; `retryable` drives the worker's backoff policy.

    `quota` marks a 429: still retried with backoff (an RPM burst clears in seconds), but metered
    as a quota rejection rather than a billed request.
    """

    def __init__(self, message: str, *, retryable: bool, quota: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.retryable = retryable
        self.quota = quota


class OcrProvider(Protocol):
    async def extract(self, image: bytes, mime: str) -> PageText: ...
