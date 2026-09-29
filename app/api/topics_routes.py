from fastapi import APIRouter

from app.auth.current_user import Ctx, CurrentUser

router = APIRouter(prefix="/api", tags=["topics"])


@router.get("/topics")
async def list_topics(ctx: Ctx, user: CurrentUser) -> list[dict]:
    return [{"id": t.id, "name": t.name, "book_count": t.book_count} for t in await ctx.topics.list_in_use()]
