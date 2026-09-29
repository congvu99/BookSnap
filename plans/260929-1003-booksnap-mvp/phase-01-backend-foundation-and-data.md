---
phase: 1
title: "Nền tảng backend và dữ liệu"
status: completed
priority: P1
dependencies: []
---

# Phase 1: Nền tảng backend và dữ liệu

## Overview
Dựng FastAPI app, config, tài khoản người dùng (đăng ký bằng mã mời/đăng nhập/session), schema SQLite, repository và REST API cơ bản cho sách/trang/đoạn. Chưa gọi OCR/TTS thật.
<!-- Updated: Brainstorm user accounts - thay APP_TOKEN bằng users + sessions -->

## Requirements
- Functional: tạo/liệt kê/xoá sách; upload ảnh trang (multipart); liệt kê chunk của sách; lưu/đọc tiến độ nghe; serve MP3 hỗ trợ HTTP Range; đăng ký (username, display name, mật khẩu ≥6, mã mời), đăng nhập, đăng xuất, `GET /api/me`; tiến độ **theo từng user**; chỉ người tạo sách được đổi giọng/xoá sách.
- Non-functional: mọi dữ liệu dưới `DATA_DIR` (mặc định `./data`, prod `/data`); khởi động < 2s; không log mật khẩu/session token/API key; mật khẩu hash argon2; session token ngẫu nhiên 32 byte, DB chỉ lưu SHA-256.

## Architecture

```
app/
  main.py                 # create_app(), lifespan: init DB, start/stop worker (stub ở phase 1)
  config.py               # Settings (pydantic-settings): DATA_DIR, INVITE_CODE, GEMINI_*, AZURE_*, TTS_DEFAULT_PROVIDER (provider mặc định cho sách mới)...
  auth/
    password_hashing.py   # argon2-cffi hash/verify
    session_service.py    # tạo/tra/gia hạn/xoá session; cookie httpOnly 180 ngày sliding
    auth_routes.py        # /api/auth/register|login|logout, /api/me
    current_user.py       # dependency require_user → User; 401 nếu thiếu/hết hạn
    rate_limiter.py       # in-memory ~10 req/phút/IP cho login/register
  cli.py                  # python -m app.cli reset-password <username>
  db.py                   # aiosqlite connection, schema migrate (PRAGMA user_version), WAL mode
  repositories/
    user_repository.py
    session_repository.py
    book_repository.py
    page_repository.py
    chunk_repository.py
    progress_repository.py
  api/
    books_routes.py       # /api/books ...
    pages_routes.py       # POST /api/books/{id}/pages
    audio_routes.py       # GET /api/chunks/{id}/audio
  static mount: web/ → /
tests/
```
Python module dùng snake_case (convention Python ưu tiên hơn kebab-case).

**Schema (SQLite):**
```sql
users(id TEXT PK, username TEXT UNIQUE COLLATE NOCASE, display_name TEXT, password_hash TEXT, created_at)
sessions(token_hash TEXT PK, user_id FK, created_at, last_seen_at, expires_at)
books(id TEXT PK, title TEXT, created_by FK users, tts_provider TEXT, tts_voice TEXT, created_at, updated_at)  -- giọng cố định khi tạo, người tạo đổi tay được
pages(id TEXT PK, book_id FK, seq INT, status TEXT,   -- uploaded|ocr_processing|ocr_done|failed
      image_path TEXT NULL, text TEXT NULL, continues INT, attempts INT, error TEXT, created_at)
chunks(id TEXT PK, book_id FK, seq INT, text TEXT, content_hash TEXT,
       status TEXT,                                    -- pending|processing|waiting_quota|done|failed
       not_before TEXT NULL,                           -- thời điểm được thử lại khi waiting_quota
       provider TEXT, voice TEXT, audio_path TEXT, duration_ms INT, attempts INT, error TEXT)
progress(user_id FK, book_id FK, chunk_seq INT, offset_ms INT, updated_at, PRIMARY KEY(user_id, book_id))
UNIQUE(book_id, seq) trên pages và chunks
```

