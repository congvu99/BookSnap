from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

TtsProviderName = Literal["gemini", "azure"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    data_dir: Path = Path("./data")
    invite_code: str = ""
    cookie_secure: bool = True
    session_ttl_days: int = 180
    max_upload_bytes: int = 5 * 1024 * 1024
    auth_rate_limit_per_minute: int = 10
    log_level: str = "INFO"

    gemini_api_key: str = ""
    gemini_ocr_model: str = "gemini-2.5-flash"
    gemini_ocr_rpm: int = 15
    # Daily/monthly quotas shown on the account screen; 0 = unknown (only usage is shown).
    gemini_ocr_rpd: int = 0
    gemini_tts_model: str = "gemini-2.5-flash-preview-tts"
    gemini_tts_voice: str = "Kore"
    gemini_tts_style: str = "Đọc bằng giọng kể chuyện ấm áp, chậm rãi, truyền cảm:"
    gemini_tts_rpm: int = 10
    gemini_tts_rpd: int = 0

    azure_speech_key: str = ""
    azure_speech_region: str = "southeastasia"
    azure_tts_voice: str = "vi-VN-HoaiMyNeural"
    azure_tts_rpm: int = 20
    azure_tts_monthly_chars: int = 0

    tts_default_provider: TtsProviderName = "gemini"

    ocr_concurrency: int = 2
    tts_concurrency: int = 2
    worker_poll_seconds: float = 2.0
    failed_image_ttl_hours: int = 24
    tail_seal_grace_seconds: float = 90.0
    cleanup_interval_seconds: float = 3600.0
    usage_retention_days: int = 62

    # Tests build the worker explicitly with fake providers, so the app's own lifespan
    # must not start a second, real one on top of it (see tests/conftest.py `settings`).
    worker_enabled: bool = True

    @property
    def db_path(self) -> Path:
        return self.data_dir / "booksnap.db"

    @property
    def library_dir(self) -> Path:
        return self.data_dir / "library"

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"

    def default_voice(self, provider: TtsProviderName) -> str:
        return self.gemini_tts_voice if provider == "gemini" else self.azure_tts_voice


@lru_cache
def get_settings() -> Settings:
    return Settings()
