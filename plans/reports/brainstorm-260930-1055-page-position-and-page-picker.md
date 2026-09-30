# Brainstorm: biết đang nghe tới trang nào + chọn trang để nghe tiếp

- Date: 2026-09-30
- Status: approved (phương án A)
- Modes: none

## Problem

User không biết đang nghe tới trang sách nào, không nhảy được tới một trang cụ thể. App hiện chỉ biết "đoạn" (chunk ~1200 ký tự): `Đoạn X/Y` trên màn đĩa than, bấm đoạn ở màn đọc, seek theo tổng thời lượng.

Gốc rễ: chunk không có quan hệ với page. `chunker_worker._chunk_book` nối text các trang thành `carry`, `text_chunker.chunk_text` cắt lại theo câu → ranh giới đoạn ≠ ranh giới trang; 1 đoạn có thể vắt 2 trang; tail bị cắt lại khi thêm trang.

## Requirements (chốt với user)

| Mục | Quyết định |
|---|---|
| Đơn vị "trang" | Trang sách đã chụp: ảnh thứ N = `pages.seq + 1` |
| Hiện vị trí | Màn nghe (NowPlayingPanel): `Mặt A · Trang X/N` thay cho `Đoạn X/Y`; MiniPlayer màn đọc: chip `Tr. X/N` |
| Chọn trang | Bottom sheet danh sách "Trang N — câu mở đầu…", đánh dấu + auto-scroll trang hiện tại, bấm = phát |
| Out of scope | Thẻ thư viện, vạch "Trang N" trong màn đọc, ô nhập số trang, số trang in trên sách (OCR), thumbnail (ảnh đã xoá sau OCR) |
| Constraint | Không migration DB; không đổi chunker/TTS; `progress` giữ `(chunk_seq, offset_ms)`; PWA không build step; reader-view.js đã 425 dòng → logic ra module riêng |

### Acceptance criteria

1. `GET /api/books/{id}/page-anchors` trả mỗi trang `{page_seq, status, chunk_seq|null, char_offset, excerpt}`; trang chưa chunk / lỗi / discarded → `chunk_seq=null`. Quyền như `/chunks` (401 chưa login, 404 sách không tồn tại).
2. Anchor chính xác tuyệt đối (so theo ký tự không-khoảng-trắng) khi text chunk chưa bị sửa; test cả trang `continues` (nối giữa câu), trang vắt qua 2 đoạn, trang ngắn nằm gọn trong 1 đoạn, trang discarded, trang rỗng.
3. Chọn trang → phát từ `char_offset/len × duration_ms − 1500ms` (clamp ≥0); đoạn chưa có `duration_ms` → phát từ 0.
4. `Trang X/N` cập nhật theo vị trí phát (kể cả khi đoạn vắt qua ranh giới trang); N = tổng số trang (kể cả đã bỏ, để nhãn `seq+1` không vượt N — chốt ở plan D3).
5. Anchor refetch khi poll thấy chunks đổi (số lượng / text); có trong bản offline.
6. Sách cũ dùng được ngay, không regenerate audio.

## Key finding

`text_chunker` chỉ chuẩn hoá khoảng trắng (strip dòng, join bằng `" "`/`"\n"`); mọi ký tự không-khoảng-trắng giữ nguyên thứ tự. `pages.text` không bị xoá sau chunk. → Đếm cộng dồn ký tự non-whitespace của pages (bỏ discarded) và của chunks cho mapping page→(chunk_seq, char_offset) tất định.

## Approaches

| # | Phương án | Pros | Cons | Verdict |
|---|---|---|---|---|
| A | Tính anchor on-read (pure fn + endpoint) | Không migration, sách cũ chạy ngay, không đụng pipeline, dễ test | O(tổng text)/request — <1MB với sách vài trăm trang, không đáng kể | **Chọn** |
| B | Lưu anchor vào `pages` lúc chunk | Tính 1 lần | Migration + backfill; `replace_tail` phải tính lại anchor trang trong tail, dễ race với TTS claim (`TailBusyError`) | Loại |
| C | Ép cắt đoạn tại ranh giới trang | 1 đoạn = 1 trang | Cắt giữa câu khi `continues` → ngắt giọng sai; regenerate sách cũ tốn quota | Loại |

