import asyncio
import logging
import shutil
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.serializers import book_out, chunk_out, missing_seqs, page_out, tail_wait_seconds
from app.api_errors import ApiError, not_found
from app.auth.current_user import Ctx, CurrentUser, ensure_book_owner
from app.config import TtsProviderName
from app.db import now_utc
from app.repositories.book_repository import Book
from app.repositories.topic_repository import clean_topic_name
from app.tts_voices import allowed_voices, provider_configured

log = logging.getLogger(__name__)

TITLE_MAX = 120
TOPIC_MAX = 40

router = APIRouter(prefix="/api", tags=["books"])


class BookCreateIn(BaseModel):
    title: str
    topic: str | None = None
    tts_provider: TtsProviderName | None = None
    tts_voice: str | None = Field(default=None, max_length=80)


class BookPatchIn(BaseModel):
    title: str | None = None
    topic: str | None = None  # null or "" removes the topic; omitted leaves it unchanged
    tts_provider: TtsProviderName | None = None
    tts_voice: str | None = Field(default=None, max_length=80)


class BookVoiceIn(BaseModel):
    tts_provider: TtsProviderName
    tts_voice: str = Field(max_length=80)


class ProgressIn(BaseModel):
    chunk_seq: int = Field(ge=0)
    offset_ms: int = Field(ge=0)


def _clean_title(raw: str) -> str:
    title = raw.strip()
    if not 1 <= len(title) <= TITLE_MAX:
        raise ApiError(400, "title_invalid", f"Tên sách 1–{TITLE_MAX} ký tự", "title")
    return title


def _clean_topic(raw: str | None) -> str | None:
    """None / blank means "no topic"; validated before any write so a request never half-applies."""
    name = clean_topic_name(raw or "")
    if len(name) > TOPIC_MAX:
        raise ApiError(400, "topic_invalid", f"Chủ đề tối đa {TOPIC_MAX} ký tự", "topic")
    return name or None


async def _topic_id(ctx: Ctx, name: str | None, user_id: str) -> str | None:
    return (await ctx.topics.get_or_create(name, user_id)).id if name else None


def _checked_voice(ctx: Ctx, provider: TtsProviderName, voice: str, *, require_configured: bool) -> str:
    """Reject voices outside the provider's list (they would only fail later in the worker,
    and Azure puts the name into SSML) and, for new choices, a non-default provider without a
    key. The default provider is the deployment's own choice; a missing key there already shows
    on the usage screen and must not block creating books."""
    if voice not in allowed_voices(ctx.settings, provider):
        raise ApiError(400, "unknown_voice", "Giọng đọc không hợp lệ", field="tts_voice")
    is_default = provider == ctx.settings.tts_default_provider
    if require_configured and not is_default and not provider_configured(ctx.settings, provider):
        raise ApiError(409, "provider_unavailable", "Giọng đọc này chưa được cấu hình trên máy chủ", field="tts_provider")
    return voice


async def load_book(ctx: Ctx, book_id: str) -> Book:
    book = await ctx.books.get(book_id)
    if book is None:
        raise not_found("Không tìm thấy sách")
    return book


async def _book_detail(ctx: Ctx, book_id: str, user) -> dict:
    summary = await ctx.books.get_summary(book_id, user.id)
    if summary is None:
        raise not_found("Không tìm thấy sách")
    out = book_out(summary, user)
    pages = await ctx.pages.list_for_book(book_id)
    out["page_list"] = [page_out(p) for p in pages]
    out["pages"]["missing_seqs"] = missing_seqs(pages)
    out["chunks"]["tail_wait_seconds"] = tail_wait_seconds(summary, ctx.settings.tail_seal_grace_seconds, now_utc())
    return out


@router.get("/me/continue")
async def continue_listening(ctx: Ctx, user: CurrentUser) -> list[dict]:
    return [book_out(b, user) for b in await ctx.books.list_in_progress_for_user(user.id)]


@router.get("/books")
async def list_books(ctx: Ctx, user: CurrentUser) -> list[dict]:
    return [book_out(b, user) for b in await ctx.books.list_summaries(user.id)]


@router.post("/books", status_code=201)
async def create_book(body: BookCreateIn, ctx: Ctx, user: CurrentUser) -> dict:
    provider = body.tts_provider or ctx.settings.tts_default_provider
    voice = (body.tts_voice or "").strip() or ctx.settings.default_voice(provider)
    _checked_voice(ctx, provider, voice, require_configured=True)
    title = _clean_title(body.title)
    topic_id = await _topic_id(ctx, _clean_topic(body.topic), user.id)
    book = await ctx.books.create(title, user.id, provider, voice, topic_id)
    log.info("book_created book_id=%s user_id=%s provider=%s", book.id, user.id, provider)
    return await _book_detail(ctx, book.id, user)


@router.get("/books/{book_id}")
async def get_book(book_id: str, ctx: Ctx, user: CurrentUser) -> dict:
    return await _book_detail(ctx, book_id, user)


