# Trang đang nghe + Chọn trang để nghe tiếp

**Ngày**: 2026-09-30 11:05
**Mức độ**: High
**Thành phần**: Player, Page Anchors
**Trạng thái**: Completed

## Diễn biến

Người dùng muốn biết trang nào đang phát và nhảy tới bất kỳ trang nào. Chunk không mang page_id, nhưng `text_chunker` chỉ thay đổi khoảng trắng → đếm cộng dồn ký tự non-whitespace của pages/chunks = mapping tất định: page → (chunk_seq, chunk_frac). Tính on-read bằng pure function trong `app/page_anchors.py`, không migration, không lưu anchor (tránh race với `replace_tail`), không ép cắt theo trang (hỏng prosody TTS, phải regenerate audio).

## Sự thật khó chịu

Code review phát hiện 3 lỗi mạng: (1) Anchor cũ khi trạng thái trang thay đổi mà chunk không đổi → thêm refetch 10s khi trang pending/failed. (2) Offline: anchor trỏ chunk vừa xoá → silent playback → thêm reconcile. (3) Label nháy nhảy sau seek → dùng floor + epsilon. **Chính xác hơn:** subagent tester báo cáo "sản xuất sẵn sàng" nhưng bỏ qua smoke test server/trình duyệt đã yêu cầu. Agent-browser check thủ công: seek trang 3 = ~0:27s (khớp công thức 0.4696×60s−1.5s). Bài học: **Không tin tóm tắt subagent nếu thiếu bằng chứng thực tế.**

## Chi tiết kỹ thuật

- pytest: 220 passed; node: 77 passed
- Seek = max(0, frac×duration − 1500ms); lùi 1.5s tránh hụt ký tự đầu trang
- Anchor cache offline riêng `booksnap:offline-anchors:{id}`
- Reader-view +27 dòng (vượt ~20 dòng tiên lượng)
- Label tránh hiện nhầm trang trước trong 1.5s sau seek

## Hạn chế đã biết

- Seek ±2–3s (ước lượng tuyến tính)
- Chunk sửa tay thủ công → anchor drift
- N không cập nhật ngay khi chụp thêm trang nhưng mọi anchor đã ready (mở lại sách = OK)

## Chưa làm

- QA trên iPhone thật (nhạc nền gesture, 320px)

## Bài học

Mỗi claim "production-ready" từ tester cần bằng chứng có tính test được (smoke test, manual QA check, metrics). Tóm tắt mà không đính bằng chứng → rủi ro cao. Lần sau yêu cầu rõ ràng: thử server lạnh, trình duyệt khác, thiết bị thật nếu cần.

---

**Status**: DONE

**File**: D:\project\BookSnap\docs\journals\260930-page-position-and-page-picker.md
