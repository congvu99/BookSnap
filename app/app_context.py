"""Process-wide services, built once in the lifespan and stored on `app.state.ctx`."""

from dataclasses import dataclass, field
from typing import Protocol

from fastapi import Request

from app.auth.rate_limiter import RateLimiter
from app.auth.session_service import SessionService
from app.config import Settings
from app.db import Database
from app.repositories.book_repository import BookRepository
from app.repositories.bookmark_repository import BookmarkRepository
from app.repositories.chunk_repository import ChunkRepository
from app.repositories.page_repository import PageRepository
from app.repositories.progress_repository import ProgressRepository
from app.repositories.provider_usage_repository import ProviderUsageRepository
from app.repositories.session_repository import SessionRepository
from app.repositories.topic_repository import TopicRepository
from app.repositories.user_repository import UserRepository


class WorkerWaker(Protocol):
    def wake(self) -> None: ...


class _NoopWaker:
    def wake(self) -> None:
        pass


@dataclass
class AppContext:
    settings: Settings
    db: Database
    users: UserRepository
    sessions: SessionRepository
    books: BookRepository
    pages: PageRepository
    chunks: ChunkRepository
    progress: ProgressRepository
    topics: TopicRepository
    bookmarks: BookmarkRepository
    usage: ProviderUsageRepository
    auth_limiter: RateLimiter
    session_service: SessionService
    worker: WorkerWaker = field(default_factory=_NoopWaker)

    @classmethod
    def build(cls, settings: Settings, db: Database) -> "AppContext":
        users = UserRepository(db)
        sessions = SessionRepository(db)
        return cls(
            settings=settings,
            db=db,
            users=users,
            sessions=sessions,
            books=BookRepository(db),
            pages=PageRepository(db),
            chunks=ChunkRepository(db),
            progress=ProgressRepository(db),
            topics=TopicRepository(db),
            bookmarks=BookmarkRepository(db),
            usage=ProviderUsageRepository(db),
            auth_limiter=RateLimiter(settings.auth_rate_limit_per_minute, 60.0),
            session_service=SessionService(sessions, users, settings),
        )


def get_ctx(request: Request) -> AppContext:
    return request.app.state.ctx
