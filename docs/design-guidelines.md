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
| Display / tiêu đề, tên sách, nút Đăng nhập/Đăng xuất | **Playfair Display** 500–700 | Cổ điển, tương phản cao; x-height lớn nên dấu chồng tiếng Việt rõ; có subset vietnamese |
| Nội dung đọc | **Literata** 400/600 (variable) | Thiết kế cho đọc sách dài (Google Play Books); dấu tiếng Việt rõ ở cỡ nhỏ |
| UI (nút, nhãn, nav, thời gian) | **Be Vietnam Pro** 400–600 | Sans tối ưu tiếng Việt |

```css
@import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600&family=Playfair+Display:wght@500;600;700&family=Literata:opsz,wght@7..72,400;7..72,600&display=swap&subset=vietnamese');
```

Thang cỡ (px): 12 · 14 · 16 · 18 · 20 · 24 · 32 · 40.
- Body đọc: 18px, line-height 1.7, measure 60–68 ký tự (mobile ~36–45), người dùng chỉnh 16–24px.
- Playfair Display rộng hơn và x-height cao hơn serif cổ điển (~0.52em): chữ trên bìa/nhãn đĩa đặt nhỏ hơn ~15% so với serif x-height thấp (sleeve `9.5cqw`, nhãn đĩa `7`), chừa chỗ cho dấu chồng (ẫ, ề, ự) ở dòng trên cùng.
- Dấu chồng Playfair cao tới ~1.07em (thường) / ~1.16em (hoa): ô tiêu đề có `overflow: hidden`/`line-clamp` cần line-height ≥1.22 và/hoặc `padding-top: .1em` (hero, vỏ đĩa, mini player, menu heading); tiêu đề nhiều dòng không clamp dùng line-height ≥1.35 để dấu chữ hoa (Ấ, Ế) không chạm chân chữ dòng trên (g, y); vỏ đĩa bị giới hạn ở 1.22 (3 dòng phải vừa khung) nên chấp nhận chạm nhẹ.
- Tên sách trên vỏ đĩa co theo độ dài và từ rộng nhất (chữ hoa tính 1.35), tối thiểu 0.5× — chỉ từ cực dài mới xuống dòng giữa từ.
- Playfair không có `tnum`: số cần thẳng cột (thống kê tài khoản) dùng `--font-ui`. Drop cap: 3em, line-height .9.
- Nút Đăng nhập (tab + submit) và Đăng xuất (menu avatar + trang tài khoản) dùng `--font-display`; các nút khác vẫn `--font-ui`.
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

Bottom nav 4 mục (icon Lucide stroke 1.5 + nhãn): **Thư viện** · **Đánh dấu** · **Chụp** (nút giữa nổi, primary) · **Đang nghe**.
Reader/Camera là màn full-screen, có nút quay lại rõ ràng; bottom nav ẩn khi đang đọc (mini player chiếm mép dưới). Màn nghe (`#/listen`) là màn của tab **Đang nghe** nên vẫn giữ bottom nav.

## 6. Component chính

### 6.1 Camera Capture (chụp trực tiếp, không lưu ảnh vào máy)
- `getUserMedia({ video: { facingMode: 'environment' } })` → `<video>` → khung canvas → `Blob` JPEG trong RAM → upload. **Không dùng `<input type=file capture>`** (một số Android tự lưu vào Thư viện ảnh).
- Viewfinder full-screen nền `#000`, khung hướng dẫn trang sách góc bo vàng mảnh `--gold`.
- Nút chụp tròn 72px viền ngà; thumbnail strip các trang đã chụp (ảnh chỉ trong bộ nhớ phiên, `URL.revokeObjectURL` sau upload).
- Hàng dưới: bật đèn (torch nếu hỗ trợ), số trang "Trang 3", nút **Xong (3)**.
- Mỗi thumbnail có trạng thái: đang tải lên → đã nhận → lỗi (chạm để chụp lại). Có thể xoá/chụp lại trước khi gửi.
- Xử lý quyền camera bị từ chối: màn giải thích + hướng dẫn bật lại; yêu cầu HTTPS.

