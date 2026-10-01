# Code Standards & Conventions

**Last updated:** 2026-10-01

## Overview

BookSnap follows pragmatic Python + JavaScript patterns optimized for a small team, single-replica deployment, and zero build overhead. Standards are driven by what the code actually does, not dogma.

## Python Backend (`app/`)

### Module Structure

```
app/
├── main.py                       # FastAPI app factory, lifespan (worker + DB)
├── config.py                     # Pydantic Settings (env vars)
├── db.py                         # Database connection, migrations, transaction context
├── app_context.py               # AppContext: repositories + worker injected into request.state
├── cli.py                        # CLI: python -m app.cli reset-password <family-account-username>
├── api_errors.py                # ApiError exception + error handlers
├── auth/
│   ├── auth_routes.py           # GET /status, POST /register, /login, /logout, GET /me; LoginOut, MeOut
│   ├── session_service.py       # Session create/verify/touch
│   ├── password_service.py      # Argon2 hashing (async on thread)
│   ├── rate_limiter.py          # Per-IP login/register rate limit
│   └── current_user.py          # CurrentUser dependency, Ctx alias
├── api/
│   ├── books_routes.py          # POST/GET/PATCH/DELETE /books
│   ├── pages_routes.py          # POST /books/{id}/pages, /pages/{id}/retry
│   ├── profiles_routes.py       # GET/POST/PATCH/DELETE /profiles, POST /profiles/{id}/select
│   ├── shelf_routes.py          # GET/PUT/DELETE /me/shelf/{book_id}
│   ├── audio_routes.py          # GET /chunks/{id}/audio (Range requests)
│   ├── voices_routes.py         # GET /voices (family rate limit), preview endpoint
│   ├── export_routes.py         # GET /books/{id}/export (ZIP stream)
│   └── serializers.py           # book_out (on_shelf), page_out, chunk_out
├── repositories/                 # Pure SQL, return dataclasses (no mutation)
│   ├── book_repository.py
│   ├── page_repository.py
│   ├── chunk_repository.py
│   ├── user_repository.py       # Profiles: list_for_account, add_to_account, update_in_account, delete_with_heir
│   ├── account_repository.py    # Accounts: minimal (lookup by username)
│   ├── shelf_repository.py      # Shelf items: CRUD, check on_shelf, list per-profile
│   ├── session_repository.py    # Sessions with account_id + user_id, revoke_all_others_for_account
│   ├── progress_repository.py
│   └── row_mapping.py           # new_id(), dataclass constructors for Account, User (Profile), LoginOut
├── pipeline/                     # Worker loops: OCR → chunker → TTS
│   ├── worker.py                # Main event loop, claim/retry logic
│   ├── chunker_worker.py        # Fold pages → chunks (ordering invariant)
│   ├── cleanup_worker.py        # TTL + orphan sweep
│   ├── ocr_provider.py          # Protocol: PageText, OcrError
│   ├── ocr_gemini.py            # Gemini OCR implementation
│   ├── tts_provider.py          # Protocol: SynthResult, TtsError
│   ├── tts_gemini.py            # Gemini TTS implementation
│   ├── tts_azure.py             # Azure TTS implementation (REST)
│   ├── tts_router.py            # Provider dispatch + retry backoff
│   ├── text_chunker.py          # Pure: split text into chunks
│   └── audio_encoding.py        # PCM16 → MP3 via lameenc
├── request_size_limit.py        # ASGI middleware: Content-Length + byte count
├── storage_health.py            # Check: Railway volume durability
└── file_paths.py                # Utility: is_within() path check
```

### Naming Conventions

- **Modules:** `snake_case.py` (descriptive, long names OK: `text_chunker.py`, `password_service.py`)
- **Classes:** `PascalCase` (exceptions, repositories, providers, dataclasses)
- **Functions/methods:** `snake_case`
- **Constants:** `UPPER_SNAKE_CASE`
- **Private:** prefix `_` (module-level or method-level)
- **Enums/types:** `Literal["gemini", "azure"]` (not UPPERCASE unless all-caps makes sense)

### Patterns

#### 1. Repositories (Pure SQL)
```python
class BookRepository:
    def __init__(self, db: Database) -> None:
        self.db = db
    
    async def create(self, user_id: str, title: str) -> Book:
        """Return dataclass; never mutate input."""
        async with self.db.transaction() as conn:
            result = await conn.execute_returning(
                "INSERT INTO books (id, title, …) VALUES (?, ?, …) RETURNING …",
                (new_id(), title, user_id, …)
            )
        return Book(**dict(result[0]))  # via row_mapping
```
- Always return dataclass or None (not dict)
- Use `async with self.db.transaction()` for writes
- Parameterized queries (no f-strings with user data)
- One connection, no re-entrancy (transaction bodies use `conn.execute`, not `db.execute`)

