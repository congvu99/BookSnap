"""In-memory sliding-window limiter. State is lost on restart, acceptable for a single replica."""

import time
from collections import deque

from fastapi import Request


class RateLimiter:
    def __init__(self, max_hits: int, window_seconds: float, max_keys: int = 10_000) -> None:
        self.max_hits = max_hits
        self.window = window_seconds
        self.max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}

    def hit(self, key: str) -> float | None:
        """Record a hit; return seconds until retry when over the limit, else None."""
        now = time.monotonic()
        hits = self._hits.get(key)
        if hits is None:
            if len(self._hits) >= self.max_keys:
                self._evict(now)
            hits = self._hits[key] = deque()
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        if len(hits) >= self.max_hits:
            return max(0.0, self.window - (now - hits[0]))
        hits.append(now)
        return None

    def _evict(self, now: float) -> None:
        stale = [k for k, h in self._hits.items() if not h or now - h[-1] >= self.window]
        for k in stale:
            del self._hits[k]
        if len(self._hits) >= self.max_keys:
            self._hits.clear()


def client_ip(request: Request) -> str:
    """Railway's edge proxy appends the real client address as the last X-Forwarded-For entry."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"
