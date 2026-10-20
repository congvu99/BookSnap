---
name: shared-element-view-transition
description: Route transitions use View Transitions with root push/pop (motion.css); any static view-transition-name on a screen element becomes an orphan group on every other nav into/out of that screen
metadata:
  type: project
---

Route motion = `runRouteTransition` (web/js/route-transition.js) + root push/pop/tab keyframes in web/css/motion.css. Since feat/instant-loading (2026-10-01) the player cover `.stage-sleeve.is-cover` carries a static `view-transition-name: book-cover`, while library cards only get the matching name inline on click.

**Why:** a named element is lifted out of the root snapshot. When only one side has the name (bottom-nav "Đang nghe", back/pop to library, book-status "Nghe"), the group cross-fades in place on top while the root slides, so the cover visibly detaches from the moving page.

**How to apply:** when reviewing any `view-transition-name`, list every navigation into/out of the screen, not just the intended pair; prefer gating the name on a flag set by the originating click (e.g. html data attribute cleared on `transition.finished`). Duplicate names abort the transition, so also check that keep-alive/mounted-twice screens cannot both carry it. Related: [[in-place-profile-switch]].
