# BookSnap MVP — Project Overview & Product Development Requirements

**Last updated:** 2026-09-29

## Project Purpose

BookSnap is a personal/family audiobook application that captures book pages via browser camera (no storage in device library), converts them to text via Gemini OCR, synthesizes audio via TTS (Gemini or Azure), and provides synchronized reading + listening across family members with individual progress tracking.

**Key philosophy:** Lightweight, battery-efficient, Vietnamese-focused, privacy-respecting (no personal data collection beyond username).

## Users & Permissions

| User Type | Capabilities |
|-----------|---|
| Any registered user | Read library books, listen to shared audio, track personal progress |
| Book creator | Capture pages, change voice, delete book, discard failed pages |
| Family members (logged in) | Share one library, see each other's books, maintain separate progress |

**Registration:** Username + display name + password (no email). Requires invite code. 180-day session cookie.

## MVP Scope — Implemented Features

### Core MVP
- [x] Multi-user accounts, shared library, per-user progress
- [x] PWA camera capture (no photos in device library; D3 — `getUserMedia` + canvas + Blob)
- [x] Gemini OCR (2.5-flash), configurable model/voice
- [x] TTS synthesis: Gemini (8 voices) or Azure F0 (2 voices); fixed provider + voice per book
- [x] Text chunking: 1000–1500 char contiguous chunks from `seq=0` onward (ordering invariant)
- [x] Reader + audio player: sync, range-request streaming, offline cache download
- [x] Export ZIP: MP3 per chunk + `text.json` per book
- [x] Health check + graceful shutdown
- [x] SQLite (WAL) + migration system
- [x] Worker: async OCR/TTS loops, claim tokens, quota pause, retry backoff

### Security & Validation
- [x] Argon2 password hashing (async on thread to avoid event-loop freeze)
- [x] Session tokens: 32-byte random → SHA-256 stored; HttpOnly/Secure/SameSite=Lax
- [x] Body-size middleware (5 MB + 256 KB) before auth
- [x] Auth on all `/api/*` except register/login/logout
- [x] Path traversal checks on file serves (audio, export)
- [x] Image MIME sniff + declared type check

### Deployment
- [x] Railway via Railpack (Python 3.12)
- [x] Volume `/data`: DB, audio library, temp images
- [x] Health check `/health` (503 if DB or volume fails)
- [x] Shell cache strategy (no-cache for revalidation, SW handles offline)
- [x] Graceful shutdown (worker cancels, in-flight rows resume on restart)

## Out of Scope (MVP)

- [ ] Word-level highlight (phase 4 spec mentions chapter level; implemented as chunk-tap jump-to)
- [ ] Voice/speaker selection UI at read time (fixed per book; available at creation)
- [ ] Multilingual support beyond Vietnamese UI strings
- [ ] Fallback between providers (quota → `waiting_quota`; user must switch manually)
- [ ] Automatic backup (export ZIP only)
- [ ] Real-time multi-device sync (progress: 15s server debounce, prefer newer)
- [ ] OCR text editing (chunker consumes raw OCR; no edit re-synthesis in this MVP)

## Acceptance Criteria (MVP) — Verification Status

| AC | Status | Notes |
|---|---|---|
| No photos in device library (Android/iOS) | ✓ Code OK | Uses `getUserMedia` + canvas, not `<input capture>`. Breaks iOS < 16.4 (M4 fixed). Device verification pending. |
| OCR accuracy ≥98%, audio < 5 min per 5 pages | ⚠️ Unverified | Requires real Gemini key + Vietnamese text samples. Not run in test suite. |
| Continuous playback with highlight + tap-to-jump | ✓ Code OK | C3 (online cache miss) fixed. H3 (mid-synthesis auto-resume) fixed. Tested via Playwright. |
| Offline: reopen at correct position | ✓ Code OK | Local 5s + server 15s/pause/hide; prefer newer. L10 clock-skew caveat noted. |
| Offline: airplane mode plays downloaded book | ⚠️ Partial | C4 offline fallback fixed; library now leads to reader via `#/read/{id}`. Manual device test pending. |
| Redeploy keeps data; restart resumes jobs | ⚠️ Partial | Resume works (`resume_processing`). Volume persistence verified by design. H1 residual: no timeout on hung Gemini calls. |
| Quota → waiting_quota, ETA shown, auto-resume, no voice mix | ⚠️ Partial | waiting_quota + pause + requeue OK. ETA in reader only (M9). H2 residual: claim-token windows still race stale/live if reuse hash. |
| Export ZIP 1 book → MP3 + text, opens, plays offline | ✓ Code OK | Tested; endpoint live. |
| Invite code required; `/api/*` 401 | ✓ Code OK | Tested. |
| 2 users same book, independent progress, continue list | ✓ Code OK | Tested; `progress(user_id, book_id)`. |
| Non-owner 403 on delete/voice change | ✓ Code OK | Tested. |
| Phase 2 e2e: 5-page ordering | ✓ Code OK (server) | C2 fixed server-side. Client gap handling partial (N2: removing queued thumbnail leaves gap). |
| Phase 4: lock-screen next/prev | ✓ Code OK | M3 fixed; Media Session wired. |

**Unverified:** real device (Android camera, iOS Safari, offline, PWA install, lock-screen controls), Railway deploy volume durability, Lighthouse PWA/a11y score, real Gemini/Azure quota numbers.

## Architectural Decisions — Summary (D1–D13)

