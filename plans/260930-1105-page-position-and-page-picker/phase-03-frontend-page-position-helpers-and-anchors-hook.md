---
phase: 3
title: Frontend page position helpers and anchors hook
status: completed
priority: P2
dependencies:
  - 2
---

# Phase 3: Frontend page position helpers and anchors hook

## Overview
Logic thuần (seek tới trang, trang hiện tại, signature chunks) có node test; hook fetch/refetch/offline cho anchor; API client + offline cache.

## Requirements
- Functional: D4, D5, D7, D8 và AC4, AC7 của [plan.md](./plan.md).
- Non-functional: `page-position.js` không import Preact (test bằng `node --test`); hook không tự poll — ăn theo `chunks` mà reader-view đã poll 4s.

## Architecture

```js
// web/js/page-position.js
export const PAGE_LEAD_IN_MS = 1500;

/** @returns {{seq:number, offsetMs:number}|null} null khi anchor không 'ready' */
export function seekForPage(anchor, chunk)
// offsetMs = anchor.chunk_frac > 0 && chunk?.duration_ms ? max(0, round(frac*dur) - LEAD_IN) : 0

/** @returns {{pageSeq:number, total:number}|null} null khi không có anchor ready */
export function pageAt(anchors, currentSeq, timeMs, durationMs)
// pos = durationMs > 0 ? min(1, (timeMs + LEAD_IN)/durationMs) : 0
// trang = anchor ready cuối cùng có (chunk_seq, chunk_frac) ≤ (currentSeq, pos) theo thứ tự từ điển;
// không có → anchor ready đầu tiên. total = anchors.length (D3).

/** Đổi khi text/số chunk đổi → trigger refetch anchor. */
export function chunksSignature(chunks)
// `${chunks.length}:${lastSeq}:${sum(text.length)}`

export function pageLabel(pageSeq) // `Trang ${pageSeq + 1}`
```

```js
// web/js/use-page-anchors.js
export function usePageAnchors(bookId, chunks, cacheOffline)
// → { anchors: PageAnchor[]|null }
// - useEffect theo [bookId, chunksSignature(chunks)]: fetch booksApi.pageAnchors(bookId)
//   → setAnchors; nếu cacheOffline → saveOfflinePageAnchors(bookId, list).
// - Lỗi fetch: giữ anchors hiện có; nếu đang null → readOfflinePageAnchors(bookId) (có thể null → D8).
// - Chống race: bỏ kết quả nếu signature/bookId đã đổi (cancelled flag như reader-view init).
// - Không fetch khi chunks.length === 0 và chưa có anchors lần đầu? → vẫn fetch 1 lần (sách chưa có chunk → []).
```

Offline cache ([offline-book-cache.js](../../web/js/offline-book-cache.js)): thêm `saveOfflinePageAnchors`, `readOfflinePageAnchors` với prefix `booksnap:offline-anchors:`; `removeOfflineBook` xoá cả key anchors. try/catch như các hàm hiện có.

## Related Code Files
- Create: `web/js/page-position.js`
- Create: `web/js/use-page-anchors.js`
- Create: `tests/web/page-position.test.mjs`
- Modify: `web/js/api-client.js` (`booksApi.pageAnchors: (id) => apiFetch(\`/api/books/${id}/page-anchors\`)`)
- Modify: `web/js/offline-book-cache.js`
- Modify: `web/sw.js` (thêm 2 file vào `SHELL_ASSETS` — bắt buộc để `test_service_worker_assets.py` xanh; bump version ở phase 4)

## Implementation Steps

**Tests Before** — `node --test "tests/web/**/*.test.mjs"` + `pytest tests/test_service_worker_assets.py` xanh.

**Tests New** (`tests/web/page-position.test.mjs`):
1. `seekForPage`: frac 0 → 0; frac 0.5, dur 60000 → 28500; frac 0.01, dur 60000 → 0 (clamp); `duration_ms` null → 0; anchor `pending` → null.
2. `pageAt`: 2 trang cùng chunk 0 (frac 0, 0.5), dur 60000 — t=0 → trang 0; t=28500 → trang 1 (nhờ lead-in); t=27000 → trang 0.
3. `pageAt`: đang ở chunk 2 không có anchor nào bắt đầu trong đó → trang của anchor cuối ≤ chunk 2.
4. `pageAt`: bỏ qua anchor `discarded`/`empty`; `total` = anchors.length.
5. `pageAt`: không anchor ready → null; `durationMs` 0 → dùng pos 0.
6. `chunksSignature`: đổi khi thêm chunk, khi sửa text; không đổi khi chỉ `status`/`duration_ms` đổi.

**Implement** theo Architecture. Thêm file vào `SHELL_ASSETS`.

**Regression Gate**: node test + `.venv/Scripts/python -m pytest -q`.

## Success Criteria
- [ ] 6 nhóm test mới xanh.
- [ ] Hook không gây request thừa: refetch chỉ khi signature đổi (kiểm tay bằng DevTools Network: sách đứng yên → 1 request anchor khi mở).

## Risk Assessment
- `duration_ms` đổi từ null → số khi TTS xong không đổi signature → không refetch (đúng: frac không phụ thuộc duration).
- ChunkEditor sửa text → signature đổi → refetch → anchor mới theo text đã sửa (drift nhỏ, xem plan Risks).
- Poll 4s × fetch anchor chỉ khi chunk đổi — lúc đang xử lý nhiều trang có thể 1 request/4s; payload nhỏ, chấp nhận.
