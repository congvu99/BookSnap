import sqlite3
from pathlib import Path

import aiosqlite
import pytest

import app.db as db_module
from app.db import MIGRATIONS, Database, TableRebuild

# Schema version right before family accounts/profiles were introduced.
PRE_PROFILES_VERSION = 5


async def _legacy_db(path: Path) -> None:
    """A DB at the last per-user-account schema, holding three family members' data."""
    async with aiosqlite.connect(path) as conn:
        scripts = "".join(MIGRATIONS[:PRE_PROFILES_VERSION])
        await conn.executescript(f"BEGIN;{scripts}PRAGMA user_version={PRE_PROFILES_VERSION};COMMIT;")
        await conn.executemany(
            "INSERT INTO users VALUES (?,?,?,?,?)",
            [
                ("u-me", "me", "Mẹ", "hash-me", "2026-01-02T00:00:00+00:00"),
                ("u-bo", "bo", "Bố", "hash-bo", "2026-01-01T00:00:00+00:00"),
                ("u-con", "con", "Con", "hash-con", "2026-01-03T00:00:00+00:00"),
            ],
        )
        await conn.executemany(
            "INSERT INTO sessions VALUES (?,?,?,?,?)",
            [("tok-me", "u-me", "t", "t", "2099-01-01T00:00:00+00:00"), ("tok-con", "u-con", "t", "t", "2099-01-01T00:00:00+00:00")],
        )
        await conn.execute("INSERT INTO topics VALUES ('t1','Cổ tích','co tich','u-con','t')")
        await conn.execute(
            "INSERT INTO books(id, title, created_by, tts_provider, tts_voice, created_at, updated_at, topic_id)"
            " VALUES ('b1','Sách của mẹ','u-me','gemini','Charon','t','t','t1')"
        )
        await conn.executemany(
            "INSERT INTO progress VALUES (?,?,?,?,?)",
            [("u-bo", "b1", 1, 100, "t"), ("u-me", "b1", 5, 200, "t"), ("u-con", "b1", 9, 300, "t")],
        )
        await conn.executemany("INSERT INTO bookmarks VALUES (?,?,?,?)", [("u-me", "b1", 2, "t"), ("u-con", "b1", 3, "t")])
        await conn.commit()


async def _scalar(db: Database, sql: str):
    row = await db.fetchone(sql)
    assert row is not None
    return row[0]


async def test_refuses_to_run_on_database_newer_than_code(tmp_path: Path) -> None:
    # An older image started against a migrated DB must crash loudly, not serve a schema it can't read.
    path = tmp_path / "newer.db"
    async with aiosqlite.connect(path) as conn:
        await conn.execute(f"PRAGMA user_version={len(MIGRATIONS) + 1}")
        await conn.commit()
    db = Database(path)
    with pytest.raises(RuntimeError, match="newer than this code"):
        await db.connect()
    await db.close()


async def test_merges_existing_accounts_into_one_family_keeping_all_data(tmp_path: Path) -> None:
    path = tmp_path / "legacy.db"
    await _legacy_db(path)
    db = Database(path)
    await db.connect()
    try:
        assert await _scalar(db, "PRAGMA user_version") == len(MIGRATIONS)
        assert await _scalar(db, "PRAGMA foreign_keys") == 1
        assert await db.fetchall("PRAGMA foreign_key_check") == []

        accounts = await db.fetchall("SELECT * FROM accounts")
        assert len(accounts) == 1
        account = accounts[0]
        # The earliest member's login becomes the family login.
        assert (account["username"], account["password_hash"]) == ("bo", "hash-bo")
        # A fresh id, so code that confuses account and profile ids fails for everyone, not just non-owners.
        assert await _scalar(db, f"SELECT count(*) FROM users WHERE id='{account['id']}'") == 0
        assert len(account["id"]) == 32

        profiles = await db.fetchall("SELECT id, account_id, display_name, avatar FROM users ORDER BY created_at")
        assert [(p["id"], p["display_name"], p["avatar"]) for p in profiles] == [
            ("u-bo", "Bố", "c1"),
            ("u-me", "Mẹ", "c2"),
            ("u-con", "Con", "c3"),
        ]
        assert {p["account_id"] for p in profiles} == {account["id"]}
        user_columns = {row["name"] for row in await db.fetchall("PRAGMA table_info(users)")}
        assert "username" not in user_columns and "password_hash" not in user_columns

        assert await _scalar(db, "SELECT count(*) FROM progress") == 3
        assert await _scalar(db, "SELECT chunk_seq FROM progress WHERE user_id='u-me'") == 5
        assert await _scalar(db, "SELECT count(*) FROM bookmarks") == 2
        assert await _scalar(db, "SELECT created_by FROM books WHERE id='b1'") == "u-me"
        assert await _scalar(db, "SELECT created_by FROM topics WHERE id='t1'") == "u-con"

        # Signed-in devices stay signed in, on the same profile.
        sessions = await db.fetchall("SELECT token_hash, account_id, user_id FROM sessions ORDER BY token_hash")
        assert [tuple(s) for s in sessions] == [("tok-con", account["id"], "u-con"), ("tok-me", account["id"], "u-me")]

        assert await _scalar(db, "SELECT count(*) FROM shelf_items") == 0
    finally:
        await db.close()


async def test_fresh_install_migrates_without_creating_an_account(tmp_path: Path) -> None:
    db = Database(tmp_path / "fresh.db")
    await db.connect()
    try:
        assert await _scalar(db, "PRAGMA user_version") == len(MIGRATIONS)
        assert await _scalar(db, "SELECT count(*) FROM accounts") == 0
    finally:
        await db.close()


@pytest.mark.parametrize(
    ("bad_migration", "error", "match"),
    [
        # Leaves an orphan row behind: caught by the foreign key check before commit.
        (
            TableRebuild("CREATE TABLE half_done(x); INSERT INTO progress VALUES ('ghost','no-book',0,0,'t');"),
            RuntimeError,
            "broke foreign keys",
        ),
        # Fails mid-script on a constraint, as a table rebuild and as a plain migration.
        (TableRebuild("CREATE TABLE half_done(x); INSERT INTO accounts(id) VALUES ('x');"), sqlite3.IntegrityError, "NOT NULL"),
        ("CREATE TABLE half_done(x); INSERT INTO accounts(id) VALUES ('x');", sqlite3.IntegrityError, "NOT NULL"),
    ],
)
async def test_failed_migration_rolls_back_and_keeps_foreign_keys_on(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, bad_migration, error: type[Exception], match: str
) -> None:
    path = tmp_path / "broken.db"
    await _legacy_db(path)
    monkeypatch.setattr(db_module, "MIGRATIONS", [*MIGRATIONS, bad_migration])
    db = Database(path)
    with pytest.raises(error, match=match):
        await db.connect()
    try:
        assert not db.conn.in_transaction
        assert await _scalar(db, "PRAGMA foreign_keys") == 1
        # Every earlier migration committed; the broken one left nothing behind.
        assert await _scalar(db, "PRAGMA user_version") == len(MIGRATIONS)
        assert await _scalar(db, "SELECT count(*) FROM sqlite_master WHERE name='half_done'") == 0
        assert await _scalar(db, "SELECT count(*) FROM progress") == 3
    finally:
        await db.close()
