---
name: profile-header-guard
description: X-Profile-Id mismatch guard is opt-in; requests sent while authStore.user is null skip it and write to the cookie's profile
metadata:
  type: project
---

Backend `require_user` only raises profile_mismatch when the X-Profile-Id header is present; no header = accept cookie profile. The web client derives the header from `authStore.get().user` at fetch time.

**Why:** found in family-profiles Phase 4 review (2026-10-01): clearing `user` before views unmount lets unmount-time writes (ReaderView progress flush) go out headerless and land in another profile.

**How to apply:** when reviewing profile switching / 409 handling, check every write fired from cleanup/unmount/unload paths carries an explicit profile id, not the live store value. See [[chunk-counter-semantics]] for other cross-cutting invariants.
