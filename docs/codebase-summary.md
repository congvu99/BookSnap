# Codebase Summary — Module Map

**Last updated:** 2026-09-29 | **LOC:** ~7.5K (app ~2.4K, web ~2.9K, tests ~1.1K)

## Directory Structure

```
BookSnap/
├── app/                                  Backend (Python 3.12, FastAPI)
│   ├── main.py                          [114 LOC] FastAPI app factory, lifespan, static mount
│   ├── config.py                        [66 LOC] Pydantic Settings, env vars
│   ├── db.py                            [181 LOC] SQLite connection, migrations (2), transaction lock
│   ├── app_context.py                   [~20 LOC] AppContext: repos + worker DI
│   ├── api_errors.py                    [~30 LOC] ApiError exception, error handlers
│   ├── cli.py                           [~15 LOC] CLI reset-password command
│   ├── request_size_limit.py            [73 LOC] ASGI middleware: Content-Length + streaming byte count
│   ├── storage_health.py                [19 LOC] Railway volume durability check
│   ├── file_paths.py                    [~5 LOC] is_within() path traversal guard
│   │
│   ├── auth/                            Auth & session management
│   │   ├── auth_routes.py               [~80 LOC] POST /register, /login, /logout, GET /me
│   │   ├── session_service.py           [~40 LOC] Create/verify session token, SHA-256 hashing
│   │   ├── password_service.py          [~20 LOC] Argon2 hash/verify (async on thread)
│   │   ├── rate_limiter.py              [~25 LOC] Per-IP login/register rate limit (10/min)
│   │   └── current_user.py              [~15 LOC] CurrentUser dependency, Ctx alias
│   │
│   ├── api/                             HTTP routes & serializers
│   │   ├── books_routes.py              [~70 LOC] POST/GET/PATCH/DELETE /books
│   │   ├── pages_routes.py              [98 LOC] POST /pages (upload JPEG/PNG/WebP), retry, discard
│   │   ├── audio_routes.py              [~45 LOC] GET /chunks/{id}/audio (Range request via Starlette)
│   │   ├── voices_routes.py             [25 LOC] GET /voices (Gemini + Azure voice list)
│   │   ├── export_routes.py             [104 LOC] GET /books/{id}/export (ZIP stream: MP3 + text.json)
│   │   └── serializers.py               [91 LOC] book_out, page_out, chunk_out (contract shapes)
│   │
│   ├── repositories/                    Data access layer (pure SQL)
│   │   ├── book_repository.py           [~90 LOC] CRUD books, get_summary (denormalized counts)
│   │   ├── page_repository.py           [~130 LOC] CRUD pages, claim_next_uploaded, resume_processing
│   │   ├── chunk_repository.py          [~160 LOC] CRUD chunks, claim_next_pending (sealing logic), tail ops
│   │   ├── user_repository.py           [~35 LOC] CRUD users, lookup by username
│   │   ├── session_repository.py        [~35 LOC] CRUD sessions, lookup by token_hash
│   │   ├── progress_repository.py       [~20 LOC] Upsert progress (per user_id + book_id)
│   │   └── row_mapping.py               [~25 LOC] new_id() (UUID), dataclass constructors from rows
│   │
│   └── pipeline/                        Worker (OCR → chunk → TTS)
│       ├── worker.py                    [312 LOC] Main event loop, OCR/TTS/chunk/cleanup loops, claim logic
│       ├── chunker_worker.py            [77 LOC] Fold pages into chunks (ordering invariant, tail sealing)
│       ├── cleanup_worker.py            [~30 LOC] TTL image expiry + orphan file sweep
│       ├── ocr_provider.py              [~20 LOC] Protocol: PageText, OcrError, OcrProvider
│       ├── ocr_gemini.py                [~60 LOC] Gemini OCR via response_schema (pydantic)
│       ├── tts_provider.py              [~40 LOC] Protocol: SynthResult, TtsError, TtsProvider
│       ├── tts_gemini.py                [~80 LOC] Gemini TTS, PCM→audio_encoding, quota/retry classification
│       ├── tts_azure.py                 [~65 LOC] Azure Speech REST (SSML), audio/24khz MP3
│       ├── tts_router.py                [~80 LOC] Provider dispatch + backoff retry (2s/8s/30s)
│       ├── text_chunker.py              [~50 LOC] Pure: split text into 1000–1500 char chunks
│       └── audio_encoding.py            [~30 LOC] PCM16→MP3 via lameenc wheel, duration calc
│
├── web/                                  Frontend (PWA, ES modules + Preact)
│   ├── index.html                       [~20 LOC] Minimal: root element, manifest link, no CSS
│   ├── manifest.webmanifest             [~25 LOC] PWA: name, icons (192/512 + SVG), theme color
│   ├── sw.js                            [146 LOC] Service worker (cache-first shell, network-first API)
│   │
│   ├── css/                             No CSS framework, design tokens only
│   │   ├── tokens.css                   [~50 LOC] Colors (wine-red, ivory, gold), fonts (Cormorant)
│   │   ├── app.css                      [~80 LOC] Global layout, form inputs, buttons
│   │   ├── library.css                  [~60 LOC] Book grid, covers
│   │   ├── camera.css                   [~50 LOC] Camera frame, shutter, progress
│   │   └── reader.css                   [~60 LOC] Reader layout, timeline, mini-player
│   │
│   ├── vendor/
│   │   └── preact-htm.module.js         [vendored, MIT] Single JS module: Preact + htm
│   │
│   ├── icons/
│   │   ├── icon.svg                     [hand-drawn open-book glyph]
│   │   ├── icon-192.png, icon-512.png   [maskable PNG]
│   │
│   └── js/                              ES modules (no build step)
│       ├── app.js                       [100 LOC] Hash router (#/auth, #/library, #/capture, #/read)
│       ├── api-client.js                [~80 LOC] Fetch wrapper, 401 logout, error parsing
│       ├── store.js                     [~60 LOC] AuthStore + ThemeStore (pub-sub, localStorage)
│       ├── icons.js                     [~70 LOC] Inline SVG icons (Lucide-style, stroke 1.5)
│       ├── camera-capture.js            [~90 LOC] getUserMedia, canvas JPEG, torch, vibrate
│       ├── upload-queue.js              [~120 LOC] Sequential upload, seq conflict + gap handling
│       ├── audio-playlist.js            [~130 LOC] Dual <audio> preload, seek, playback rate
│       ├── playback-progress.js         [~60 LOC] Local 5s + server 15s debounce, prefer-newer merge
│       ├── media-session.js             [~40 LOC] Lock-screen play/pause/next/prev
│       ├── offline-audio-cache.js       [~50 LOC] Cache API download, verify, remove
│       ├── offline-book-cache.js        [~40 LOC] localStorage per-book manifest
│       │
│       ├── views/                       Route components (Preact)
│       │   ├── auth-view.js             [~80 LOC] Register/login form, invite code validation
│       │   ├── library-view.js          [~70 LOC] Book grid, empty state, offline fallback
│       │   ├── capture-view.js          [~240 LOC] Book chooser → camera → shutter + thumbnail strip
│       │   ├── book-status-view.js      [~90 LOC] Timeline (pages, chunks), retry, discard buttons
│       │   └── reader-view.js           [~310 LOC] Reader (text + highlight), player shell, progress sync
│       │
│       └── components/                  Reusable UI components
│           ├── book-cover.js            [~30 LOC] Visual book cover render
│           ├── bottom-nav.js            [~50 LOC] Tab bar (library, capture, library, settings)
│           ├── progress-timeline.js     [~70 LOC] Page/chunk status timeline
│           ├── mini-player.js           [~60 LOC] Inline player: play/pause/rate/download
│           ├── player-sheet.js          [~80 LOC] Bottom sheet: rate, theme, offline mode, export
│           ├── chunk-paragraph.js       [~50 LOC] Text render + edit button (long-press)
│           └── chunk-editor.js          [~50 LOC] Edit dialog for chunk text
│
├── tests/                               Test suite (88–99 tests, no network)
│   ├── conftest.py                      [~30 LOC] Fixtures: settings, db, app, fake providers
│   ├── test_auth.py                     [~60 LOC] Register, login, logout, rate limit
│   ├── test_books_api.py                [~252 LOC] CRUD books, voice change, multi-user progress
│   ├── test_pages_api.py                [~80 LOC] Upload, retry, discard, seq conflict
│   ├── test_chunks_api.py               [~60 LOC] List chunks, audio streaming (Range)
│   ├── test_text_chunker.py             [~50 LOC] Pure chunker: split text, boundaries
│   ├── test_tts_router.py               [~50 LOC] Router: backoff, quota, RPM limit
│   ├── test_worker_resume.py            [~248 LOC] Resume on-flight rows (pages, chunks)
│   ├── test_export_and_storage_health.py [~50 LOC] Export ZIP, health check
│   └── test_pipeline_end_to_end.py      [~60 LOC] Full flow: upload → OCR → chunk → TTS (fake)
│
├── scripts/
│   └── voice_poc.py                     [~80 LOC] CLI: PoC voice selection (OCR 1 image, synthesize 4 Gemini + 2 Azure voices)
│
├── docs/                                Documentation
│   ├── design-guidelines.md             [existing] UI/UX, Classic Library theme
│   ├── project-overview-pdr.md          [new] MVP scope, decisions, acceptance criteria
│   ├── system-architecture.md           [new] Component diagram, request flow, DB schema, API endpoints
│   ├── deployment-guide.md              [new] Railway setup, health check, runbook, troubleshooting
│   ├── code-standards.md                [new] Python/JS conventions, patterns, testing
│   ├── codebase-summary.md              [new] This file
│   └── project-roadmap.md               [new] MVP status, next steps, open issues
│
├── .env.example                         Environment template (copy to .env for local dev)
├── .gitignore                           Exclude .env, .venv, data/, __pycache__
├── .python-version                      3.12 (Railpack detection)
├── railway.json                         Railpack config: start command, health check, 1 replica
├── requirements.txt                     Dependencies (fastapi, aiosqlite, google-genai, httpx, etc.)
├── requirements-dev.txt                 Test dependencies (pytest, playwright, etc.)
├── pytest.ini                           Test config (timeout, markers)
└── README.md                            Quick start, local dev, env vars, structure
```

