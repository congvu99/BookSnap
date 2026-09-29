# Code review — Vinyl library redesign (phase 1–6, uncommitted)

Ngày: 2026-09-29 · Reviewer: code-reviewer · Phạm vi: `git diff` + file untracked dưới `app/`, `web/`, `tests/`

## Scope
- Backend: `app/db.py` (migration v4), `app/app_context.py`, `app/main.py`, `app/repositories/bookmark_repository.py` (mới), `app/api/bookmarks_routes.py` (mới), `tests/test_bookmarks_api.py`, `tests/test_service_worker_assets.py`.
- Web: `app.js`, `api-client.js`, `icons.js`, `sleeve-palette.js`, `text-fold.js`, `use-book-bookmarks.js`, views (`reader`, `library`, `auth`, `bookmarks`), components (`record-sleeve`, `vinyl-disc`, `tonearm`, `now-playing-panel`, `mini-player`, `bottom-nav`, `chunk-paragraph`, `library-*`, `topic-filter-menu`), CSS (`vinyl`, `now-playing`, `bookmarks`, `auth`, `library`, `reader`, `tokens`, `ornaments`), `sw.js`, `index.html`. `book-cover.js` xoá.
- ~533+/365- dòng trên file tracked + ~1.400 dòng file mới.

## Kiểm chứng đã chạy
- `pytest -q` → **126 passed**.
- `node --check` tất cả file JS thay đổi/mới → không lỗi cú pháp.
- Script đối chiếu icon: mọi `name=` dùng trong `web/js` đều có trong `icons.js` (33 icon). Không còn import `book-cover.js`.
- Đối chiếu class CSS↔JS: class dùng mà không style: `is-busy` (auth), `reader-view--listen` (vô hại). CSS chết: `.field-password-toggle` (app.css:120-121, auth cũ), token `--radius-cover` (tokens.css:51).
- `text-fold`: "chuyen lang" khớp "Chuyện làng ven sông", "DAC" khớp "Đắc…", NFD input vẫn khớp. `sleevePalette` ổn định; `'brand'` → `wine` đúng comment.
- Tương phản ink/bg 5 màu vỏ: 5.07–9.40 (≥4.5 ✓); ink/deep ≥4.68 ✓. Chữ nhỏ trên nhãn đĩa (`--cover-ornament` trên bg): amber 3.87, slate 4.44 (trang trí, aria-hidden → chấp nhận được).
- Probe API (ASGI, in-process):
  - `PUT /bookmarks/9223372036854775808` và `DELETE …/99999999999999999999` → **500 text/plain** (OverflowError SQLite).
  - `PUT` + `DELETE` cùng seq gửi đồng thời ×200: server còn bookmark ở **134/200** lần, dù ý định cuối của user (tap 2) là bỏ đánh dấu.

## Đánh giá chung
Kiến trúc đúng hướng: một `case 'read'` + `key=bookId` giữ nguyên `AudioPlaylist` khi đổi mode (phase-03 report đã đo audio liên tục). Migration append-only, FK cascade, PK composite, privacy per-user đều có test. SW test chặn 404 trong `cache.addAll`. Không có lỗ hổng auth. Các vấn đề chính: race double-tap của toggle bookmark, validate `chunk_seq` thiếu cận trên (500 ngoài format lỗi), lỗi/offline bị ẩn ở listen mode, và `reader-view.js` vượt ngưỡng kích thước plan.

## Critical
Không có.

## High

