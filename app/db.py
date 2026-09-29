"""SQLite access: one shared aiosqlite connection per process, writes serialized by a lock.

The app runs as a single process (API + in-process worker), so a single connection in WAL
mode plus an asyncio.Lock around writes is enough and avoids "database is locked" errors.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Iterable, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import aiosqlite

log = logging.getLogger(__name__)

MIGRATIONS: list[str] = [
    """
    CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );
    CREATE INDEX idx_sessions_user ON sessions(user_id);
    CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES users(id),
        tts_provider TEXT NOT NULL,
        tts_voice TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE pages (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        status TEXT NOT NULL,
        image_path TEXT,
        image_mime TEXT,
        client_upload_id TEXT,
        text TEXT,
        continues INTEGER NOT NULL DEFAULT 0,
        chunked INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(book_id, seq)
    );
    CREATE INDEX idx_pages_status ON pages(status);
    CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        text TEXT NOT NULL,
        content_hash TEXT,
        status TEXT NOT NULL,
        not_before TEXT,
        provider TEXT,
        voice TEXT,
        audio_path TEXT,
        duration_ms INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        sealed INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE(book_id, seq)
    );
    CREATE INDEX idx_chunks_status ON chunks(status);
    CREATE TABLE progress (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        chunk_seq INTEGER NOT NULL,
        offset_ms INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, book_id)
    );
    """,
    # Claim token guards TTS results against a chunk being reset/re-claimed mid-synthesis.
    "ALTER TABLE chunks ADD COLUMN claim_token TEXT;",
    # Shared, user-created topics; name_key (NFC + casefold + collapsed spaces) is the identity.
    """
    CREATE TABLE topics (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        created_by TEXT REFERENCES users(id),
        created_at TEXT NOT NULL
    );
    ALTER TABLE books ADD COLUMN topic_id TEXT REFERENCES topics(id);
    CREATE INDEX idx_books_topic ON books(topic_id);
    """,
    # Per-user bookmarks keyed by chunk seq (like progress): the unsealed tail chunk is replaced
    # when pages are added, but its seq survives, so a bookmark never dangles on a chunk id.
    """
    CREATE TABLE bookmarks (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        chunk_seq INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(user_id, book_id, chunk_seq)
    );
    """,
]


def now_utc() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def to_iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="seconds")


def now_iso(delta: timedelta | None = None) -> str:
    moment = now_utc()
    return to_iso(moment + delta if delta else moment)


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value)


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._conn: aiosqlite.Connection | None = None
        self._write_lock = asyncio.Lock()

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database is not connected")
        return self._conn

    async def connect(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(self.path, isolation_level=None)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA foreign_keys=ON")
        await self._conn.execute("PRAGMA busy_timeout=5000")
        await self._migrate()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def _migrate(self) -> None:
        async with self.conn.execute("PRAGMA user_version") as cur:
            row = await cur.fetchone()
        current = row[0] if row else 0
        for version, script in enumerate(MIGRATIONS[current:], start=current + 1):
            log.info("db_migrate version=%d", version)
            await self.conn.executescript(f"BEGIN;\n{script}\nPRAGMA user_version={version};\nCOMMIT;")

    async def fetchone(self, sql: str, params: Sequence[Any] = ()) -> aiosqlite.Row | None:
        async with self.conn.execute(sql, params) as cur:
            return await cur.fetchone()

    async def fetchall(self, sql: str, params: Sequence[Any] = ()) -> list[aiosqlite.Row]:
        async with self.conn.execute(sql, params) as cur:
            return list(await cur.fetchall())

    async def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        """Run a single write statement; returns affected row count."""
        async with self._write_lock:
            async with self.conn.execute(sql, params) as cur:
                return cur.rowcount

    async def execute_returning(self, sql: str, params: Sequence[Any] = ()) -> list[aiosqlite.Row]:
        async with self._write_lock:
            async with self.conn.execute(sql, params) as cur:
                return list(await cur.fetchall())

    async def executemany(self, sql: str, rows: Iterable[Sequence[Any]]) -> None:
        async with self.transaction() as conn:
            await conn.executemany(sql, rows)

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[aiosqlite.Connection]:
        async with self._write_lock:
            await self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
            except BaseException:
                await self.conn.execute("ROLLBACK")
                raise
            else:
                await self.conn.execute("COMMIT")
