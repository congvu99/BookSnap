from fastapi import APIRouter

from app.auth.current_user import Ctx, CurrentAccount
from app.db import now_utc
from app.usage_quota import usage_summary

router = APIRouter(prefix="/api", tags=["usage"])


@router.get("/usage")
async def get_usage(ctx: Ctx, session: CurrentAccount) -> dict:
    """Household-wide provider quota status: every profile shares the same API keys."""
    now = now_utc()
    return {"as_of": now.isoformat(), "services": await usage_summary(ctx, now)}