**API contract (JSON):**
| Method | Path | Ghi chú |
|---|---|---|
| POST | /api/auth/register | `{username, display_name, password, invite_code}` → Set-Cookie; 400 sai định dạng, 403 sai mã mời, 409 trùng username |
| POST | /api/auth/login | `{username, password}` → Set-Cookie; 401 chung chung (không tiết lộ username tồn tại) |
| POST | /api/auth/logout | xoá session + cookie |
| GET | /api/me | `{id, username, display_name}` |
| GET | /api/me/continue | sách đang nghe dở của user, sắp theo `progress.updated_at` desc |
| GET/POST | /api/books | list (kèm tiến độ của user hiện tại + `created_by_name`) / create `{title, tts_provider?, tts_voice?}` (mặc định từ env) |
| PATCH | /api/books/{id} | **chỉ người tạo** (403 nếu không); đổi title; đổi `tts_provider/tts_voice` → toàn bộ chunk reset `pending` (sinh lại cả sách) |
| GET/DELETE | /api/books/{id} | detail gồm trạng thái tổng hợp (pages, chunks done/total); DELETE **chỉ người tạo** |
| POST | /api/books/{id}/pages | multipart `image`, `seq`; ≤ 5MB, chỉ `image/jpeg|png|webp`; trả 202 |
| GET | /api/books/{id}/chunks | seq, text, status, provider, duration_ms, audio_url |
| PATCH | /api/chunks/{id} | sửa text → reset `pending` (phase 2 xử lý) |
| POST | /api/chunks/{id}/retry | |
| GET | /api/chunks/{id}/audio | `FileResponse` có Range |
| GET/PUT | /api/books/{id}/progress | `{chunk_seq, offset_ms}` của **user hiện tại** |
| GET | /health | DB + ghi được DATA_DIR |

## Related Code Files
- Create: `pyproject.toml` hoặc `requirements.txt`, `app/**`, `tests/test_books_api.py`, `tests/conftest.py`, `.env.example`, `.gitignore` (data/, .env), `README.md`

## Implementation Steps
1. Khởi tạo project: deps `fastapi uvicorn[standard] pydantic-settings aiosqlite python-multipart httpx argon2-cffi`; dev `pytest pytest-asyncio`.
2. `config.py` + `.env.example` (không commit `.env`).
3. `db.py`: tạo schema, bật WAL, foreign keys; migration theo `user_version`.
4. Repositories: CRUD thuần SQL, trả dataclass.
5. Auth: register kiểm tra mã mời bằng `hmac.compare_digest`, username `^[a-z0-9_.]{3,32}$` (lưu lowercase), display name 1–40 ký tự (Unicode, trim); login verify argon2, rehash nếu tham số đổi; cookie `booksnap_session` `HttpOnly; Secure; SameSite=Lax; Max-Age=180d`, gia hạn `expires_at` khi `last_seen_at` cũ > 1 ngày; `require_user` áp lên toàn bộ `/api/*` trừ register/login; static `/` public. Rate limit login/register theo IP (`X-Forwarded-For` từ proxy Railway). Dọn session hết hạn lúc startup.
5b. Quyền: helper `ensure_book_owner(book, user)` → 403 cho PATCH/DELETE book. Thêm trang, sửa text chunk, retry: mọi user.
5c. `app/cli.py reset-password <username>`: nhập mật khẩu mới qua `getpass`, xoá mọi session của user đó.
6. Routes theo contract; upload ghi ảnh vào `DATA_DIR/tmp/{page_id}.jpg`, tạo page `uploaded`.
7. Audio route: kiểm tra path nằm trong `DATA_DIR/library` (chống path traversal); xác minh Starlette `FileResponse` hỗ trợ Range ở version cài đặt, nếu không tự xử lý header `Range`.
8. `/health`, mount `web/` (placeholder index.html).
9. README: cách chạy local, env vars.

## Success Criteria
- [x] `pytest` pass: CRUD sách, upload hợp lệ/không hợp lệ (loại file, quá size), 401 khi thiếu cookie, Range request trả 206.
- [x] `pytest` auth: đăng ký đúng/sai mã mời, trùng username (khác hoa thường), login sai → 401, logout vô hiệu session, session hết hạn → 401, rate limit → 429.
- [x] 2 user cùng nghe 1 sách → progress độc lập; user B PATCH/DELETE sách của A → 403.
- [x] CLI reset-password đổi được mật khẩu và đăng xuất mọi thiết bị của user.
- [x] `uvicorn app.main:app` chạy local, `/health` 200.
- [x] Xoá sách xoá cả file audio và ảnh tạm.

## Risk Assessment
- Path traversal khi serve audio → chỉ serve theo `chunk.audio_path` từ DB, resolve và kiểm tra prefix.
- Brute-force mật khẩu yếu → rate limit + argon2; dữ liệu không nhạy cảm nên chấp nhận mật khẩu ≥6.
- Lộ mã mời → đổi `INVITE_CODE` trong env, tài khoản cũ không ảnh hưởng.
- Rate limiter in-memory mất khi restart → chấp nhận (1 replica).
- SQLite lock khi worker + API ghi đồng thời → WAL + transaction ngắn; 1 process duy nhất.
