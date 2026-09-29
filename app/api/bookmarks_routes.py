"""Per-user bookmarks on chunk seqs. PUT/DELETE are idempotent so the client can retry blindly."""

from fastapi import APIRouter, Path, Response

from app.api.books_routes import load_book
from app.api.pages_routes import MAX_PAGE_SEQ
from app.auth.current_user import Ctx, CurrentUser
from app.repositories.bookmark_repository import EXCERPT_CHARS

router = APIRouter(prefix="/api", tags=["bookmarks"])

# A page yields a handful of chunks at most; this cap only rejects nonsense (and ints JS can't round-trip).
MAX_CHUNK_SEQ = MAX_PAGE_SEQ * 100
ChunkSeq = Path(ge=0, le=MAX_CHUNK_SEQ)


@router.get("/bookmarks")
async def list_bookmarks(ctx: Ctx, user: CurrentUser) -> list[dict]:
    return [
        {
            "book_id": b.book_id,
            "book_title": b.book_title,
            "chunk_seq": b.chunk_seq,
            "excerpt": b.chunk_text[:EXCERPT_CHARS] if b.chunk_text is not None else None,
            "created_at": b.created_at,
        }
        for b in await ctx.bookmarks.list_for_user(user.id)
    ]


@router.get("/books/{book_id}/bookmarks")
async def list_book_bookmarks(book_id: str, ctx: Ctx, user: CurrentUser) -> list[int]:
    await load_book(ctx, book_id)
    return await ctx.bookmarks.seqs_for_book(user.id, book_id)


@router.put("/books/{book_id}/bookmarks/{chunk_seq}")
async def put_bookmark(book_id: str, ctx: Ctx, user: CurrentUser, chunk_seq: int = ChunkSeq) -> dict:
    await load_book(ctx, book_id)
    b = await ctx.bookmarks.add(user.id, book_id, chunk_seq)
    return {"chunk_seq": b.chunk_seq, "created_at": b.created_at}


@router.delete("/books/{book_id}/bookmarks/{chunk_seq}", status_code=204)
async def delete_bookmark(book_id: str, ctx: Ctx, user: CurrentUser, chunk_seq: int = ChunkSeq) -> Response:
    await load_book(ctx, book_id)
    await ctx.bookmarks.remove(user.id, book_id, chunk_seq)
    return Response(status_code=204)