@router.post("/books/{book_id}/seal-tail", status_code=204)
async def seal_tail(book_id: str, ctx: Ctx, user: CurrentUser) -> None:
    """Skip the tail grace period ("Xong rồi, đọc luôn"). Open to every member, like adding,
    retrying or discarding pages: the worst case is a chunk boundary placed a little early."""
    await load_book(ctx, book_id)
    rows = await ctx.chunks.seal_tail(book_id)
    log.info("book_tail_sealed book_id=%s user_id=%s rows=%d", book_id, user.id, rows)
    if rows:
        ctx.worker.wake()


@router.patch("/books/{book_id}")
async def patch_book(book_id: str, body: BookPatchIn, ctx: Ctx, user: CurrentUser) -> dict:
    book = await load_book(ctx, book_id)
    ensure_book_owner(book, user)
    title = _clean_title(body.title) if body.title is not None else None
    topic_given = "topic" in body.model_fields_set
    topic_name = _clean_topic(body.topic) if topic_given else None
    # Everything is validated before the first write so a 400 leaves the book untouched.
    new_voice: tuple[TtsProviderName, str] | None = None
    if body.tts_provider is not None or body.tts_voice is not None:
        provider = body.tts_provider or book.tts_provider
        voice = (body.tts_voice or "").strip() or (
            book.tts_voice if provider == book.tts_provider else ctx.settings.default_voice(provider)  # type: ignore[arg-type]
        )
        if (provider, voice) != (book.tts_provider, book.tts_voice):
            # Legacy full regeneration kept for installed clients; the UI now uses PUT /voice.
            _checked_voice(ctx, provider, voice, require_configured=False)  # type: ignore[arg-type]
            new_voice = (provider, voice)  # type: ignore[assignment]
    if title is not None:
        await ctx.books.update_title(book_id, title)
    if topic_given:
        await ctx.books.set_topic(book_id, await _topic_id(ctx, topic_name, user.id))
    if new_voice is not None:
        await ctx.books.change_voice(book_id, *new_voice)
        log.info("book_voice_changed book_id=%s provider=%s voice=%s", book_id, *new_voice)
        ctx.worker.wake()
    return await _book_detail(ctx, book_id, user)


@router.put("/books/{book_id}/voice")
async def set_book_voice(book_id: str, body: BookVoiceIn, ctx: Ctx, user: CurrentUser) -> dict:
    """Change the voice for content that has no audio yet (chosen when adding pages)."""
    book = await load_book(ctx, book_id)
    ensure_book_owner(book, user)
    voice = body.tts_voice.strip()
    if (body.tts_provider, voice) == (book.tts_provider, book.tts_voice):
        return await _book_detail(ctx, book_id, user)  # no-op stays valid even if config changed since
    _checked_voice(ctx, body.tts_provider, voice, require_configured=True)
    await ctx.books.set_voice(book_id, body.tts_provider, voice)
    log.info("book_voice_set book_id=%s user_id=%s provider=%s voice=%s", book_id, user.id, body.tts_provider, voice)
    ctx.worker.wake()
    return await _book_detail(ctx, book_id, user)


@router.delete("/books/{book_id}", status_code=204)
async def delete_book(book_id: str, ctx: Ctx, user: CurrentUser) -> None:
    book = await load_book(ctx, book_id)
    ensure_book_owner(book, user)
    image_paths = await ctx.pages.image_paths_for_book(book_id)
    await ctx.books.delete(book_id)
    await asyncio.to_thread(_remove_book_files, ctx.settings.library_dir / book_id, image_paths)
    log.info("book_deleted book_id=%s user_id=%s", book_id, user.id)


def _remove_book_files(library_dir: Path, image_paths: list[str]) -> None:
    shutil.rmtree(library_dir, ignore_errors=True)
    for p in image_paths:
        Path(p).unlink(missing_ok=True)


@router.get("/books/{book_id}/chunks")
async def list_chunks(book_id: str, ctx: Ctx, user: CurrentUser) -> list[dict]:
    await load_book(ctx, book_id)
    return [chunk_out(c) for c in await ctx.chunks.list_for_book(book_id)]


@router.get("/books/{book_id}/progress")
async def get_progress(book_id: str, ctx: Ctx, user: CurrentUser) -> dict:
    await load_book(ctx, book_id)
    p = await ctx.progress.get(user.id, book_id)
    if p is None:
        return {"chunk_seq": 0, "offset_ms": 0, "updated_at": None}
    return {"chunk_seq": p.chunk_seq, "offset_ms": p.offset_ms, "updated_at": p.updated_at}


@router.put("/books/{book_id}/progress")
async def put_progress(book_id: str, body: ProgressIn, ctx: Ctx, user: CurrentUser) -> dict:
    await load_book(ctx, book_id)
    p = await ctx.progress.upsert(user.id, book_id, body.chunk_seq, body.offset_ms)
    return {"chunk_seq": p.chunk_seq, "offset_ms": p.offset_ms, "updated_at": p.updated_at}