### 6.2 Thư viện & Đang nghe
**Thư viện — thùng đĩa than:**
- **Thùng (crate)**: mỗi chủ đề một thùng (sắp theo bảng chữ cái tiếng Việt), thùng "Chưa phân loại" cuối. Nền `--surface-sunken`, viền vàng 1px, tab thùng in hoa + icon collapsible ở đầu. **Tab thùng sticky** khi cuộn → người dùng biết chủ đề hiện tại. Bên trong mỗi thùng: hero "Nghe tiếp" (card khung `OrnateFrame` + vỏ đĩa), rồi lưới 2 cột vỏ đĩa vuông (mỗi sách một vỏ).
- **Vỏ đĩa vuông (sleeve)**: tỉ lệ 1:1, **5 màu da** chọn cố định theo `hash(book.id) % 5`: wine, moss, slate, amber, parchment. Khung hoa văn góc lượn + 4 góc + 2 fleuron, tên sách Playfair 600 ở giữa, co chữ theo độ dài (tối đa 3 dòng). Bìa là trang trí (`aria-hidden`), tên sách luôn hiện dạng chữ cạnh vỏ. Sách chưa `ready` không có đĩa ("Đang ép đĩa · x/y"). Chữ bìa ≥4.5:1 trên cả 5 màu.
- **Hero "Nghe tiếp"**: vỏ đĩa nhớ sách user đang nghe dở (fetch `/api/me/continue`), đĩa ló ra bên phải (trạng thái ấy), nút primary "Nghe tiếp" hoặc "Tiếp tục đọc", nền giống thùng.
- **Menu chủ đề (iOS)**: nút segmented "Mọi chủ đề ⌃⌄" ở trên hero, pull-down menu (không cuộn ngang chip), chọn → filter các thùng khác ở dưới, empty state khi chọn chủ đề không có sách.
- **Tìm kiếm**: ô bỏ dấu (client-side, accent-insensitive; không yêu cầu server).
- Dưới vỏ: tên, tiến độ nghe của user hiện tại (thanh mảnh `--primary`), trạng thái xử lý ("Đang chuyển giọng · 12/20 đoạn").
- Empty state: minh hoạ thùng đĩa SVG + "Chụp trang sách đầu tiên".

**Chế độ Đang nghe:**
- Route: `#/listen/:id` (cùng `ReaderView` instance với `#/read/:id`, không ngắt audio khi chuyển mode).
- Vỏ đĩa trái, **đĩa than ló ra bên phải**. Phát → đĩa trượt ra 900ms + xoay 33⅓ vòng/phút (chỉ khi `playing`), **cần đồng thau** (tonearm arm 9.5° → 29.5° theo % tiến độ chunk, ở đầu chunk 9.5°, ở cuối 29.5°). Tạm dừng → cần nhấc lên, đĩa trượt về vỏ 600ms. **`prefers-reduced-motion` → tắt hết animation**, vỏ/đĩa/cần tĩnh, không trượt hay xoay.
- Nút đĩa trên topbar reader (mode read) → chuyển sang listen; mini player hiện vỏ 48px + đĩa nhỏ xoay khi phát.

### 6.3 Reader + Audio Player
- Nền giấy, văn bản Literata; **đoạn đang đọc** nền `--highlight`, chuyển mượt 200ms, tự cuộn giữ đoạn ở ~1/3 màn hình (tắt tự cuộn khi người dùng tự kéo; hiện nút "Về đoạn đang đọc").
- Chạm vào một đoạn → phát từ đoạn đó.
- Mini player dính đáy (`--surface-sunken`, elevation 2): Play/Pause 56px primary, lùi/tiến 15s, thanh tiến độ, thời gian tabular, tốc độ 0.75–2×.
- Mở rộng thành sheet: chọn chương, hẹn giờ tắt, chọn giọng, cỡ chữ, sáng/tối.
- Đoạn chưa có audio: chữ `--ink-muted` + spinner nhỏ; đoạn lỗi: icon + "Thử lại".
- Media Session API: điều khiển ở màn hình khoá, nghe khi tắt màn hình.

