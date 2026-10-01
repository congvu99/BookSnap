"""Add/remove books on the current profile's shelf; the list itself comes with each book (`on_shelf`)."""

from fastapi import APIRouter

from app.api.books_routes import load_book
from app.auth.current_user import Ctx, CurrentUser

router = APIRouter(prefix="/api/me/shelf", tags=["shelf"])


@router.put("/{book_id}", status_code=204)
async def add_to_shelf(book_id: str, ctx: Ctx, user: CurrentUser) -> None:
    await load_book(ctx, book_id)
    await ctx.shelf.add(user.id, book_id)


@router.delete("/{book_id}", status_code=204)
async def remove_from_shelf(book_id: str, ctx: Ctx, user: CurrentUser) -> None:
    await ctx.shelf.remove(user.id, book_id)