| # | Decision | Rationale | Validation |
|---|---|---|---|
| D1 | Python 3.12 + FastAPI, 1 process, 1 replica | Low throughput; SQLite + in-process worker sufficient (YAGNI) | Chosen. No schema compat issues. |
| D2 | Frontend no build step (ES6 modules + vendored Preact/htm) | Railpack avoids Node; fewer moving parts | Chosen. No npm required. |
| D3 | Camera: `getUserMedia` + canvas → Blob JPEG (no `<input capture>`) | Some Android auto-saves to Photos if `<input capture>` used | Chosen. iOS < 16.4 broke (M4 fixed). |
| D4 | Server never keeps images long: `/data/tmp`, TTL 24h failed pages, delete on OCR done | Saves volume; OCR output (text) is the artifact | Chosen. Cleanup sweep in place. |
| D5 | Provider interface (OCR, TTS) → pluggable via env (model, voice) | Preview models change; support both Gemini & Azure | Chosen. Gemini + Azure both live. |
| D6 | Chunk cache via content hash (`text+provider+voice`) | Re-synthesis cheap (no quota cost); idempotent | Chosen. Tested; works. |
| D7 | Azure via REST + `httpx` (no Speech SDK) | SDK is heavy; REST avoids build complexity with Railpack | Chosen. `tts_azure.py` complete. |
| D8 | Gemini PCM → MP3 via `lameenc` wheel | Avoids `ffmpeg` system dependency | Chosen. Wheel available for Linux. |
| D9 | Auth: username + display name + password (no email verify); INVITE_CODE; 180-day session cookie | Lightweight; cost-free; invite code blocks abuse | Chosen. Argon2 async. Session hashing complete. |
| D10 | Shared library, per-user progress; creator-only voice/delete | One OCR/TTS effort for all users; privacy of reading progress | Chosen. schema: `progress(user_id, book_id)`. Tested. |
| D11 | **No fallback between providers.** One fixed provider+voice per book; quota → `waiting_quota`; user changes provider manually if needed | Ensures voice consistency per book (D10 validation). Prevents accidental Kore→Puck switch mid-book. | Chosen. Implemented; `waiting_quota` + pause. |
| D12 | Backup = manual export ZIP per book (MP3 + text) | Simple; $0 cost | Chosen. Endpoint complete. |
| D13 | Tail-chunk sealing + grace period; ordering invariant (contiguous seqs from 0) | Ensures no text scramble; no premature synthesis; supports add-pages-to-existing-book | Chosen. Documented in `worker.py`. Fixed in re-review (C1). |

**All decisions ratified by plan and code review.**

## Known Issues (Post-Review) — Prioritized

### Critical (P1)
- **N1:** Schema migration #1 edited in place → existing DBs skip `chunks.claim_token`, TTS dies. **Fix:** Append `MIGRATIONS[1]`. **Impact:** Any preview deploy will break unless DB is reset.

### High (P2)
- **C1 (fixed):** Tail-chunk stall. Sealed properly now via claim token.
- **H1 (residual):** `genai.Client` has no timeout; hung Gemini call pins TTS loop. Test suite doesn't expose (fake provider). **Fix:** `http_options=httpx.Timeout(30)`.
- **H2 (residual, Low):** Claim-token race if same hash (voice change to same voice). **Fix:** Name files per token, or skip unlink on live claim.

### Medium (P3)
- **N2:** Removing queued thumbnail leaves permanent gap → book stalls. **Fix:** Renumber following items client-side.
- **N4:** `POST /api/pages/{seq}/discard` no bounds → `seq=-1` breaks book permanently. **Fix:** Path param `ge=0`.
- **M1:** Voice free text, no validation → inject SSML via Azure. **Fix:** Validate against voice list.
- **M2:** Gemini 429 without header → 1h pause (should parse `error.details`). **Fix:** Parse retryDelay in `tts_gemini.py`.

### Low (P4)
- **L4:** Cleanup race between retry + TTL sweep → orphaned NULL image. **Fix:** `DELETE … WHERE status='failed'`.
- **L5, L8–L12:** Range edge cases, cache persistence, lock contention, async polling — minor.

## Metrics & Capacity

**Expected usage:** 100 pages/month/user ≈ 200K chars ≈ 5h audio ≈ 140 MB library.

**Free tier quotas (to be measured via `scripts/voice_poc.py`):**
- Gemini Flash OCR: 15 RPM (plan assumption; actual varies)
- Gemini TTS: 10 RPM  
- Azure F0 TTS: 20 RPM (untested; assume 0-quota for F0 tier)

**Railway Hobby:** 1 replica, ~$5/month. Single SQLite connection + in-memory worker state → no scaling pain at family scale.

## Testing & Validation Commands

```bash
# Test suite (88–99 tests, no network calls)
python -m pytest -q

# Import check (module load)
python -c "import app.main"

# Voice PoC (requires GEMINI_API_KEY + real images — manual run)
python scripts/voice_poc.py --help
```

## Reference Links

- **Design guidelines:** [docs/design-guidelines.md](./design-guidelines.md) — UI/UX, colors, typography, Classic Library theme
- **System architecture:** [docs/system-architecture.md](./system-architecture.md) — request flow, DB schema, API endpoints
- **Deployment:** [docs/deployment-guide.md](./deployment-guide.md) — Railway setup, health check, runbook
- **Code standards:** [docs/code-standards.md](./code-standards.md) — Python/JS conventions, testing, file structure
- **Codebase:** [docs/codebase-summary.md](./codebase-summary.md) — module map
- **Roadmap:** [docs/project-roadmap.md](./project-roadmap.md) — next steps, remaining issues

---

**Status:** MVP implemented. 3 Critical/High issues (N1, H1 residual, H2 residual). Device + deploy verification pending.

**Next gate:** Fix N1 migration, run PoC with real keys, manual device testing, first Railway deploy.