### H1. Toggle bookmark optimistic không tuần tự hoá → UI và server lệch nhau khi double-tap
`web/js/use-book-bookmarks.js:41-51`, server `app/repositories/bookmark_repository.py:29-40`.
- Tap 1: `on=true`, PUT bay đi. Preact re-render trong microtask nên tap 2 thấy `seqs` mới → `on=false`, DELETE bay đi song song. Thứ tự xử lý phía server không được đảm bảo (probe: 67% kết thúc *vẫn còn* bookmark trong khi UI hiện "đã bỏ").
- Rollback theo boolean cố định: nếu PUT lỗi sau khi DELETE đã thành công, `apply(seq, !on)` vẫn đúng tình cờ; nhưng nếu DELETE lỗi sau PUT thành công, `apply(seq, true)` ghi đè trạng thái — không phản ánh server.
- Thêm: `add()` là INSERT rồi SELECT tách rời; DELETE chen giữa → `row_to` trả `None` → `b.chunk_seq` AttributeError → 500 (có `# type: ignore` che đúng chỗ này, dòng 40).
- **Fix**:
  - Client: khoá theo seq khi đang bay (`pending = useRef(new Set())`; `if (pending.current.has(seq)) return;`), hoặc xếp hàng promise theo seq và sau khi settle thì đồng bộ lại `seqs` từ kết quả cuối (hoặc `forBook` lại khi có lỗi).
  - Server: làm atomic, bỏ `type: ignore`:
    ```python
    rows = await self.db.execute_returning(
        "INSERT INTO bookmarks(user_id, book_id, chunk_seq, created_at) VALUES (?,?,?,?)"
        " ON CONFLICT(user_id, book_id, chunk_seq) DO UPDATE SET created_at=bookmarks.created_at RETURNING *",
        (user_id, book_id, chunk_seq, now_iso()),
    )
    return row_to(Bookmark, rows[0])
    ```
  - Thêm test: PUT+DELETE đồng thời không bao giờ 500.

### H2. `chunk_seq` không có cận trên → 500 plain-text, vi phạm contract lỗi `{"error":{code,message,field}}`
`app/api/bookmarks_routes.py:11` `ChunkSeq = Path(ge=0)`.
- Giá trị > 2^63-1 → OverflowError từ sqlite3 → 500 `text/plain`. Giá trị ≤2^63-1 nhưng > 2^53 được lưu, rồi JS làm tròn (`Number`) → không xoá được từ BookmarksView (seq gửi đi sai), rác vĩnh viễn trong `/api/bookmarks`.
- Tiền lệ trong repo: `pages_routes.py:40,73` dùng `le=MAX_PAGE_SEQ`.
- **Fix**: `ChunkSeq = Path(ge=0, le=MAX_CHUNK_SEQ)` (ví dụ 1_000_000, hoặc suy từ `MAX_PAGE_SEQ`), + test 400 `field=chunk_seq` cho số quá lớn. (Cùng lỗi tồn tại sẵn ở `ProgressIn.chunk_seq`, `books_routes.py:39` — ngoài phạm vi, nên sửa kèm.)

## Medium

### M1. Listen mode nuốt mọi lỗi và trạng thái offline
`web/js/views/reader-view.js:344,349`. Banner `error` chỉ nằm trong `.reader-content` (chỉ render ở read mode) và banner offline có `!isListen`. Ở `#/listen/:id` (nay là đích mặc định từ thư viện, hero, bottom nav), các lỗi từ PlayerSheet (đổi giọng, chủ đề, xoá sách, tải offline) và `retryChunk` hoàn toàn im lặng. Phase-03 report đã tự ghi nhận nhưng chưa xử lý.
**Fix**: render `error` (và dòng "phát từ bản đã tải" khi `isOffline`) ở cấp `.reader-view` cho cả hai mode, hoặc truyền `error` vào `NowPlayingPanel` hiển thị dưới `np-status`.

### M2. `?seq=` trỏ tới seq không còn chunk → player kẹt, excerpt/bookmark chip lệch đoạn
`reader-view.js:103-107` + `302-304`; `audio-playlist.js:81-86`.
BookmarksView cố ý hiển thị bookmark có `excerpt=null` ("Đoạn này đã được thay đổi hoặc không còn") kèm nút "Nghe từ đây". `loadAt(seqKhôngTồnTại)` gỡ `src`, `ready=false` → nút Play disabled; đồng thời `chunkIndex` fallback về 0 nên excerpt + chip đánh dấu áp vào **đoạn 1**, không phải `currentSeq` thật của playlist.
**Fix**: trong `startAt`, kẹp về chunk gần nhất: `const target = chunks.find(c => c.seq >= startSeq) ?? chunks.at(-1)`; nếu không có chunk thì bỏ qua `startSeq`. Và cho `currentSeq` của chip lấy từ `playerState.currentSeq` khi nó tồn tại trong `chunks`, ẩn chip khi không.

