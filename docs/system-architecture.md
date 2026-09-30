# System Architecture — BookSnap MVP

**Last updated:** 2026-09-29

## Component Overview

```mermaid
graph TB
  BrowserPWA["PWA (Browser)"]
  ServiceWorker["Service Worker (sw.js)"]
  FastAPI["FastAPI Backend"]
  Worker["In-Process Worker<br/>(OCR/TTS Loops)"]
  SQLite["SQLite DB<br/>(WAL Mode)"]
  FileSystem["Filesystem<br/>/data/library/,/data/tmp/"]
  GeminiAPI["Gemini API<br/>(OCR + TTS)"]
  AzureAPI["Azure Speech API<br/>(TTS Only)"]
  
  BrowserPWA -->|HTTPS| FastAPI
  BrowserPWA -->|Service Worker Cache| ServiceWorker
  ServiceWorker -->|Range Requests| FastAPI
  
  FastAPI -->|Auth, CRUD| SQLite
  FastAPI -->|File I/O| FileSystem
  FastAPI -->|Stream MP3| BrowserPWA
  
  Worker -->|Read/Write<br/>One Connection| SQLite
  Worker -->|Consume<br/>Credentials| FastAPI
  Worker -->|OCR Image| GeminiAPI
  Worker -->|TTS Text| GeminiAPI
  Worker -->|TTS Text| AzureAPI
  Worker -->|Read Image<br/>Write MP3| FileSystem
```

## Request & Data Flow

### 1. Capture → Upload → OCR → Chunking

```
User captures page (camera) 
    ↓
[Client] Canvas JPEG → Blob (RAM only)
    ↓
POST /api/books/{id}/pages
    ├─ Validate MIME + size (5 MB)
    ├─ Write to /data/tmp/{page_id}.jpg
    ├─ Insert page row: status='uploaded', seq from client
    ↓
[Worker — OCR Loop]
    ├─ Claim next page: SELECT … WHERE status='uploaded' 
    ├─ Read image bytes, call Gemini OCR
    ├─ Mark status='ocr_done', save text + continues_on_next_page flag
    ├─ Delete temp image
    ├─ Wake chunker
    ↓
[Worker — Chunk Loop]
    ├─ List pages with chunked=0
    ├─ For each book, walk contiguous seqs from 0
    ├─ Stop at first missing/failed/non-ocr_done page (ordering invariant)
    ├─ Incorporate pages' text into carry string (join with space or \n\n)
    ├─ Split carry via chunker.chunk_text (1000–1500 chars; paragraph breaks kept as one newline per chunk)
    ├─ Replace unsealed tail chunk: DELETE old, INSERT pieces
    ├─ Mark pages chunked=1
    ↓
[Worker — TTS Loop] (repeats every poll_seconds=2)
    ├─ Claim next pending chunk: SELECT … WHERE status='pending' AND sealed=1
    │   OR (tail AND book idle > grace_seconds)
    ├─ Hash(text, provider, voice): check if audio exists on disk
    ├─ If miss: call TTS provider with text_chunker.spoken_text(text) — paragraphs flattened,
    │   full stop added after headings so the voice pauses (respects RPM limiter + quota pause)
    ├─ Get MP3 bytes, write to /data/library/{book_id}/{seq:05d}-{hash[:8]}.mp3
    ├─ Mark status='done', store content_hash + claim_token
    ├─ On quota (429): mark status='waiting_quota', set not_before, pause provider
    ├─ On error: mark status='failed'
    ↓
[Client — Reader]
    ├─ Poll GET /api/books/{id}/chunks
    ├─ For each chunk: display text (one <p> per paragraph; short unpunctuated lines as headings), audio_url (if done)
    ├─ <audio> Range-request MP3 from /api/chunks/{id}/audio
    ├─ SW passes through (online) or serves from cache (offline)
    ├─ Track progress: local 5s → server 15s debounce
```

### 2. Ordering Invariant (Chunking Correctness)

**Goal:** No text scramble; no lost pages; handle retry + discard.

