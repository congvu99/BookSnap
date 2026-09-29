"""Append-only log of OCR/TTS provider call attempts, summed per quota window on read."""

from dataclasses import dataclass
from typing import Literal

from app.db import Database, now_iso

UsageService = Literal["gemini_ocr", "gemini_tts", "azure_tts"]
UsageOutcome = Literal["ok", "quota", "error"]


@dataclass(frozen=True)
class UsageTotals:
    # Attempts the provider answered with anything but a quota rejection: these are what
    # count against a requests-per-day quota.
    requests: int
    # Characters sent on successful calls: what a per-character quota (Azure) bills.
    chars: int
    quota_hits: int
    last_quota_at: str | None


class ProviderUsageRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def record(self, service: UsageService, outcome: UsageOutcome, chars: int, book_id: str | None) -> None:
        await self.db.execute(
            "INSERT INTO provider_usage(service, outcome, chars, book_id, created_at) VALUES (?,?,?,?,?)",
            (service, outcome, chars if outcome == "ok" else 0, book_id, now_iso()),
        )

    async def totals_since(self, service: UsageService, since: str) -> UsageTotals:
        row = await self.db.fetchone(
            "SELECT COALESCE(SUM(outcome != 'quota'), 0) AS requests, COALESCE(SUM(chars), 0) AS chars,"
            " COALESCE(SUM(outcome = 'quota'), 0) AS quota_hits,"
            " MAX(CASE WHEN outcome = 'quota' THEN created_at END) AS last_quota_at"
            " FROM provider_usage WHERE service=? AND created_at >= ?",
            (service, since),
        )
        assert row is not None
        return UsageTotals(row["requests"], row["chars"], row["quota_hits"], row["last_quota_at"])

    async def delete_older_than(self, cutoff: str) -> int:
        return await self.db.execute("DELETE FROM provider_usage WHERE created_at < ?", (cutoff,))