### M3. Nút đánh dấu trong reader 32×32px (<44px)
`web/css/bookmarks.css:36` `.reader-bookmark-btn { width: 32px; height: 32px }`. Theo pattern cũ của `.reader-edit-btn` nhưng vi phạm tiêu chí "touch target ≥44px" của plan và nằm sát nút sửa (tap nhầm = mở editor). **Fix**: giữ glyph 16px nhưng mở vùng chạm bằng `min-width/min-height: 44px` hoặc `::before { inset: -6px }` (không đổi layout dòng).

### M4. `reader-view.js` 416 dòng — vượt mục tiêu plan (<~360) và quy tắc ~200
Phase-03 ghi "tách nếu cần để < ~360 dòng". Nhánh listen (khối props ~25 dòng + `bookmarkSlot` inline) có thể tách: một `ReaderListenBody`/`ReaderReadBody` presentational, hoặc chuyển nút bookmark của NowPlaying thành component `BookmarkToggle` dùng chung với `ChunkParagraph`. Không đổi logic player.

### M5. Trạng thái bookmark hiển thị sai khi `forBook` lỗi/đến muộn
`use-book-bookmarks.js:14-24`. Comment khẳng định "UI never shows a false state" nhưng:
- Offline/lỗi mạng: `.catch(() => {})` → mọi đoạn hiện *chưa đánh dấu* dù server có.
- `forBook` về sau khi user đã toggle → `setSeqs(new Set(list))` ghi đè optimistic.
**Fix**: giữ trạng thái `loaded`; khi chưa tải được thì ẩn/disable nút (hoặc hiện toast giải thích), và merge thay vì ghi đè (`setSeqs(prev => new Set([...list, ...pendingAdds]))`). Sửa comment cho đúng.

## Low
- **L1** `app.js:41,116` + `reader-view.js:105`: `history.replaceState` không bắn `hashchange`, nên state `hash` của App vẫn giữ `?seq=n`. Hiện an toàn vì `startSeq` chỉ đọc trong effect `[bookId]` (không re-apply khi re-render/đổi mode, đã kiểm luồng bookmarks→listen→read→back). Nhưng prop `startSeq` vẫn truyền giá trị cũ mãi; ai sau này thêm `startSeq` vào deps sẽ gây nhảy đoạn. Ghi chú bằng comment hoặc `setHash` qua callback sau khi strip. `replaceState(null, …)` cũng xoá `history.state` (hiện không ai dùng).
- **L2** `reader-view.js:103-106`: `startAt` chạy trước check `cancelled` (sau `await progress.load()`), nên có thể `replaceState` URL của route khác nếu user rời đi đúng lúc. Vô hại hiện tại (route khác không có query) — dời check `cancelled` lên trước.
- **L3** a11y toggle: `chunk-paragraph.js:69-77` và `reader-view.js:330-336` đổi cả `aria-label` lẫn `aria-pressed` → SR đọc "Bỏ đánh dấu…, đã nhấn" (nghĩa kép). Giữ nhãn cố định "Đánh dấu đoạn n" + `aria-pressed`.
- **L4** `reader-view.js:410`: toast `role="status"` mount cùng lúc với nội dung → nhiều SR không đọc. Giữ vùng live luôn mount, chỉ đổi text.
- **L5** `auth-view.js:137-140`: `role="tablist"`/`tab` không có `tabpanel`/`aria-controls`, không có điều hướng mũi tên. Dùng `role="radiogroup"` + `aria-checked`, hoặc hai `button aria-pressed`, hoặc bổ sung `aria-controls` + `role="tabpanel"` trên `<form>`.
- **L6** `topic-filter-menu.js` / `library-account-menu.js`: Tab rời menu nhưng menu vẫn mở (scrim phủ màn); nên đóng khi `focusout` ra ngoài menu. `items` chụp lúc mở — nếu `options` đổi khi đang mở thì phím mũi tên dùng danh sách cũ.
- **L7** `auth-view.js`: lỗi field hiển thị dưới *cả nhóm* (không dưới đúng ô) — khớp phase-05 ("dòng lỗi dưới nhóm") nhưng lệch acceptance tổng "lỗi hiện dưới ô". Chốt lại câu chữ acceptance. Class `is-busy` không có CSS.
- **L8** `mini-player.js:22,37,76`: không còn meta mở sheet; `onExpand` vẫn dùng cho chevron — OK. `formatTime`/`RATES` được export từ component để tái dùng → nên chuyển sang module tiện ích (`format-time.js`) thay vì import chéo component↔component (`now-playing-panel.js:9-10`).
- **L9** `bookmarks-view.js:123-131`: rollback `setItems(before)` dùng snapshot → hai lần xoá song song mà lần 1 lỗi sẽ khôi phục cả item lần 2 đã xoá thành công. Banner lỗi không bao giờ tự xoá. Dùng updater thêm lại đúng item.
- **L10** `bookmark_repository.list_for_user`: không phân trang, tải full `chunks.text` rồi cắt ở Python. Dùng `substr(c.text, 1, 160)` trong SQL; chấp nhận không phân trang ở quy mô gia đình.
- **L11** CSS: literal màu trong CSS component (`vinyl.css:29,31,40` `#fff/#000`, `library.css` `rgba(31,27,22,…)`) — nên token hoá (`--vinyl-groove`, `--shadow-ink`). Dead CSS `.field-password-toggle` (app.css:120-121), token `--radius-cover` (tokens.css:51) nên xoá trong phase 6.
- **L12** Hành vi đổi: sách `ready` mở thẳng `#/listen/:id` (không qua `#/book/:id`); listen chỉ có "Về thư viện" → màn trạng thái sách (chụp thêm trang) chỉ còn đường Đọc cùng → Quay lại. Chỉ còn 1 sách "Nghe tiếp" (hero) thay vì danh sách. Cần xác nhận là quyết định sản phẩm.

