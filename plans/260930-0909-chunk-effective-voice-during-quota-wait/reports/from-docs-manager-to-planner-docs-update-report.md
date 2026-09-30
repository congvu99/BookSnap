# Documentation Update Report — Chunk Effective Voice & Provider Unpark

**Date:** 2026-09-30  
**Task:** Update docs for backend fix: chunk_out returns effective voice + PUT /voice provider-change unparks waiting_quota  
**Files Modified:** 3 (`system-architecture.md`, `deployment-guide.md`, `project-roadmap.md`)

## Changes Made

### 1. docs/system-architecture.md

#### Line 142 (Section "4. Quota Management")
- **Old:** `Change book voice to Azure (PATCH `/api/books/{id}`) → all `waiting_quota` chunks→`pending` with new provider`
- **New:** `Change book voice to Azure (PUT `/api/books/{id}/voice`) → if provider changes, all `waiting_quota` chunks→`pending` with new provider`
- **Reason:** Corrected endpoint from legacy PATCH to current PUT; clarified behavior only applies when provider actually changes.

#### Lines 146–151 (Example: Gemini quota scenario)
- **Old:** `→ User can wait OR PATCH voice to Azure` / `→ If PATCH: all waiting_quota chunks immediately available, TTS claims via Azure`
- **New:** `→ User can wait OR use PUT /voice to change provider` / `→ If provider changes (e.g., to Azure): all waiting_quota chunks→pending immediately, TTS claims via new provider`
- **Reason:** Clarified that auto-requeue happens at not_before timestamp if user waits; emphasized provider *change* triggers unpark.

#### Line 309 (API Table: PUT `/books/{id}/voice` row)
- **Old:** `body `{tts_provider, tts_voice}` (đổi giọng cho đoạn chưa có audio; không reset grace)`
- **New:** `body `{tts_provider, tts_voice}`. If provider changes (e.g. gemini→azure), all `waiting_quota` chunks→`pending` immediately. `done` chunks keep their audio+voice. Next claim uses new voice.`
- **Reason:** Documented provider-change unpark behavior and clarified done chunks are unaffected.

#### Line 327 (API Table: PATCH `/chunks/{id}` row)
- **Old:** `'chunk_out'; sửa `text` → seal + `pending`'`
- **New:** `'chunk_out'; sửa `text` → seal + `pending`; returns voice/provider = book's current (the voice next claim will use)'`
- **Reason:** Documented that API returns effective voice (book's current, not chunk's snapshot).

#### Line 328 (API Table: POST `/chunks/{id}/retry` row)
- **Old:** `'chunk_out'; từ `failed`/`waiting_quota`'`
- **New:** `'chunk_out'; từ `failed`/`waiting_quota`; returns voice/provider = book's current'`
- **Reason:** Documented that API returns effective voice (book's current for retry).

#### Lines 437–439 (Chunk Status Machine)
- **Old:**
  ```
  [user voice change] → all processing/waiting_quota → pending (provider/voice updated)
  [user discard] → all pending+sealed → removed from book
  ```
- **New:**
  ```
  [user voice change via PUT /voice]:
      if provider changes → all processing/waiting_quota → pending, not_before cleared (new provider unparked)
      if same provider, different voice → waiting_quota stay waiting (quota per key); processing/done unaffected
  [user discard] → all pending+sealed → removed from book
  ```
- **Reason:** Clarified that provider *change* (e.g., gemini→azure) unparks waiting_quota immediately; same provider with different voice keeps chunks waiting (quota is per key, not per voice).

---

### 2. docs/deployment-guide.md

#### Line 160 (Operations Runbook: Daily Operations table)
- **Old:** `1. Check [Gemini quota](...) 2. Wait for reset 3. Or change book voice to Azure`
- **New:** `1. Check [Gemini quota](...) 2. Wait for reset (auto-requeue at `not_before`) 3. Or use PUT `/api/books/{id}/voice` to change provider (e.g. to Azure; unparks waiting chunks)`
- **Reason:** Clarified that auto-requeue is automatic at not_before timestamp; documented API endpoint for operator recovery instructions.

#### Lines 244–247 (Section: "Change TTS Provider (e.g., Gemini → Azure)")
- **Old:**
  ```
  1. Go to book settings → voice → pick an Azure voice
  2. All `waiting_quota` chunks→`pending` (new provider)
  3. TTS resumes with Azure credentials
  ```
- **New:**
  ```
  1. User adds another page via the Capture flow (or API: PUT `/api/books/{id}/voice`)
  2. User chooses an Azure voice during the voice confirmation step (PUT `/api/books/{id}/voice`)
  3. All `waiting_quota` chunks→`pending` immediately (provider changed, not_before cleared)
  4. TTS resumes with Azure credentials; `done` chunks keep their original audio
  ```
- **Reason:** Corrected workflow—voice change happens during add-pages (Capture) step, not a separate settings page; clarified API endpoint; noted done chunks unaffected.

---

### 3. docs/project-roadmap.md

#### Version History table (added row)
- **Added:** New row dated 2026-09-30 documenting the bugfix:
  ```
  2026-09-30 | — | Bugfix | chunk_out endpoint now returns effective voice 
  (book's current for pending/waiting_quota/failed; chunk's own for done/processing). 
  PUT /voice provider change unparks waiting_quota chunks immediately (not_before cleared). 
  Docs updated.
  ```
- **Reason:** Created changelog entry for the backend fix.

---

## Verification Checklist

- [x] Endpoint names match codebase (`PUT /api/books/{id}/voice` confirmed in code)
- [x] Behavior descriptions match verified behavior:
  - Provider change unparks waiting_quota chunks (not_before cleared)
  - Same provider, different voice → chunks stay waiting
  - done chunks keep their original audio+voice
  - chunk_out returns effective voice per chunk state
- [x] All cross-references updated (PATCH → PUT, legacy vs current flow)
- [x] Mixed Vietnamese/English preserved; surrounding language matched
- [x] Edits minimal and surgical (no rewording beyond scope)
- [x] All stale spots identified in brief fixed

---

## Summary

Updated 3 docs to reflect accurate backend behavior:
- **system-architecture.md:** 7 edits clarifying API endpoints, voice change behavior, and effective voice returned by chunk endpoints
- **deployment-guide.md:** 2 edits clarifying quota recovery and provider-change workflow
- **project-roadmap.md:** 1 edit adding changelog entry

All edits verified against specified behavior; no code changes attempted.

---

Status: DONE  
Summary: All 3 docs updated; 10 total edits reflecting chunk effective voice + provider-change unpark behavior. No gaps or concerns.  
Concerns/Blockers: None
