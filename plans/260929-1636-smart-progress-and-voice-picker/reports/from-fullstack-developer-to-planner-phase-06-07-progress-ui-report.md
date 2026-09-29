# Phase 6 + 7 report

New files (controller must register in sw.js SHELL_ASSETS / index.html):
- web/js/processing-progress.js
- web/js/use-visible-polling.js
- web/js/components/book-page-status-list.js
- web/css/processing-progress.css (link in index.html)
- tests/web/processing-progress.test.mjs (26 tests)

Modified: web/js/views/book-status-view.js (240 lines; page list extracted), web/js/components/progress-timeline.js (queued counts as active), web/js/views/library-view.js, web/js/components/library-crate.js, web/css/library.css.

Verify: node --check ok; node --test 35/35 pass. Not browser-tested; pytest not run (no backend change).

Notes:
- phaseOf treats chunks.processing>0 as tts too (avoid false "waiting for pages" while synth runs).
- useVisiblePolling(fn(isStale), ms, active) returns reload(); no immediate first call (callers load initially). Visible again -> immediate run.
- Listen button now href #/listen/{id}; label uses book.duration_ms (falls back to "Nghe ngay" if 0).
- Library: offline/legacy books w/o pages/chunks fall back to book.state label, no build bar.
- Pulse dot is CSS-only (::after) in processing-progress.css.

Status: DONE
