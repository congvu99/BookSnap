# Phase 5 capture notices report

Files: web/js/views/capture-view.js (246 lines), web/css/camera.css, NEW web/js/components/capture-thumb-strip.js (needs sw.js SHELL_ASSETS entry).

Done: thumb badge "Trang N"; done toast (newlyDone + formatPageList, 2.5s, timer cleared on unmount, no vibrate); error label + persistent error toast (excl. seq_conflict); topbar "Chụp trang N" + "Đã tải d/t"; finish() confirm lists pending pages; CSS uses tokens.

Checks: node --check OK; node --test 9/9 pass; test_service_worker_assets fails as expected (new JS file not in sw.js).

Unresolved: toast position relies on .reader-toast CSS (fixed?) - not visually verified over camera view.

Status: DONE_WITH_CONCERNS
