# BookSnap Design Guidelines

Phong cách: **"Thư phòng cổ điển" (Classic Library)** — giấy ngà, mực nâu đen, điểm nhấn đỏ rượu vang + vàng cổ. Tươi sáng, sang trọng, cổ điển, nội dung là trung tâm.

Nguồn: ui-ux-pro-max (style `E-Ink / Paper`, palette `Book & Reading Tracker`, typography `Editorial Classic`) — tinh chỉnh cho tiếng Việt và độ tương phản WCAG AA.

## 1. Nguyên tắc

1. **Trang sách là nhân vật chính** — vùng đọc luôn sạch, không hoa văn; khi đọc/nghe mọi chrome lùi về sau.
2. **Sáng, ấm, không chói** — nền ngà thay vì trắng tinh; không gradient loè, không glassmorphism.
3. **Sang trọng qua typography, khoảng trắng và hoa văn cổ điển Tây Âu xuyên suốt** — mọi phần chrome (tiêu đề, kệ, bìa, nút, input, card, sheet, nav, timeline, camera) nói cùng một ngôn ngữ: góc gần vuông, hairline vàng lồng trong, hình thoi, fleuron. Không dùng hiệu ứng (blur, gradient loè, bóng dày). Xem §6.5.
4. **Một CTA chính mỗi màn hình** (Chụp / Phát).
5. **Tiếng Việt trước tiên** — mọi font phải có subset `vietnamese`, kiểm tra dấu chồng (ẫ, ự, ổ).

## 2. Color tokens

| Token | Light | Dark ("đọc đêm") | Dùng cho |
|---|---|---|---|
| `--bg` | `#FBF7EF` giấy ngà | `#1C1915` | Nền app |
| `--surface` | `#FFFDF8` | `#26221D` | Card, sheet |
| `--surface-sunken` | `#F3ECDF` | `#15130F` | Thanh player, input |
| `--ink` | `#1F1B16` | `#EDE6D8` | Chữ chính (AAA) |
| `--ink-muted` | `#5E554A` | `#B3A996` | Chữ phụ (≥4.5:1) |
| `--border` | `#E6DCCB` | `#3A342C` | Divider, viền card |
| `--primary` | `#7A2E2E` đỏ rượu vang | `#D98C7F` | CTA, nút Phát, active nav |
| `--on-primary` | `#FFFDF8` | `#1C1915` | Chữ trên primary |
| `--gold` | `#B08D57` | `#C9A66B` | **Chỉ trang trí**: viền, icon lớn, ornament (không dùng cho chữ nhỏ) |
| `--gold-ink` | `#7D6230` | `#D8BC86` | Chữ nhấn màu vàng (≥4.5:1) |
| `--highlight` | `#F3E6C4` | `#3D3424` | Nền đoạn/từ đang đọc |
| `--success` | `#3F6B4A` | `#8DBB98` | Hoàn tất |
| `--danger` | `#A1332B` | `#E58A80` | Lỗi, xoá |

Quy tắc: không hardcode hex trong component; trạng thái luôn có icon + text, không chỉ màu.

## 3. Typography

| Vai trò | Font | Lý do |
|---|---|---|
| Display / tiêu đề sách | **Cormorant Garamond** 500–700 | Cổ điển, sang; có subset vietnamese |
| Nội dung đọc | **Literata** 400/600 (variable) | Thiết kế cho đọc sách dài (Google Play Books); dấu tiếng Việt rõ ở cỡ nhỏ |
| UI (nút, nhãn, nav, thời gian) | **Be Vietnam Pro** 400–600 | Sans tối ưu tiếng Việt |

```css
@import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600&family=Cormorant+Garamond:wght@500;600;700&family=Literata:opsz,wght@7..72,400;7..72,600&display=swap&subset=vietnamese');
```

Thang cỡ (px): 12 · 14 · 16 · 18 · 20 · 24 · 32 · 40.
- Body đọc: 18px, line-height 1.7, measure 60–68 ký tự (mobile ~36–45), người dùng chỉnh 16–24px.
- Tiêu đề Cormorant cần lớn hơn ~2px so với serif thường (x-height thấp); không dùng Cormorant chữ thường < 20px. Ngoại lệ: nhãn **in hoa giãn chữ** (tiêu đề mục 17px, biển tên kệ 15px) — chữ hoa có chiều cao thị giác lớn nên vẫn rõ.
- Thời gian player: `font-variant-numeric: tabular-nums`.

## 4. Layout & spacing