### 6.3.1 Đánh dấu
- Trang `#/bookmarks`: danh sách đánh dấu của user hiện tại (mới nhất trước), nhóm theo sách, mỗi thẻ = "Đoạn n" + trích 160 ký tự + thời gian tương đối. "Nghe từ đây" → `#/listen/:id?seq=n` (mở đúng đoạn, không tự phát; đoạn không còn thì lấy đoạn kế tiếp). Đánh dấu/bỏ dấu: chip dấu trang ở màn Đang nghe (đoạn đang phát) và nút dấu trang 44px cạnh nút sửa ở mỗi đoạn trong reader.

### 6.3.2 Đăng nhập iOS
- Hero: `RecordSleeve` (vỏ brand wine) + `VinylDisc` (đĩa trượt một lần 900ms khi load), `:focus-within` → hero co scale 0.52, ẩn tagline.
- Segmented tablist (role=tab) "Đăng nhập / Đăng ký" + form nhóm + nút primary 52px ở nửa dưới.
- Input: username `autocapitalize=none autocorrect=off spellcheck=false enterkeyhint=next`, password `current-password`/`new-password` + `passwordrules="minlength: 6; maxlength: 128;"` (khớp backend), display name `autocomplete=name`, mã mời `autocomplete=off`, font ≥17px. Nút mắt toggle trong ô password.
- Lỗi field: vạch đỏ + nhãn đỏ + dòng lỗi dưới group (`role=alert`); lỗi form chung giữ banner. Chuyển tab xoá lỗi nhưng giữ giá trị.
- Busy: đĩa xoay, nút disabled "Đang mở thư viện…", input blur (bàn phím hạ).

### 6.4 Chọn giọng (Voice Picker)
Giao diện chọn giọng khi thêm nội dung:
- **Layout:** 2 cột trên mobile, 3+ cột tablet
- **Chip style:** viền vàng, chữ con, góc gần vuông
- **States:** bình thường, chọn, "Chưa cấu hình" (provider chưa setup key)
- **Preview:** nút ▶ (play icon) bên cạnh mỗi giọng → phát sample text (6 call/user/min limit)
  - Nếu đang download: loading spinner
  - Nếu lỗi: tắt preview, icon ⚠, tooltip "Không phát được"
- **Dismiss:** quay lại, giọng đã chọn lưu ở step confirm

### 6.4.1 Trạng thái xử lý (Processing Progress)
Timeline dọc cho mỗi lần upload: Tải ảnh → Nhận dạng chữ → Chuyển giọng → Sẵn sàng.
- **Thanh tiến độ:** vàng 2px, phần done tô primary
- **Pulse animation:** nháy nhẹ cho "queued" / "processing" (tắt ở `prefers-reduced-motion`)
- **ETA:** "Chờ ~3 phút", reset khi phía sau có activity
- **Toast info:** "Trang 3 đã tải lên" (không modal chặn)
- **Toast error:** "Trang 5 lỗi: ..." + nút thử lại

### 6.4.2 Status Toast
Thông báo trạng thái nhỏ, không đè lên nội dung:
- **Info (upload success):** nền xanh lá, icon ✓, tự tắt 2s
- **Error (upload fail, quota, provider down):** nền đỏ, icon ✕, user dismiss hoặc timeout 4s
- **Vị trí:** dưới topbar reader, cách bottom nav 8px
- **Animation:** slide-in 200ms ease-out, slide-out 150ms

### 6.5 Hoa văn cổ điển Tây Âu (xuyên suốt app)
Hình khối dùng chung ở `web/js/components/ornament-shapes.js` (góc lượn, fleuron) và mask `--lozenge-mask`/`--fleuron-mask` trong `web/css/ornaments.css` — không vẽ hoa văn mới rời rạc. Style của từng control nằm ngay trong file CSS gốc của nó (app/library/reader/camera.css), không đè lớp riêng.

