# Brainstorm — Tiến trình xử lý thông minh + chọn/nghe thử giọng + giọng nam mặc định

**Ngày:** 2026-09-29 · **Mode:** default (không --html/--wiki) · **Trạng thái:** đã duyệt

> **Đã bị thay thế một phần bởi Red Team Review** trong [plan.md](../260929-1636-smart-progress-and-voice-picker/plan.md#red-team-review):
> - Cờ `regenerate` → endpoint `PUT /voice`.
> - **Giữ style prompt cũ**, không đổi.
> - Seal-tail cho mọi thành viên.
> - Bỏ `tail_ready_at`, thêm `chunks.queued`.
> - Preview: single-flight + cache lỗi + không dùng chung limiter.
> - PoC giọng thành Gate 0.
>
> Khi có chỗ mâu thuẫn, plan là nguồn đúng.

## 1. Vấn đề & yêu cầu

- Sau khi chụp xong, user không biết app đang làm gì: timeline chỉ hiện `done/total`, không %, không ETA.
- **Nguyên nhân gốc:** chunk tail chờ `tail_seal_grace_seconds` (90s) trước khi TTS, nhưng API đếm `pending` chung vào `chunks.processing` → client hiện "đang xử lý" 90s trong khi không có gì chạy.
- Thư viện: nhãn "Đang ép đĩa x/y" tĩnh, không tự cập nhật.
- Giọng mặc định `Kore` (nữ). User muốn nam, trầm hơn.
- User muốn chọn giọng + nghe thử lúc tạo sách/upload ảnh.

## 2. Quyết định đã chốt

| # | Quyết định | Lựa chọn |
|---|---|---|
| D1 | Phạm vi UI | Màn tiến trình sau chụp + thư viện tự cập nhật |
| D2 | Giọng mặc định | Gemini `Charon` |
| D3 | Sách cũ | Giữ nguyên giọng (không regenerate) |
| D4 | Bỏ qua chờ 90s | Có — endpoint seal-tail |
| D5 | Nhãn giọng | Map client-side ("Nam · trầm", "Nữ · ấm"…), không đổi contract `/api/voices` |
| D6 | Nghe thử | Endpoint synth câu mẫu cố định + cache disk |
| D7 | Vị trí picker | Bước tạo sách mới + bước "thêm trang vào sách có sẵn". **Bỏ khỏi player-sheet** (chỉ UI; PATCH API giữ nguyên) |
| D8 | Đổi giọng khi thêm trang | Chỉ áp dụng cho đoạn **chưa có audio** (trang mới + tail chưa synth); đoạn đã xong giữ giọng cũ → 1 sách có thể 2 giọng, không tốn quota |
| D9 | Thông báo trang khi upload | 1 ảnh = 1 trang (đã đúng: 1 capture = 1 `seq`). Mỗi trang upload xong → toast "Đã tải trang N ✓"; thumbnail gắn "Trang N"; topbar "Đã tải x/y trang"; lỗi ghi rõ số trang |

## 3. Phương án đã cân nhắc

| Chủ đề | Chọn | Bỏ | Lý do |
|---|---|---|---|
| Realtime | Polling (3s status, 5s library, dừng khi tab ẩn/hết việc) | SSE/WebSocket | App gia đình, 1 replica, polling đã có; SSE overkill |
| Tail-waiting | Server trả field | Client suy luận | Tránh lệch đồng hồ, lệch config grace |
| ETA | Client EMA từ throughput quan sát, hiện khi ≥2 chunk xong | RPM lý thuyết server-side | Server không lưu thời gian synth/chunk; RPM không phản ánh latency Gemini thật. Nhược: reload mất dữ liệu đo |
| % tổng | OCR 30% + TTS 70%, clamp monotonic | % thô | `chunks.total` tăng theo OCR → % tụt lùi |
| Nghe thử | Endpoint + cache | File MP3 tĩnh commit | Luôn khớp style/model hiện tại; không binary trong git. Nhược: lần đầu chờ 5–15s |
| Style prompt | Không chứa giới tính | "giọng nam trầm…" | Prompt là global; sách cũ dùng Kore thêm trang sẽ nhận prompt mâu thuẫn |

## 4. Thiết kế

### 4.1 Backend
- **Config** ([app/config.py](../../app/config.py)): `gemini_tts_voice="Charon"`, `gemini_tts_style="Đọc bằng giọng trầm, ấm, chậm rãi, truyền cảm như người kể chuyện:"`. Cập nhật `.env.example`, README.
- **Summary SQL** ([app/repositories/book_repository.py](../../app/repositories/book_repository.py)): thêm aggregate `SUM(status='pending' AND sealed=0) AS tail_pending`. Serializer thêm vào `chunks`:
  - `tail_waiting: bool` — có tail pending chưa sealed, không có page `uploaded/ocr_processing`.
  - `tail_ready_at: str|null` — `books.updated_at + grace` (ISO).
  - Additive, không phá client cũ.
- **`POST /api/books/{id}/seal-tail`** (chỉ `can_manage`): `UPDATE chunks SET sealed=1 WHERE book_id=? AND status='pending' AND sealed=0`. Conditional update → an toàn đồng thời; page mới OCR sau đó tạo chunk mới (invariant D-3). 204; idempotent.
- **`GET /api/voices/{provider}/{voice}/preview`** (auth):
  - Whitelist voice theo `GEMINI_VOICES`/`AZURE_VOICES` (+ default) → chặn path traversal, 404 nếu không hợp lệ.
  - Câu mẫu cố định server-side (không nhận text client → không đốt quota tùy ý).
  - Cache `DATA_DIR/voice-previews/{sha256(provider,voice,style,model,sample)[:16]}.mp3`; ghi atomic (tmp + rename); lock per-key tránh synth trùng khi 2 request đồng thời.
  - Lỗi quota → 503 + `Retry-After`; provider chưa cấu hình → 409 `provider_unavailable`.
  - `Cache-Control: private, max-age=86400`.
- **PATCH `/api/books/{id}`** thêm `regenerate: bool = true` (mặc định giữ hành vi cũ → không phá contract). `regenerate=false` → `BookRepository.set_voice_for_new_content()`: chỉ `UPDATE books SET tts_provider, tts_voice`, không requeue chunk `done`. Worker vốn copy voice từ book **lúc claim** ([chunk_repository.py claim_next_pending](../../app/repositories/chunk_repository.py)) → chunk pending/waiting_quota/failed-retry tự nhận giọng mới. Log `book_voice_changed_new_content_only`.
- Thêm Gemini voices nam vào `GEMINI_VOICES` nếu cần (vd. `Algenib`, `Iapetus`) — chỉ sau khi PoC nghe thử.

### 4.2 Frontend
- **`voice-labels.js`**: map `{Charon: 'Nam · trầm', Orus: 'Nam · chắc', Kore: 'Nữ · ấm', …}`; fallback tên gốc.
- **`voice-picker.js`** (component dùng chung): chip giọng + nút ▶; states `idle|loading|playing|error`; 1 `Audio` duy nhất (dừng bản đang phát khi chọn bản khác); hủy khi unmount.
- **capture-view** bước `choose`:
  - Sách mới: `VoicePicker` (default từ `/api/voices`) → `tts_provider/tts_voice` trong `booksApi.create`.
  - Sách có sẵn: chọn sách → `VoicePicker` default = giọng hiện tại của sách; chọn khác → cảnh báo "Trang mới đọc bằng giọng X, trang cũ giữ giọng Y" → PATCH `regenerate:false` **trước** khi mở camera (tránh page mới bị claim với giọng cũ).
- **capture-view** màn camera:
  - Thumbnail gắn nhãn "Trang N" (`seq + 1`).
  - Toast ngắn "Đã tải trang N ✓" + rung nhẹ mỗi khi 1 item chuyển `done` (gom toast nếu nhiều trang xong liền nhau: "Đã tải trang 4–6 ✓").
  - Topbar: "Đã tải x/y trang · đang tải trang N".
  - Lỗi: "Trang N lỗi, chạm để thử lại".
  - `aria-live="polite"` cho toast.
- **player-sheet**: **bỏ** mục chọn giọng; thay bằng dòng chỉ đọc "Giọng: Charon (Nam · trầm)" + gợi ý "Đổi giọng khi thêm trang mới".
- **book-status-view**:
  - Thanh % tổng + dòng trạng thái ngữ cảnh (OCR trang x/y · TTS đoạn x/y · còn ~N phút · chờ quota đến HH:MM · "Đang chờ thêm trang… đoạn cuối đọc sau 0:47").
  - Nút **"Xong rồi, đọc luôn"** khi `tail_waiting` → gọi seal-tail, refetch.
  - CTA "Nghe ngay · N phút đã sẵn sàng" khi `chunks.done ≥ 1`.
  - Hoàn tất → toast + CTA `#/listen/:id`, không auto-navigate.
  - Poll dừng khi `document.hidden`, resume khi visible.
  - Danh sách trang: mỗi trang 1 dòng "Trang N" + trạng thái (đã tải · đang nhận dạng · xong · lỗi).
- **progress-timeline**: pulse/spinner bước active + thanh con/bước.
- **library-view / library-crate**: poll list 5s khi có sách `processing|waiting_quota` và tab visible; thanh tiến độ mảnh dưới sleeve; animation đĩa trượt ra khi chuyển `ready`.
- **sw.js**: bump cache version.

## 5. Rủi ro & vận hành

- **Railway env `GEMINI_TTS_VOICE`** nếu đã set `Kore` sẽ override default code → phải sửa env prod.
- **Chất lượng tiếng Việt của Charon chưa kiểm chứng** → chạy `scripts/voice_poc.py` (key thật) trước merge.
- Preview lần đầu mỗi giọng tốn 1 call TTS, cạnh tranh RPM với worker (`GEMINI_TTS_RPM=10`) → dùng chung rate limiter của provider, không bypass.
- Cache preview tăng disk rất nhỏ (~10 file × ~60KB); đổi style/model → key mới, file cũ mồ côi → cleanup_worker có thể dọn file >30 ngày không truy cập (tùy chọn).
- ETA sai lệch lúc đầu → chỉ hiện sau ≥2 mẫu, ghi "khoảng".
- Seal-tail sớm khi user thực ra còn chụp tiếp: chỉ ảnh hưởng ranh giới chunk (chunk ngắn hơn), không mất/đảo text.
- Bỏ đổi giọng khỏi cài đặt → sách đã xong không sửa giọng được qua UI; còn đường PATCH API thủ công.
- Sách 2 giọng: chuyển giọng giữa chừng khi nghe. Chấp nhận theo quyết định D8. Chunk-editor sửa text đoạn đã xong → synth lại bằng giọng **hiện tại** của sách (có thể khác giọng gốc đoạn đó) — ghi nhận, không xử lý vòng này.
- Log: `book_tail_sealed_by_user book_id=… user_id=…`, `voice_preview_synth provider voice cache_hit ms`.

## 6. Tiêu chí nghiệm thu

1. Sách mới không chọn gì → `tts_voice=Charon`; sách cũ giữ `Kore`, không regenerate.
2. Bước tạo sách: chọn giọng, ▶ phát được, loading hiện khi synth lần đầu; lần 2 phát tức thì (cache hit).
3. Voice không whitelist → 404; chưa đăng nhập → 401; không có tham số text từ client.
4. Màn trạng thái: % không bao giờ giảm; trong 90s grace hiện đếm ngược, không hiện "đang xử lý".
5. "Xong rồi, đọc luôn" → chunk tail được TTS ngay (không chờ grace); gọi 2 lần không lỗi.
6. Thư viện tự cập nhật trạng thái sách đang xử lý, ngừng poll khi hết sách xử lý hoặc tab ẩn.
7. Thêm trang vào sách có sẵn với giọng khác → chunk `done` giữ `voice` cũ (không requeue); chunk mới có `voice` mới. PATCH không có `regenerate` → hành vi cũ (regenerate toàn bộ).
8. Màn camera: mỗi ảnh = 1 trang; mỗi trang upload xong có toast ghi đúng số trang; thumbnail có "Trang N".
9. Player-sheet không còn mục đổi giọng.
10. Test pytest mới (viết trước — TDD): field `tail_waiting/tail_ready_at`, seal-tail (quyền, idempotent, đồng thời với chunker), preview (whitelist, cache hit, quota error), PATCH `regenerate=false` (không requeue, claim sau lấy giọng mới) — fake provider.

## 7. Ngoài phạm vi
UX bước chọn sách có sẵn (ngoài picker giọng); đổi giọng hàng loạt sách cũ; SSE/WebSocket; server-side ETA; giữ giọng gốc khi sửa text đoạn đã xong.

## 8. Bước tiếp theo
Plan: [plans/260929-1636-smart-progress-and-voice-picker/plan.md](../260929-1636-smart-progress-and-voice-picker/plan.md).

Phát hiện thêm khi lập plan:
- Race `replace_tail` ↔ seal-tail: câu DELETE thiếu guard `sealed=0` → sửa ở phase 1.
- Thêm `tail_wait_seconds` do server tính để đếm ngược không phụ thuộc đồng hồ client.
- Validate voice theo whitelist khi create/patch (phase 2).

`/ck:plan --tdd` với báo cáo này. Phases gợi ý: (1) backend config + summary fields + seal-tail, (2) PATCH `regenerate=false`, (3) voice preview endpoint + cache, (4) voice-picker + capture (sách mới/có sẵn) + bỏ khỏi player-sheet, (5) thông báo trang trên màn camera, (6) status view + timeline + danh sách trang, (7) library polling, (8) docs/env/SW bump + PoC giọng.

## Câu hỏi chưa giải quyết
- Railway prod hiện có set `GEMINI_TTS_VOICE` không? (cần kiểm tra env)
- Câu mẫu nghe thử: dùng câu cố định chung hay đoạn đầu tiên của sách? (đề xuất: câu cố định — sách chưa OCR lúc tạo)
- Có muốn bổ sung giọng nam Gemini khác (`Algenib`, `Iapetus`) sau PoC không?
