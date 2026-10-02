"""Connection diagnostics: lets a device compare its latency and the address the server sees (e.g.
whether iCloud Private Relay is in the path) without reading any user data."""

from fastapi import APIRouter, Request, Response

from app.auth.rate_limiter import client_ip
from app.db import now_iso

router = APIRouter(prefix="/api/diag", tags=["diagnostics"])


@router.get("/ping")
async def ping(request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return {
        "ip": client_ip(request),
        "via": request.headers.get("via"),
        "server_time": now_iso(),
    }
