"""Process-wide services, built once in the lifespan and stored on `app.state.ctx`."""

from dataclasses import dataclass, field
from typing import Protocol

from fastapi import Request

from app.auth.rate_limiter import RateLimiter
from app.auth.session_service import SessionService
from app.config import Settings
from app.db import Database
from app.repositories.account_repository import AccountRepository
from app.repositories.book_repository import BookRepository
from app.repositories.bookmark_repository import BookmarkRepository
from app.repositories.chunk_repository import ChunkRepository
from app.repositories.page_repository import PageRepository
from app.repositories.progress_repository import ProgressRepository
from app.repositories.provider_usage_repository import ProviderUsageRepository
from app.repositories.session_repository import SessionRepository
from app.repositories.shelf_repository import ShelfRepository
from app.repositories.topic_repository import TopicRepository
from app.repositories.user_repository import UserRepository
from app.voice_preview import VoicePreviewService


class WorkerWaker(Protocol):
    def wake(self) -> None: ...


class _NoopWaker:
    def wake(self) -> None:
        pass


@dataclass
class AppContext:
    settings: Settings
    db: Database
    accounts: AccountRepository
    users: UserRepository
    sessions: SessionRepository
    books: BookRepository
    pages: PageRepository
    chunks: ChunkRepository
    progress: ProgressRepository
    topics: TopicRepository
    bookmarks: BookmarkRepository
    shelf: ShelfRepository
    usage: ProviderUsageRepository
    auth_limiter: RateLimiter
    session_service: SessionService
    voice_preview: VoicePreviewService
    worker: WorkerWaker = field(default_factory=_NoopWaker)

    @classmethod
    def build(cls, settings: Settings, db: Database) -> "AppContext":
        accounts = AccountRepository(db)
        users = UserRepository(db)
        sessions = SessionRepository(db)
        usage = ProviderUsageRepository(db)
        return cls(
            settings=settings,
            db=db,
            accounts=accounts,
            users=users,
            sessions=sessions,
            books=BookRepository(db),
            pages=PageRepository(db),
            chunks=ChunkRepository(db),
            progress=ProgressRepository(db),
            topics=TopicRepository(db),
            bookmarks=BookmarkRepository(db),
            shelf=ShelfRepository(db),
            usage=usage,
            auth_limiter=RateLimiter(settings.auth_rate_limit_per_minute, 60.0),
            session_service=SessionService(sessions, accounts, users, settings),
            voice_preview=VoicePreviewService(settings, usage),
        )


def get_ctx(request: Request) -> AppContext:
    return request.app.state.ctx
