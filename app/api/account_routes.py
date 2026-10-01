"""The signed-in profile (stats, display name) and the family account's password."""

import asyncio
import logging

from fastapi import APIRouter
from pydantic import BaseModel

from app.api_errors import ApiError
from app.auth.auth_routes import PASSWORD_MAX, PASSWORD_MIN, MeOut, validate_display_name
from app.auth.current_user import Ctx, CurrentAccount, CurrentUser
from app.auth.password_hashing import hash_password, verify_password

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/me", tags=["account"])


class ProfilePatchIn(BaseModel):
    display_name: str


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str


@router.get("/profile")
async def get_profile(ctx: Ctx, session: CurrentAccount, user: CurrentUser) -> dict:
    stats = await ctx.users.stats(user.id)
    return {
        **MeOut.of(session.account, user).model_dump(),
        "created_at": user.created_at,
        "stats": {
            "books_created": stats.books_created,
            "pages_captured": stats.pages_captured,
            "books_listening": stats.books_listening,
            "bookmarks": stats.bookmarks,
        },
    }


@router.patch("")
async def update_profile(body: ProfilePatchIn, ctx: Ctx, session: CurrentAccount, user: CurrentUser) -> MeOut:
    """Rename the current profile."""
    display_name = validate_display_name(body.display_name)
    await ctx.users.update_display_name(user.id, display_name)
    log.info("account_update outcome=ok profile_id=%s", user.id)
    updated = await ctx.users.get(user.id)
    if updated is None:  # deleted from another device meanwhile
        raise ApiError(409, "profile_required", "Hồ sơ không còn, hãy chọn hồ sơ khác")
    return MeOut.of(session.account, updated)


@router.post("/password")
async def change_password(body: PasswordChangeIn, ctx: Ctx, session: CurrentAccount) -> dict:
    """Change the family password and sign out every other device, whichever profile it was on."""
    account = session.account
    # Keyed by account: every profile guesses the same password, so they share one budget.
    retry_after = ctx.auth_limiter.hit(f"password:{account.id}")
    if retry_after is not None:
        raise ApiError(
            429, "rate_limited", "Thử quá nhiều lần, vui lòng đợi một chút", headers={"Retry-After": str(int(retry_after) + 1)}
        )
    if not await asyncio.to_thread(verify_password, account.password_hash, body.current_password):
        log.info("account_password outcome=denied account_id=%s", account.id)
        raise ApiError(400, "current_password_invalid", "Mật khẩu hiện tại không đúng", "current_password")
    if not PASSWORD_MIN <= len(body.new_password) <= PASSWORD_MAX:
        raise ApiError(400, "password_invalid", f"Mật khẩu mới {PASSWORD_MIN}–{PASSWORD_MAX} ký tự", "new_password")
    if body.new_password == body.current_password:
        raise ApiError(400, "password_unchanged", "Mật khẩu mới phải khác mật khẩu hiện tại", "new_password")
    await ctx.accounts.update_password_hash(account.id, await asyncio.to_thread(hash_password, body.new_password))
    revoked = await ctx.sessions.delete_for_account_except(account.id, session.token_hash)
    log.info("account_password outcome=ok account_id=%s other_sessions_revoked=%d", account.id, revoked)
    return {"other_sessions_revoked": revoked}
