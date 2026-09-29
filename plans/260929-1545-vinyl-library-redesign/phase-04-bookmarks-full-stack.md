# Phase 4 — Đánh dấu full-stack + nav 4 mục

## Context
Pattern: `progress_repository.py`, `topics_routes.py`, `books_routes.load_book`, `tests/test_topics_api.py`. Chunk đuôi bị thay (`chunk_repository.replace_tail`) nhưng giữ `seq` → khoá theo seq.

## Requirements
- Migration v4 (append):
  ```sql
  CREATE TABLE bookmarks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chunk_seq INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(user_id, book_id, chunk_seq)
  );
  ```
- API (auth bắt buộc, sách phải tồn tại qua `load_book`):
  | Method | Path | Kết quả |
  |---|---|---|
  | GET | `/api/bookmarks` | `[{book_id, book_title, chunk_seq, excerpt, created_at}]` của user, mới nhất trước; `excerpt` = 160 ký tự đầu text chunk (NULL nếu chunk không còn) |
  | GET | `/api/books/{id}/bookmarks` | `[chunk_seq,...]` của user cho sách |
  | PUT | `/api/books/{id}/bookmarks/{seq}` | 200 `{chunk_seq, created_at}`, idempotent (giữ created_at cũ) |
  | DELETE | `/api/books/{id}/bookmarks/{seq}` | 204, idempotent |
  - `seq < 0` → 400 `field=chunk_seq`.
- Web: `bookmarksApi`; `BookmarksView` (`#/bookmarks`) nhóm theo sách (vỏ 44px, tên, số đoạn), thẻ: "Đoạn n · thời gian tương đối", trích 3 dòng, "Nghe từ đây" (→ `#/listen/:id?seq=n` — ReaderView `loadAt(seq, 0)`), ✕ bỏ; offline → banner.
- Nút đánh dấu: chip trong NowPlaying (đoạn đang phát) + icon ở meta mỗi đoạn trong reader. Optimistic update, rollback + toast khi lỗi.
- Bottom nav 4 mục: Thư viện · Đánh dấu · [Chụp] · Đang nghe.

## Files
- Create: `app/repositories/bookmark_repository.py`, `app/api/bookmarks_routes.py`, `tests/test_bookmarks_api.py`, `web/js/views/bookmarks-view.js`, `web/css/bookmarks.css`
- Modify: `app/db.py`, `app/app_context.py`, `app/main.py`, `web/js/api-client.js`, `web/js/app.js`, `web/js/components/bottom-nav.js`, `web/js/components/now-playing-panel.js`, `web/js/components/chunk-paragraph.js`, `web/js/views/reader-view.js` (đọc `?seq=`), `web/index.html`

## Tests
- PUT 2 lần → 1 dòng, created_at không đổi; DELETE không tồn tại → 204.
- Bob không thấy bookmark của Alice; sách không tồn tại → 404; chưa đăng nhập → 401.
- Xoá sách → bookmark biến mất khỏi GET.
- Excerpt cắt 160 ký tự; chunk_seq không còn chunk → excerpt null.
- Migration: DB v3 có dữ liệu → mở lại → v4, dữ liệu cũ còn.

## Risks
`?seq=` trong hash route: parseRoute phải tách query; không làm vỡ `#/read/:id` cũ.
