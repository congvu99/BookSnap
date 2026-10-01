# Brainstorm: UX quick wins (sau đợt thanh kéo / loading / chuyển động)

Ngày: 2026-10-01 · Trạng thái: **đã duyệt (phương án A)** · Modes: không flag

## Bối cảnh

Đợt trước (`b7640c3`, đã lên main): RangeSlider (xem trước khi kéo, commit khi thả), vòng buffering, thanh tiến trình đỉnh màn hình cho thao tác ghi >150ms, spinner nút bận, route fade-up, sheet trượt lên, reduced-motion.

## Vấn đề còn lại (bằng chứng)

| # | Vấn đề | Bằng chứng |
|---|---|---|
| 1 | Layout shift màn đăng nhập: tab Đăng ký chèn sau `/api/auth/status` | E2E headless: lần bấm đầu hụt 2/2 |
| 2 | Kệ/bookmark chờ server mới đổi trạng thái | `book-status-view.js` toggleShelf, `use-book-bookmarks.js` |
| 3 | Thư viện hiện skeleton mỗi lần mở app | `library-view.js` load() luôn fetch trước |
| 4 | Mở sách chờ book+chunks | `reader-view.js` init (thuộc phương án B, ngoài phạm vi) |

## Phương án đã xét

| | A. Quick wins ✅ | B. A + prefetch + View Transitions | C. A + B + cử chỉ |
|---|---|---|---|
| Effort | ~0,5 ngày | ~1,5 ngày | ~3 ngày |
| Rủi ro | Thấp | TB (fallback, dữ liệu cũ sai hồ sơ) | Cao (xung đột cử chỉ iOS PWA; vibrate không có trên Safari iOS) |

## Giải pháp chốt (A)

1. **Auth không nhảy layout:** giữ chỗ cố định cho segmented control (render khung ẩn/disabled trong lúc chờ status); cache `registration_open` trong localStorage để lần sau hiện đúng ngay; đổi trạng thái chỉ khi khác cache.
2. **Optimistic UI:** kệ (book page + player sheet) và bookmark: đổi UI ngay, gọi API nền; lỗi → rollback + toast "Không lưu được, thử lại"; chống bấm dồn (bỏ qua khi đang có request cùng sách hoặc lấy trạng thái cuối).
3. **Thư viện tức thì (stale-while-revalidate):** lưu danh sách `books` + `continue` gần nhất theo **profile id** (`booksnap:library:{profileId}`), hiện ngay khi mở, fetch nền rồi thay; đổi hồ sơ/đăng xuất không lộ dữ liệu hồ sơ khác (key theo profile, không dùng khi user khác).

Ngoài phạm vi: prefetch, skeleton reader, View Transitions, cử chỉ, haptic.

## Rủi ro

| Risk | L | I | Mitigation |
|---|---|---|---|
| Cache thư viện hiện sách đã xoá/ trạng thái cũ vài trăm ms | M | L | Làm mới ngay sau render; chỉ là hiển thị, mọi thao tác vẫn qua server |
| Cache lẫn hồ sơ | L | M | Key theo profile id; test helper thuần |
| Optimistic lệch server khi lỗi mạng | M | L | Rollback + toast; trạng thái server thắng ở lần poll kế |
| localStorage đầy | L | L | try/catch, bỏ qua cache |

## Tiêu chí nghiệm thu

- Màn đăng nhập: không thay đổi vị trí form sau khi status về (đo `getBoundingClientRect` trước/sau).
- Bấm kệ/bookmark: UI đổi < 50ms; tắt mạng → rollback + toast.
- Mở thư viện lần 2: sách hiện ngay không skeleton; đổi hồ sơ không thấy kệ/tiến độ hồ sơ trước.
- `node --test` + `pytest` xanh; kiểm headless 390px.

## Bước tiếp

Làm trực tiếp bằng `/ck:cook` (phạm vi nhỏ), song song 2–3 agent theo file ownership; merge main khi xanh.
