"""SQLite access: one shared aiosqlite connection per process, writes serialized by a lock.

The app runs as a single process (API + in-process worker), so a single connection in WAL
mode plus an asyncio.Lock around writes is enough and avoids "database is locked" errors.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Iterable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import aiosqlite

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class TableRebuild:
    """A migration that recreates tables (SQLite's create-copy-drop-rename procedure).

    It runs with foreign keys OFF: dropping a referenced table with them ON would cascade-delete
    every child row. The runner checks foreign keys before committing instead.
    """

    sql: str


MIGRATIONS: list[str | TableRebuild] = [
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
    # One row per provider call attempt, so the app can show how much of each API quota is left.
    # No FK on book_id: usage stays counted after a book is deleted. Pruned by the cleanup worker.
    """
    CREATE TABLE provider_usage (
        id INTEGER PRIMARY KEY,
        service TEXT NOT NULL,
        outcome TEXT NOT NULL,
        chars INTEGER NOT NULL DEFAULT 0,
        book_id TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX idx_provider_usage_service_time ON provider_usage(service, created_at);
    """,
    # One family account (the login) owning several profiles. `users` rows become the profiles, so
    # every existing user_id (progress, bookmarks, created_by) now means "profile id". Existing
    # members are merged into the earliest member's login; signed-in devices keep their profile.
    TableRebuild(
        """
        CREATE TABLE accounts (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        INSERT INTO accounts(id, username, password_hash, created_at)
            SELECT lower(hex(randomblob(16))), username, password_hash, created_at
            FROM users ORDER BY created_at, id LIMIT 1;

        CREATE TABLE users_new (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            display_name TEXT NOT NULL,
            avatar TEXT NOT NULL DEFAULT 'c1',
            created_at TEXT NOT NULL
        );
        INSERT INTO users_new(id, account_id, display_name, avatar, created_at)
            SELECT id, (SELECT id FROM accounts), display_name,
                   'c' || ((ROW_NUMBER() OVER (ORDER BY created_at, id) - 1) % 8 + 1), created_at
            FROM users ORDER BY created_at, id;  -- rowid then follows creation order
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        CREATE INDEX idx_users_account ON users(account_id);

        CREATE TABLE sessions_new (
            token_hash TEXT PRIMARY KEY,
            account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        INSERT INTO sessions_new(token_hash, account_id, user_id, created_at, last_seen_at, expires_at)
            SELECT token_hash, (SELECT id FROM accounts), user_id, created_at, last_seen_at, expires_at
            FROM sessions;
        DROP TABLE sessions;
        ALTER TABLE sessions_new RENAME TO sessions;
        CREATE INDEX idx_sessions_account ON sessions(account_id);
        CREATE INDEX idx_sessions_user ON sessions(user_id);

        CREATE TABLE shelf_items (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            added_at TEXT NOT NULL,
            PRIMARY KEY(user_id, book_id)
        );
        """
    ),
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
        if current > len(MIGRATIONS):
            # An older release (e.g. an automatic deploy rollback) must not serve a schema it can't read.
            raise RuntimeError(
                f"Database schema v{current} is newer than this code (v{len(MIGRATIONS)}): "
                "deploy the newer release or restore the pre-migration backup"
            )
        for version, migration in enumerate(MIGRATIONS[current:], start=current + 1):
            log.info("db_migrate version=%d", version)
            if isinstance(migration, TableRebuild):
                await self._apply_table_rebuild(migration.sql, version)
            else:
                await self._apply(migration, version)

    async def _apply(self, script: str, version: int) -> None:
        # BEGIN goes inside the script: executescript() commits any transaction already open.
        try:
            await self.conn.executescript(f"BEGIN;\n{script}\nPRAGMA user_version={version};")
            await self.conn.execute("COMMIT")
        except BaseException:
            if self.conn.in_transaction:
                await self.conn.execute("ROLLBACK")
            raise

    async def _apply_table_rebuild(self, script: str, version: int) -> None:
        # PRAGMA foreign_keys is a no-op inside a transaction: switch it off before BEGIN and back on
        # only after COMMIT/ROLLBACK, then verify it really is on again.
        await self.conn.execute("PRAGMA foreign_keys=OFF")
        try:
            await self.conn.executescript(f"BEGIN;\n{script}")
            violations = await self.fetchall("PRAGMA foreign_key_check")
            if violations:
                raise RuntimeError(f"Migration v{version} broke foreign keys: {[tuple(v) for v in violations[:5]]}")
            await self.conn.execute(f"PRAGMA user_version={version}")
            await self.conn.execute("COMMIT")
        except BaseException:
            if self.conn.in_transaction:
                await self.conn.execute("ROLLBACK")
            raise
        finally:
            await self.conn.execute("PRAGMA foreign_keys=ON")
            if (await self.fetchone("PRAGMA foreign_keys"))[0] != 1:  # type: ignore[index]
                raise RuntimeError("Foreign keys could not be re-enabled after migration")

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