#### 2. Providers (Pluggable Interfaces)
```python
from typing import Protocol

class OcrProvider(Protocol):
    async def ocr(self, image: bytes, mime: str) -> PageText:
        """Raises OcrError on any failure."""
        …

class OcrError(Exception):
    def __init__(self, message: str, is_retriable: bool = False) -> None:
        self.message = message
        self.is_retriable = is_retriable
```
- Protocol (structural typing) avoids abstract base class overhead
- Errors are dataclasses with fields (code, message, is_retriable, etc.)
- No "generic Error"; specific exceptions (OcrError, TtsError)

#### 3. Worker Loops (Async Claim/Process)
```python
async def claim_and_process_page(self) -> bool:
    """Return True if work was done; False if idle."""
    page = await self.ctx.pages.claim_next_uploaded()
    if page is None:
        return False
    try:
        await self.process_page(page)
    except Exception as exc:
        await self.ctx.pages.mark_failed(page.id, str(exc))
        raise  # Log via _run_forever wrapper
    return True

async def _run_forever(self, name: str, step: Callable[[], Awaitable[bool]]) -> None:
    while True:
        try:
            if not await step():
                await self._sleep_or_wake()
        except asyncio.CancelledError:
            return
        except Exception:
            log.exception("worker_loop name=%s", name)
            await asyncio.sleep(self.poll_seconds)
```
- `claim_and_process` pattern: claim one row, process, mark done/failed
- Return bool (idleness) for sleep decision
- `_run_forever` wraps all loops, logs unexpected exceptions
- Graceful shutdown: cancel tasks, gather with return_exceptions=True

#### 4. Async Sync Boundaries
```python
# Path I/O (not DB) → use asyncio.to_thread
image_bytes = await asyncio.to_thread(Path(page.image_path).read_bytes)
await asyncio.to_thread(path.write_bytes, data)

# CPU-bound (Argon2) → use asyncio.to_thread
await asyncio.to_thread(verify_password, hashed, plain)
```
- Never block event loop on I/O or CPU
- Use `to_thread` for compatibility (no subprocess spawning)

### Type Hints

- **Required** on all public functions (mypy strict mode assumed by future)
- **Optional** on internal helpers (for brevity)
- Use `| None` (PEP 604) for optional, not `Optional`
- Use `from collections.abc import Iterable, Callable` (not `typing`)

### Error Handling

```python
class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, field: str | None = None) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.field = field

# Raise for client errors
raise ApiError(409, "page_seq_taken", "Số trang này đã tồn tại", "seq")

# Handle unexpected errors in worker
except Exception as exc:
    await self.ctx.pages.mark_failed(page.id, f"Lỗi ({type(exc).__name__})")
    log.exception("ocr outcome=error …")
```
- Use custom `ApiError` for all HTTP responses (400, 401, 403, 404, 409, 413, …)
- Log context: `log.info("action outcome=ok/error key1=val1 key2=val2")`
- Worker exceptions: mark row failed, log, continue loop (never raise to caller)

### Logging

```python
log = logging.getLogger(__name__)

log.info("ocr outcome=%s page_id=%s chars=%d latency_ms=%d", "ok", page.id, len(text), ms)
log.exception("worker_loop outcome=crash loop=%s", name)  # auto-includes traceback
```
- Key-value format: `outcome=, latency_ms=, rowcount=`
- Level: INFO (normal flow), WARNING (recoverable issue), ERROR (bug, needs investigation)
- No logs in tests (expected failures on fake providers are silent)

## JavaScript Frontend (`web/`)

### Module Structure

