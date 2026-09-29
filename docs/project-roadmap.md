# Project Roadmap — MVP & Next Steps

**Last updated:** 2026-09-29 | **Status:** MVP implemented, code review complete, 3 blockers for first deploy

## MVP Status

### Completed (Phase 1–4)

**Backend (Phase 1–2):**
- [x] SQLite schema + migrations (append-only)
- [x] User/session auth (Argon2, session token, 180-day cookie)
- [x] Multi-user library + per-user progress
- [x] Page upload (JPEG/PNG/WebP, 5 MB, MIME validation)
- [x] OCR: Gemini 2.5-flash (async, retry backoff 2/8/30s, 5 attempts)
- [x] Chunker: 1000–1500 char contiguous chunks (ordering invariant, tail sealing, grace period)
- [x] TTS: Gemini (8 voices) + Azure (2 voices), fixed provider+voice per book
- [x] Quota pause (no fallback, user-initiated voice change to switch providers)
- [x] Audio file storage: hash-based cache (`{seq:05d}-{hash[:8]}.mp3`)
- [x] Worker lifecycle: resume on restart, graceful shutdown

**Frontend (Phase 3–6):**
- [x] PWA (no build step, Preact + htm vendored)
- [x] Camera: `getUserMedia` + canvas JPEG (no device library)
- [x] Library: **vinyl redesign** — record crates by topic, 5-color sleeves (hash by book.id), hero "Continue", sticky tabs, iOS topic menu, search
- [x] Listen mode: dedicated `#/listen/:id` (sleeve + disc + tonearm), 33⅓ rpm spin, tonearm angle by progress, pause → lift + slide
- [x] Bookmarks: per-user marks by chunk_seq, full-stack (DB + API + UI)
- [x] Capture: sequential upload queue, seq conflict handling
- [x] Reader: text display, tap-to-jump, sync highlight
- [x] Audio player: dual-audio preload, seek, playback rate; mini-player with disc icon
- [x] Auth: iOS-optimized signin (hero + segmented + form, correct autocomplete attrs, 17px fonts)
- [x] Offline: SW cache-first shell (bumped to v11), network-first API, Range requests for partial audio
- [x] Progress: local 5s + server 15s debounce, prefer-newer merge

**Deploy (Phase 5 partial):**
- [x] `railway.json`: startCommand, healthcheck, 1 replica
- [x] Health check: `/health` (200 OK / 503 error)
- [x] Volume: `/data` persistence, DB + audio
- [x] Env vars: all settings externalized
- [x] Export ZIP: per-book MP3 + text.json
- [x] CLI: `python -m app.cli reset-password <username>`

### Unverified (Still Manual)

- [ ] **Real device:** Android Chrome camera capture (no photos in gallery), iOS Safari offline playback, PWA install, lock-screen controls
- [ ] **Real API keys:** Gemini quota measured via `scripts/voice_poc.py`, Azure F0 tier tested
- [ ] **Real Railway deploy:** Volume persistence, cost tracking, auto-restart on failure
- [ ] **Lighthouse metrics:** PWA installability, a11y score ≥90
- [ ] **Acceptance criteria (partial):** 5-page ordering (server OK, client gap handling N2), tone of voice check (needs real Gemini output), continuous playback over audio chunks (C3 fixed, H3 fixed, still need real audio)

## Blocking Issues — Fix Before First Deploy

### P1 (Critical)

**N1 — Schema migration edited in place**
- **Status:** HIGH BLOCKER for any production deploy
- **Issue:** Migration #1 was edited to add `chunks.claim_token` after being applied to test DB. Production DB (if ever deployed) will skip this column, and TTS dies on first claim attempt.
- **Evidence:** `app/db.py:92` column inside `MIGRATIONS[0]` (should be separate migration)
- **Fix:** 
  1. Create `MIGRATIONS[1]` as new separate migration:
     ```python
     MIGRATIONS = [
       """CREATE TABLE …""",  # #0
       "ALTER TABLE chunks ADD COLUMN claim_token TEXT;",  # #1
     ]
     ```
  2. Delete column from existing `MIGRATIONS[0]`
  3. Local dev: delete `data/booksnap.db` (will re-run from scratch)
  4. Any existing deploy: volume must be reset OR DB migrated manually
- **Effort:** 10 minutes
- **Depends on:** Nothing

### P2 (High — Code Review Findings)

