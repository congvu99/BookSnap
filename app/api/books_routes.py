import asyncio
import logging
import shutil
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.serializers import book_out, chunk_out, missing_seqs, page_out
from app.api_errors import ApiError, not_found
from app.auth.current_user import Ctx, CurrentUser, ensure_book_owner
from app.config import TtsProviderName
from app.repositories.book_repository import Book

log = logging.getLogger(__name__)

TITLE_MAX = 120

router = APIRouter(prefix="/api", tags=["books"])


class BookCreateIn(BaseModel):
    title: str
    tts_provider: TtsProviderName | None = None
    tts_voice: str | None = Field(default=None, max_length=80)


class BookPatchIn(BaseModel):
    title: str | None = None
    tts_provider: TtsProviderName | None = None
    tts_voice: str | None = Field(default=None, max_length=80)


class ProgressIn(BaseModel):
    chunk_seq: int = Field(ge=0)
    offset_ms: int = Field(ge=0)


def _clean_title(raw: str) -> str:
    title = raw.strip()
    if not 1 <= len(title) <= TITLE_MAX:
        raise ApiError(400, "title_invalid", f"Tên sách 1–{TITLE_MAX} ký tự", "title")
    return title


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
    book = await ctx.books.create(_clean_title(body.title), user.id, provider, voice)
    log.info("book_created book_id=%s user_id=%s provider=%s", book.id, user.id, provider)
    return await _book_detail(ctx, book.id, user)


@router.get("/books/{book_id}")
async def get_book(book_id: str, ctx: Ctx, user: CurrentUser) -> dict:
    return await _book_detail(ctx, book_id, user)


@router.patch("/books/{book_id}")
async def patch_book(book_id: str, body: BookPatchIn, ctx: Ctx, user: CurrentUser) -> dict:
    book = await load_book(ctx, book_id)
    ensure_book_owner(book, user)
    if body.title is not None:
        await ctx.books.update_title(book_id, _clean_title(body.title))
    if body.tts_provider is not None or body.tts_voice is not None:
        provider = body.tts_provider or book.tts_provider
        voice = (body.tts_voice or "").strip() or (
            book.tts_voice if provider == book.tts_provider else ctx.settings.default_voice(provider)  # type: ignore[arg-type]
        )
        if (provider, voice) != (book.tts_provider, book.tts_voice):
            await ctx.books.change_voice(book_id, provider, voice)
            log.info("book_voice_changed book_id=%s provider=%s voice=%s", book_id, provider, voice)
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