```
web/
├── index.html                    # Minimal HTML, no build
├── manifest.webmanifest         # PWA metadata
├── sw.js                        # Service worker (global scope, not ES module)
├── css/
│   ├── tokens.css              # Design tokens (colors, fonts)
│   ├── app.css                 # Global styles
│   ├── library.css, camera.css, … # Per-view styles
├── vendor/
│   └── preact-htm.module.js     # Vendored, single ES module
├── js/
│   ├── app.js                  # Hash router + shell
│   ├── api-client.js           # Fetch wrapper, 401 handling
│   ├── store.js                # AuthStore, ThemeStore pub-sub
│   ├── icons.js                # Inline SVG icons
│   ├── camera-capture.js       # getUserMedia, JPEG, torch
│   ├── upload-queue.js         # Sequential upload, seq conflict
│   ├── audio-playlist.js       # 2-audio preload/seek/rate
│   ├── playback-progress.js    # Local 5s + server 15s debounce
│   ├── media-session.js        # Lock-screen controls
│   ├── offline-audio-cache.js  # Cache API download/verify/remove
│   ├── offline-book-cache.js   # localStorage per book
│   └── views/
│       ├── auth-view.js        # Register/login form
│       ├── library-view.js     # Book grid
│       ├── capture-view.js     # Camera + shutter
│       ├── book-status-view.js # Timeline, retry, discard
│       └── reader-view.js      # Reader + player shell
│   └── components/
│       ├── book-cover.js       # Visual
│       ├── bottom-nav.js       # Tab bar
│       ├── progress-timeline.js # Status timeline
│       ├── mini-player.js      # Inline player
│       ├── player-sheet.js     # Bottom sheet (rate, theme, offline dl)
│       ├── chunk-paragraph.js  # Text + edit button
│       └── chunk-editor.js     # Edit dialog
└── icons/
    ├── icon.svg, icon-192.png, icon-512.png
```

### Naming Conventions

- **Files:** `kebab-case.js` (self-documenting: `camera-capture.js`, `offline-audio-cache.js`)
- **Functions/components:** `camelCase` (or PascalCase for Preact components)
- **Classes:** `PascalCase` (rarely used; prefer functions)
- **Constants:** `UPPER_SNAKE_CASE` or `camelCase` (context-dependent)
- **Privates:** `_leading_underscore()` or closure (convention only; no true privacy)

### Patterns

#### 1. Preact Component (Functional)
```javascript
import { html, useState, useEffect } from '../vendor/preact-htm.module.js';

export function MyComponent({ prop1, onEvent }) {
  const [state, setState] = useState('initial');
  
  useEffect(() => {
    // Setup/cleanup
    const timer = setTimeout(() => setState('new'), 1000);
    return () => clearTimeout(timer);
  }, []);
  
  return html`
    <div class="my-class">
      <p>${state}</p>
      <button onClick=${() => onEvent()}>Click</button>
    </div>
  `;
}
```
- No JSX; use `html` tagged template (preact/htm)
- Props as function params, event handlers as callbacks
- Hooks: useState, useEffect, useRef, useContext
- Destructure props inline for clarity

#### 2. API Client (Fetch Wrapper)
```javascript
export const booksApi = {
  list: () => apiCall('GET', '/api/books'),
  create: (title) => apiCall('POST', '/api/books', { title }),
  updateVoice: (id, voice) => apiCall('PATCH', `/api/books/${id}`, { tts_voice: voice }),
};

async function apiCall(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) {
    const error = data?.error || {};
    if (res.status === 401) {
      onUnauthorized();  // Trigger logout
    }
    throw new ApiError(error.code, error.message, res.status, error.field);
  }
  return data;
}
```
- Group endpoints by resource (booksApi, pagesApi, authApi)
- Always parse JSON and check status before throwing
- Dispatch 401 globally for logout
- Error shape: `{error: {code, message, field}}`

#### 3. Pub-Sub Store
```javascript
export const authStore = {
  _listeners: [],
  _state: { user: null, ready: false, offline: false },
  
  get: () => ({ ...authStore._state }),
  set: (partial) => {
    authStore._state = { ...authStore._state, ...partial };
    authStore._listeners.forEach(fn => fn(authStore.get()));
  },
  subscribe: (fn) => {
    authStore._listeners.push(fn);
    return () => {
      authStore._listeners = authStore._listeners.filter(l => l !== fn);
    };
  },
};
```
- Immutable updates (`{ ...state, ...partial }`)
- Subscriber list (not event emitter)
- Unsubscribe function returned
- Used by views via useEffect + useState

#### 4. Local/Server Progress Sync
```javascript
// Client: every 5s (local), also on pause/hide
async function trackProgress(chunkSeq, offsetMs) {
  const now = Date.now();
  localProgress = { chunkSeq, offsetMs, updatedAt: now };
  if (now - lastServerSync > 15000) {
    await put(`/api/books/${bookId}/progress`, localProgress);
    lastServerSync = now;
  }
}

// Resume: prefer newer
function restoreProgress(serverProgress) {
  if (!localProgress || serverProgress.updatedAt > localProgress.updatedAt) {
    return serverProgress;
  }
  return localProgress;
}
```
- Local: update every UI action (5s debounce via setTimeout)
- Server: send every 15s or on pause/hide
- Merge: compare `updated_at` timestamps, take newer
- Caveat (L10): clock skew on phone can favor stale data