**Rule:** Chunks walk `seq = 0, 1, 2, …` and stop at the first "not ready" page:
- Missing: upload hasn't arrived yet
- Failed: OCR failed, retry not pressed, image not expired
- Not OCR'd: still `uploaded` or `ocr_processing`
- **Exception:** `discarded` pages are skipped (dead marker)

**Example:**
```
Pages:     [0:ocr_done, 1:ocr_done, 2:failed, 3:ocr_done, 4:discarded, 5:ocr_done]
Chunks:    [0–1 merged] → blocked at seq 2 (failed) → chunks [4–5] unreachable
User:      Press "Retry" on page 2 → pages.status='ocr_processing' → chunks unblock next tick
           Or press "Discard" on page 2 → pages.status='discarded' → chunks [2, 3, 4, 5] fold in
```

**Enforcement:** SQL `contiguous from 0` loop in `chunker_worker.py:37–58`. Breaking the invariant client-side (N2 gap) leaves a permanent stall until user manual discard on status view.

### 3. Tail-Chunk Sealing (Synthesis Safety)

**Problem:** Don't synthesize text that might change (pages added later, user edit).

**Solution:** TTS can only claim:
1. **Sealed chunks** (`sealed=1`) — immutable, chunker will never touch again
2. **Unsealed tail** if the book is idle — no page activity for `tail_seal_grace_seconds=90s`

**How it works:**
- Chunker always preserves 1 unsealed (`sealed=0`) tail chunk
- `ChunkRepository.claim_next_pending`: atomic SQL check
  ```sql
  UPDATE chunks SET status='processing', sealed=1, claim_token=<new>, provider=<book>, voice=<book>
  WHERE id = (oldest pending chunk of an unpaused provider
              AND (sealed=1 OR (book.updated_at <= now - grace AND no uploaded/ocr_processing page)))
  AND status='pending'
  RETURNING *
  ```
- Voice change / text edit / retry reset the chunk to `pending` even while it is `processing`; the in-flight run then fails the claim-token check in `mark_*` and deletes its own file unless another row references it
- Claiming seals the chunk, so pages added later start a new chunk instead of rewriting spoken text
- `replace_tail` (chunker): guard `DELETE FROM chunks WHERE id=? AND sealed=0` — protects against user seal or hand edits to the tail

**Result:** Last chunk of a book synthesizes after grace period, but never early. User hand-edited text in tail is never overwritten by chunker.

**User-initiated seal (`POST /api/books/{id}/seal-tail`):** Open to every member; skips grace, tail marked sealed immediately, TTS claims it on next tick.

### 4. Quota Management (No Fallback)

**Decision (D11):** One fixed provider+voice per book; no automatic fallback.

**Flow:**
1. TTS calls provider → 429 (quota exceeded)
2. `TtsError.code == 'quota'` → not retried inline
3. Mark chunk `status='waiting_quota'`, set `not_before` (from Retry-After or default 1h)
4. Worker pauses provider in-memory: skip all pending chunks for that provider
5. Chunk stays in queue; next tick checks `not_before` timestamp
6. ETA shown in reader (chunk-level) and book status (summary)
7. **User recovery:** 
   - Wait for quota reset (natural re-queue at `not_before`)
   - Change book voice to Azure (PUT `/api/books/{id}/voice`) → if provider changes, all `waiting_quota` chunks→`pending` with new provider

**Example:**
```
Gemini quota hits at chunk 5
  → chunks [5–N] → waiting_quota
  → UI shows "Chờ quota — dự kiến lúc 2026-09-29T12:00:00Z" (if shown)
  → User can wait OR use PUT /voice to change provider
  → If wait: at 12:00, chunk 5 auto-transitions to pending, TTS claims it with Gemini
  → If provider changes (e.g., to Azure): all waiting_quota chunks→pending immediately, TTS claims via new provider
```

**No cross-provider retry:** Prevents voice mix within one book (D11 validation).

## Database Schema

**SQLite, WAL mode, foreign keys=ON. User version (migrations) tracks schema version.**

