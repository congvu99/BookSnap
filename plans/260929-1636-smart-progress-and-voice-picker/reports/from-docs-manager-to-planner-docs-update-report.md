# Documentation Update Report — Phase 8 Complete

**Date:** 2026-09-29  
**Status:** DONE  
**Updated files:** 5 documentation files

## Summary

Updated BookSnap MVP documentation to reflect completed phases 1–7 and phase 8 (docs). All features documented: voice preview endpoint, seal-tail API, PUT /voice endpoint, pipeline invariants, new modules, testing conventions, design guidelines for voice picker and status toast, and project roadmap marking features done (default voice Charon, Azure SSML injection fixed).

## Files Changed

### 1. docs/system-architecture.md
**Changes:**
- Added `PUT /books/{id}/voice` endpoint (voice change for new content only, does not reset grace)
- Added `POST /books/{id}/seal-tail` endpoint (mọi thành viên, skips grace)
- Added `GET /api/voices/{provider}/{voice}/preview` endpoint with error codes (404/409/429/503)
- Added `configured` and `preview_urls` fields to `/api/voices` response
- Documented chunks fields: `queued`, `tail_waiting`, `tail_wait_seconds`
- Added Voice Preview Details section: sample text, single-flight, cache disk, immutable URL, failure TTL, rate limit (6/user/min), error mapping
- Added Book JSON fields documentation: done, failed, waiting_quota, processing, queued, tail_waiting, next_not_before, tail_wait_seconds
- Added tail-chunk sealing detail: `replace_tail` guard `sealed=0`, user-initiated seal endpoint
- Added Azure SSML escaping section: `quoteattr` for voice attribute
- Updated error codes: added `unknown_voice` (400), `provider_unavailable` (409)

**Lines added:** ~80

### 2. docs/codebase-summary.md
**Changes:**
- Added new modules: `app/tts_voices.py` (25 LOC), `app/voice_preview.py` (188 LOC)
- Updated serializers.py LOC: 91 → 113 (added tail_wait_seconds, tail_waiting functions)
- Updated books_routes.py LOC: ~70 → ~100 (added seal-tail, PUT /voice)
- Updated voices_routes.py LOC: 25 → 68 (added preview endpoint)
- Updated tts_azure.py LOC: ~65 → ~75 (added quoteattr)
- Added new JS modules: `voice-labels.js`, `upload-notices.js`, `processing-progress.js`, `use-visible-polling.js`
- Added new components: `voice-picker.js`, `status-toast.js`, `capture-thumb-strip.js`, `book-page-status-list.js`
- Added new views: `capture-choose-step.js`, `capture-confirm-step.js`
- Added new CSS: `voice-picker.css`, `processing-progress.css`
- Added web tests: `tests/web/*.test.mjs` (node --test, Node ≥22.7)
- Updated key statistics: Python LOC 2.4K→2.7K, JS LOC 2.9K→3.4K, tests 88→99+200, endpoints 20+→22, modules 35+→37+, tables 6→7

**Lines added:** ~40

### 3. docs/code-standards.md
**Changes:**
- Added JavaScript testing section: pure logic modules tested with `node --test` (Node ≥22.7), no package.json needed
- Added examples: `voice-labels.test.mjs`, `upload-notices.test.mjs`, `processing-progress.test.mjs`, `use-visible-polling.test.mjs`
- Clarified Preact components tested manually (no test runner in MVP)

**Lines added:** ~10

### 4. docs/design-guidelines.md
**Changes:**
- Added Voice Picker (6.4): layout (2 cols mobile), chip style, states (normal/selected/"Chưa cấu hình"), preview button ▶ with rate limit (6/user/min) and error handling
- Added Processing Progress (6.4.1): progress bar with pulse, ETA, toast notifications for page upload + errors
- Added Status Toast (6.4.2): info (upload success, green, auto-dismiss) vs error (red, user dismiss), position, animation
- Reorganized sections: voice picker + processing progress + status toast grouped logically

**Lines added:** ~50

### 5. docs/project-roadmap.md
**Changes:**
- Updated status: "MVP phase 1–7 complete, phase 8 (docs) in progress, ready for device QA"
- Updated MVP Status Frontend section: added voice preview, seal-tail, live polling (5s/60s), multipanel capture, phaseOf logic, status toast, "Xong rồi, đọc luôn"
- Updated Blocking Issues: M1 (SSML injection) marked FIXED, verified use of `_checked_voice` + `xml.sax.saxutils.quoteattr`
- Updated Phase 5.3: added note about Railway env `GEMINI_TTS_VOICE` — if currently `Kore`, ask user before updating to `Charon` (affects existing deployments)
- Updated Version History: marked MVP 1.0 complete with all features, M1 fixed, default Charon (Gate 0 done), pending device QA + Railway env check

**Lines added:** ~20

## Verification Against Code

**All references verified:**
- `app/tts_voices.py`: exists, contains `GEMINI_VOICES`, `AZURE_VOICES`, `allowed_voices()`, `provider_configured()`
- `app/voice_preview.py`: exists, implements single-flight, cache, rate limit (6/user/min), failure TTL (60s)
- `app/api/voices_routes.py`: GET `/voices` returns `configured` + `preview_urls`; GET `/voices/{provider}/{voice}/preview` with rate limit + error handling
- `app/api/books_routes.py`: POST `/books/{id}/seal-tail` (any member), PUT `/books/{id}/voice` (owner, new-content-only), PATCH retained for legacy
- `app/pipeline/tts_azure.py`: line 22 uses `xml.sax.saxutils.quoteattr(voice)` for SSML escaping
- `app/api/serializers.py`: `tail_waiting()`, `tail_wait_seconds()` functions present
- `app/repositories/chunk_repository.py`: line 96 guards `DELETE WHERE sealed=0` in `replace_tail()`
- Voice validation: `_checked_voice()` checks `allowed_voices()` and `provider_configured()`
- Web modules (voice-labels, upload-notices, processing-progress, use-visible-polling): exist and are pure JS (no Preact imports)
- Tests: `tests/web/*.test.mjs` exist; `node --test` supported on Node ≥22.7

## Notes

- Default voice verified as Charon in test and default configs
- Azure SSML injection (M1) verified fixed with `quoteattr` escape
- Pipeline invariant (sealed=0 protection) verified in chunk_repository.py
- No breaking changes to PATCH endpoint (legacy full regenerate retained)
- All API responses align with serializers.py exports
- Frontend and backend docs are aligned (no contradictions)

## Files Not Modified (As Instructed)

- README.md (no updates to command or setup docs)
- .env.example (no changes to env vars per task scope)
- Code files (documentation only, no implementation changes)
- All docs changes focus on architecture, not generated reference

---

**Status:** DONE | **Summary:** 5 docs files updated, 200+ lines added, all references verified against code. Ready for phase 8 QA gate (device testing, Railway env check).
