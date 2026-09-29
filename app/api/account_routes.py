"""The signed-in user's own account: profile + stats, display name, password change."""

import asyncio
import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.api_errors import ApiError
from app.auth.auth_routes import DISPLAY_NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, MeOut
from app.auth.current_user import Ctx, CurrentUser
from app.auth.password_hashing import hash_password, verify_password
from app.auth.session_service import COOKIE_NAME, hash_token

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/me", tags=["account"])


class ProfilePatchIn(BaseModel):
    display_name: str


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str


@router.get("/profile")
async def get_profile(ctx: Ctx, user: CurrentUser) -> dict:
    stats = await ctx.users.stats(user.id)
    return {
        **MeOut.of(user).model_dump(),
        "created_at": user.created_at,
        "stats": {
            "books_created": stats.books_created,
            "pages_captured": stats.pages_captured,
            "books_listening": stats.books_listening,
            "bookmarks": stats.bookmarks,
        },
    }


@router.patch("")
async def update_profile(body: ProfilePatchIn, ctx: Ctx, user: CurrentUser) -> MeOut:
    display_name = body.display_name.strip()
    if not 1 <= len(display_name) <= DISPLAY_NAME_MAX:
        raise ApiError(400, "display_name_invalid", f"Tên hiển thị 1–{DISPLAY_NAME_MAX} ký tự", "display_name")
    await ctx.users.update_display_name(user.id, display_name)
    log.info("account_update outcome=ok user_id=%s", user.id)
    updated = await ctx.users.get(user.id)
    assert updated is not None
    return MeOut.of(updated)


@router.post("/password")
async def change_password(body: PasswordChangeIn, request: Request, ctx: Ctx, user: CurrentUser) -> dict:
    """Verify the current password, set the new one and sign out every other device."""
    retry_after = ctx.auth_limiter.hit(f"password:{user.id}")
    if retry_after is not None:
        raise ApiError(
            429, "rate_limited", "Thử quá nhiều lần, vui lòng đợi một chút", headers={"Retry-After": str(int(retry_after) + 1)}
        )
    if not await asyncio.to_thread(verify_password, user.password_hash, body.current_password):
        log.info("account_password outcome=denied user_id=%s", user.id)
        raise ApiError(400, "current_password_invalid", "Mật khẩu hiện tại không đúng", "current_password")
    if not PASSWORD_MIN <= len(body.new_password) <= PASSWORD_MAX:
        raise ApiError(400, "password_invalid", f"Mật khẩu mới {PASSWORD_MIN}–{PASSWORD_MAX} ký tự", "new_password")
    if body.new_password == body.current_password:
        raise ApiError(400, "password_unchanged", "Mật khẩu mới phải khác mật khẩu hiện tại", "new_password")
    await ctx.users.update_password_hash(user.id, await asyncio.to_thread(hash_password, body.new_password))
    # require_user already resolved this cookie, so it is present and valid.
    current_hash = hash_token(request.cookies[COOKIE_NAME])
    revoked = await ctx.sessions.delete_for_user_except(user.id, current_hash)
    log.info("account_password outcome=ok user_id=%s other_sessions_revoked=%d", user.id, revoked)
    return {"other_sessions_revoked": revoked}
