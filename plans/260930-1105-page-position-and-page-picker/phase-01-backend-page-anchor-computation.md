---
phase: 1
title: Backend page anchor computation
status: completed
priority: P2
dependencies: []
---

# Phase 1: Backend page anchor computation

## Overview
Pure function map mỗi trang → (chunk_seq, chunk_frac) bằng đếm ký tự non-whitespace cộng dồn. Không import DB/FastAPI.

## Requirements
- Functional: đúng các case ở AC2/AC3 của [plan.md](./plan.md).
- Non-functional: O(tổng text), không cấp phát chuỗi lớn thừa; tất định.

## Architecture

Invariant nền (xác minh ở [text_chunker.py](../../app/pipeline/text_chunker.py) + [chunker_worker.py:28-75](../../app/pipeline/chunker_worker.py#L28-L75)):
- `carry` = text các trang `ocr_done` theo seq, nối bằng `" "`/`"\n\n"`; `chunk_text` chỉ strip/gộp khoảng trắng → dãy ký tự non-ws của `concat(chunks.text)` == dãy non-ws của `concat(pages.text)` theo thứ tự (khi chưa sửa chunk).
- Chunker chỉ đi qua các seq liên tục từ 0; trang chưa resolved chặn mọi trang sau.
- `replace_tail` chạy **trước** `mark_chunked` → có khoảnh khắc chunk đã chứa text nhưng page `chunked=0` → trang đó `pending`, không sai số.

```python
# app/page_anchors.py
@dataclass(frozen=True)
class PageAnchor:
    page_seq: int
    status: Literal["ready", "pending", "failed", "discarded", "empty"]
    chunk_seq: int | None
    chunk_frac: float | None   # 0..1, round 4
    excerpt: str               # ~80 ký tự đầu trang, whitespace gộp, "" nếu không có text

class _PageLike(Protocol): seq: int; status: str; text: str | None; chunked: int
class _ChunkLike(Protocol): seq: int; text: str

def compute_page_anchors(pages: Sequence[_PageLike], chunks: Sequence[_ChunkLike]) -> list[PageAnchor]
```

Thuật toán:
1. Sort pages theo seq, chunks theo seq.
2. Duyệt pages; `blocked=False`. Với mỗi page:
   - Nếu `blocked` hoặc seq không liên tục → `pending` (hoặc `failed` nếu status failed) — không anchor.
   - `discarded` → `discarded`, tiếp tục (không cộng dồn).
   - `failed` → `failed`, `blocked=True`.
   - `ocr_done` và `chunked` : `n = non_ws(text)`; `n == 0` → `empty`; ngược lại ghi mốc `start = cum`, `cum += n` → cần resolve.
   - Còn lại (uploaded/ocr_processing/ocr_done chưa chunked) → `pending`, `blocked=True`.
3. Resolve mốc bằng một lần quét chunks (two-pointer, mốc tăng dần): tìm chunk có `c_start ≤ start < c_start + non_ws(chunk)`; trong chunk tìm index thực của ký tự non-ws thứ `start - c_start` → `frac = idx / len(text)`.
4. Mốc ≥ tổng non-ws của chunks (chunk bị sửa ngắn) → clamp về chunk cuối, `frac = 0.0` (phát từ đầu đoạn cuối an toàn hơn phát sát cuối rồi hết). Không có chunk nào → `pending`.
5. `excerpt`: `" ".join(text.split())[:80]`, cắt ở ranh giới từ nếu dài hơn, thêm `…`.

## Related Code Files
- Create: `app/page_anchors.py`
- Create: `tests/test_page_anchors.py`

## Implementation Steps

**Tests Before** — `tests/test_text_chunker.py` hiện có phải xanh. Thêm 1 test khoá invariant mapping dựa vào:
- `test_chunk_text_preserves_non_whitespace_sequence`: với text nhiều đoạn, câu dài >1500 ký tự (đi qua `_split_long_sentence`), `"".join(concat(chunks).split()) == "".join(text.split())`. Nếu test này đỏ → dừng, D1 sai.

**Tests New** (`tests/test_page_anchors.py`, dựng page/chunk bằng `SimpleNamespace`, chunk sinh bằng `text_chunker.chunk_text` trên chuỗi nối như chunker thật):
1. 1 trang, 1 đoạn → `ready`, `chunk_seq=0`, `frac=0.0`.
2. 3 trang ngắn gộp 1 đoạn → trang 2, 3 cùng `chunk_seq=0`, frac tăng dần, bằng đúng `text.index(first word)/len`.
3. Trang dài vắt 2 đoạn → trang kế tiếp bắt đầu ở đoạn 1 với frac đúng.
4. Trang `continues` (nối giữa câu bằng `" "`) → frac trỏ đúng ký tự đầu trang sau.
5. Trang `discarded` ở giữa → `discarded`, các trang sau vẫn đúng.
6. Trang `ocr_done` text rỗng/chỉ khoảng trắng → `empty`.
7. Trang `failed` → `failed`; mọi trang sau → `pending` với `chunk_seq=None`.
8. Trang `ocr_done` chưa `chunked` (khoảnh khắc giữa `replace_tail` và `mark_chunked`) → `pending`.
9. Chunk bị sửa ngắn (bỏ nửa sau) → trang cuối clamp về chunk cuối `frac=0.0`, không exception.
10. Không có chunk nào, trang đã chunked → `pending`.
11. Excerpt: gộp whitespace, ≤ 81 ký tự, kết thúc `…` khi bị cắt.
12. Tail re-chunk: chunk trên [p0,p1] rồi chunk lại [p0,p1,p2] (mô phỏng replace_tail) → anchor p0/p1 vẫn đúng với list chunk mới.

**Implement** `app/page_anchors.py` theo Architecture; helper `_non_ws_len(s)`, `_index_of_nth_non_ws(s, n)`.

**Regression Gate**: `.venv/Scripts/python -m pytest -q` xanh toàn bộ.

## Success Criteria
- [ ] Invariant test xanh (khẳng định D1).
- [ ] 12 case mới xanh.
- [ ] `page_anchors.py` không import `app.db`/`fastapi`; < 120 dòng.

## Risk Assessment
- OCR text chứa ký tự mà `str.split()`/`isspace()` coi là khoảng trắng khác nhau (NBSP `\xa0`, zero-width). `text_chunker` dùng `strip()`/`splitlines()`/`isspace()` → dùng **cùng** định nghĩa `str.isspace()` cho đếm. ZWSP (`​`) không phải space ở cả hai → nhất quán. Thêm case NBSP vào test 4.
- `splitlines()` tách cả ` `, `\x0c`… — đều `isspace()` → nhất quán.
