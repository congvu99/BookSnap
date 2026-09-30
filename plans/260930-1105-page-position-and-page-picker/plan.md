---
title: Vị trí trang đang nghe + chọn trang để nghe tiếp
description: >-
  Map trang sách đã chụp → (chunk_seq, vị trí trong đoạn) tính khi đọc, không
  migration. Hiện "Trang X/N" ở màn đĩa than + mini player; sheet danh sách
  trang để nhảy tới.
status: completed
priority: P2
branch: main
tags:
  - frontend
  - api
  - player
  - ux
blockedBy: []
blocks: []
created: '2026-09-30T03:56:40.547Z'
createdBy: 'ck:plan'
source: skill
mode: tdd
---

# Vị trí trang đang nghe + chọn trang để nghe tiếp

## Overview

Nguồn: [brainstorm report](../reports/brainstorm-260930-1055-page-position-and-page-picker.md) (phương án A, đã duyệt).

Chunk không biết thuộc trang nào: chunker nối text mọi trang rồi cắt lại theo câu (~1200 ký tự). Nhưng `text_chunker` chỉ chuẩn hoá **khoảng trắng** → đếm cộng dồn ký tự non-whitespace của pages và chunks cho mapping tất định page → (chunk_seq, chunk_frac). Tính on-read, không lưu, không đụng pipeline/TTS, sách cũ chạy ngay.

**TDD:** mỗi phase gồm Tests Before (khoá hành vi hiện tại), Tests New (đỏ trước), Implement, Regression Gate.
- Backend: `.venv/Scripts/python -m pytest -q`
- Frontend thuần: `node --test "tests/web/**/*.test.mjs"` (Node ≥22.7)

## Decisions

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Anchor tính on-read bằng pure fn `app/page_anchors.py` | Không migration/backfill; tail re-chunk tự đúng; loại phương án lưu cột (race `replace_tail`) và ép cắt theo trang (hỏng prosody, regenerate) |
| D2 | API trả `chunk_frac` (0..1) thay vì char offset | Python đếm code point, JS đếm UTF-16 → frac tránh lệch đơn vị; client chỉ cần `frac × duration_ms` |
| D3 | Nhãn = `Trang {seq+1}`, tổng N = tổng số trang (kể cả đã bỏ) | Khớp "Trang N" ở màn camera + `BookPageStatusList`; trang đã bỏ hiện disabled trong picker. *(Report đã sửa theo; bản đầu đếm N không tính trang đã bỏ → nhãn `seq+1` có thể vượt N)* |
| D4 | Seek = `max(0, frac × duration − 1500ms)`; frac=0 hoặc chưa có duration → 0 | Ước lượng tuyến tính ±2–3s; lùi 1.5s để không hụt chữ đầu trang |
| D5 | Trang hiện tại so với `timeMs + 1500ms` | Sau khi seek có lùi, nhãn không hiện nhầm trang trước trong 1.5s |
| D6 | `progress` giữ `(chunk_seq, offset_ms)`; trang là giá trị suy ra | Không đổi contract, bookmark/`?seq=` không ảnh hưởng |
| D7 | Anchor cache offline riêng key `booksnap:offline-anchors:{id}`, chỉ khi sách đã tải offline | Không đổi shape `saveOfflineBook`; không phình localStorage cho sách chưa tải |
| D8 | Không có anchor (offline chưa cache, sách rỗng) → NowPlayingPanel fallback `Đoạn X/Y`, MiniPlayer ẩn chip | Không bao giờ hiện số sai |
| D9 | Logic ở `page-position.js` + `use-page-anchors.js` + `page-picker-sheet.js`; reader-view chỉ nối dây (≤ ~20 dòng) | reader-view.js đã 425 dòng |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Backend page anchor computation](./phase-01-backend-page-anchor-computation.md) | Completed |
| 2 | [Backend page anchors endpoint](./phase-02-backend-page-anchors-endpoint.md) | Completed |
| 3 | [Frontend page position helpers and anchors hook](./phase-03-frontend-page-position-helpers-and-anchors-hook.md) | Completed |
| 4 | [Frontend page picker UI wiring and docs](./phase-04-frontend-page-picker-ui-wiring-and-docs.md) | Completed |