## Edge cases từ scout
- Đổi mode `read↔listen` khi đang phát: không remount (1 case, key bookId) ✓; auto-scroll tắt ở listen, bật lại + reset suppress khi về read ✓; listener scroll gỡ đúng ✓.
- Progress save/media session/sleep timer/poll chunk/offline fallback (`readOfflineBook`) không đổi logic; `startAt` áp cho cả nhánh offline ✓.
- Library offline: vẫn dùng `listOfflineBooks`, link offline → `#/read/:id` ✓; hero ẩn khi offline ✓. Logout giữ `clearUserProgress` + `clearCachedUser` ✓.
- Bottom nav chỉ hiện ở library/bookmarks/book; `isContinue` so sánh cả `#/listen` và `#/read` (bỏ query) ✓.
- SW: `SHELL_ASSETS` khớp đĩa, bump v11, test chặn 404 ✓.
- `seqParam`: `?seq=abc`/âm → null ✓.
- Reduced motion: `.disc-spin { animation: none }` thắng rule `*` toàn cục (rule đó chỉ `!important` duration) ✓; transition slide/arm tắt ✓.

## Kiểm tra theo yêu cầu
| Mục | Kết quả |
|---|---|
| (a) Giữ cùng AudioPlaylist khi đổi mode | ✓ (code + đo trong phase-03 report) |
| (a) Đĩa chỉ xoay khi phát / reduced-motion | ✓ (`animation-play-state`, `animation:none`) |
| (a) Palette ổn định theo id | ✓ FNV-1a, test thủ công |
| (a) Tìm không dấu | ✓ |
| (a) ≥44px | ✗ nút bookmark reader 32px (M3); nav, chip, menu, avatar, np-bookmark ✓ |
| (a) Bookmark idempotent/privacy/cascade/migration | ✓ tuần tự; ✗ đồng thời (H1), ✗ seq quá lớn (H2) |
| (a) Input attributes auth | ✓ autocapitalize/autocorrect/spellcheck/enterkeyhint/autocomplete/passwordrules (min 6 khớp backend) |
| (b) Regression touchpoints | Không thấy regression logic; lỗi ẩn ở listen (M1) |
| (c) API cũ không đổi; lỗi mới đúng format | ✓ trừ 500 plain (H2); migration append-only ✓ |
| (d) Pattern | Repo trả dataclass ✓, `load_book` ✓, comment tiếng Anh/UI tiếng Việt ✓; `type: ignore` (H1), reader-view 416 dòng (M4) |
| (e) Cú pháp/import/icon/CSS | ✓ node --check sạch, icon đủ; dead CSS nhỏ (L11) |
| Bảo mật | Mọi endpoint bookmark qua `CurrentUser` (401 có test), lọc theo `user.id`; `load_book` 404 không lộ gì mới vì thư viện chia sẻ chung |