- Mobile-first, breakpoints 375 / 768 / 1024. Nội dung đọc max-width `38rem`, căn giữa trên tablet/desktop.
- Spacing 4/8: 4 · 8 · 12 · 16 · 24 · 32 · 48. Gutter mobile 20px.
- Radius gần vuông như bản in: `--radius-sm 2px` (nút, input, chip), `--radius-md 3px` (card), sheet 10px trên cùng. Bìa sách 4px. Tròn chỉ giữ cho nút icon, nút Chụp, nút Play.
- Hairline vàng: `--gold-soft` (viền control), `--gold-faint` (rule lồng trong, halo focus) — suy ra từ `--gold` nên tự theo theme.
- Elevation: 2 cấp duy nhất — `0 1px 2px rgba(31,27,22,.06)` (card), `0 8px 24px rgba(31,27,22,.10)` (sheet/player nổi).
- Dùng `min-h-dvh`, tôn trọng safe-area (`env(safe-area-inset-*)`).
- Ornament: đường kẻ mảnh `--gold` 1px + dấu `❦` bằng SVG làm divider chương (không emoji).

## 5. Navigation

Bottom nav 3 mục (icon Lucide stroke 1.5 + nhãn): **Thư viện** · **Chụp** (nút giữa nổi, primary) · **Đang nghe**.
Reader/Camera là màn full-screen, có nút quay lại rõ ràng; bottom nav ẩn khi đang đọc.

## 6. Component chính

### 6.1 Camera Capture (chụp trực tiếp, không lưu ảnh vào máy)
- `getUserMedia({ video: { facingMode: 'environment' } })` → `<video>` → khung canvas → `Blob` JPEG trong RAM → upload. **Không dùng `<input type=file capture>`** (một số Android tự lưu vào Thư viện ảnh).
- Viewfinder full-screen nền `#000`, khung hướng dẫn trang sách góc bo vàng mảnh `--gold`.
- Nút chụp tròn 72px viền ngà; thumbnail strip các trang đã chụp (ảnh chỉ trong bộ nhớ phiên, `URL.revokeObjectURL` sau upload).
- Hàng dưới: bật đèn (torch nếu hỗ trợ), số trang "Trang 3", nút **Xong (3)**.
- Mỗi thumbnail có trạng thái: đang tải lên → đã nhận → lỗi (chạm để chụp lại). Có thể xoá/chụp lại trước khi gửi.
- Xử lý quyền camera bị từ chối: màn giải thích + hướng dẫn bật lại; yêu cầu HTTPS.

### 6.2 Thư viện
- **Kệ theo chủ đề**: mỗi chủ đề một kệ (sắp theo bảng chữ cái tiếng Việt), kệ "Chưa phân loại" cuối cùng. Mobile: kệ cuộn ngang, bìa rộng 136px; ≥768px: lưới xuống dòng.
- **Bìa chung** (một bộ sách đóng cùng tủ, mọi sách giống nhau trừ tên): tỉ lệ 2:3, nền đỏ rượu vang `--cover-bg`→`--cover-bg-deep`, khung đôi + 4 góc lượn + 2 fleuron màu `--cover-ornament`, tên sách Cormorant 600 màu `--cover-ink` ở giữa, co chữ theo độ dài, tối đa 4 dòng. Giữ nguyên ở cả 2 theme. Component: `web/js/components/book-cover.js`; phương án tham khảo: `docs/mockups/cover-preview.html` (đã chọn A). Bìa là trang trí (`aria-hidden`), tên sách luôn hiện dạng chữ cạnh bìa.
- Dưới bìa: tên, tiến độ nghe (thanh mảnh `--primary`), trạng thái xử lý ("Đang chuyển giọng · 12/20 đoạn").
- Empty state: minh hoạ kệ sách SVG + "Chụp trang sách đầu tiên".

### 6.3 Reader + Audio Player
- Nền giấy, văn bản Literata; **đoạn đang đọc** nền `--highlight`, chuyển mượt 200ms, tự cuộn giữ đoạn ở ~1/3 màn hình (tắt tự cuộn khi người dùng tự kéo; hiện nút "Về đoạn đang đọc").
- Chạm vào một đoạn → phát từ đoạn đó.
- Mini player dính đáy (`--surface-sunken`, elevation 2): Play/Pause 56px primary, lùi/tiến 15s, thanh tiến độ, thời gian tabular, tốc độ 0.75–2×.
- Mở rộng thành sheet: chọn chương, hẹn giờ tắt, chọn giọng, cỡ chữ, sáng/tối.
- Đoạn chưa có audio: chữ `--ink-muted` + spinner nhỏ; đoạn lỗi: icon + "Thử lại".
- Media Session API: điều khiển ở màn hình khoá, nghe khi tắt màn hình.

### 6.4 Trạng thái xử lý
Timeline dọc cho mỗi lần upload: Tải ảnh → Nhận dạng chữ → Chuyển giọng → Sẵn sàng. Skeleton cho trang đang OCR; không spinner chặn toàn màn hình.

