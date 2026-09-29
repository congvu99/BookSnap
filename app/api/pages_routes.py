import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile
from fastapi import Path as PathParam
from fastapi.responses import JSONResponse

from app.api.books_routes import load_book
from app.api.serializers import page_out
from app.api_errors import ApiError, not_found
from app.auth.current_user import Ctx, CurrentUser
from app.repositories.page_repository import PageSeqConflictError
from app.repositories.row_mapping import new_id

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["pages"])

_EXT_BY_MIME = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_PAGE_SEQ = 100_000


def sniff_image_mime(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


@router.post("/books/{book_id}/pages", status_code=202)
async def upload_page(
    book_id: str,
    ctx: Ctx,
    user: CurrentUser,
    image: UploadFile = File(...),
    seq: int = Form(..., ge=0, le=MAX_PAGE_SEQ),
    upload_id: str | None = Form(default=None, max_length=64),
):
    await load_book(ctx, book_id)
    limit = ctx.settings.max_upload_bytes
    data = await image.read(limit + 1)
    if len(data) > limit:
        raise ApiError(413, "image_too_large", f"Ảnh vượt quá {limit // (1024 * 1024)}MB", "image")
    declared = (image.content_type or "").split(";")[0].strip().lower()
    actual = sniff_image_mime(data[:16])
    if declared not in _EXT_BY_MIME or actual != declared:
        raise ApiError(415, "image_type_invalid", "Chỉ nhận ảnh JPEG, PNG hoặc WebP", "image")

    page_id = new_id()
    ctx.settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    path = ctx.settings.tmp_dir / f"{page_id}.{_EXT_BY_MIME[actual]}"
    await asyncio.to_thread(path.write_bytes, data)
    try:
        page = await ctx.pages.create(book_id, seq, str(path), actual, upload_id, page_id=page_id)
    except PageSeqConflictError as conflict:
        path.unlink(missing_ok=True)
        existing = conflict.existing
        if existing is not None and upload_id and existing.client_upload_id == upload_id:
            return JSONResponse(page_out(existing), status_code=200)
        raise ApiError(409, "page_seq_taken", "Số trang này đã tồn tại trong sách", "seq") from None

    await ctx.books.touch(book_id)
    log.info("page_uploaded page_id=%s book_id=%s seq=%d bytes=%d user_id=%s", page.id, book_id, seq, len(data), user.id)
    ctx.worker.wake()
    return page_out(page)


@router.post("/books/{book_id}/pages/{seq}/discard")
async def discard_page(book_id: str, ctx: Ctx, user: CurrentUser, seq: int = PathParam(ge=0, le=MAX_PAGE_SEQ)) -> dict:
    await load_book(ctx, book_id)
    before = await ctx.pages.get_by_seq(book_id, seq)
    page = await ctx.pages.discard(book_id, seq)
    if page is None:
        raise ApiError(409, "page_not_discardable", "Chỉ bỏ được trang lỗi hoặc trang còn thiếu")
    if before is not None and before.image_path:
        await asyncio.to_thread(Path(before.image_path).unlink, True)
    await ctx.books.touch(book_id)
    log.info("page_discarded book_id=%s seq=%d user_id=%s", book_id, seq, user.id)
    ctx.worker.wake()
    return page_out(page)


@router.post("/pages/{page_id}/retry")
async def retry_page(page_id: str, ctx: Ctx, user: CurrentUser) -> dict:
    page = await ctx.pages.get(page_id)
    if page is None:
        raise not_found("Không tìm thấy trang")
    if not await ctx.pages.reset_for_retry(page_id):
        raise ApiError(409, "page_not_retryable", "Trang không ở trạng thái lỗi hoặc ảnh gốc đã hết hạn")
    ctx.worker.wake()
    refreshed = await ctx.pages.get(page_id)
    return page_out(refreshed)  # type: ignore[arg-type]