## Recommended actions (ưu tiên)
1. H1: khoá/xếp hàng toggle theo seq ở client + `INSERT … RETURNING` atomic ở server, bỏ `type: ignore`, thêm test đồng thời.
2. H2: `le=` cho `chunk_seq` (bookmarks, và progress) + test.
3. M1: hiện `error`/offline ở listen mode.
4. M2: kẹp `startSeq` về chunk tồn tại; chip bookmark theo `playerState.currentSeq`.
5. M3: vùng chạm 44px cho `.reader-bookmark-btn`.
6. M5: trạng thái `loaded` cho hook bookmark, merge thay vì ghi đè.
7. M4 + L8: tách nhánh listen / tiện ích `formatTime`, `RATES`.
8. Phase 6 còn lại: cập nhật `docs/design-guidelines.md` (§101 còn ghi "nút icon ở mini player để đánh dấu", mâu thuẫn implement), `docs/mockups/index.html`, ghi chú plan cũ; xoá dead CSS/token.

## Plan follow-ups (không sửa plan)
- Phase 1–5: code có mặt đầy đủ theo Files list; phase 4 cần H1/H2 trước khi đánh dấu hoàn thành.
- Phase 6: SW + test + dọn CSS xong; docs/mockup index/ghi chú plan cũ **chưa** làm.
- `plan.md` status vẫn `pending` cho mọi phase — để lead cập nhật.

## Metrics
- Tests: 126 passed (7 bookmark + 2 SW mới). Không có coverage tool.
- Type/lint: repo không cấu hình ruff/mypy (không có pyproject); `node --check` 0 lỗi.
- Linting issues: n/a.

## Unresolved questions
1. Mở sách `ready` thẳng vào listen mode (bỏ qua màn trạng thái) và chỉ 1 hero "Nghe tiếp" có phải quyết định đã chốt trong brainstorm không?
2. "Nghe từ đây" có nên tự phát (autoplay trong cử chỉ người dùng) hay giữ "không tự phát" như phase-03?
3. Acceptance "lỗi hiện dưới ô" vs phase-05 "dòng lỗi dưới nhóm" — chuẩn nào?


## Đã xử lý (main session, 2026-09-29)
| Mục | Xử lý | Kiểm |
|---|---|---|
| H1 | `use-book-bookmarks.js`: xếp hàng request theo seq, UI = ý muốn mới nhất, rollback về trạng thái server xác nhận; `add()` = `INSERT … ON CONFLICT DO UPDATE … RETURNING` | `test_concurrent_put_and_delete_never_error`; trình duyệt: PUT trễ 600ms + double/triple tap → UI khớp server |
| H2 | `MAX_CHUNK_SEQ = MAX_PAGE_SEQ * 100`, `le=` trên path | test -1, max+1, 2^64 → 400 `field=chunk_seq` |
| M1 | Listen mode hiện banner lỗi + offline (`.np-banners`) | xem code |
| M2 | `startAt` kẹp về chunk seq ≥ startSeq, không có thì chunk cuối; bỏ qua nếu đã huỷ | `?seq=99` → Đoạn 4/4, Phát bật được |
| M3 | `.reader-bookmark-btn` 44px | CSS |
| M5 | Tải `forBook` về muộn không ghi đè tap đang chờ; comment sửa đúng hành vi offline | xem code |
| L (toast) | Vùng `role=status aria-live` luôn mount, ẩn bằng `hidden` | xem code |
| Docs §101 | Sửa mô tả đánh dấu theo code | — |
Chưa làm: M4 (độ dài reader-view), các Low còn lại.
