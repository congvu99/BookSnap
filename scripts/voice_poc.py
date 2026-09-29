"""Voice proof-of-concept CLI: listen to candidate voices + style before choosing a default.

Takes book page images (OCR'd with Gemini) or a literal `--text`, then synthesizes the
first ~600 characters with the chosen Gemini voices (and the Azure voices when a key is
set), writing one MP3 per voice to scripts/poc-output/.

Voices and style come from the command line, not `.env`, so candidates can be compared
under the same style. Requires real API keys in `.env` — not exercised by the test suite:
  python scripts/voice_poc.py page1.jpg page2.jpg
  python scripts/voice_poc.py --text "..." --voices Charon,Orus,Kore --style "..." --tag tram
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
from app.tts_voices import AZURE_VOICES, GEMINI_VOICES  # noqa: E402

OUTPUT_DIR = Path(__file__).resolve().parent / "poc-output"
SAMPLE_CHARS = 600


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


def _out_path(provider: str, voice: str, tag: str) -> Path:
    suffix = f"-{tag}" if tag else ""
    return OUTPUT_DIR / f"{provider}-{voice}{suffix}.mp3"


async def _synthesize_all(sample: str, voices: list[str], style: str, tag: str) -> None:
    settings = get_settings()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Style: {style}", file=sys.stderr)

    gemini = GeminiTtsProvider(settings.gemini_api_key, settings.gemini_tts_model, style)
    for voice in voices:
        print(f"TTS gemini/{voice} ...", file=sys.stderr)
        result = await gemini.synthesize(sample, voice)
        out = _out_path("gemini", voice, tag)
        out.write_bytes(result.mp3)
        print(f"  -> {out} ({result.duration_ms} ms)")

    if not settings.azure_speech_key:
        print("Bỏ qua Azure: chưa có AZURE_SPEECH_KEY.", file=sys.stderr)
        return
    azure = AzureTtsProvider(settings.azure_speech_key, settings.azure_speech_region)
    for voice in AZURE_VOICES:
        print(f"TTS azure/{voice} ...", file=sys.stderr)
        result = await azure.synthesize(sample, voice)
        out = _out_path("azure", voice, tag)
        out.write_bytes(result.mp3)
        print(f"  -> {out} ({result.duration_ms} ms)")


async def _main(args: argparse.Namespace) -> None:
    full_text = args.text if args.text else await _ocr_all(args.images)
    sample = full_text[:SAMPLE_CHARS]
    if not sample.strip():
        print("Không có văn bản nào để đọc thử (OCR trả về rỗng).", file=sys.stderr)
        return
    voices = [v.strip() for v in args.voices.split(",") if v.strip()]
    style = args.style if args.style is not None else get_settings().gemini_tts_style
    await _synthesize_all(sample, voices, style, args.tag)


def main() -> None:
    parser = argparse.ArgumentParser(description="BookSnap voice PoC: đọc thử nhiều giọng TTS từ ảnh sách hoặc đoạn văn.")
    parser.add_argument("images", nargs="*", type=Path, help="Đường dẫn ảnh trang sách, theo đúng thứ tự")
    parser.add_argument("--text", help="Đọc thử đoạn văn này thay vì OCR ảnh")
    parser.add_argument("--voices", default=",".join(GEMINI_VOICES), help="Danh sách giọng Gemini, cách nhau bởi dấu phẩy")
    parser.add_argument("--style", help="Style prompt Gemini (mặc định: GEMINI_TTS_STYLE hiện tại)")
    parser.add_argument("--tag", default="", help="Hậu tố tên file để so sánh nhiều style")
    args = parser.parse_args()
    if not args.text and not args.images:
        parser.error("cần ảnh trang sách hoặc --text")
    asyncio.run(_main(args))


if __name__ == "__main__":
    main()
