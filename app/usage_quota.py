"""How much of each provider quota is left, as far as this app can tell.

Neither Gemini nor Azure exposes "remaining quota" through the API, so usage is metered locally
(`provider_usage`, one row per call attempt) and compared against limits set in config. Calls made
with the same key from elsewhere (AI Studio, another app) are invisible here; a provider 429 is the
only ground truth, surfaced as `paused_until` / `last_quota_at`.

Windows follow each provider's reset rule: Gemini requests-per-day reset at midnight Pacific time;
Azure F0 characters are counted per calendar month (UTC here — the exact anchor is Azure's billing
cycle).
"""

from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from app.app_context import AppContext
from app.config import Settings
from app.db import to_iso
from app.repositories.provider_usage_repository import UsageService

PACIFIC = ZoneInfo("America/Los_Angeles")

QuotaWindow = Literal["pacific_day", "utc_month"]
QuotaStatus = Literal["unconfigured", "paused", "exhausted", "ok"]


@dataclass(frozen=True)
class QuotaPolicy:
    service: UsageService
    tts_provider: str | None
    label: str
    unit: Literal["requests", "chars"]
    window: QuotaWindow
    limit: int
    configured: bool


def quota_policies(settings: Settings) -> list[QuotaPolicy]:
    gemini = bool(settings.gemini_api_key)
    return [
        QuotaPolicy("gemini_ocr", None, "Nhận dạng chữ · Gemini", "requests", "pacific_day", settings.gemini_ocr_rpd, gemini),
        QuotaPolicy("gemini_tts", "gemini", "Giọng đọc · Gemini", "requests", "pacific_day", settings.gemini_tts_rpd, gemini),
        QuotaPolicy(
            "azure_tts", "azure", "Giọng đọc · Azure", "chars", "utc_month", settings.azure_tts_monthly_chars, bool(settings.azure_speech_key)
        ),
    ]


def window_bounds(window: QuotaWindow, now: datetime) -> tuple[datetime, datetime]:
    if window == "pacific_day":
        day = now.astimezone(PACIFIC).date()
        # combine() at local midnight keeps DST days at their real 23h/25h length.
        return datetime.combine(day, time(), tzinfo=PACIFIC), datetime.combine(day + timedelta(days=1), time(), tzinfo=PACIFIC)
    start = now.astimezone(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start, (start + timedelta(days=32)).replace(day=1)


async def usage_summary(ctx: AppContext, now: datetime) -> list[dict]:
    now_s = to_iso(now)
    waits = await ctx.chunks.quota_waits(now_s)
    out: list[dict] = []
    for policy in quota_policies(ctx.settings):
        start, end = window_bounds(policy.window, now)
        totals = await ctx.usage.totals_since(policy.service, to_iso(start))
        used = totals.chars if policy.unit == "chars" else totals.requests
        limit = policy.limit if policy.limit > 0 else None
        paused_until, waiting = waits.get(policy.tts_provider or "", (None, 0))
        status: QuotaStatus
        if not policy.configured:
            status = "unconfigured"
        elif paused_until:
            status = "paused"
        elif limit is not None and used >= limit:
            status = "exhausted"
        else:
            status = "ok"
        out.append(
            {
                "service": policy.service,
                "label": policy.label,
                "unit": policy.unit,
                "window": policy.window,
                "status": status,
                "used": used,
                "limit": limit,
                "remaining": max(0, limit - used) if limit is not None else None,
                "window_start": to_iso(start),
                "resets_at": to_iso(end),
                "quota_hits": totals.quota_hits,
                "last_quota_at": totals.last_quota_at,
                "paused_until": paused_until,
                "waiting_chunks": waiting,
            }
        )
    return out
