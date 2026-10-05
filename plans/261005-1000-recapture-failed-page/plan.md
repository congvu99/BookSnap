---
title: Recapture failed page
description: 'Thay ảnh cho trang OCR lỗi, giữ nguyên seq, OCR lại và nối audio đúng thứ tự'
status: in-progress
priority: P2
branch: main
tags:
  - pages
  - ocr
  - upload
  - tdd
blockedBy: []
blocks: []
created: '2026-10-05T02:48:06.119Z'
createdBy: 'ck:plan'
source: skill
---

# Recapture failed page

## Overview

Trang `failed` giữ seq (`UNIQUE(book_id, seq)`) nên không upload lại được. `Thử lại` chỉ OCR lại ảnh cũ (hết hạn sau 24h), còn `Bỏ trang` thì mất nội dung. Plan này thêm `POST /api/pages/{page_id}/image` (chỉ cho `failed`) cộng nút **Chụp lại** (camera + chọn file, nén JPEG) ở màn trạng thái sách.

Thứ tự an toàn theo cấu trúc: chunker dừng ở trang `failed` đầu tiên, nên không trang nào sau nó đã thành chunk.

Brainstorm: [brainstorm-261005-1000-recapture-failed-page.md](../reports/brainstorm-261005-1000-recapture-failed-page.md)

Mode: `--tdd`. Test viết trước, khoá bất biến thứ tự trang → chunk.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Backend replace image (TDD)](./phase-01-backend-replace-image-tdd.md) | Completed |
| 2 | [Frontend recapture sheet](./phase-02-frontend-recapture-sheet.md) | Completed |
| 3 | [Verify and release](./phase-03-verify-and-release.md) | In Progress |

## Acceptance Criteria

- Trang `failed` → thay ảnh → `uploaded`, cùng `id` và `seq`, `error=NULL`, `attempts=0`.
- Sau khi OCR xong, chunker ghép trang N rồi N+1 đúng thứ tự.
- Ảnh cũ (nếu còn) bị xoá. Ảnh mới bị xoá nếu thay thất bại.
- Trang không ở `failed` → 409 `page_not_replaceable`. Ảnh sai định dạng/quá cỡ → 415/413. Trang không tồn tại → 404.
- UI: hàng trang Lỗi có `Chụp lại` → sheet "Chụp lại Trang N" → camera hoặc chọn file → gửi ảnh nén ≤ 2000px JPEG.
- Pytest và node test xanh. Bump `SHELL_CACHE`.

## Out of Scope

Khôi phục trang `discarded`; chụp lại trang `ocr_done`; nút thử lại đoạn TTS ở màn trạng thái.

## Dependencies

Không có. Các plan đang mở (mvp, family-profiles, netflix-style-ux…) không đụng vào `pages_routes`/`page_repository` theo hướng xung đột. Phase 2 sửa `book-status-view.js`: nhớ rebase nếu plan UX đang sửa dở file này.