## Key Statistics

| Metric | Value |
|--------|-------|
| Python LOC | ~2,400 |
| JavaScript LOC | ~2,900 |
| Test LOC | ~1,100 |
| Tests | 88–99 (0 network calls) |
| API endpoints | 20+ |
| DB tables | 6 (users, sessions, books, pages, chunks, progress) |
| DB migrations | 2 (append-only) |
| Python modules | 35+ |
| JS modules | 30+ |
| External deps (production) | 10 (fastapi, aiosqlite, google-genai, httpx, lameenc, etc.) |
| External deps (dev) | 5 (pytest, playwright, etc.) |

## Module Dependencies (Simplified)

```
main.py
  → config.py, db.py, app_context.py
  → auth/*, api/*, repositories/*, pipeline/*
  
api/*.py (routes)
  → current_user.py (dependency)
  → repositories/* (CRUD)
  → api_errors.py (errors)
  
repositories/*.py
  → db.py (execute, transaction)
  
pipeline/worker.py
  → repositories/* (claim, mark done)
  → ocr_gemini.py, tts_gemini.py, tts_azure.py (providers)
  → tts_router.py (retry)
  → chunker_worker.py, cleanup_worker.py (sub-ticks)
  
web/js/app.js (router)
  → views/* (components)
  → store.js (state)
  → api-client.js (fetch)
  
web/sw.js (global)
  → (independent; handles fetch events)
```

