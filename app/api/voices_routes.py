import logging
import time

from fastapi import APIRouter
from fastapi.responses import FileResponse

from app.api_errors import ApiError, not_found
from app.auth.current_user import Ctx, CurrentAccount, CurrentUser
from app.tts_voices import allowed_voices, provider_configured
from app.voice_preview import PreviewError

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["voices"])

PROVIDERS = ("gemini", "azure")

# Fixed messages only: provider error text stays in the server log.
_PREVIEW_ERRORS: dict[str, tuple[int, str]] = {
    "rate_limited": (429, "Nghe thử nhiều quá, đợi một chút rồi thử lại"),
    "tts_quota": (503, "Hết lượt đọc thử, thử lại sau"),
    "tts_timeout": (503, "Máy chủ đọc thử đang chậm, thử lại sau"),
    "tts_failed": (502, "Không đọc thử được giọng này"),
}


@router.get("/voices")
async def list_voices(ctx: Ctx, session: CurrentAccount) -> dict:
    s = ctx.settings
    preview = ctx.voice_preview
    return {
        "default_provider": s.tts_default_provider,
        "providers": {
            provider: {
                "default": s.default_voice(provider),
                "voices": allowed_voices(s, provider),
                "configured": provider_configured(s, provider),
                "preview_urls": {v: preview.preview_url(provider, v) for v in allowed_voices(s, provider)},
            }
            for provider in PROVIDERS
        },
    }


@router.get("/voices/{provider}/{voice}/preview")
async def voice_preview(provider: str, voice: str, ctx: Ctx, user: CurrentUser) -> FileResponse:
    """MP3 of the fixed preview sentence. The `?v=` query from /api/voices versions the URL, so
    it can be cached immutably; the path itself is only a whitelisted provider/voice pair."""
    if provider not in PROVIDERS or voice not in allowed_voices(ctx.settings, provider):  # type: ignore[arg-type]
        raise not_found("Không có giọng này")
    service = ctx.voice_preview
    if not service.is_configured(provider):
        raise ApiError(409, "provider_unavailable", "Giọng đọc này chưa được cấu hình trên máy chủ")

    started = time.monotonic()
    try:
        path, cache_hit = await service.get(provider, voice, user.id)
    except PreviewError as exc:
        status, message = _PREVIEW_ERRORS[exc.code]
        log.info("voice_preview user_id=%s provider=%s voice=%s outcome=%s", user.id, provider, voice, exc.code)
        headers = {"Retry-After": exc.retry_after_header} if exc.retry_after_header else None
        raise ApiError(status, exc.code, message, headers=headers) from exc
    log.info(
        "voice_preview user_id=%s provider=%s voice=%s cache_hit=%s ms=%d outcome=ok",
        user.id, provider, voice, cache_hit, (time.monotonic() - started) * 1000,
    )
    return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"})
