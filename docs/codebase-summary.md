# Codebase Summary — Module Map

**Last updated:** 2026-10-01 | **LOC:** ~9K (app ~3.2K, web ~3.5K, tests ~2K)

## Directory Structure

```
BookSnap/
├── app/                                  Backend (Python 3.12, FastAPI)
│   ├── main.py                          [114 LOC] FastAPI app factory, lifespan, static mount
│   ├── config.py                        [66 LOC] Pydantic Settings, env vars
│   ├── db.py                            [181 LOC] SQLite connection, migrations (2), transaction lock
│   ├── app_context.py                   [~20 LOC] AppContext: repos + worker DI
│   ├── api_errors.py                    [~30 LOC] ApiError exception, error handlers
│   ├── cli.py                           [~20 LOC] CLI: python -m app.cli reset-password <family-account-username>
│   ├── request_size_limit.py            [73 LOC] ASGI middleware: Content-Length + streaming byte count
│   ├── storage_health.py                [19 LOC] Railway volume durability check
│   ├── file_paths.py                    [~5 LOC] is_within() path traversal guard
│   │
│   ├── auth/                            Auth & session management
│   │   ├── auth_routes.py               [~165 LOC] GET /status, POST /register, /login, /logout, GET /me; LoginOut, MeOut
│   │   ├── session_service.py           [~40 LOC] Create/verify session token, SHA-256 hashing
│   │   ├── password_service.py          [~20 LOC] Argon2 hash/verify (async on thread)
│   │   ├── rate_limiter.py              [~25 LOC] Per-IP login/register rate limit (10/min)
│   │   └── current_user.py              [~15 LOC] CurrentUser dependency, Ctx alias
│   │
│   ├── api/                             HTTP routes & serializers
│   │   ├── books_routes.py              [~100 LOC] POST/GET/PATCH/PUT/DELETE /books, seal-tail, voice change
│   │   ├── pages_routes.py              [98 LOC] POST /pages (upload JPEG/PNG/WebP), retry, discard
│   │   ├── profiles_routes.py           [~110 LOC] GET/POST/PATCH/DELETE /profiles, select, create
│   │   ├── shelf_routes.py              [~30 LOC] GET/PUT/DELETE /me/shelf/{book_id}
│   │   ├── bookmarks_routes.py          [~46 LOC] GET/PUT/DELETE /bookmarks, per-user bookmarks
│   │   ├── audio_routes.py              [~45 LOC] GET /chunks/{id}/audio (Range request via Starlette)
│   │   ├── voices_routes.py             [70 LOC] GET /voices (family rate limit), GET /voices/{provider}/{voice}/preview
│   │   ├── export_routes.py             [104 LOC] GET /books/{id}/export (ZIP stream: MP3 + text.json)
│   │   └── serializers.py               [~130 LOC] book_out (on_shelf field), page_out, chunk_out
│   │
│   ├── repositories/                    Data access layer (pure SQL)
│   │   ├── book_repository.py           [~90 LOC] CRUD books, get_summary (denormalized counts)
│   │   ├── page_repository.py           [~130 LOC] CRUD pages, claim_next_uploaded, resume_processing
│   │   ├── chunk_repository.py          [~160 LOC] CRUD chunks, claim_next_pending (sealing logic), tail ops
│   │   ├── bookmark_repository.py       [~63 LOC] CRUD bookmarks, list per-user, per-book; idempotent add
│   │   ├── shelf_repository.py          [~40 LOC] CRUD shelf items (per-profile per-book; list, add, remove, check on_shelf)
│   │   ├── user_repository.py           [~60 LOC] CRUD profiles: list, add, update, delete_with_heir (reassign books)
│   │   ├── account_repository.py        [~35 LOC] CRUD accounts (minimal: lookup by username)
│   │   ├── session_repository.py        [~45 LOC] CRUD sessions (with account_id + user_id), lookup by token_hash, revoke others per account
│   │   ├── progress_repository.py       [~20 LOC] Upsert progress (per user_id + book_id)
│   │   └── row_mapping.py               [~30 LOC] new_id() (UUID), dataclass constructors for Account, User (Profile), LoginOut
│   │
│   ├── tts_voices.py                    [25 LOC] GEMINI_VOICES, AZURE_VOICES, allowed_voices, provider_configured
│   ├── page_anchors.py                  [~110 LOC] Compute page ↔ chunk mapping (on-read, pure fn, no DB)
│   ├── voice_preview.py                 [188 LOC] Preview service: single-flight, cache, rate limit, failure TTL
│   │
│   └── pipeline/                        Worker (OCR → chunk → TTS)
│       ├── worker.py                    [312 LOC] Main event loop, OCR/TTS/chunk/cleanup loops, claim logic
│       ├── chunker_worker.py            [77 LOC] Fold pages into chunks (ordering invariant, tail sealing)
│       ├── cleanup_worker.py            [~30 LOC] TTL image expiry + orphan file sweep
│       ├── ocr_provider.py              [~20 LOC] Protocol: PageText, OcrError, OcrProvider
│       ├── ocr_gemini.py                [~60 LOC] Gemini OCR via response_schema (pydantic)
│       ├── tts_provider.py              [~40 LOC] Protocol: SynthResult, TtsError, TtsProvider
│       ├── tts_gemini.py                [~80 LOC] Gemini TTS, PCM→audio_encoding, quota/retry classification
│       ├── tts_azure.py                 [~75 LOC] Azure Speech REST (SSML + quoteattr), audio/24khz MP3
│       ├── tts_router.py                [~80 LOC] Provider dispatch + backoff retry (2s/8s/30s)
│       ├── text_chunker.py              [~50 LOC] Pure: split text into 1000–1500 char chunks
│       └── audio_encoding.py            [~30 LOC] PCM16→MP3 via lameenc wheel, duration calc
│
├── web/                                  Frontend (PWA, ES modules + Preact)
│   ├── index.html                       [~20 LOC] Minimal: root element, manifest link, no CSS
│   ├── manifest.webmanifest             [~25 LOC] PWA: name, icons (192/512 + SVG), theme color
│   ├── sw.js                            [~170 LOC] Service worker (cache-first shell, network-first API, cache riêng chunk audio + nhạc nền)
│   ├── audio/ambient/                   Nhạc nền MP3 (-18 LUFS, 128kbps) + CREDITS.md (nguồn, license); không precache
│   │
│   ├── css/                             No CSS framework, design tokens only
│   │   ├── tokens.css                   [~50 LOC] Colors (wine-red, ivory, gold), fonts (Playfair Display)
│   │   ├── app.css                      [~100 LOC] Global layout, form inputs, buttons, ornaments
│   │   ├── library.css                  [~80 LOC] Crates, shelves, hero cards, topic menu
│   │   ├── vinyl.css                    [~100 LOC] Record sleeve colors (5 palettes), vinyl disc, tonearm
│   │   ├── now-playing.css              [~80 LOC] Listen mode NowPlayingPanel + disc animation
│   │   ├── bookmarks.css                [~40 LOC] Bookmarks view styling
│   │   ├── auth.css                     [~60 LOC] iOS-optimized signin/signup form
│   │   ├── voice-picker.css             [~60 LOC] Voice choice chips (2 cols mobile), preview button
│   │   ├── processing-progress.css      [~50 LOC] Progress bar with pulse, phaseOf status indicator
│   │   ├── camera.css                   [~70 LOC] Camera frame, shutter, progress, page number
│   │   └── reader.css                   [~70 LOC] Reader layout, timeline, mini-player, status toast
│   │
│   ├── vendor/
│   │   └── preact-htm.module.js         [vendored, MIT] Single JS module: Preact + htm
│   │
│   ├── icons/
│   │   ├── icon.svg                     [hand-drawn open-book glyph]
│   │   ├── icon-192.png, icon-512.png   [maskable PNG]
│   │
│   └── js/                              ES modules (no build step)
│       ├── app.js                       [100 LOC] Hash router (#/auth, #/library, #/bookmarks, #/capture, #/read, #/listen)
│       ├── api-client.js                [~80 LOC] Fetch wrapper, 401 logout, error parsing
│       ├── store.js                     [~60 LOC] AuthStore + ThemeStore (pub-sub, localStorage)
│       ├── icons.js                     [~70 LOC] Inline SVG icons (Lucide-style, stroke 1.5)
│       ├── sleeve-palette.js            [~30 LOC] FNV-1a hash → 5 leather colors (wine, moss, slate, amber, parchment)
│       ├── camera-capture.js            [~90 LOC] getUserMedia, canvas JPEG, torch, vibrate
│       ├── upload-queue.js              [~120 LOC] Sequential upload, seq conflict + gap handling
│       ├── audio-playlist.js            [~130 LOC] Dual <audio> preload, seek, playback rate
│       ├── background-music.js          [~200 LOC] Nhạc nền: <audio loop> qua GainNode, fade theo TTS, blob URL, chống race
│       ├── background-music-graph.js    [~35 LOC] Web Audio: dựng graph element→gain (all-or-nothing), ramp gain
│       ├── background-music-prefs.js    [~60 LOC] Pref nhạc nền theo thiết bị (localStorage), pure/testable
│       ├── background-music-tracks.js   [~20 LOC] Danh sách bài nhạc nền (id, nhãn, URL, gain)
│       ├── use-background-music.js      [~85 LOC] Hook: engine theo `playing`, lưu pref, toast lỗi
│       ├── playback-progress.js         [~60 LOC] Local 5s + server 15s debounce, prefer-newer merge
│       ├── media-session.js             [~40 LOC] Lock-screen play/pause/next/prev
│       ├── offline-audio-cache.js       [~50 LOC] Cache API download, verify, remove
│       ├── offline-book-cache.js        [~40 LOC] localStorage per-book manifest
│       ├── text-fold.js                 [~20 LOC] Accent-insensitive search (strip diacritics)
│       ├── voice-labels.js              [~40 LOC] Voice name mapping (Gemini/Azure labels)
│       ├── upload-notices.js            [~60 LOC] Pure logic for page upload notifications (page#, error)
│       ├── processing-progress.js       [~80 LOC] Pure logic for phaseOf (queued/processing/done), ETA calc
│       ├── use-visible-polling.js       [~40 LOC] Pure hook: pause polling when tab hidden
│       ├── page-position.js             [~80 LOC] Pure: map page ↔ (chunk_seq, frac), seek, playback position, anchors reconcile
│       ├── use-page-anchors.js          [~55 LOC] Hook: fetch anchors on chunk change, poll when pages pending, offline cache
│       │
│       ├── views/                       Route components (Preact)
│       │   ├── auth-view.js             [~90 LOC] iOS-optimized signin (hero + segmented + form), invite validation
│       │   ├── library-view.js          [~120 LOC] Crates by topic, hero "Continue", iOS topic menu, search
│       │   ├── bookmarks-view.js        [~80 LOC] Per-user bookmarks list (newest first)
│       │   ├── capture-view.js          [~200 LOC] Multipanel: choose book → confirm voice → camera
│       │   ├── capture-choose-step.js   [~100 LOC] Panel: book selector, new/existing book choice
│       │   ├── capture-confirm-step.js  [~150 LOC] Panel: voice picker with preview (▶), confirm to camera
│       │   ├── book-status-view.js      [~120 LOC] Timeline (pages, chunks), retry, discard buttons, progress
│       │   └── reader-view.js           [~395 LOC] Reader (text + highlight) + listen mode (disc+tonearm), progress sync
│       │
│       └── components/                  Reusable UI components
│           ├── record-sleeve.js         [~70 LOC] Square record sleeve (1:1) with 5 leather colors
│           ├── vinyl-disc.js            [~60 LOC] Vinyl disc animation (33⅓ rpm when playing)
│           ├── tonearm.js               [~50 LOC] Brass tonearm (angle by % progress, lift on pause)
│           ├── now-playing-panel.js     [~120 LOC] Listen mode: full-screen sleeve/disc + controls
│           ├── library-crate.js         [~90 LOC] Crate section (topic tab + grid of sleeves)
│           ├── library-hero-card.js     [~80 LOC] Hero "Continue" card (sleeve + disc + button)
│           ├── library-account-menu.js  [~50 LOC] Account menu (logout, language)
│           ├── topic-filter-menu.js     [~60 LOC] iOS segmented "Mọi chủ đề ⌃⌄" pull-down
│           ├── voice-picker.js          [~150 LOC] Voice choice UI: chips (2 cols mobile), ▶ preview, disabled state
│           ├── status-toast.js          [~40 LOC] Info/error toast (page upload, seal result)
│           ├── capture-thumb-strip.js   [~80 LOC] Page thumbnail row with status (upload, error)
│           ├── book-page-status-list.js [~70 LOC] Page timeline in book status view
│           ├── bottom-nav.js            [~52 LOC] Tab bar (library, bookmarks, capture, listen; 4 items)
│           ├── progress-timeline.js     [~70 LOC] Page/chunk status timeline
│           ├── mini-player.js           [~90 LOC] Inline player with sleeve icon + disc (48px)
│           ├── page-picker-sheet.js      [~65 LOC] Bottom sheet: list captured pages, current marked, disabled pages labeled, tap to play from
│           ├── player-sheet.js          [~150 LOC] Bottom sheet: rate, sleep, nhạc nền, font, theme, offline, export
│           ├── chunk-paragraph.js       [~50 LOC] Text render + edit button (long-press)
│           └── chunk-editor.js          [~50 LOC] Edit dialog for chunk text
│
├── tests/                               Test suite (Python: pytest, Web: node --test)
│   ├── conftest.py                      [~30 LOC] Fixtures: settings, db, app, fake providers
│   ├── test_auth.py                     [~60 LOC] Register, login, logout, rate limit
│   ├── test_books_api.py                [~252 LOC] CRUD books, voice change, multi-user progress, seal-tail
│   ├── test_pages_api.py                [~80 LOC] Upload, retry, discard, seq conflict
│   ├── test_chunks_api.py               [~60 LOC] List chunks, audio streaming (Range)
│   ├── test_page_anchors_api.py          [~70 LOC] GET /page-anchors with various page/chunk scenarios
│   ├── test_text_chunker.py             [~50 LOC] Pure chunker: split text, boundaries, invariant non-ws preservation
│   ├── test_tts_router.py               [~50 LOC] Router: backoff, quota, RPM limit
│   ├── test_worker_resume.py            [~248 LOC] Resume on-flight rows (pages, chunks)
│   ├── test_export_and_storage_health.py [~50 LOC] Export ZIP, health check
│   ├── test_pipeline_end_to_end.py      [~60 LOC] Full flow: upload → OCR → chunk → TTS (fake)
│   ├── test_service_worker_assets.py    [~40 LOC] Verify SW SHELL_ASSETS list matches files
│   └── web/*.test.mjs                   [~350 LOC] Node tests: voice-labels, upload-notices, processing-progress, use-visible-polling, background-music-prefs, background-music-engine, page-position (fake Audio/AudioContext + mock timers) (node --test, Node ≥22.7)
│
├── scripts/
│   ├── voice_poc.py                     [~80 LOC] CLI: PoC voice selection (OCR 1 image, synthesize 4 Gemini + 2 Azure voices)
│   └── prepare_ambient_audio.py         [~130 LOC] Chuẩn hoá nguồn nhạc nền (scripts/ambient-source/, gitignored) → web/audio/ambient/ bằng ffmpeg
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
| Python LOC | ~3,200 |
| JavaScript LOC | ~3,800 |
| Test LOC | ~2,200 |
| Tests | 270+ Python (pytest) + 85+ JS (node --test) |
| API endpoints | 30+ (auth with /status, profiles CRUD, shelf, voices family-shared, account password, 401/409 dependencies) |
| DB tables | 9 (accounts, users, sessions, books, pages, chunks, progress, bookmarks, shelf_items, topics) |
| DB migrations | 6 (append-only, PRAGMA user_version; v6 = family accounts + profiles) |
| Python modules | 42+ |
| JS modules | 42+ |
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

**Status:** Complete. Page position + page picker features implemented (220 Python + 77 JS tests, 3 High issues post-review, remainder Low/Medium).

**Next:** Fix N1 migration, run voice PoC with real keys, device testing, Railway deploy.
