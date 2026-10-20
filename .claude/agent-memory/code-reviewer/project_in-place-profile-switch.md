---
name: in-place-profile-switch
description: Since the Netflix UX (2026-10-01) profile switch happens in place via a sheet; shell-level components that fetch per-profile data at mount stay mounted and go stale
metadata:
  type: project
---

Profile switching moved from the `#/profiles` route (which unmounted the whole shell incl. BottomNav) to an in-place bottom sheet (`ProfileSwitchSheet`, mounted once in app.js). app.js keys `.route-view` by `user.id` (capture excluded so unsent pages survive), but anything outside route-view (BottomNav "Đang nghe" target, module-level caches like the sheet's `cachedProfiles`) is NOT rebuilt.

**Why:** found in feat/netflix-ux review 2026-10-01: BottomNav fetched continue-listening once at mount and kept pointing at the previous profile's book; sheet cached the profile list across sign-out.

**How to apply:** when reviewing profile/identity changes, list every per-profile fetch or module-scope cache outside the keyed route view and check it re-runs on `user.id` change. Also check in-flight requests carrying the old X-Profile-Id that resolve after the switch (409 profile_mismatch → forced picker). Related: [[profile-header-guard]].
