"""Route a page the primary OCR refused as recitation to a plain OCR engine."""

import logging

from app.pipeline.ocr_provider import OcrError, OcrProvider, PageText

log = logging.getLogger(__name__)


class RecitationFallbackOcrProvider:
    """Gemini reads every page first (best text cleanup); only recitation-blocked pages go to the fallback."""

    def __init__(self, primary: OcrProvider, fallback: OcrProvider) -> None:
        self._primary = primary
        self._fallback = fallback

    async def extract(self, image: bytes, mime: str) -> PageText:
        try:
            return await self._primary.extract(image, mime)
        except OcrError as exc:
            if not exc.recitation:
                raise
        log.info("ocr_fallback reason=recitation")
        return await self._fallback.extract(image, mime)