| Vị trí | Xử lý |
|---|---|
| Tiêu đề trang (Thư viện, tên sách, Chụp trang sách) | Playfair + đường kẻ `── ❦ ──` (`.fleuron-rule`, `.header-rule` dưới header) |
| Tiêu đề mục, tiêu đề trong sheet | In hoa La Mã giãn chữ + hairline chạy tới hình thoi (`.section-heading`, `.player-sheet-section h3`) |
| Divider có nhãn (Trang lỗi) | `◆──── NHÃN ────◆` (`.ornament`) |
| Vỏ đĩa (sleeve) | Tỉ lệ 1:1, 5 màu da, khung đôi + 4 góc lượn + 2 fleuron, tên Playfair ở giữa (3 dòng tối đa, co chữ theo độ dài) |
| Đĩa than (disc) | Vinyl đen `#111` + viền mặt 3D, xoay 33⅓ vòng/phút khi phát (chỉ khi `playing`), tắt khi `prefers-reduced-motion` |
| Cần đồng thau (tonearm) | Góc 9.5° → 29.5° theo % tiến độ, chuyên động mượt; lift khi pause, reset khi tab thùng/cue; màu brass hi/mid/lo theo độ sáng |
| Tab thùng | In hoa + icon collapse/expand, sticky khi cuộn, nền `--surface-sunken`, viền vàng 1px |
| Menu chủ đề (pull-down) | Nút segmented "Mọi chủ đề ⌃⌄", dropdown không cuộn ngang, mỗi mục text chủ đề + số sách |
| Segmented control | Tabs in hoa giãn chữ, indicator trượt dưới tab chọn (không nền), focus viền `--gold` |
| Tên kệ | Biển đồng thau viền đôi, dưới kệ vạch đôi 3px |
| Màn đăng nhập | Hero `RecordSleeve` + `VinylDisc`; segmented Đăng nhập/Đăng ký in hoa; tab chọn có gạch đỏ + hình thoi; form nhóm; nút primary 52px |
| Nút primary | Nền đỏ, hairline vàng lồng trong 2px, hình thoi hai bên nhãn |
| Nút secondary / danger | Viền `--gold-soft` (danger: `--danger`) + rule lồng trong mờ |
| Chip | Góc vuông, viền vàng; chip chọn giống nút primary (không hình thoi) |
| Input, select, textarea | Viền `--gold-soft`, bóng lõm nhẹ; focus = viền `--primary` + halo `--gold-faint` |
| Nhãn field | Playfair in hoa `--gold-ink`, số lining |
| Card | Viền `--gold-soft` + rule mờ lồng trong 3px; `OrnateFrame` (góc lượn) chỉ 1 card mỗi màn |
| Banner | Viền màu nhạt; hình thoi đầu dòng khi banner không có icon |
| Bottom nav, mini player, sheet, topbar reader | Vạch đôi vàng ở mép; tab đang mở có hình thoi nằm trên vạch; sheet dùng fleuron thay thanh kéo |
| Nút Chụp, Play, shutter camera | Vành vàng mảnh |
| Thanh tiến độ phát | Rule vàng 2px, phần đã nghe tô `--primary`, con trượt hình thoi |
| Timeline trạng thái | Mốc hình thoi trên sợi chỉ vàng chấm |
| Khung ngắm camera | 4 góc vàng dạng thước ngắm + hairline mờ; thumbnail viền vàng |
| Empty state, lỗi camera | Icon vàng + fleuron rule |
| Reader | Tiêu đề chương (dòng ngắn không dấu câu cuối) Playfair căn giữa; drop cap ở đoạn văn đầu tiên của sách (sau tiêu đề); đoạn đang đọc có vạch vàng 2px bên trái. Không hoa văn khác trong nội dung |

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

**Từ vinyl redesign:**
- **Không gỗ**: thử kệ gỗ + mâm gỗ cho thùng/đĩa → loại (quá sạm, không khớp với ngà + vàng cổ).
- **Không chip row ngang động**: topic menu cũ dùng chip cuộn ngang → chuyển sang segmented pull-down (cố định, dễ lướt).
