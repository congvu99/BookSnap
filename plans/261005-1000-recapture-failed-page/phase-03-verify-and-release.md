---
phase: 3
title: Verify and release
status: in-progress
priority: P2
effort: 1h
dependencies:
  - 1
  - 2
---

# Phase 3: Verify and release

## Overview
Chạy toàn bộ test, bump service worker, kiểm thủ công trên iPhone, cập nhật docs.

## Requirements
- Functional: thiết bị đã cài PWA nhận được bản mới.
- Non-functional: không có regression ở luồng chụp hàng loạt và luồng thử lại/bỏ trang.

## Related Code Files
- Modify: `web/sw.js` (`SHELL_CACHE`), `docs/system-architecture.md` (mục API trang/vòng đời trang), `docs/codebase-summary.md` (nếu liệt kê endpoint)

## Implementation Steps
1. `.venv\Scripts\python -m pytest -q` và `node --test "tests/web/**/*.test.mjs"`.
2. Tăng `SHELL_CACHE` trong `web/sw.js`.
3. Kiểm thủ công (bản deploy HTTPS hoặc cloudflared): làm 1 trang lỗi (vd. ảnh trắng/không chữ, hoặc set `failed` trong DB local) → Chụp lại bằng camera → trang Xong, audio nối đúng thứ tự. Lặp lại với "Chọn từ máy" bằng ảnh thư viện > 5MB.
4. Cập nhật docs: endpoint mới, vòng đời `failed → uploaded` qua thay ảnh.

## Success Criteria
- [ ] Tất cả test xanh
- [ ] Kiểm tay trên iPhone Safari đạt cả 2 nguồn ảnh
- [ ] Docs cập nhật khớp code

## Risk Assessment
- Quên bump SW thì thiết bị giữ UI cũ, không thấy nút → bước 2 bắt buộc.