## Final design

### Backend

- `app/page_anchors.py` (pure, không import DB): `compute_page_anchors(pages, chunks) -> list[PageAnchor]`.
  - Duyệt pages theo seq; trang `ocr_done` + `chunked` + text non-empty mới có anchor; tổng non-ws cộng dồn → tìm chunk có cumulative vượt mốc → `char_offset` = vị trí ký tự thực (kể cả whitespace) trong `chunk.text`.
  - Chỉ duyệt trang contiguous đã chunk (cùng invariant thứ tự như chunker); trang sau trang bị chặn → `chunk_seq=null`.
  - Nếu tổng non-ws của pages vượt chunks (chunk bị sửa ngắn đi) → clamp vào cuối chunk cuối.
  - `excerpt`: ~80 ký tự đầu trang, whitespace gộp.
- Route trong `app/api/books_routes.py`: `GET /books/{book_id}/page-anchors`; lấy pages + chunks qua repo sẵn có; serializer `page_anchor_out`.
- Tests pytest: pure fn (các case ở AC2) + route (auth, 404, shape).

### Frontend

- `web/js/page-position.js` (pure, `node --test`):
  - `seekForPage(anchor, chunk)` → `{ seq, offsetMs }`.
  - `pageAt(anchors, chunks, seq, timeMs, durationMs)` → `{ index, total }` (char estimate = `timeMs/durationMs × len`).
- `web/js/use-page-anchors.js`: fetch on open; refetch khi chunks signature (count + tổng length) đổi trong poll; đọc/ghi kèm offline cache (`offline-book-cache.js`).
- `web/js/components/page-picker-sheet.js`: sheet list, trang hiện tại `aria-current`, disabled + nhãn "Chưa sẵn sàng"/"Đã bỏ"/"Lỗi".
- `api-client.js`: `booksApi.pageAnchors(id)`.
- `now-playing-panel.js`: eyebrow `Mặt A · Trang X/N` là button mở picker. `mini-player.js`: chip `Tr. X/N`.
- `reader-view.js`: chỉ nối hook + state `pickerOpen` + `loadAt`.
- `web/sw.js`: bump `SHELL_CACHE` (file JS mới).

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Seek giữa đoạn là ước lượng tuyến tính | Lệch ±2–3s trên đoạn 60–90s | Lùi 1.5s; timestamp chính xác cần TTS word timing (Gemini không có) — out of scope |
| ChunkEditor sửa text → drift | Lệch vài ký tự | Clamp; chấp nhận. Nếu cần sau: re-align bằng tìm snippet đầu trang |
| Tail re-chunk khi thêm trang | Anchor cũ sai | Tính on-read + refetch theo signature chunks |
| Offline | Không có anchor → không hiện trang | Lưu anchor vào offline cache; thiếu thì fallback hiện `Đoạn X/Y` |
| Sách lớn | CPU mỗi request | O(n) tuyến tính, không cache; đo nếu sách >1000 trang |

## Security

Endpoint chỉ đọc, cùng auth/ownership rules như `/chunks`; `excerpt` là text user đã có quyền đọc. Render qua htm (auto-escape).

## Success metrics

- Chọn trang N → câu đầu trang N nghe được trong ≤3s kể từ lúc phát.
- `Trang X/N` khớp trang sách thật khi đối chiếu tay trên 1 sách ≥20 trang có trang `continues`.
- Toàn bộ pytest + node test xanh.

## Next steps

`/ck:plan` với report này. Thứ tự: pure fn + tests → endpoint → `page-position.js` + tests → hook/sheet/UI → sw bump + docs (`system-architecture.md` API list, `codebase-summary.md`).

## Unresolved questions

- Không có.