#### 5. Service Worker (Not ES Module)
```javascript
// Top-level: shared caches + handler functions
const SHELL_CACHE = 'booksnap-shell-v3';
const AUDIO_CACHE = 'booksnap-audio-v1';

function isChunkAudio(url) {
  return /\/api\/chunks\/[^/]+\/audio/.test(url.pathname);
}

async function handleChunkAudio(request) {
  // Cache-first for downloaded, pass-through for online
  const cached = await caches.match(request.url);
  if (!cached) return fetch(request);
  if (request.headers.get('range')) return respondWithRange(cached, …);
  return cached;
}

self.addEventListener('fetch', (event) => {
  if (isChunkAudio(new URL(event.request.url))) {
    event.respondWith(handleChunkAudio(event.request));
  }
});
```
- No ES module syntax (global scope)
- Stateless: all data in Cache API or IDB
- Precache shell assets on install
- Network-first for API, cache-first for shell + audio (if downloaded)

### Type Hints

- **JSDoc optional** (no TypeScript in build; tooling ignored)
- **Use when:** complex function signatures, unclear param types
```javascript
/** 
 * Upload a page image to the server.
 * @param {string} bookId - Book ID
 * @param {File} image - JPEG/PNG/WebP image file
 * @param {number} seq - Page sequence number
 * @returns {Promise<Object>} Page row {id, seq, status, …}
 */
async function uploadPage(bookId, image, seq) {
  …
}
```

### Async Patterns

```javascript
// Fetch + JSON parse + error check
const data = await apiCall('GET', '/api/books');

// Concurrent: Promise.all only if order doesn't matter
const [books, voices] = await Promise.all([
  apiCall('GET', '/api/books'),
  apiCall('GET', '/api/voices'),
]);

// Sequential queue: upload one page at a time (avoid seq conflicts)
for (const item of uploadQueue) {
  await apiCall('POST', `/api/books/${bookId}/pages`, item);
}

// Debounce: send progress every 15s or on event
clearTimeout(progressTimer);
progressTimer = setTimeout(() => apiCall('PUT', …), 15000);
```

### Testing

**Python:**
```bash
python -m pytest -q              # Run all tests, no network
python -m pytest tests/test_books_api.py -v  # Single file, verbose
pytest --tb=short -x            # Stop on first failure, short traceback
```

**JavaScript:**
- Pure logic modules (no Preact imports): tested with `node --test "tests/web/**/*.test.mjs"` (Node ≥22.7)
  - Examples: `voice-labels.test.mjs`, `upload-notices.test.mjs`, `processing-progress.test.mjs`, `use-visible-polling.test.mjs`
  - No package.json needed; tests run with built-in test runner
- Preact components: manual browser testing (no test runner in MVP)
- `node --check` syntax validation on all .js files
- Browser console: no errors on clean load

### File Organization

**Single file size limits:**
- Python: ≤ 312 lines OK (worker.py is large but shared-state heavy; not worth split)
- JavaScript: ≤ 310 lines OK (reader-view.js, capture-view.js near limit; consider split if adding more)

**Readability over DRY:**
- Duplicate small helpers if it avoids coupling modules
- Move common logic only when ≥3 callers

## Concurrency & Thread Safety

**Python:**
- Single aiosqlite connection + asyncio.Lock around writes
- No thread pool (worker is pure async)
- Argon2: off event loop via `asyncio.to_thread`

**JavaScript:**
- Single-threaded event loop (no Worker threads)
- Concurrent I/O: multiple fetch() calls in Promise.all are OK
- Shared state: authStore via pub-sub (immutable updates)

## Code Review Checklist

Before merging:

- [ ] `node --check` passes on all `.js` files
- [ ] `python -m pytest -q` passes (88+ tests, no network)
- [ ] `python -c "import app.main"` OK
- [ ] Endpoint paths match what views call (apiCall paths)
- [ ] Error shape consistent (code, message, field)
- [ ] No secrets in code (env vars only)
- [ ] SQL parameterized (no f-strings with user data)
- [ ] Async/await all I/O (no sync APIs like `Path.read_bytes()` without `to_thread`)
- [ ] Tests cover new provider/repository/loop logic
- [ ] Logging includes context (outcome, latency, rowcount, user_id if relevant)

## Reference Links

- **Design:** [docs/design-guidelines.md](./design-guidelines.md)
- **Architecture:** [docs/system-architecture.md](./system-architecture.md) — API shapes, DB schema
- **Deployment:** [docs/deployment-guide.md](./deployment-guide.md)

---

**Status:** Complete. 99 tests pass. Code review complete (3 High issues fixed, remainder Low/Medium noted).
