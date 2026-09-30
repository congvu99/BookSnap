---
phase: 2
title: Backend page anchors endpoint
status: completed
priority: P2
dependencies:
  - 1
---

# Phase 2: Backend page anchors endpoint

## Overview
`GET /api/books/{book_id}/page-anchors` bọc `compute_page_anchors`, cùng quyền với `/chunks`.

## Requirements
- Functional: AC1 của [plan.md](./plan.md).
- Non-functional: 2 query (pages + chunks), không N+1; không cache.

## Contract

```http
GET /api/books/{book_id}/page-anchors
200 [
  {"page_seq": 0, "status": "ready", "chunk_seq": 0, "chunk_frac": 0.0, "excerpt": "Chương một. Chiều xuống…"},
  {"page_seq": 1, "status": "discarded", "chunk_seq": null, "chunk_frac": null, "excerpt": ""},
  {"page_seq": 2, "status": "pending", "chunk_seq": null, "chunk_frac": null, "excerpt": ""}
]
401 chưa đăng nhập · 404 sách không tồn tại
```
`excerpt` rỗng khi trang chưa có text; với `failed` cũng rỗng (không lộ `error`).

## Architecture
- Route đặt cạnh `list_chunks` trong [books_routes.py:199](../../app/api/books_routes.py#L199); dùng `load_book` như `/chunks` (thư viện dùng chung — mọi user đăng nhập đọc được).
- `ctx.pages.list_for_book` + `ctx.chunks.list_for_book` chạy tuần tự (SQLite 1 connection; gather không lợi).
- Serializer `page_anchor_out(a: PageAnchor) -> dict` trong [serializers.py](../../app/api/serializers.py) (`dataclasses.asdict` là đủ, nhưng giữ hàm tường minh như `page_out`).

## Related Code Files
- Modify: `app/api/books_routes.py` (+~8 dòng)
- Modify: `app/api/serializers.py` (+~5 dòng)
- Create: `tests/test_page_anchors_api.py`

## Implementation Steps

**Tests Before** — `tests/test_books_api.py`, `tests/test_bookmarks_api.py` xanh (khoá `/chunks`, `/progress`).

**Tests New** (`tests/test_page_anchors_api.py`; seed trực tiếp DB như `insert_chunk` trong `test_bookmarks_api.py`, thêm helper `insert_page(app, book_id, seq, status, text, chunked)`):
1. `anon` → 401.
2. Sách không tồn tại → 404.
3. Sách không có trang → `[]`.
4. 3 trang (`ocr_done` chunked, `discarded`, `uploaded`) + chunk tương ứng → đúng shape Contract, đúng thứ tự.
5. `bob` đọc sách của `alice` → 200 (thư viện chung, khớp `/chunks`).
6. Trang `failed` có `error` → response không chứa text lỗi.
7. End-to-end qua pipeline thật (dùng fake provider trong `test_pipeline_end_to_end.py`): upload 2 trang → chạy worker tới khi chunked → anchor trang 1 `ready` với `chunk_seq`/`frac` khớp `compute_page_anchors` trên dữ liệu DB.

**Implement** route + serializer.

**Regression Gate**: `.venv/Scripts/python -m pytest -q`.

## Success Criteria
- [ ] 7 test mới xanh; test cũ xanh.
- [ ] Response khớp Contract từng field.

## Risk Assessment
- Sách rất dài (1000+ trang) → O(n) thuần Python, ước lượng <20ms cho ~2MB text. Log `page_anchors book_id=… pages=… ms=…` ở DEBUG nếu cần đo; không thêm cache (YAGNI).
- Contract field đổi sau này phá client cũ đã cache SW → giữ field names ổn định; client bỏ qua field lạ.
