---
phase: 1
title: DB migration accounts and profiles
status: completed
priority: P1
effort: 1d
dependencies: []
---

# Phase 1: DB migration accounts and profiles

## Overview
(0) Release riêng **trước**: guard chặn chạy code cũ trên DB mới hơn. (1) Migration v6: thêm `accounts`, rebuild `users` (thành hồ sơ) và `sessions`, thêm `shelf_items`; gộp dữ liệu cũ không mất progress/bookmark/session.

## Branching [RT#7]
- Bước 0 (downgrade guard) commit thẳng `main` và **deploy prod trước** phần còn lại, để image mà `deploy.sh` rollback về đã có guard.
- Phase 1–3 làm trên branch `feat/family-profiles`. Phase 1 chấp nhận suite đỏ trên branch; merge vào `main` chỉ khi Phase 3 xanh toàn bộ (Phase 4 có thể cùng branch).

## Requirements
- Functional: schema đích như dưới; account backfill từ user tạo sớm nhất; avatar luân phiên `c1..c8` theo `created_at`; session cũ → `account_id` = account gộp, giữ `user_id`.
- DB rỗng (cài mới): migration chạy, không tạo account.
- Non-functional: lỗi bất kỳ trong migration → ROLLBACK đầy đủ, `foreign_keys` bật lại = 1, `user_version` giữ nguyên, app không khởi động (fail loud).

## Architecture

**Downgrade guard [RT#1]** (`app/db.py:_migrate`): `if current > len(MIGRATIONS): raise RuntimeError("DB schema v{current} mới hơn code (v{len}) — restore backup hoặc deploy bản mới")`. Hệ quả: image cũ crash lúc boot thay vì chạy sai âm thầm → `deploy.sh` log "rollback ALSO unhealthy", lộ sự cố.

Schema đích:

```sql
accounts(id TEXT PK, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)
users(id TEXT PK, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT 'c1', created_at TEXT NOT NULL)   -- = hồ sơ
sessions(token_hash TEXT PK, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
         user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
         created_at, last_seen_at, expires_at)            -- idx_sessions_account, idx_sessions_user
shelf_items(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            added_at TEXT NOT NULL, PRIMARY KEY(user_id, book_id))
```

`users.username`/`password_hash` bị bỏ (login chuyển sang `accounts`). Username của user phụ mất — đã chốt.

`accounts.id` sinh bằng `lower(hex(randomblob(16)))` (cùng định dạng `new_id()` = uuid4 hex) — **không** tái dùng id của user sớm nhất, để bug nhầm account/profile id lộ ra ngay [RT#6].

**Vì sao rebuild bảng:** SQLite không đổi được `NOT NULL`; `DROP COLUMN` không áp dụng cột `UNIQUE` (`users.username`). Theo quy trình 12 bước: tạo `users_new` → `INSERT … SELECT` → `DROP users` → `ALTER TABLE users_new RENAME TO users`.

**Bẫy FK:** `DROP TABLE users` khi `foreign_keys=ON` ngầm DELETE → CASCADE xoá sạch progress/bookmarks. `PRAGMA foreign_keys` vô tác dụng trong transaction → phải tắt **trước** `BEGIN`, bật lại **sau** khi transaction đã đóng.

Runner (`app/db.py`) [RT#6]:

```python
@dataclass(frozen=True)
class TableRebuild:          # migration cần tắt FK (quy trình rebuild bảng của SQLite)
    sql: str

MIGRATIONS: list[str | TableRebuild]

# với TableRebuild:
await conn.execute("PRAGMA foreign_keys=OFF")
try:
    await conn.execute("BEGIN")
    await conn.executescript(m.sql)                       # body KHÔNG chứa BEGIN/COMMIT
    bad = await fetchall("PRAGMA foreign_key_check")      # execute riêng, không trong executescript
    if bad: raise MigrationError(bad[:5])
    await conn.execute(f"PRAGMA user_version={n}")
    await conn.execute("COMMIT")
except BaseException:
    if conn.in_transaction: await conn.execute("ROLLBACK")
    raise
finally:
    await conn.execute("PRAGMA foreign_keys=ON")
    assert (await fetchone("PRAGMA foreign_keys"))[0] == 1
```

Lưu ý: `executescript` của sqlite3 tự COMMIT transaction đang mở trước khi chạy → kiểm khi implement; nếu vậy, đưa `BEGIN` vào đầu script body và giữ phần fk_check/COMMIT bằng `execute` riêng. Test bước 3–4 sẽ bắt sai.

Prod chạy `python:3.12-slim` (sqlite riêng của image) — cần `ROW_NUMBER()` (≥3.25) và RENAME hiện đại (≥3.26). Local là 3.49.1; **phải kiểm trong image prod** (Phase 5).

## Related Code Files
- Modify: `app/db.py` (guard, runner, migration v6), `app/repositories/user_repository.py` + `app/repositories/session_repository.py` (chỉ dataclass `User`, `Session` khớp schema mới; logic ở Phase 2)
- Create: `tests/test_db_migration_family_profiles.py`

## Implementation Steps (TDD)
0. **Guard (main, release riêng):** test đỏ — DB `user_version = len(MIGRATIONS)+1` → `connect()` raise. Implement, merge, deploy prod.
1. **Test đỏ — migrate dữ liệu cũ:** dựng DB ở v5 bằng `MIGRATIONS[:5]`, chèn 3 user (`bo` sớm nhất, `me`, `con`), session cho `me`, `con`, sách của `me`, topic của `con`, progress cả 3, bookmark 2. `connect()`. Assert:
   - 1 `accounts`: username `bo`, password_hash = hash cũ, `accounts.id NOT IN (SELECT id FROM users)`.
   - 3 `users` cùng `account_id`, display_name giữ, avatar `c1/c2/c3`.
   - progress/bookmarks/books/topics đủ dòng; `PRAGMA foreign_key_check` rỗng.
   - sessions giữ `user_id`, `account_id` đúng.
   - `foreign_keys = 1`; `user_version = 6`.
2. Test đỏ: DB rỗng → v6, 0 account.
3. Test đỏ: migration giả vi phạm FK → raise; `user_version` không đổi; `foreign_keys = 1`; `conn.in_transaction = False`.
4. Test đỏ: migration giả lỗi SQL giữa chừng (vd. NOT NULL) → như bước 3, và bảng tạo dở không tồn tại.
5. Implement runner + v6 (backfill SQL thuần; avatar `'c' || ((ROW_NUMBER() OVER (ORDER BY created_at, id) - 1) % 8 + 1)`).
6. Cập nhật dataclass `User`, `Session` cho app boot được. Suite auth đỏ trên branch là chấp nhận — sửa ở Phase 2.

## Success Criteria
- [ ] `pytest tests/test_db_migration_family_profiles.py -q` xanh.
- [ ] Guard đã deploy prod trước khi merge branch.
- [ ] Migration trên bản sao `data/booksnap.db` local: progress/bookmarks trước = sau.

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| CASCADE xoá progress khi DROP users | M | H | FK OFF ngoài transaction + test đếm dòng |
| Auto-rollback image cũ chạy trên DB v6 | M | H | Guard release trước [RT#1] |
| Lỗi giữa chừng để FK OFF / transaction treo | M | H | try/except ROLLBACK + test bước 3–4 [RT#6] |
| Không rollback được schema | H | M | Một chiều; rollback = restore backup (runbook Phase 5) |