### Users & Sessions
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,           -- Argon2, hashed async
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,           -- SHA-256(32-byte random token)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,            -- For sliding expiry (cookie reissue not implemented; L2)
  expires_at TEXT NOT NULL               -- 180 days from creation
);
```

### Books & Pages
```sql
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  tts_provider TEXT NOT NULL,            -- "gemini" or "azure"
  tts_voice TEXT NOT NULL,               -- e.g. "Kore", "vi-VN-HoaiMyNeural" (not validated; M1)
  topic_id TEXT REFERENCES topics(id),   -- v3; NULL = "Chưa phân loại"
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL               -- Touched on every relevant change (for tail-seal grace)
);

CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,                  -- User-provided on upload; server assigns at insert (C2 fix)
  status TEXT NOT NULL,                  -- 'uploaded','ocr_processing','ocr_done','failed','discarded'
  image_path TEXT,                       -- /data/tmp/{id}.{jpg|png|webp}; NULL after OCR done or TTL
  image_mime TEXT,                       -- Sniffed + validated
  client_upload_id TEXT,                 -- Idempotent re-upload detection
  text TEXT,                             -- Raw OCR output
  continues INTEGER NOT NULL DEFAULT 0,  -- 1 if page text continues to next (no paragraph break)
  chunked INTEGER NOT NULL DEFAULT 0,    -- 1 after incorporated into chunks
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,                            -- User-facing error message
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(book_id, seq)
);
```

### Chunks & Audio
```sql
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  content_hash TEXT,                     -- hash(text, provider, voice)[:8] for cache
  status TEXT NOT NULL,                  -- 'pending','processing','done','waiting_quota','failed'
  not_before TEXT,                       -- ISO timestamp; chunk unclaimable until this time (quota reset)
  provider TEXT,                         -- Copied from books.tts_provider at claim time
  voice TEXT,                            -- Copied from books.tts_voice at claim time
  audio_path TEXT,                       -- /data/library/{book_id}/{seq:05d}-{hash[:8]}.mp3 (if done)
  duration_ms INTEGER,                   -- Audio length (if done)
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,                            -- User-facing error
  sealed INTEGER NOT NULL DEFAULT 0,     -- 1 if immutable; 0 if tail (may be re-split)
  updated_at TEXT NOT NULL,
  claim_token TEXT,                      -- Non-null while processing; prevents stale TTS race (H2 fix)
  UNIQUE(book_id, seq)
);

CREATE TABLE progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chunk_seq INTEGER NOT NULL,            -- Current chunk index (0-based)
  offset_ms INTEGER NOT NULL,            -- Within-chunk offset (for resume mid-chunk)
  updated_at TEXT NOT NULL,              -- For prefer-newer merge (local vs server)
  PRIMARY KEY(user_id, book_id)
);

CREATE TABLE bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chunk_seq INTEGER NOT NULL,            -- Chunk sequence (unsealed tail can be replaced; seq survives)
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, book_id, chunk_seq)
);

CREATE TABLE provider_usage (             -- v5: one row per OCR/TTS provider call attempt
  id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,                 -- gemini_ocr | gemini_tts | azure_tts
  outcome TEXT NOT NULL,                 -- ok | quota (429) | error
  chars INTEGER NOT NULL DEFAULT 0,      -- characters on successful calls (Azure bills per char)
  book_id TEXT,                          -- no FK: usage stays counted after a book is deleted
  created_at TEXT NOT NULL
);
CREATE INDEX idx_provider_usage_service_time ON provider_usage(service, created_at);
```

**Provider quota ("usage còn lại"):** Gemini/Azure không có API trả quota còn lại → worker ghi mỗi lần gọi (kể cả retry) vào `provider_usage` (best-effort, lỗi ghi không làm hỏng page/chunk); `app/usage_quota.py` cộng theo cửa sổ reset của từng provider (Gemini RPD: nửa đêm giờ Pacific; Azure: tháng UTC) và so với `GEMINI_OCR_RPD` / `GEMINI_TTS_RPD` / `AZURE_TTS_MONTHLY_CHARS` (0 = chưa đặt → chỉ hiện đã dùng). Nguồn sự thật duy nhất là 429 của provider → `status=paused` từ chunk `waiting_quota`. Lượt gọi bằng cùng key từ nơi khác không được đếm. Cleanup worker xoá dòng cũ hơn `USAGE_RETENTION_DAYS` (62).

**Why `chunk_seq` not `chunk_id`:** The unsealed tail chunk is replaced when pages are added (`chunk_repository.replace_tail`), so its `id` changes; bookmarks keyed by `seq` survive the replacement.

### Indexes (for claim, resume, TTL)
```sql
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_pages_status ON pages(status);
CREATE INDEX idx_chunks_status ON chunks(status);
```

**Migrations (append-only, `PRAGMA user_version`):**
```sql
-- v2: guard TTS results against a chunk reset/re-claimed mid-synthesis
ALTER TABLE chunks ADD COLUMN claim_token TEXT;
-- v3: shared user-created topics, 0–1 per book
CREATE TABLE topics (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
                     created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL);
