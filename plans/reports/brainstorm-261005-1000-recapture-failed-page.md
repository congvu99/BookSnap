# Brainstorm: Chụp lại trang lỗi (giữ nguyên số trang)

Ngày: 2026-10-05 · Trạng thái: **đã duyệt** · Flags: không

## Vấn đề
Trang OCR lỗi → không upload lại được đúng trang đó để xử lý lại mà không phá thứ tự.

Nguyên nhân gốc (đã kiểm code):
- `pages` có `UNIQUE(book_id, seq)` (`app/db.py:73`) → upload lại cùng seq bị `409 page_seq_taken` (`app/api/pages_routes.py:64`).
- `Thử lại` chỉ OCR lại **ảnh cũ** (vô ích nếu ảnh mờ/lệch); sau `failed_image_ttl_hours=24` ảnh bị `cleanup_worker` xoá → Thử lại bị từ chối.
- `Bỏ trang` → `discarded`, seq vẫn bị chiếm, nội dung mất vĩnh viễn.

## Yêu cầu chốt
- **Output**: nút "Chụp lại" trên hàng trang Lỗi (màn trạng thái sách) → camera hoặc chọn file → ảnh mới thay cho đúng trang đó → OCR lại → nối vào audio đúng vị trí.
- **Acceptance**: seq không đổi; trang sau tiếp tục xử lý đúng thứ tự; ảnh cũ bị xoá; trang không ở `failed` → 409; ảnh >5MB/sai định dạng bị chặn (client nén trước).
- **Scope**: chỉ trang `failed` (lỗi OCR).
- **Out of scope**: khôi phục trang `discarded`; chụp lại trang đã `ocr_done` nhưng chữ sai (dùng sửa chữ của đoạn); nút thử lại đoạn TTS ở màn trạng thái.
- **Constraints**: không migration, không đổi API cũ, PWA không build step, bump `SHELL_CACHE`.

## Lỗi chuyển giọng (TTS) — không thuộc tính năng này
TTS lỗi ở tầng **chunk** (ghép từ nhiều trang, ảnh đã xoá), nguyên nhân là provider/mạng/quota, không phải ảnh. Đã có: `POST /chunks/{id}/retry` (nút ở reader) + `PATCH /chunks/{id}` sửa chữ. Không ảnh hưởng thứ tự.

## Phương án đã xét
| PA | Công sức | Rủi ro | Kết luận |
|---|---|---|---|
| A. Endpoint `POST /pages/{id}/image` thay ảnh trang failed | 0.5–1 ngày | Thấp | **Chọn** |
| B. `upload_page` upsert khi seq đang failed | 0.5 ngày | TB | Loại: lẫn với `reassignSeq` của upload queue, ghi đè ngầm |
| C. Xoá hàng failed + upload thường | 0.5 ngày | TB | Loại: 2 request không atomic |
| D. A + khôi phục `discarded` | +2–3 ngày | Cao | Loại: phải chèn chunk giữa sách, ảnh hưởng tiến độ/bookmark theo chunk seq |

## Giải pháp
**Vì sao an toàn về thứ tự**: chunker (`app/pipeline/chunker_worker.py:36-48`) dừng ở trang `failed` đầu tiên → không trang nào sau nó đã thành chunk. Đổi ảnh + đưa về `uploaded` → OCR → chunker tiếp tục từ đúng seq.

Backend:
- Tách helper validate ảnh (size + sniff MIME) từ `upload_page`, dùng chung.
- `PageRepository.replace_failed_image(page_id, path, mime) -> str | None` (trả old path; None nếu không failed): 1 transaction, `UPDATE … SET image_path, image_mime, status='uploaded', error=NULL, attempts=0, updated_at WHERE id=? AND status='failed'`.
- Route: ghi file tmp → repo → thất bại thì xoá file mới, 409 `page_not_replaceable`; thành công thì xoá file cũ, `books.touch`, `worker.wake()`, trả `page_out`. Log `page_image_replaced`.

Frontend:
- `book-status-view.js` hàng failed: `Thử lại` | `Chụp lại` | `Bỏ trang này`.
- Sheet "Chụp lại Trang N": `<input type=file accept=image/* capture=environment>` + input chọn file.
- Tách logic nén JPEG từ `camera-capture.js` thành helper (downscale + JPEG quality) dùng chung; gửi qua `pagesApi.replaceImage(pageId, blob)`.
- Không tái dùng `capture-view` (luồng batch + queue + reassignSeq).
- Bump `SHELL_CACHE` trong `web/sw.js`.

## Rủi ro
| Rủi ro | L | I | Giảm thiểu |
|---|---|---|---|
| Race với worker claim | L | M | Điều kiện `status='failed'` trong UPDATE → 409 |
| File ảnh mồ côi | M | L | Xoá sau commit; cleanup orphan sẵn có |
| Ảnh iPhone >5MB / HEIC | M | M | Nén qua canvas → JPEG trước khi gửi |
| Chụp nhầm trang | M | M | Tiêu đề sheet ghi rõ "Trang N" |

## Kiểm thử
- pytest: failed→uploaded giữ seq; non-failed→409; 413/415; ảnh cũ bị xoá; chunker ghép N rồi N+1 đúng thứ tự sau khi thay ảnh trang N.
- node test cho helper nén (nếu tách thành module thuần).
- Thủ công trên iPhone Safari: camera + chọn ảnh thư viện.

## Bước tiếp theo
`/ck:plan` với báo cáo này.

## Câu hỏi chưa giải quyết
- Không có.
