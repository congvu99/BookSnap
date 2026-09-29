# Phase 1 — Vỏ đĩa + đĩa than (component dùng chung)

## Context
Mockup: `sleeve()`, `disc()`, `PALETTES`, `SLEEVE_ORNAMENT` trong `docs/mockups/vinyl-library-preview.html`. Hoa văn gốc: `web/js/components/ornament-shapes.js`.

## Requirements
- `RecordSleeve({ book })`: vỏ vuông 1:1, 5 màu da theo `sleevePalette(book.id)` (FNV-1a hash % 5), khung đôi + 4 góc + 2 fleuron + vòng mờ; tên sách Cormorant co theo độ dài, tối đa 3 dòng. `aria-hidden`.
- `VinylDisc({ book, detailed, spinning })`: rãnh, 2 vòng ngăn, nhãn màu vỏ; `detailed` thêm tên sách trên lỗ trục + "Mặt A · 33⅓"; lỗ trục `fill: var(--bg)`; sheen không xoay. `spinning` → `.spin` chạy.
- Token màu bìa 5 bộ trong `tokens.css` (`--sleeve-{wine|moss|slate|amber|parchment}-{bg|deep|ornament|ink}`), giữ nguyên ở 2 theme.

## Files
- Create: `web/js/components/record-sleeve.js`, `web/js/components/vinyl-disc.js`, `web/js/sleeve-palette.js` (hash + tên palette), `web/css/vinyl.css` (sleeve, disc, spin keyframes, reduced-motion)
- Modify: `web/css/tokens.css`, `web/index.html` (link `vinyl.css`), `web/js/components/ornament-shapes.js` (export `SQUARE_MIRRORED_CORNERS`)
- Delete: `web/js/components/book-cover.js` (chỉ library-view dùng — thay ở phase 2)

## Steps
1. `sleeve-palette.js`: `PALETTE_NAMES`, `sleevePalette(id)` (FNV-1a 32-bit, ổn định).
2. Token 5 bộ màu; CSS `.sleeve`, `.disc`, `.spin` (+ `animation-play-state` theo `.is-spinning`).
3. Component Preact dùng `html` + `CornerFlourish`/`Fleuron`.

## Validation
- Hash cố định: cùng id → cùng palette (kiểm bằng unit nhỏ trong console/test JS thủ công).
- Contrast: ink/bg mỗi palette ≥4.5:1 (đã tính: wine, moss, slate ≫7; amber 5.1; parchment 7.4).

## Risks
Container query `cqw` cần Safari ≥16 — đã dùng ở bìa hiện tại, không đổi mức hỗ trợ.