ALTER TABLE books ADD COLUMN topic_id TEXT REFERENCES topics(id);
CREATE INDEX idx_books_topic ON books(topic_id);
```

**Single aiosqlite connection (async), one write lock (asyncio.Lock) around all mutations. Reads don't lock.**

## API Endpoints — Full Reference

**Base:** `/api/` (all except `register`/`login`/`logout` require `CurrentUser`).

Tất cả path có tiền tố `/api` (trừ `/health`). Auth ✓ = cần cookie session, thiếu → 401.

| Method | Path | Auth | Status | Returns |
|--------|------|------|--------|---------|
| **Auth** ||||
| POST | `/auth/register` | — | 201 | `{id, username, display_name}` + cookie; cần `invite_code` |
| POST | `/auth/login` | — | 200 | `{id, username, display_name}` + cookie |
| POST | `/auth/logout` | — | 204 | xoá session nếu có (idempotent) |
| GET | `/me` | ✓ | 200 | `{id, username, display_name}` |
| GET | `/me/continue` | ✓ | 200 | `[book_out]` sách user đang nghe dở, mới nhất trước |
| **Account** ||||
| GET | `/me/profile` | ✓ | 200 | `{id, username, display_name, created_at, stats: {books_created, pages_captured, books_listening, bookmarks}}` |
| PATCH | `/me` | ✓ | 200 | `{id, username, display_name}`; body `{display_name}` (1–40 ký tự) |
| POST | `/me/password` | ✓ | 200 | `{other_sessions_revoked}`; body `{current_password, new_password}`; giữ session hiện tại, xoá mọi session khác; rate limit theo user |
| GET | `/usage` | ✓ | 200 | `{as_of, services: [{service, label, unit, window, status, used, limit, remaining, window_start, resets_at, quota_hits, last_quota_at, paused_until, waiting_chunks}]}` — dùng chung cả nhà |
| **Books** ||||
| POST | `/books` | ✓ | 201 | `book_detail`; body `{title, topic?, tts_provider?, tts_voice?}` |
| GET | `/books` | ✓ | 200 | `[book_out]` (thư viện chung, tiến độ của user hiện tại) |
| GET | `/books/{id}` | ✓ | 200 | `book_detail` = `book_out` + `page_list` + `pages.missing_seqs` + `chunks.tail_wait_seconds` |
| PATCH | `/books/{id}` | ✓ người tạo | 200 | `book_detail`; legacy: `title?`, `topic?`, `tts_provider?`, `tts_voice?` (đổi giọng → mọi chunk về `pending`) |
| PUT | `/books/{id}/voice` | ✓ người tạo | 200 | `book_detail`; body `{tts_provider, tts_voice}` (đổi giọng cho đoạn chưa có audio; không reset grace). Đổi provider (vd. gemini→azure) → các đoạn `waiting_quota` của sách về `pending` ngay; cùng provider thì vẫn chờ quota |
| POST | `/books/{id}/seal-tail` | ✓ mọi thành viên | 204 | Bỏ qua khoảng chờ; tail chunk được đề cử TTS ngay |
| DELETE | `/books/{id}` | ✓ người tạo | 204 | xoá DB + audio + ảnh tạm |
| GET | `/books/{id}/export` | ✓ | 200 | ZIP stream (MP3 theo seq + `text.json`) |
| GET/PUT | `/books/{id}/progress` | ✓ | 200 | `{chunk_seq, offset_ms, updated_at}` của user hiện tại |
| **Bookmarks** ||||
| GET | `/bookmarks` | ✓ | 200 | `[{book_id, book_title, chunk_seq, excerpt, created_at}]` (mới nhất trước, excerpt 160 ký tự) |
| GET | `/books/{id}/bookmarks` | ✓ | 200 | `[chunk_seq]` cho sách này, user hiện tại |
| PUT | `/books/{id}/bookmarks/{seq}` | ✓ | 200 | `{chunk_seq, created_at}`; idempotent (tái add giữ created_at cũ) |
| DELETE | `/books/{id}/bookmarks/{seq}` | ✓ | 204 | xoá bookmark; idempotent (xoá 2 lần OK) |
| **Topics** ||||
| GET | `/topics` | ✓ | 200 | `[{id, name, book_count}]` — chỉ chủ đề đang có sách, sắp theo tên |
| **Pages** ||||
| POST | `/books/{id}/pages` | ✓ | 202 (200 khi gửi lại cùng `upload_id`) | `page_out`; multipart `image`, `seq`, `upload_id?` |
| POST | `/books/{id}/pages/{seq}/discard` | ✓ | 200 | `page_out`; trang `failed` hoặc seq còn thiếu (≤ next_seq) |
| POST | `/pages/{id}/retry` | ✓ | 200 | `page_out`; chỉ trang `failed` còn ảnh |
| **Chunks** ||||
| GET | `/books/{id}/chunks` | ✓ | 200 | `[chunk_out]`; `audio_url` chỉ có khi `done` |
| PATCH | `/chunks/{id}` | ✓ | 200 | `chunk_out`; sửa `text` → seal + `pending`; returns voice/provider = book's current (the voice next claim will use) |
| POST | `/chunks/{id}/retry` | ✓ | 200 | `chunk_out`; từ `failed`/`waiting_quota`; returns voice/provider = book's current |
| GET | `/chunks/{id}/audio` | ✓ | 200/206 | MP3, hỗ trợ `Range` |
| **Voices** ||||
| GET | `/voices` | ✓ | 200 | `{default_provider, providers: {gemini: {default, voices, configured, preview_urls}, azure: {…}}}` |
| GET | `/voices/{provider}/{voice}/preview` | ✓ | 200/401/404/409/429/503 | MP3 của câu cố định (cache 1 năm, `?v=` versioned) |
| **Health** ||||
| GET | `/health` | — | 200/503 | `{status, db, data_dir}` |

`book_out.topic` = `{id, name}` hoặc `null`. Chủ đề được nhận diện theo `name_key` (NFC + casefold + gộp khoảng trắng): "Văn học" và "VĂN  HỌC" là một.

**Error format (all endpoints):**
```json
{
  "error": {
    "code": "page_seq_taken",
    "message": "Số trang này đã tồn tại trong sách",
    "field": "seq"
  }
}
```

**Error codes:** `invalid_request` (400), `username_invalid` / `display_name_invalid` / `password_invalid` / `title_invalid` / `topic_invalid` / `text_invalid` (400), `current_password_invalid` / `password_unchanged` (400), `unauthorized` / `invalid_credentials` (401), `forbidden` / `invite_invalid` (403), `not_found` (404), `page_seq_taken` / `username_taken` / `page_not_discardable` / `page_not_retryable` / `chunk_not_retryable` (409), `unknown_voice` (400 khi tên giọng lạ), `provider_unavailable` (409 khi provider không cấu hình API key), `image_too_large` / `request_too_large` (413), `image_type_invalid` (415), `rate_limited` (429, có `Retry-After`).

### Voice Preview Details

**GET `/api/voices/{provider}/{voice}/preview`:**
- Sample text cố định (server constant): "Xin chào, tôi sẽ đọc cuốn sách này cho bạn nghe. Mời bạn thư giãn và lắng nghe từng trang sách."
- Single-flight: cùng voice / provider, request đồng thời chỉ tạo 1 lần call TTS (chia sẻ kết quả hoặc lỗi)
- Cache disk: `DATA_DIR/voice-previews/{cache_key:16}.mp3`, key từ provider + voice + model + style + text
- Immutable URL: `/api/voices/{provider}/{voice}/preview?v={cache_key}` → `Cache-Control: max-age=31536000, immutable`
- Failure cache: lỗi nhớ 60s (hoặc `Retry-After` từ quota error); timeout 30s từ client
- Rate limit: 6 calls/user/phút (tính cả timeout) → 429 `rate_limited`
- Error mapping (client không nhận text provider):
  - 409 `provider_unavailable`: giọng hợp lệ nhưng provider chưa cấu hình key
  - 429 `rate_limited`: user gọi quá nhanh; `Retry-After` header
  - 503 `tts_quota`: hết quota; `Retry-After` header
  - 503 `tts_timeout`: server chậm > 30s
  - 502 `tts_failed`: provider lỗi khác

**Book JSON fields (`chunks` object):**
- `done`: số đoạn đã có audio
- `failed`: số đoạn lỗi (user phải thử lại hoặc bỏ qua)
- `waiting_quota`: số đoạn chờ quota reset
- `processing`: số đoạn đang synthesize
- `queued`: số đoạn sẵn sàng claim (sealed hoặc tail quá grace)
- `tail_waiting`: true nếu chỉ tail chưa seal, không có queued/processing, không có page OCR đang chạy
- `next_not_before`: timestamp sớm nhất mà chunk nào được unblock (quota reset)
- `tail_wait_seconds` (GET `/books/{id}` only): giây còn chờ để tail được synthesize; null nếu không `tail_waiting`

## Web Routes (Hash-based SPA)

**App shell routes** (`web/js/app.js` parseRoute):
- `#/auth` → `AuthView` (login/register, invite code)
- `#/library` → `LibraryView` (crate library, hero "Continue")
- `#/bookmarks` → Bookmarks view (per-user bookmarks, newest first)
- `#/account` → `AccountView` (thông tin cá nhân, hạn mức dịch vụ, đổi tên hiển thị/mật khẩu); mở từ menu avatar ở Thư viện
- `#/capture` / `#/capture/:bookId` → `CaptureView` (camera + upload queue)
- `#/book/:id` → `BookStatusView` (processing timeline)
- `#/read/:id` · `#/listen/:id` → `ReaderView` (mode="read" | "listen", same component instance; optional `?seq=N` to start at chunk N)

