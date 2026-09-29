---
title: "Thùng đĩa than + màn Đang nghe + Đánh dấu + Đăng nhập iOS"
status: completed
priority: P2
effort: 2–3 ngày
branch: main
tags: [library, player, bookmarks, auth, pwa, ios]
created: 2026-09-29
---

# Thùng đĩa than + Đang nghe + Đánh dấu + Đăng nhập iOS

Nguồn: [brainstorm report](../reports/brainstorm-260929-1543-vinyl-library-redesign.md) · Mockup duyệt: [docs/mockups/vinyl-library-preview.html](../../docs/mockups/vinyl-library-preview.html)

## Phases
| # | Phase | Phụ thuộc | Status |
|---|---|---|---|
| 1 | [Vỏ đĩa + đĩa than (component dùng chung)](phase-01-sleeve-and-disc-components.md) | — | completed |
| 2 | [Thư viện thùng đĩa + menu chủ đề + hero + tìm kiếm](phase-02-library-crates-and-topic-menu.md) | 1 | completed |
| 3 | [Chế độ Đang nghe của ReaderView](phase-03-listen-mode-turntable.md) | 1 | completed |
| 4 | [Đánh dấu full-stack + nav 4 mục](phase-04-bookmarks-full-stack.md) | 3 | completed |
| 5 | [Đăng nhập tối ưu iOS](phase-05-ios-auth-view.md) | 1 | completed |
| 6 | [Docs + SW cache + mockup](phase-06-docs-and-cache.md) | 1–5 | completed |

## Acceptance (tổng)
- [x] `#/read/:id` ↔ `#/listen/:id` khi đang phát: audio không ngắt, vị trí giữ nguyên
- [x] Đĩa chỉ xoay khi phát; cần đĩa theo % tiến độ; `prefers-reduced-motion` tĩnh hoàn toàn
- [x] Màu vỏ cố định theo `book.id` (hash) trên mọi thiết bị; chữ bìa ≥4.5:1 trên 5 màu
- [x] Tìm "chuyen lang" ra "Chuyện làng ven sông"; menu chủ đề + tìm kết hợp; empty state
- [x] 375px không cuộn ngang toàn trang; touch target ≥44px (nav 4 mục)
- [x] Bookmark: PUT/DELETE idempotent, riêng từng user, xoá sách → xoá theo, migration v3→v4 không mất dữ liệu
- [x] Đăng nhập: username không tự viết hoa; lỗi hiện dưới nhóm ô (vạch đỏ đúng ô)
- [ ] Autofill Keychain + bàn phím thật — cần kiểm trên iPhone thật
- [x] Toàn bộ test cũ pass + test mới cho bookmark

## Ngoài phạm vi
Player global, tác giả/series, mục lục chương, ghi chú bookmark, kéo đĩa để tua, màu theo chủ đề.

## Rủi ro chính
ReaderView remount khi đổi mode (ngắt nhạc) · pin do animation · Safari bỏ qua `interactive-widget` · guidelines cũ mâu thuẫn (T4) · SW cache cũ.

## Kết quả (2026-09-29)
- 6 phase xong; phase 2/3/5 chạy song song bởi 3 agent sau phase 1. `pytest`: 127 passed (117 cũ + 8 bookmark + 2 guard danh sách SW).
- Kiểm trên trình duyệt 390×844: đổi read↔listen không ngắt audio (theo dõi `currentTime`), thư viện/menu/tìm kiếm, đánh dấu (listen + reader), `#/bookmarks`, "Nghe từ đây" (`?seq=` kẹp về đoạn còn tồn tại), đăng nhập/đăng ký.
- Review: 0 Critical; đã sửa H1 (double-tap PUT/DELETE lệch thứ tự → client xếp hàng theo seq + `INSERT … RETURNING`), H2 (cận trên `chunk_seq`), M1 (banner lỗi/offline ở listen), M2, M3 (nút 44px), M5. Chi tiết: [reports/code-review-report.md](reports/code-review-report.md).
- Phát hiện khi tích hợp: `sw.js` còn liệt kê `book-cover.js` đã xoá → SW không cài được; đã sửa + thêm `tests/test_service_worker_assets.py`.
- Chưa kiểm: iPhone thật (Keychain, bàn phím, Safari `interactive-widget`), Lighthouse a11y. Tester subagent không chạy được E2E trình duyệt — E2E do main session + agent từng phase thực hiện.
- Để lại: `reader-view.js` ~420 dòng (props + nhánh render, không thêm logic player); Low L1–L12 trong review.
