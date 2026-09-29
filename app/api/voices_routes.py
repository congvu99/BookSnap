from fastapi import APIRouter

from app.auth.current_user import Ctx, CurrentUser

router = APIRouter(prefix="/api", tags=["voices"])

GEMINI_VOICES = ["Kore", "Aoede", "Leda", "Zephyr", "Puck", "Charon", "Fenrir", "Orus"]
AZURE_VOICES = ["vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"]


def _with_default(voices: list[str], default: str) -> list[str]:
    return voices if default in voices else [default, *voices]


@router.get("/voices")
async def list_voices(ctx: Ctx, user: CurrentUser) -> dict:
    s = ctx.settings
    return {
        "default_provider": s.tts_default_provider,
        "providers": {
            "gemini": {"default": s.gemini_tts_voice, "voices": _with_default(GEMINI_VOICES, s.gemini_tts_voice)},
            "azure": {"default": s.azure_tts_voice, "voices": _with_default(AZURE_VOICES, s.azure_tts_voice)},
        },
    }