### 6.5 Hoa văn cổ điển Tây Âu (xuyên suốt app)
Hình khối dùng chung ở `web/js/components/ornament-shapes.js` (góc lượn, fleuron) và mask `--lozenge-mask`/`--fleuron-mask` trong `web/css/ornaments.css` — không vẽ hoa văn mới rời rạc. Style của từng control nằm ngay trong file CSS gốc của nó (app/library/reader/camera.css), không đè lớp riêng.

| Vị trí | Xử lý |
|---|---|
| Tiêu đề trang (Thư viện, tên sách, Chụp trang sách) | Cormorant + đường kẻ `── ❦ ──` (`.fleuron-rule`, `.header-rule` dưới header) |
| Tiêu đề mục, tiêu đề trong sheet | In hoa La Mã giãn chữ + hairline chạy tới hình thoi (`.section-heading`, `.player-sheet-section h3`) |
| Divider có nhãn (Trang lỗi) | `◆──── NHÃN ────◆` (`.ornament`) |
| Tên kệ | Biển đồng thau viền đôi, dưới kệ vạch đôi 3px |
| Màn đăng nhập | Frontispiece `OrnateFrame`; tab in hoa, tab chọn có gạch đỏ + hình thoi |
| Nút primary | Nền đỏ, hairline vàng lồng trong 2px, hình thoi hai bên nhãn |
| Nút secondary / danger | Viền `--gold-soft` (danger: `--danger`) + rule lồng trong mờ |
| Chip | Góc vuông, viền vàng; chip chọn giống nút primary (không hình thoi) |
| Input, select, textarea | Viền `--gold-soft`, bóng lõm nhẹ; focus = viền `--primary` + halo `--gold-faint` |
| Nhãn field | Cormorant in hoa `--gold-ink`, số lining |
| Card | Viền `--gold-soft` + rule mờ lồng trong 3px; `OrnateFrame` (góc lượn) chỉ 1 card mỗi màn |
| Banner | Viền màu nhạt; hình thoi đầu dòng khi banner không có icon |
| Bottom nav, mini player, sheet, topbar reader | Vạch đôi vàng ở mép; tab đang mở có hình thoi nằm trên vạch; sheet dùng fleuron thay thanh kéo |
| Nút Chụp, Play, shutter camera | Vành vàng mảnh |
| Thanh tiến độ phát | Rule vàng 2px, phần đã nghe tô `--primary`, con trượt hình thoi |
| Timeline trạng thái | Mốc hình thoi trên sợi chỉ vàng chấm |
| Khung ngắm camera | 4 góc vàng dạng thước ngắm + hairline mờ; thumbnail viền vàng |
| Empty state, lỗi camera | Icon vàng + fleuron rule |
| Reader | Tiêu đề chương (dòng ngắn không dấu câu cuối) Cormorant căn giữa; drop cap ở đoạn văn đầu tiên của sách (sau tiêu đề); đoạn đang đọc có vạch vàng 2px bên trái. Không hoa văn khác trong nội dung |

Không làm: nền damask/hoạ tiết, góc lượn quanh mọi card, divider hoa văn giữa các đoạn đọc, hình thoi trong chip (quá dày khi nhiều chip).

## 7. Motion

- 150–250ms, ease-out khi vào, exit ngắn hơn ~30%. Chỉ animate `transform`/`opacity`.
- Chuyển Thư viện → Reader: shared element bìa sách mở ra (fallback crossfade).
- Tôn trọng `prefers-reduced-motion`: tắt tự cuộn mượt và shared element.

## 8. Accessibility checklist

- Tương phản chữ ≥4.5:1 cả 2 theme; `--gold` không dùng cho chữ < 24px.
- Touch target ≥44px, cách nhau ≥8px.
- Nút icon có `aria-label` tiếng Việt; player có `role` và `aria-valuenow`.
- Đoạn đang đọc thông báo qua `aria-current="true"`, không dùng `aria-live` liên tục.
- Đoạn đọc không mang `role="button"`/`aria-label` (sẽ che nội dung với screen reader): chữ là `<p>`, tiêu đề chương là `role="heading"`; "Phát từ đoạn N" là nút riêng, chỉ hiện khi focus bàn phím.
- Không khoá zoom; cỡ chữ đọc tuỳ chỉnh.

## 9. Anti-patterns

Glassmorphism/Liquid Glass (kể cả topbar mờ), gradient neon, nền trắng tinh #FFF, emoji làm icon, chữ vàng nhỏ `--gold` trên nền ngà (dùng `--gold-ink`), animation trang trí > 300ms, auto-play khi mở app, hoa văn trong vùng đọc, góc lượn (`OrnateFrame`) ở mọi card, bo tròn lớn kiểu pill cho nút/chip.