**Key pattern:** Listen/read routes share a single `ReaderView` instance (keyed by `bookId`) so audio doesn't interrupt when user switches between read and listen mode. `parseRoute` returns `name='read'` with separate `mode` prop; the component re-renders but doesn't remount.

## Service Worker (`web/sw.js`)

**Cache strategy:**
- **Shell cache** (cache-first): HTML, JS, CSS, fonts — version `booksnap-shell-v11` (bump on any `web/` change to bust cache)
- **API cache** (network-first): `/api/*` fallback to cache if offline
- **Audio cache** (cache on demand): user-initiated offline download per book

**Shell assets** guarded by `tests/test_service_worker_assets.py` (ensure sw.js SHELL_ASSETS list matches files).

## Page Status Machine

```
            [user] upload
        ↓
    uploaded
        ↓
    [worker claim]
    ↓
ocr_processing
    ↓
    ├─ [OCR OK] → ocr_done
    │               ├─ (chunker folds in)
    │               └─ chunked=1
    │
    └─ [OCR failed] → failed
        (image TTL 24h, then orphan sweep)
        ├─ [user retry] → uploaded (image still present)
        └─ [image expired] → failed (image=NULL, can only discard)

    [user discard]
        ↓
    discarded (skipped by chunker, treated as resolved)
```

