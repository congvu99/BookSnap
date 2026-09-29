from typing import Annotated

from fastapi import Depends, Request

from app.api_errors import ApiError
from app.app_context import AppContext, get_ctx
from app.auth.session_service import COOKIE_NAME
from app.repositories.book_repository import Book
from app.repositories.user_repository import User

Ctx = Annotated[AppContext, Depends(get_ctx)]


async def require_user(request: Request, ctx: Ctx) -> User:
    user = await ctx.session_service.resolve(request.cookies.get(COOKIE_NAME))
    if user is None:
        raise ApiError(401, "unauthorized", "Vui lòng đăng nhập")
    request.state.user = user
    return user


CurrentUser = Annotated[User, Depends(require_user)]


def ensure_book_owner(book: Book, user: User) -> None:
    if book.created_by != user.id:
        raise ApiError(403, "forbidden", "Chỉ người tạo sách mới được thực hiện thao tác này")