| Item | Status | Effort | Notes |
|------|--------|--------|-------|
| **H1 residual:** No timeout on hung Gemini calls | Fixed partial | 15 min | Add `http_options=httpx.Timeout(30)` to `genai.Client`. Test suite doesn't expose (fake provider). Low impact family scale but affects production availability. |
| **H2 residual:** Claim-token race if content hash collision | Fixed partial | 20 min | If voice change reuses same voice (unlikely), or text edit to same text: stale + live TTS both write to same file. File named per token would fix. Low priority MVP (rare collision). |
| **N2:** Removing queued thumbnail blocks book | Fixed partial | 30 min | Client-side: renumber following items when queue item removed. Complex; affects only edge case (deleting bad photo during capture). Can defer to post-MVP. |
| **N4:** `POST /discard` seq unbounded (allows -1) | Quick fix | 5 min | Add `Path(ge=0, le=MAX_PAGE_SEQ)` to endpoint. Prevents `seq=-1` trick that permanently marks book failed. |
| **M1:** Voice not validated (SSML injection via Azure) | Medium fix | 20 min | Validate voice against `voices_routes.GEMINI_VOICES`/`AZURE_VOICES`. Use `quoteattr` for SSML. |
| **M2:** Gemini 429 without header → 1h pause (should parse body) | Medium fix | 25 min | Parse `error.details` for `RetryInfo.retryDelay`. Fall back to 60s for RPM-type 429s. Low impact if quota generous. |

**Recommended pre-deploy sequence:**
1. Fix N1 (migration) — **blocking**
2. Fix N4 (seq bounds) — **5 min, high confidence**
3. Consider H1 timeout — improves reliability

## Next Steps — Phased

### Phase 5.1 — Fix N1 + Run PoC (2–3 hours)

**Goal:** Unblock first deploy, measure real quota.

1. **Fix N1 migration** (10 min) — separate migration clause
2. **Delete test DB** (1 min) — force schema rebuild
3. **Run `voice_poc.py`** (30–60 min) — requires real Gemini + Azure keys
   ```bash
   GEMINI_API_KEY=<key> AZURE_SPEECH_KEY=<key> \
   python scripts/voice_poc.py --sample-text "Long Vietnamese paragraph"
   # Outputs: which voices sound good, actual quota/RPM, any errors
   ```
4. **Update config defaults** if quota lower than assumed (e.g., lower `GEMINI_TTS_RPM` from 10 to 5)
5. **Commit + push** (ready for deploy)

### Phase 5.2 — Manual Device Testing (30–60 min)

**Prerequisites:** First deploy on Railway live (see Phase 5.3).

**Test on Android Chrome:**
- [ ] Open web app, register account
- [ ] Capture 5 pages with camera
- [ ] Check Photos app — **zero new images** (D3 validation)
- [ ] Wait 2–3 min for OCR
- [ ] Reader should show text + audio chunks
- [ ] Play chunk, skip forward/back
- [ ] Close app, reopen → resume position

**Test on iOS Safari:**
- [ ] Same capture + read flow
- [ ] **OffscreenCanvas check:** Ensure camera doesn't crash (M4 fixed, but verify)
- [ ] Standalone mode (add to home screen) → full-screen PWA

**Test offline (airplane mode):**
- [ ] Download 1 book (play all chunks)
- [ ] Toggle airplane mode mid-read
- [ ] Resume playback → should still work from cache
- [ ] Page refresh → offline library shown

**Test multi-account:**
- [ ] Login user A, listen to book 1, position at chunk 2
- [ ] Login user B (same phone), listen to same book 1, position at chunk 5
- [ ] Login user A again → resume at chunk 2 ✓
- [ ] Check "Tiếp tục nghe" list is per-user ✓

### Phase 5.3 — First Railway Deploy (30 min + wait for confidence)

**Prerequisites:** N1 fixed, config vars set up.

1. **Create Railway project**
   - New project → connect GitHub
   - Link repo to main branch (push-to-deploy enabled)

2. **Create volume**
   - Railway dashboard → service → storage
   - Add volume: mount path = `/data`, size = 50 GB

3. **Set environment variables** (Railway Variables panel)
   ```
   INVITE_CODE=test-code-12345
   GEMINI_API_KEY=<AI Studio key>
   GEMINI_OCR_MODEL=gemini-2.5-flash
   GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
   GEMINI_TTS_VOICE=Kore
   TTS_DEFAULT_PROVIDER=gemini
   COOKIE_SECURE=true
   DATA_DIR=/data
   ```