## Chunk Status Machine

```
    [chunker creates] → pending (unsealed=0 tail, or newly sealed)
        ├─ [book idle + grace_seconds] → claimable as tail
        └─ [sealed=1] → always claimable
            ↓
        [worker claim] → processing (provider+voice copied, claim_token set)
            ├─ [TTS OK] → done (audio_path set, duration_ms set, claim_token cleared)
            ├─ [TTS 429] → waiting_quota (not_before set, whole provider paused)
            │              (auto-requeue when not_before expires OR provider changed)
            └─ [TTS error] → failed (error message)

    [user voice change via PUT /voice]:
        chunks of this book parked on another provider's quota → pending, not_before cleared (new provider unparked)
        chunk in flight that then gets the old provider's 429 → pending (not parked), worker still pauses old provider
        if same provider, different voice → waiting_quota stay waiting (quota per key); processing/done unaffected
    [user discard] → all pending+sealed → removed from book
```

## Security Model

| Layer | Mechanism |
|-------|-----------|
| **Authn** | Session token (32 bytes random) → SHA-256 in DB. Cookie httpOnly, Secure, SameSite=Lax, 180 days. |
| **Authz** | `CurrentUser` dependency on all `/api/*` (except register/login/logout). Creator check on delete/voice. `load_book` verifies book exists; user not checked (owner-only enforced per endpoint). |
| **Body size** | Middleware fast-path (Content-Length) + streamed byte count. Rejects ≥ 5.256 MB before parsing. |
| **Image** | MIME sniff (magic bytes) + declared type match. Whitelist: JPEG/PNG/WebP. |
| **Paths** | Files served only from `/data/library/` (audio) or ZIP stream (export); checked via `is_within(path, base)`. |
| **Secrets** | API keys in headers (not URL/body/logs). `.env` not committed. |
| **XSS** | All user text in htm text nodes (not HTML). Static SVG icons only. |
| **CSRF** | SameSite=Lax prevents cross-site POST/PATCH/DELETE; GET is side-effect free. (Assumes `up.railway.app` on PSL.) |
| **SQL** | Parameterized queries only. Foreign keys enabled. |

