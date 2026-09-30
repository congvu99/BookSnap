---
phase: 4
title: Frontend page picker UI wiring and docs
status: completed
priority: P2
dependencies:
  - 3
---

# Phase 4: Frontend page picker UI wiring and docs

## Overview
Sheet chọn trang, nhãn `Trang X/N` ở NowPlayingPanel + MiniPlayer, nối vào reader-view; bump SW; cập nhật docs.

## Requirements
- Functional: AC4–AC6 của [plan.md](./plan.md); D8 fallback.
- Non-functional: reader-view tăng ≤ ~20 dòng; a11y (dialog label, `aria-current`, focus trả về nút mở khi đóng); theo `docs/design-guidelines.md` (sheet giống `player-sheet`).

## Architecture

**`web/js/components/page-picker-sheet.js`**
```js
/** @param {{ anchors: PageAnchor[], currentPageSeq: number|null, onPick:(anchor)=>void, onClose:()=>void }} props */
export function PagePickerSheet(props)
```
- Tái dùng class `player-sheet-backdrop` / `player-sheet` / `player-sheet-handle`; `role="dialog" aria-label="Chọn trang"`.
- Mỗi hàng `<button class="page-pick-row">`: `Trang N` + excerpt (1 dòng, ellipsis). Trang hiện tại `aria-current="true"`.
- Status ≠ `ready` → `disabled` + nhãn: `pending` "Chưa sẵn sàng", `failed` "Lỗi", `discarded` "Đã bỏ", `empty` "Trang trống".
- Mount → `scrollIntoView({block:'center'})` hàng hiện tại (tôn trọng reduced motion như reader-view). Esc đóng.

**NowPlayingPanel** ([now-playing-panel.js:69](../../web/js/components/now-playing-panel.js#L69)): prop mới `pageLabel: string|null`, `onOpenPages: ()=>void`. Có `pageLabel` → eyebrow `Mặt A · <button class="np-page-btn">Trang X/N</button>`; không có → giữ `Đoạn X/Y` (D8).

**MiniPlayer**: prop `pageLabel`, `onOpenPages`; có → chip `Tr. X/N` (button, `aria-label="Đang ở trang X trên N, chọn trang"`); không có → không render.

**reader-view.js** (nối dây):
```js
const pages = usePageAnchors(bookId, chunks, downloadState.status === 'done');
const [pagePickerOpen, setPagePickerOpen] = useState(false);
const pagePos = pages.anchors && pageAt(pages.anchors, playerState.currentSeq, playerState.currentTimeMs, playerState.durationMs);
const pageText = pagePos ? `${pagePos.pageSeq + 1}/${pagePos.total}` : null;
function playPage(anchor) {
  const target = seekForPage(anchor, chunks.find((c) => c.seq === anchor.chunk_seq));
  if (!target) return;
  music.unlock();                          // tap = gesture cho iOS AudioContext
  playlistRef.current.loadAt(target.seq, target.offsetMs, true);
  setPagePickerOpen(false);
}
```
Truyền `pageLabel`/`onOpenPages` cho 2 component, render `PagePickerSheet` khi `pagePickerOpen`. Không mở đồng thời với `PlayerSheet`.

## Related Code Files
- Create: `web/js/components/page-picker-sheet.js`
- Modify: `web/js/components/now-playing-panel.js`, `web/js/components/mini-player.js`, `web/js/views/reader-view.js`
- Modify: `web/css/*` (file chứa `.player-sheet` — thêm `.page-pick-row`, `.np-page-btn`, chip mini player; dùng token sẵn có)
- Modify: `web/sw.js` (thêm `page-picker-sheet.js` vào `SHELL_ASSETS`; bump `SHELL_CACHE` lên version kế tiếp — hiện `v20` → `v21`, kiểm lại lúc implement)
- Modify: `docs/system-architecture.md` (API list + mục mapping trang), `docs/codebase-summary.md` (file mới), `docs/project-roadmap.md` (mục tính năng)

## Implementation Steps

**Tests Before** — node test + pytest xanh. Mở một sách có ≥3 trang trên local, ghi nhận hành vi hiện tại của NowPlayingPanel/MiniPlayer (ảnh chụp) để đối chiếu không vỡ layout.

**Tests New** — UI không có test harness (Preact không test ở repo); logic đã phủ ở phase 3. Thêm vào `tests/web/page-position.test.mjs` nếu tách thêm helper thuần (vd. nhãn trạng thái `pageStatusLabel(status)`).

**Implement** theo Architecture, rồi:
- Bump `SHELL_CACHE`, thêm asset.
- Cập nhật 3 docs.

**QA tay** (Chrome desktop + iPhone Safari qua deploy/tunnel):
1. Sách ≥20 trang có trang `continues`: chọn trang 12 → câu đầu trang 12 nghe được trong ≤3s.
2. Nghe liên tục qua ranh giới trang → nhãn đổi đúng lúc (±2s).
3. Sách đang xử lý: trang chưa chunk disabled "Chưa sẵn sàng"; sau khi xong (poll) tự bật.
4. Trang đã bỏ hiện "Đã bỏ", nhãn N vẫn là tổng số trang.
5. Tải offline → tắt mạng → mở lại sách → vẫn có `Trang X/N`; sách chưa tải offline + tắt mạng → fallback `Đoạn X/Y`.
6. iOS: chọn trang từ màn khoá/nền không áp dụng; từ app → nhạc nền vẫn bật được (gesture).
7. Keyboard: Tab tới nút trang, Enter mở, Esc đóng, focus quay lại nút.

**Regression Gate**: `node --test "tests/web/**/*.test.mjs"` + `.venv/Scripts/python -m pytest -q`.

## Success Criteria
- [ ] AC4–AC8 đạt; QA tay 1–7 pass.
- [ ] reader-view.js tăng ≤ ~20 dòng.
- [ ] Docs cập nhật, link/claim khớp code.

## Risk Assessment
- Nhãn trên eyebrow dài hơn ở màn hẹp (320px) → cho phép xuống dòng/ellipsis; kiểm ở QA.
- SW cũ giữ JS cũ → bump `SHELL_CACHE` là bắt buộc; xung đột version với plan khác → lấy version kế tiếp lúc merge.
- `loadAt` khi đang phát đoạn khác: playlist đã hỗ trợ (dùng bởi "Nghe từ đây"/bấm đoạn) → không thêm logic.
