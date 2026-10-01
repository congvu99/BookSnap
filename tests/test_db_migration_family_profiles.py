from pathlib import Path

import aiosqlite
import pytest

from app.db import MIGRATIONS, Database


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
