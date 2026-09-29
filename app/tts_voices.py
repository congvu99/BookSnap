"""Voices a book may use, per TTS provider, and whether that provider can synthesize at all.

Single source for the voice picker (`/api/voices`), book create/voice-change validation, the
preview endpoint and `scripts/voice_poc.py`. Validation applies to new input only: voices
already stored on a book keep working even if they later drop off these lists.
"""

from app.config import Settings, TtsProviderName

GEMINI_VOICES = ["Charon", "Orus", "Fenrir", "Puck", "Kore", "Aoede", "Leda", "Zephyr"]
AZURE_VOICES = ["vi-VN-NamMinhNeural", "vi-VN-HoaiMyNeural"]

_VOICES: dict[str, list[str]] = {"gemini": GEMINI_VOICES, "azure": AZURE_VOICES}


def allowed_voices(settings: Settings, provider: TtsProviderName) -> list[str]:
    """The provider's list, with the configured default first if an env var set one outside it."""
    voices = _VOICES[provider]
    default = settings.default_voice(provider)
    return voices if default in voices else [default, *voices]


def provider_configured(settings: Settings, provider: TtsProviderName) -> bool:
    return bool(settings.gemini_api_key if provider == "gemini" else settings.azure_speech_key)
