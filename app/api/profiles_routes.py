"""Profiles of the family account: list, add, pick the one this device listens as, manage."""

import asyncio
import logging
import re

from fastapi import APIRouter
from pydantic import BaseModel

from app.api_errors import ApiError, not_found
from app.auth.auth_routes import MeOut, validate_display_name
from app.auth.current_user import Ctx, CurrentAccount, CurrentUser
from app.auth.password_hashing import verify_password
from app.repositories.user_repository import User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/profiles", tags=["profiles"])

MAX_PROFILES = 8
# Avatar = the name's initial on one of eight preset colours (tokens c1..c8 in the web CSS).
AVATAR_RE = re.compile(r"^c[1-8]$")


class ProfileOut(BaseModel):
    id: str
    display_name: str
    avatar: str

    @classmethod
    def of(cls, user: User) -> "ProfileOut":
        return cls(id=user.id, display_name=user.display_name, avatar=user.avatar)


class ProfileCreateIn(BaseModel):
    display_name: str
    avatar: str | None = None


def validate_avatar(avatar: str | None) -> str | None:
    if avatar is not None and not AVATAR_RE.fullmatch(avatar):
        raise ApiError(400, "avatar_invalid", "Màu hồ sơ không hợp lệ", "avatar")
    return avatar


@router.get("")
async def list_profiles(ctx: Ctx, session: CurrentAccount) -> list[ProfileOut]:
    return [ProfileOut.of(u) for u in await ctx.users.list_for_account(session.account.id)]


@router.post("", status_code=201)
async def create_profile(body: ProfileCreateIn, ctx: Ctx, session: CurrentAccount) -> ProfileOut:
    display_name = validate_display_name(body.display_name)
    avatar = validate_avatar(body.avatar)
    user = await ctx.users.add_to_account(session.account.id, display_name, avatar, MAX_PROFILES)
    if user is None:
        raise ApiError(409, "profile_limit", f"Tối đa {MAX_PROFILES} hồ sơ")
    log.info("profile_created account_id=%s profile_id=%s", session.account.id, user.id)
    return ProfileOut.of(user)


@router.post("/{profile_id}/select")
async def select_profile(profile_id: str, ctx: Ctx, session: CurrentAccount) -> MeOut:
    user = await ctx.session_service.select_profile(session, profile_id)
    if user is None:
        raise not_found("Không tìm thấy hồ sơ")
    log.info("profile_selected account_id=%s profile_id=%s", session.account.id, user.id)
    return MeOut.of(session.account, user)


class ProfilePatchIn(BaseModel):
    display_name: str | None = None
    avatar: str | None = None


class ProfileDeleteIn(BaseModel):
    password: str


@router.patch("/{profile_id}")
async def update_profile(profile_id: str, body: ProfilePatchIn, ctx: Ctx, session: CurrentAccount) -> ProfileOut:
    """Any profile of the family may rename or recolour any other ("Quản lý hồ sơ")."""
    display_name = validate_display_name(body.display_name) if body.display_name is not None else None
    avatar = validate_avatar(body.avatar)
    user = await ctx.users.update_in_account(session.account.id, profile_id, display_name, avatar)
    if user is None:
        raise not_found("Không tìm thấy hồ sơ")
    return ProfileOut.of(user)


@router.delete("/{profile_id}", status_code=204)
async def delete_profile(profile_id: str, body: ProfileDeleteIn, ctx: Ctx, session: CurrentAccount, user: CurrentUser) -> None:
    """Irreversible (progress, bookmarks and shelf are lost), so it asks for the family password."""
    account = session.account
    retry_after = ctx.auth_limiter.hit(f"password:{account.id}")
    if retry_after is not None:
        raise ApiError(
            429, "rate_limited", "Thử quá nhiều lần, vui lòng đợi một chút", headers={"Retry-After": str(int(retry_after) + 1)}
        )
    if not await asyncio.to_thread(verify_password, account.password_hash, body.password):
        log.info("profile_delete outcome=denied account_id=%s", account.id)
        raise ApiError(403, "password_invalid", "Mật khẩu gia đình không đúng", "password")
    if profile_id == user.id:
        raise ApiError(409, "profile_active", "Không thể xoá hồ sơ đang dùng, hãy đổi sang hồ sơ khác trước")
    result = await ctx.users.delete_with_heir(account.id, profile_id)
    if result is None:
        # Not in this family (the last profile is always the one in use, handled above).
        raise not_found("Không tìm thấy hồ sơ")
    heir_id, books_reassigned = result
    log.info(
        "profile_deleted account_id=%s profile_id=%s heir_id=%s books_reassigned=%d",
        account.id, profile_id, heir_id, books_reassigned,
    )