**Known gaps (post-review):**
- H4: Pre-auth multipart parsing unbounded (Starlette limits files to 1 MB non-file parts; file parts unlimited). **Mitigation:** RequestSizeLimitMiddleware fast-path on Content-Length.
- L11: Rate limit by last X-Forwarded-For entry (trusts Railway header append).
- M1: Voice not validated → SSML injection risk (Azure). **Fix:** validate voice against list.

## Pipeline Invariants & Safety

### Azure SSML Voice Attribute Escaping

Voice names (from `tts_voice`) are inserted into Azure SSML `<voice xml:lang="vi-VN" name={voice}>{text}</voice>`. Always escape using `xml.sax.saxutils.quoteattr(voice)` to prevent SSML injection. Example:
```python
escaped = xml.sax.saxutils.escape(text)  # Text content
voice_attr = xml.sax.saxutils.quoteattr(voice)  # Attribute value
ssml = f'<voice name={voice_attr}>{escaped}</voice>'
```

## Deployment Topology (Railway)

```
GitHub main
    ↓ (push)
Railway (Railpack)
    ├─ Build: detect Python via requirements.txt/.python-version
    ├─ Start: /bin/sh -c "exec uvicorn app.main:app --host 0.0.0.0 --port $PORT …"
    ├─ Health: GET /health (200 | 503)
    ├─ Replicas: 1 (SQLite, in-process worker — no scaling)
    ├─ Volume: /data (booksnap.db, library/, tmp/)
    └─ Env: GEMINI_API_KEY, AZURE_SPEECH_KEY, INVITE_CODE, TTS_DEFAULT_PROVIDER, …
```

**Health check semantics:**
- 200 OK: DB reachable, data_dir readable/writable, on Railway with volume mounted
- 503 Error: DB fail, data_dir fail, or Railway env detected but no volume mount

---

## Reference: Data Life Cycles

| Data | Created | Updated | Deleted | Storage |
|------|---------|---------|---------|---------|
| Page image | Upload | — | On OCR done (explicit) or TTL 24h (sweep) | `/data/tmp/` |
| Page text | OCR complete | User edit text field (not in MVP) | With book | DB |
| Chunk text | Chunker | User discard | With book | DB |
| Chunk audio | TTS complete | Voice change (→ `pending`, new provider) | With book or cache clear | `/data/library/{book_id}/` |
| Session | Login | Touch (not implemented; L2) | Logout or expiry (180d) | DB |
| Progress | First read | Play/pause, seek | Logout clears session (local storage not cleared) | DB + localStorage |

---

**Status:** Architecture complete. Implementation verified by code review (99 tests pass; 3 High issues, remainder Low/Medium).
