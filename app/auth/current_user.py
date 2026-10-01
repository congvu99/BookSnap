from typing import Annotated

from fastapi import Depends, Request

from app.api_errors import ApiError
from app.app_context import AppContext, get_ctx
from app.auth.session_service import COOKIE_NAME, SessionContext
from app.repositories.book_repository import Book
from app.repositories.user_repository import User

Ctx = Annotated[AppContext, Depends(get_ctx)]

# Sent by the web client with every request: the cookie (and so the selected profile) is shared by
# all tabs, and a tab still showing profile A must not write into the profile another tab picked.
PROFILE_HEADER = "X-Profile-Id"


async def require_account(request: Request, ctx: Ctx) -> SessionContext:
    session = await ctx.session_service.resolve(request.cookies.get(COOKIE_NAME))
    if session is None:
        raise ApiError(401, "unauthorized", "Vui lòng đăng nhập")
    request.state.session = session
    return session


CurrentAccount = Annotated[SessionContext, Depends(require_account)]


async def require_user(request: Request, session: CurrentAccount) -> User:
    """The profile this device picked; family-wide routes use `CurrentAccount` instead."""
    if session.user is None:
        raise ApiError(409, "profile_required", "Chọn hồ sơ để tiếp tục")
    claimed = request.headers.get(PROFILE_HEADER)
    if claimed and claimed != session.user.id:
        raise ApiError(409, "profile_mismatch", "Hồ sơ đã được đổi ở thẻ khác")
    request.state.user = session.user
    return session.user


CurrentUser = Annotated[User, Depends(require_user)]


def ensure_book_owner(book: Book, user: User) -> None:
    if book.created_by != user.id:
        raise ApiError(403, "forbidden", "Chỉ người tạo sách mới được thực hiện thao tác này")
