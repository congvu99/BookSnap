"""Voice proof-of-concept CLI (phase 2, step 1 — user decides voice + style before build-out).

Takes book page images, OCRs each with Gemini, prints the combined text, then
synthesizes the first ~600 characters with a handful of Gemini voices plus the
two Azure Vietnamese voices, writing one MP3 per voice to scripts/poc-output/.

Requires real API keys in `.env` (GEMINI_API_KEY, AZURE_SPEECH_KEY) — this script
is not exercised by the test suite (no network in tests) and is meant to be run
by hand: `python scripts/voice_poc.py page1.jpg page2.jpg ...`
"""

import argparse
import asyncio
import mimetypes
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Windows consoles default to a legacy codepage that cannot print Vietnamese diacritics.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

from app.config import get_settings  # noqa: E402
from app.pipeline.ocr_gemini import GeminiOcrProvider  # noqa: E402
from app.pipeline.tts_azure import AzureTtsProvider  # noqa: E402
from app.pipeline.tts_gemini import GeminiTtsProvider  # noqa: E402

OUTPUT_DIR = Path(__file__).resolve().parent / "poc-output"
SAMPLE_CHARS = 600
GEMINI_VOICES = ["Kore", "Aoede", "Leda", "Zephyr"]
AZURE_VOICES = ["vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"]


def _guess_mime(path: Path) -> str:
    mime, _ = mimetypes.guess_type(path.name)
    if mime not in ("image/jpeg", "image/png", "image/webp"):
        raise ValueError(f"Không nhận dạng được định dạng ảnh: {path}")
    return mime


async def _ocr_all(image_paths: list[Path]) -> str:
    settings = get_settings()
    ocr = GeminiOcrProvider(settings.gemini_api_key, settings.gemini_ocr_model)
    texts: list[str] = []
    for path in image_paths:
        print(f"OCR {path.name} ...", file=sys.stderr)
        page = await ocr.extract(path.read_bytes(), _guess_mime(path))
        texts.append(page.text)
        print(f"--- {path.name} (continues={page.continues_on_next_page}) ---")
        print(page.text)
        print()
    return "\n\n".join(texts)


async def _synthesize_all(sample: str) -> None:
    settings = get_settings()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    gemini = GeminiTtsProvider(settings.gemini_api_key, settings.gemini_tts_model, settings.gemini_tts_style)
    for voice in GEMINI_VOICES:
        print(f"TTS gemini/{voice} ...", file=sys.stderr)
        result = await gemini.synthesize(sample, voice)
        out = OUTPUT_DIR / f"gemini-{voice}.mp3"
        out.write_bytes(result.mp3)
        print(f"  -> {out} ({result.duration_ms} ms)")

    azure = AzureTtsProvider(settings.azure_speech_key, settings.azure_speech_region)
    for voice in AZURE_VOICES:
        print(f"TTS azure/{voice} ...", file=sys.stderr)
        result = await azure.synthesize(sample, voice)
        out = OUTPUT_DIR / f"azure-{voice}.mp3"
        out.write_bytes(result.mp3)
        print(f"  -> {out} ({result.duration_ms} ms)")


async def _main(image_paths: list[Path]) -> None:
    full_text = await _ocr_all(image_paths)
    sample = full_text[:SAMPLE_CHARS]
    if not sample.strip():
        print("Không có văn bản nào để đọc thử (OCR trả về rỗng).", file=sys.stderr)
        return
    await _synthesize_all(sample)


def main() -> None:
    parser = argparse.ArgumentParser(description="BookSnap voice PoC: OCR ảnh sách rồi đọc thử nhiều giọng TTS.")
    parser.add_argument("images", nargs="+", type=Path, help="Đường dẫn ảnh trang sách, theo đúng thứ tự")
    args = parser.parse_args()
    asyncio.run(_main(args.images))


if __name__ == "__main__":
    main()