Thứ tự tuần tự 1 → 2 → 3 → 4. Phase 3 test thuần có thể viết song song với 2 (contract JSON chốt ở phase 2 §Contract).

## Dependencies

- Không blockedBy. Không migration DB.
- Xung đột mềm: [260930-0920-background-ambient-music](../260930-0920-background-ambient-music/plan.md) và [260929-1636-smart-progress-and-voice-picker](../260929-1636-smart-progress-and-voice-picker/plan.md) (phase cuối in-progress) cùng sửa `web/sw.js` / `reader-view.js`. Khi implement: bump `SHELL_CACHE` lên version kế tiếp của giá trị lúc đó (hiện `v20` → `v21`).

## Acceptance Criteria

1. `GET /api/books/{id}/page-anchors` → `[{page_seq, status, chunk_seq, chunk_frac, excerpt}]`, sắp theo `page_seq`; 401 chưa login, 404 sách không tồn tại.
2. Anchor chính xác (frac đúng tới ký tự) khi text chunk chưa sửa: trang nối giữa câu (`continues`), trang vắt 2 đoạn, nhiều trang trong 1 đoạn, trang đã bỏ, trang rỗng, trang sau chỗ bị chặn, tail re-chunk sau khi thêm trang.
3. Chunk bị sửa ngắn đi → anchor clamp, không lỗi 500.
4. Chọn trang → phát theo D4. Đoạn chưa có audio → phát từ đầu đoạn, hiện "Đang chuyển giọng" như hiện nay.
5. `Mặt A · Trang X/N` (màn đĩa than) và chip `Tr. X/N` (mini player) cập nhật theo vị trí phát, bấm mở picker.
6. Picker: trang hiện tại đánh dấu + auto-scroll; trang `pending`/`failed`/`discarded`/`empty` disabled có nhãn; bấm trang `ready` → phát + đóng sheet.
7. Anchor refetch khi chunks đổi (poll 4s); có bản offline khi sách đã tải.
8. Toàn bộ pytest + node test xanh; `test_service_worker_assets.py` xanh (file JS mới có trong `SHELL_ASSETS`).

## Out of scope

Thẻ thư viện, vạch "Trang N" trong màn đọc, ô nhập số trang, số trang in trên sách, thumbnail trang, timestamp từ TTS.

## Implementation Notes (2026-09-30)

- Kết quả: pytest 220 passed, node 77 passed; smoke test trên server thật + trình duyệt (agent-browser): `Trang X/N`, sheet, disabled rows, chọn trang 3 → seek ~0:27 (khớp `0.4696×60s − 1.5s`), Esc + trả focus.
- Chênh so với plan: prop tên `pageText` (plan ghi `pageLabel`); reader-view +27 dòng (mục tiêu ~20); thêm helper thuần `pageStatusLabel`, `reconcileAnchors`, `hasUnsettledPages`.
- Sửa sau code review: refetch anchor mỗi 10s khi còn trang pending/failed (trạng thái trang đổi mà chunk không đổi); anchor trỏ chunk không có trong playlist → coi như chưa sẵn sàng (tránh seek vào chỗ trống khi offline); seek dùng floor + epsilon để nhãn không nháy về trang trước; không fetch khi chưa có chunk; focus fallback trong sheet.
- Chấp nhận: clamp sau khi sửa tay chunk có thể làm anchor không đơn điệu trong chunk cuối (chỉ ảnh hưởng nhãn); N không tăng ngay khi đang chụp thêm trang mà mọi anchor đã ready (mở lại sách là đúng).
- Chưa làm: QA trên iPhone thật (nhạc nền + gesture, màn hẹp 320px).
