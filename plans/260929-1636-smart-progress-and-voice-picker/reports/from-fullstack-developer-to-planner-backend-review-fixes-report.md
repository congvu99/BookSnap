# Backend review fixes report

Fixed: M1 (patch_book validates voice before any write; test), M2 (mp3 written atomically first, usage best-effort via `_record_usage`, OSError -> tts_failed + cached failure; 2 tests), M3 (e2e seal-tail -> new chunk seq test using `chunk_tick`), L1 (PUT /voice no-op returns early, test), L2 (documented why `configured` attr is honored: test fakes only), L4 (`quote(voice, safe="")`), L5 (Retry-After int test).

Files: app/api/books_routes.py, app/voice_preview.py, tests/test_tail_seal.py, tests/test_voice_change.py, tests/test_voice_preview.py. (voices_routes.py untouched.)

pytest: 181 passed, 1 failed. Failure = tests/test_service_worker_assets.py: web/js/processing-progress.js + one more new js file not yet in sw.js precache list; owned by concurrent web agent, not in my scope.

Status: DONE_WITH_CONCERNS
Summary: All backend fixes + 5 new tests in; 181 passed, 1 failed (sw precache list lacks 2 new web js files from concurrent web work).