4. **Push to `main`** (or merge PR)
   - Railway auto-detects Python, installs requirements.txt
   - Runs healthcheck `/health` every 10 seconds

5. **Verify deployment**
   ```bash
   # Check logs (Railway CLI or dashboard)
   railway logs -f
   
   # Expected: "startup data_dir=/data …", "db_migrate version=1", "db_migrate version=2"
   
   # Test health
   curl https://<service-name>.up.railway.app/health
   # Expected: {"status":"ok","db":"ok","data_dir":"ok"}
   ```

6. **Smoke test**
   - Register 2 accounts (one wrong invite code → 403)
   - Capture 3 pages on phone
   - Verify uploaded (book status view)
   - Redeploy (dummy commit push)
   - Verify data survived

### Phase 5.4 — Remaining Code Review Items (Post-MVP, Prioritized)

| Priority | Item | Est. Effort | Notes |
|----------|------|-------------|-------|
| P3 | N2 (client-side gap handling) | 30 min | Edge case: user deletes queued thumbnail → book stalls until manual discard. Rare. |
| P3 | M1 (voice validation) | 20 min | Prevent SSML injection. Low risk (only owner can change voice). |
| P3 | M2 (quota ETA from error details) | 25 min | Better quota pause behavior (parse header vs default 1h). |
| P4 | H1 (Gemini timeout) | 15 min | Add `http_options` to `genai.Client`. Improves reliability. |
| P4 | L4–L12 (various) | Various | Minor: L4 cleanup race, L5 orphan sweep, L8 poll cleanup, etc. |
| P5 | M5 (shell cache versioning) | — | Already fixed (v3 bumped). Keep bumping `SHELL_CACHE` on web changes. |

**Recommended post-MVP window:** After first 1–2 weeks on Railway, tackle P3 items if quota/voice issues arise in practice.

## Open Questions (For Product/Team)

1. **N6 — Discard ownership:** Should `POST /discard` be owner-only (like delete/voice-change), or open to all users? Currently open (any user can mark failed page as discarded). Decision affects API design.

2. **Voice selection UX:** Should app show per-chunk voice choice at read time (would require per-chunk provider), or always fixed per book (current)? Fixed is simpler; per-chunk would give flexibility for multi-author books.

3. **OCR model finalization:** When Gemini TTS model exits preview → update `GEMINI_TTS_MODEL` env default. Current: `gemini-2.5-flash-preview-tts`. Monitor [AI Studio](https://ai.google.dev) release calendar.

4. **Azure F0 quota:** Confirm Azure F0 tier includes TTS quota. (Assumption: free tier has some limit, measured via PoC.)

5. **Privacy: progress data.** Offline progress stored in localStorage (survives logout). Should we wipe on logout? Current behavior: each user's progress key is per-user (localStorage keyed by `booksnap:progress:{user_id}:{book_id}`), so privacy OK in single-user family phones.

## Success Criteria — MVP Ship

- [x] Code review complete (99 tests, 3 High post-review items noted)
- [x] All P1 blocking issues identified (N1)
- [ ] N1 fixed + tested
- [ ] Device tests run (Android + iOS)
- [ ] First Railway deploy live
- [ ] 1 full week of logs monitored (no critical errors)
- [ ] Cost tracking: ≤ $10/month confirmed

## Maintenance & Support (Post-Deploy)

**First 1 month:**
- Daily log check (look for pattern errors)
- Respond to user quota issues (help change voice to Azure if Gemini exhausted)
- Track usage (books created, pages uploaded, audio hours generated)

**Ongoing:**
- Update `GEMINI_OCR_MODEL` / `GEMINI_TTS_MODEL` when new versions released
- Bump `SHELL_CACHE` version when web JS/CSS changes
- Monitor Railway dashboard for cost spikes or errors
- Backup exports (manual ZIP from status view, or volume snapshot if available)

## Version History

| Date | Version | Status | Notes |
|------|---------|--------|-------|
| 2026-09-29 | MVP 1.0 | Code complete, 1 blocker | Phase 1–4 done. Phase 5 awaiting N1 fix + PoC + device test. |

---

**Next immediate action:** Fix N1 migration, run voice PoC, commit, request device testing.

**Owner:** Development team. Roadmap reviews weekly (or post-deploy weekly for 1 month).
