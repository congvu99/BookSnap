import asyncio
import hmac
import logging
import re

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.api_errors import ApiError
from app.auth.current_user import Ctx, CurrentAccount, CurrentUser
from app.auth.password_hashing import hash_password, needs_rehash, verify_password
from app.auth.rate_limiter import client_ip
from app.auth.session_service import COOKIE_NAME
from app.repositories.account_repository import Account
from app.repositories.user_repository import User

log = logging.getLogger(__name__)

USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,32}$")
PASSWORD_MIN, PASSWORD_MAX = 6, 128
DISPLAY_NAME_MAX = 40
FIRST_PROFILE_AVATAR = "c1"

public_router = APIRouter(prefix="/api/auth", tags=["auth"])
router = APIRouter(prefix="/api", tags=["auth"])


class RegistrationClosedError(Exception):
    pass


class RegisterIn(BaseModel):
    username: str
    display_name: str
    password: str
    invite_code: str


class LoginIn(BaseModel):
    username: str
    password: str


class AccountOut(BaseModel):
    id: str
    username: str


class MeOut(BaseModel):
    """The selected profile; `username` is the family login it belongs to."""

    id: str
    username: str
    display_name: str
    avatar: str

    @classmethod
    def of(cls, account: Account, user: User) -> "MeOut":
        return cls(id=user.id, username=account.username, display_name=user.display_name, avatar=user.avatar)


class LoginOut(BaseModel):
    """Profile fields at the top level (null until one is picked) so older cached clients keep working."""

    id: str | None
    username: str
    display_name: str | None
    avatar: str | None
    account: AccountOut
    profile_required: bool

    @classmethod
    def of(cls, account: Account, user: User | None) -> "LoginOut":
        return cls(
            id=user.id if user else None,
            username=account.username,
            display_name=user.display_name if user else None,
            avatar=user.avatar if user else None,
            account=AccountOut(id=account.id, username=account.username),
            profile_required=user is None,
        )


def validate_display_name(raw: str) -> str:
    display_name = raw.strip()
    if not 1 <= len(display_name) <= DISPLAY_NAME_MAX:
        raise ApiError(400, "display_name_invalid", f"Tên hiển thị 1–{DISPLAY_NAME_MAX} ký tự", "display_name")
    return display_name


def _enforce_rate_limit(ctx: Ctx, request: Request) -> None:
    retry_after = ctx.auth_limiter.hit(f"auth:{client_ip(request)}")
    if retry_after is not None:
        raise ApiError(
            429, "rate_limited", "Thử quá nhiều lần, vui lòng đợi một chút", headers={"Retry-After": str(int(retry_after) + 1)}
        )


@public_router.get("/status")
async def status(ctx: Ctx) -> dict:
    """Whether this server still accepts creating the family account (only the first time)."""
    return {"registration_open": bool(ctx.settings.invite_code) and not await ctx.accounts.any_exists()}


@public_router.post("/register", status_code=201)
async def register(body: RegisterIn, request: Request, response: Response, ctx: Ctx) -> LoginOut:
    """Create the family account with its first profile. One account per server: closed afterwards."""
    _enforce_rate_limit(ctx, request)
    username = body.username.strip().lower()
    if not USERNAME_RE.fullmatch(username):
        raise ApiError(400, "username_invalid", "Tên đăng nhập 3–32 ký tự: chữ thường, số, dấu . hoặc _", "username")
    display_name = validate_display_name(body.display_name)
    if not PASSWORD_MIN <= len(body.password) <= PASSWORD_MAX:
        raise ApiError(400, "password_invalid", f"Mật khẩu tối thiểu {PASSWORD_MIN} ký tự", "password")
    expected = ctx.settings.invite_code.encode()
    if not expected or not hmac.compare_digest(body.invite_code.strip().encode(), expected):
        log.info("auth_register outcome=bad_invite ip=%s", client_ip(request))
        raise ApiError(403, "invite_invalid", "Mã mời không đúng", "invite_code")
    password_hash = await asyncio.to_thread(hash_password, body.password)
    try:
        # Account, first profile and session commit together: a failure leaves registration open.
        async with ctx.db.transaction() as conn:
            if await ctx.accounts.any_exists(conn):
                raise RegistrationClosedError
            account = await ctx.accounts.create(conn, username, password_hash)
            user = await ctx.users.create(conn, account.id, display_name, FIRST_PROFILE_AVATAR)
            token = await ctx.session_service.create(account.id, user.id, conn=conn)
    except RegistrationClosedError:
        raise ApiError(403, "registration_closed", "Gia đình đã có tài khoản, hãy đăng nhập") from None
    ctx.session_service.set_cookie(response, token)
    log.info("auth_register outcome=ok account_id=%s profile_id=%s", account.id, user.id)
    return LoginOut.of(account, user)


@public_router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, ctx: Ctx) -> LoginOut:
    _enforce_rate_limit(ctx, request)
    account = await ctx.accounts.get_by_username(body.username.strip())
    valid = await asyncio.to_thread(verify_password, account.password_hash if account else None, body.password)
    if not valid or account is None:
        log.info("auth_login outcome=denied ip=%s", client_ip(request))
        raise ApiError(401, "invalid_credentials", "Sai tên đăng nhập hoặc mật khẩu")
    if needs_rehash(account.password_hash):
        await ctx.accounts.update_password_hash(account.id, await asyncio.to_thread(hash_password, body.password))
    profiles = await ctx.users.list_for_account(account.id)
    # A single profile needs no picker; with several, the device chooses after login.
    user = profiles[0] if len(profiles) == 1 else None
    ctx.session_service.set_cookie(response, await ctx.session_service.create(account.id, user.id if user else None))
    log.info("auth_login outcome=ok account_id=%s profile_id=%s", account.id, user.id if user else None)
    return LoginOut.of(account, user)


@public_router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, ctx: Ctx) -> None:
    await ctx.session_service.revoke(request.cookies.get(COOKIE_NAME))
    ctx.session_service.clear_cookie(response)


@router.get("/me")
async def me(session: CurrentAccount, user: CurrentUser) -> MeOut:
    return MeOut.of(session.account, user)
