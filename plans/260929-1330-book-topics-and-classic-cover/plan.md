---
title: "Chủ đề sách + bìa hoa văn cổ điển"
status: completed
priority: P2
effort: 0.5–1 ngày
branch: main
tags: [library, topics, cover, pwa]
created: 2026-09-29
---

# Chủ đề sách + bìa hoa văn cổ điển

## Quyết định (user, 2026-09-29)
| # | Quyết định |
|---|---|
| T1 | Chủ đề do người dùng tự tạo, dùng chung cả nhà (gõ mới hoặc chọn cái đã có) |
| T2 | Thư viện hiển thị dạng **kệ theo chủ đề**; "Tiếp tục nghe" vẫn ở đầu; sách chưa có chủ đề vào kệ "Chưa phân loại" (cuối) |
| T3 | Mỗi sách 0–1 chủ đề; chỉ người tạo sách đổi được (cùng quyền đổi tên/giọng — D13) |
| T4 | Một mẫu bìa chung cho mọi sách: nền đỏ rượu vang, khung hoa văn góc vàng cổ, tên sách giữa (Cormorant, màu ngà) |

## Thiết kế
**DB — migration v3 (append-only):**
```sql
CREATE TABLE topics(id TEXT PK, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL);
ALTER TABLE books ADD COLUMN topic_id TEXT REFERENCES topics(id);
```
`name_key` = NFC + casefold + gộp khoảng trắng → "Văn học" ≡ "VĂN  HỌC" (SQLite `NOCASE` không gộp chữ có dấu).

**API (thêm, không đổi field cũ):**
| Method | Path | Ghi chú |
|---|---|---|
| GET | /api/topics | `[{id, name, book_count}]`, chỉ chủ đề đang có ≥1 sách, sắp theo tên |
| POST/PATCH | /api/books(/{id}) | nhận thêm `topic: string \| null` (tên; get-or-create; `null`/`""` = bỏ chủ đề). PATCH vẫn chỉ người tạo |
| — | book_out | thêm `topic: {id, name} \| null` |

Không làm (YAGNI): đổi tên/xoá chủ đề, nhiều chủ đề/sách, màu theo chủ đề. Chủ đề không còn sách tự ẩn khỏi danh sách, gõ lại tên cũ thì dùng lại.

**Web:**
- `components/book-cover.js`: SVG bìa chung — khung đôi vàng, hoa văn 4 góc, fleuron ❦ dưới tên; tên tự xuống dòng, co chữ theo độ dài. Màu qua token mới `--cover-bg/--cover-ornament/--cover-ink` trong `tokens.css` (bìa giữ màu ở cả 2 theme, chỉ chỉnh nhẹ độ sáng ở dark).
- `views/library-view.js`: nhóm theo `topic`, mỗi kệ = tiêu đề + hàng cuộn ngang (scroll-snap), sắp tên theo `localeCompare('vi')`; offline fallback nhóm tương tự.
- `views/capture-view.js` (tạo sách mới) + `components/player-sheet.js` (cài đặt sách, người tạo): ô "Chủ đề" có `<datalist>` gợi ý từ `/api/topics`.
- `sw.js`: bump `SHELL_CACHE`.

## Files
- Modify: `app/db.py`, `app/repositories/book_repository.py`, `app/api/books_routes.py`, `app/api/serializers.py`, `app/main.py`, web files trên, `docs/system-architecture.md`, `docs/mockups/*`
- Create: `app/repositories/topic_repository.py`, `app/api/topics_routes.py`, `tests/test_topics_api.py`

## Acceptance
- [x] Tạo sách với chủ đề mới → `/api/topics` có chủ đề, `book_out.topic` đúng; tạo sách khác gõ "VĂN HỌC" → dùng lại chủ đề "Văn học"
- [x] PATCH `topic` bởi người không tạo sách → 403; `topic: null` → bỏ chủ đề; chủ đề không còn sách không hiện ở `/api/topics`
- [x] Tên chủ đề > 40 ký tự → 400 `field=topic`, không ghi gì; rỗng/khoảng trắng = không có chủ đề
- [x] DB đang ở v2 nâng lên v3 không mất dữ liệu; mọi test cũ pass
- [x] Thư viện hiện kệ theo chủ đề, "Chưa phân loại" cuối; không cuộn ngang toàn trang ở 375px
- [x] Bìa hiển thị tên dài 3 dòng không tràn; đọc rõ ở light/dark
- [x] Mockup `docs/mockups` chụp lại màn thư viện + bìa

## Rủi ro
| Rủi ro | L | I | Giảm thiểu |
|---|---|---|---|
| Trùng chủ đề do dấu/hoa thường | M | M | `name_key` chuẩn hoá + UNIQUE; get-or-create trong transaction |
| Tên sách dài tràn bìa | M | L | Co cỡ chữ theo độ dài, giới hạn 4 dòng + ellipsis |
| Kệ cuộn ngang khó dùng trên desktop | L | L | Tablet/desktop: kệ xuống dòng thành lưới |

## Kết quả (2026-09-29)
- Implement xong; 113 test pass (thêm `tests/test_topics_api.py`); review: không Critical/High, 4 Medium đã sửa (PATCH validate trước khi ghi, sắp xếp chủ đề theo bảng chữ cái tiếng Việt, đồng bộ ô chủ đề trong sheet, sửa dòng acceptance về chủ đề rỗng). Report: [reports/code-review-report.md](./reports/code-review-report.md).
- Mở rộng theo yêu cầu user: hoa văn cổ điển Tây Âu mức "Vừa" cho phần khung (`web/css/ornaments.css`, `ornament-shapes.js`, `ornate-frame.js`); ghi vào `docs/design-guidelines.md` §6.5.
- Chưa kiểm: thiết bị thật (iOS/Android), Lighthouse a11y.

