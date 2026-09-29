"""GET /api/books/{id}/export: stream a ZIP (MP3 per chunk + text.json) without a temp file."""

import json
import logging
import re
import unicodedata
import zipfile
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.api.books_routes import load_book
from app.auth.current_user import Ctx, CurrentUser
from app.db import now_iso
from app.file_paths import is_within

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["export"])

_READ_SIZE = 256 * 1024


class _ChunkedSink:
    """Write-only, non-seekable file object; zipfile then emits data descriptors."""

    def __init__(self) -> None:
        self._parts: list[bytes] = []
        self._pos = 0

    def write(self, data: bytes) -> int:
        self._parts.append(bytes(data))
        self._pos += len(data)
        return len(data)

    def tell(self) -> int:
        return self._pos

    def flush(self) -> None:
        pass

    def drain(self) -> bytes:
        out = b"".join(self._parts)
        self._parts.clear()
        return out


def _zip_stream(manifest: dict, audio_files: list[tuple[str, Path]]) -> Iterator[bytes]:
    sink = _ChunkedSink()
    with zipfile.ZipFile(sink, mode="w", compression=zipfile.ZIP_STORED) as zf:  # type: ignore[arg-type]
        zf.writestr(
            "text.json", json.dumps(manifest, ensure_ascii=False, indent=2), compress_type=zipfile.ZIP_DEFLATED
        )
        yield sink.drain()
        for arcname, path in audio_files:
            with path.open("rb") as src, zf.open(arcname, mode="w") as dst:
                while block := src.read(_READ_SIZE):
                    dst.write(block)
                    yield sink.drain()
    yield sink.drain()


def ascii_slug(title: str) -> str:
    folded = unicodedata.normalize("NFKD", title.replace("đ", "d").replace("Đ", "D"))
    slug = re.sub(r"[^A-Za-z0-9]+", "-", folded.encode("ascii", "ignore").decode()).strip("-").lower()
    return slug[:60] or "book"


@router.get("/books/{book_id}/export")
async def export_book(book_id: str, ctx: Ctx, user: CurrentUser) -> StreamingResponse:
    book = await load_book(ctx, book_id)
    summary = await ctx.books.get_summary(book_id, user.id)
    chunks = await ctx.chunks.list_for_book(book_id)

    entries, audio_files = [], []
    for c in chunks:
        arcname = None
        if c.status == "done" and c.audio_path:
            path = Path(c.audio_path)
            if is_within(path, ctx.settings.library_dir) and path.is_file():
                arcname = f"audio/{c.seq + 1:05d}.mp3"
                audio_files.append((arcname, path))
        entries.append({"seq": c.seq, "text": c.text, "duration_ms": c.duration_ms if arcname else None, "audio": arcname})

    manifest = {
        "title": book.title,
        "created_by_name": summary.created_by_name if summary else None,
        "tts_provider": book.tts_provider,
        "tts_voice": book.tts_voice,
        "exported_at": now_iso(),
        "chunks": entries,
    }
    slug = ascii_slug(book.title)
    disposition = f"attachment; filename=\"booksnap-{slug}.zip\"; filename*=UTF-8''{quote(f'booksnap-{book.title}.zip')}"
    log.info("book_export book_id=%s user_id=%s chunks=%d audio_files=%d", book_id, user.id, len(chunks), len(audio_files))
    return StreamingResponse(
        _zip_stream(manifest, audio_files),
        media_type="application/zip",
        headers={"Content-Disposition": disposition, "Cache-Control": "no-store"},
    )