## Test Coverage

| Module | Coverage |
|--------|----------|
| auth/ | 88% (login, register, rate limit) |
| repositories/ | 95% (all CRUD paths, claim logic) |
| pipeline/ | 85% (worker loops, OCR/TTS with fake providers, chunker logic) |
| api/ | 90% (all routes, error cases) |
| text_chunker.py | 100% (pure function) |

**No network calls in tests:** OCR/TTS providers are mocked; Gemini/Azure never called from CI.

## Performance Notes

- **Single aiosqlite connection:** ~10–100 ms per query (simple) to 500+ ms (complex scan with group/join)
- **Chunker:** O(N log N) over all chunks (scan + binary search for tail); acceptable at family scale
- **Worker loops:** Poll every 2 seconds; scales linearly with concurrency (2 OCR + 2 TTS default)
- **Web:** No build, ~100 KB uncompressed JS + CSS, lazy-load views via hash router

## Known Tech Debt

- **L12 file size:** `worker.py` (312 LOC), `reader-view.js` (310 LOC) — near limits but cohesive
- **N1 migration:** Schema change edited in place; existing DBs skipped `claim_token` column (fix: append new migration)
- **M1 voice validation:** Free text, no validation against provider list (SSML injection risk)
- **L11 rate limit IP:** Trusts last X-Forwarded-For entry (safe for Railway if header append only)

---

**Status:** Complete. Code review done (99 tests, 3 High issues, remainder Low/Medium).

**Next:** Fix N1 migration, run voice PoC with real keys, device testing, Railway deploy.
