from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.serializers import chunk_out
from app.api_errors import ApiError, not_found
from app.auth.current_user import Ctx, CurrentUser
from app.file_paths import is_within

router = APIRouter(prefix="/api", tags=["chunks"])

CHUNK_TEXT_MAX = 3000


class ChunkPatchIn(BaseModel):
    text: str


@router.patch("/chunks/{chunk_id}")
async def patch_chunk(chunk_id: str, body: ChunkPatchIn, ctx: Ctx, user: CurrentUser) -> dict:
    if await ctx.chunks.get(chunk_id) is None:
        raise not_found("Không tìm thấy đoạn")
    text = body.text.strip()
    if not 1 <= len(text) <= CHUNK_TEXT_MAX:
        raise ApiError(400, "text_invalid", f"Nội dung đoạn 1–{CHUNK_TEXT_MAX} ký tự", "text")
    await ctx.chunks.update_text(chunk_id, text)
    ctx.worker.wake()
    return chunk_out(await ctx.chunks.get(chunk_id))  # type: ignore[arg-type]


@router.post("/chunks/{chunk_id}/retry")
async def retry_chunk(chunk_id: str, ctx: Ctx, user: CurrentUser) -> dict:
    if await ctx.chunks.get(chunk_id) is None:
        raise not_found("Không tìm thấy đoạn")
    if not await ctx.chunks.reset_for_retry(chunk_id):
        raise ApiError(409, "chunk_not_retryable", "Đoạn không ở trạng thái lỗi hoặc chờ quota")
    ctx.worker.wake()
    return chunk_out(await ctx.chunks.get(chunk_id))  # type: ignore[arg-type]


@router.get("/chunks/{chunk_id}/audio")
async def chunk_audio(chunk_id: str, ctx: Ctx, user: CurrentUser) -> FileResponse:
    chunk = await ctx.chunks.get(chunk_id)
    if chunk is None or not chunk.audio_path:
        raise not_found("Đoạn chưa có audio")
    path = Path(chunk.audio_path)
    if not is_within(path, ctx.settings.library_dir) or not path.is_file():
        raise not_found("Đoạn chưa có audio")
    # URL carries ?v=<content hash>, so a given URL always maps to the same bytes.
    return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"})
