import asyncio
import hmac
import logging
import re

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.api_errors import ApiError
from app.auth.current_user import Ctx, CurrentUser
from app.auth.password_hashing import hash_password, needs_rehash, verify_password
from app.auth.rate_limiter import client_ip
from app.auth.session_service import COOKIE_NAME
from app.repositories.user_repository import User, UsernameTakenError

log = logging.getLogger(__name__)

USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,32}$")
PASSWORD_MIN, PASSWORD_MAX = 6, 128
DISPLAY_NAME_MAX = 40

public_router = APIRouter(prefix="/api/auth", tags=["auth"])
router = APIRouter(prefix="/api", tags=["auth"])


class RegisterIn(BaseModel):
    username: str
    display_name: str
    password: str
    invite_code: str


class LoginIn(BaseModel):
    username: str
    password: str


class MeOut(BaseModel):
    id: str
    username: str
    display_name: str

    @classmethod
    def of(cls, user: User) -> "MeOut":
        return cls(id=user.id, username=user.username, display_name=user.display_name)


def _enforce_rate_limit(ctx: Ctx, request: Request) -> None:
    retry_after = ctx.auth_limiter.hit(f"auth:{client_ip(request)}")
    if retry_after is not None:
        raise ApiError(
            429, "rate_limited", "Thử quá nhiều lần, vui lòng đợi một chút", headers={"Retry-After": str(int(retry_after) + 1)}
        )


@public_router.post("/register", status_code=201)
async def register(body: RegisterIn, request: Request, response: Response, ctx: Ctx) -> MeOut:
    _enforce_rate_limit(ctx, request)
    username = body.username.strip().lower()
    display_name = body.display_name.strip()
    if not USERNAME_RE.fullmatch(username):
        raise ApiError(400, "username_invalid", "Tên đăng nhập 3–32 ký tự: chữ thường, số, dấu . hoặc _", "username")
    if not 1 <= len(display_name) <= DISPLAY_NAME_MAX:
        raise ApiError(400, "display_name_invalid", f"Tên hiển thị 1–{DISPLAY_NAME_MAX} ký tự", "display_name")
    if not PASSWORD_MIN <= len(body.password) <= PASSWORD_MAX:
        raise ApiError(400, "password_invalid", f"Mật khẩu tối thiểu {PASSWORD_MIN} ký tự", "password")
    expected = ctx.settings.invite_code.encode()
    if not expected or not hmac.compare_digest(body.invite_code.strip().encode(), expected):
        log.info("auth_register outcome=bad_invite ip=%s", client_ip(request))
        raise ApiError(403, "invite_invalid", "Mã mời không đúng", "invite_code")
    try:
        user = await ctx.users.create(username, display_name, await asyncio.to_thread(hash_password, body.password))
    except UsernameTakenError:
        raise ApiError(409, "username_taken", "Tên đăng nhập đã có người dùng", "username") from None
    ctx.session_service.set_cookie(response, await ctx.session_service.create(user.id))
    log.info("auth_register outcome=ok user_id=%s", user.id)
    return MeOut.of(user)


@public_router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, ctx: Ctx) -> MeOut:
    _enforce_rate_limit(ctx, request)
    user = await ctx.users.get_by_username(body.username.strip())
    valid = await asyncio.to_thread(verify_password, user.password_hash if user else None, body.password)
    if not valid or user is None:
        log.info("auth_login outcome=denied ip=%s", client_ip(request))
        raise ApiError(401, "invalid_credentials", "Sai tên đăng nhập hoặc mật khẩu")
    if needs_rehash(user.password_hash):
        await ctx.users.update_password_hash(user.id, await asyncio.to_thread(hash_password, body.password))
    ctx.session_service.set_cookie(response, await ctx.session_service.create(user.id))
    log.info("auth_login outcome=ok user_id=%s", user.id)
    return MeOut.of(user)


@public_router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, ctx: Ctx) -> None:
    await ctx.session_service.revoke(request.cookies.get(COOKIE_NAME))
    ctx.session_service.clear_cookie(response)


@router.get("/me")
async def me(user: CurrentUser) -> MeOut:
    return MeOut.of(user)
