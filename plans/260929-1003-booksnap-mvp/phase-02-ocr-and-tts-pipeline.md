---
phase: 2
title: "Pipeline OCR và TTS"
status: in-progress
priority: P1
dependencies: [1]
---

# Phase 2: Pipeline OCR và TTS

## Overview
Worker asyncio trong process: ảnh trang → Gemini OCR → ghép & tách đoạn → TTS song song có giới hạn → MP3 trên Volume. Mỗi sách 1 provider+voice cố định (không tự fallback), chờ quota khi bị 429, retry, resume khi restart.
<!-- Updated: Validation Session 1 - bỏ auto-fallback, thêm waiting_quota -->

## Requirements
- Functional: OCR giữ đúng dấu tiếng Việt, bỏ số trang/header/footer; ghép đoạn văn bị ngắt qua trang; chunk 1000–1500 ký tự không cắt giữa câu; TTS theo provider+voice của sách (Gemini mặc định, Azure tuỳ chọn); hết quota → `waiting_quota` rồi tự chạy tiếp; sửa text 1 đoạn → sinh lại audio đoạn đó.
- Non-functional: concurrency cấu hình (mặc định OCR 2, TTS 2); retry backoff mũ tối đa 3 lần/provider; restart không mất việc; không gọi lại API cho chunk đã có audio cùng hash.

## Architecture

```
app/pipeline/
  worker.py              # vòng lặp: claim việc từ DB → chạy trong Semaphore → cập nhật trạng thái
  ocr_provider.py        # Protocol OcrProvider.extract(image: bytes) -> PageText
  ocr_gemini.py          # google-genai, response JSON schema
  text_chunker.py        # pure function, test kỹ
  tts_provider.py        # Protocol + TtsError(retryable: bool, quota: bool)
  tts_gemini.py          # PCM 24kHz s16le mono → MP3 (audio_encoding)
  tts_azure.py           # REST SSML, output audio-24khz-48kbitrate-mono-mp3
  tts_router.py          # lấy provider theo book.tts_provider; phân loại lỗi → retry / waiting_quota / failed
  audio_encoding.py      # lameenc PCM→MP3, tính duration_ms
```

**Contracts:**
```python
class OcrProvider(Protocol):
    async def extract(self, image: bytes, mime: str) -> PageText: ...
# PageText: paragraphs: list[str]; continues_on_next_page: bool

class TtsProvider(Protocol):
    name: str
    async def synthesize(self, text: str, voice: str) -> SynthResult: ...
# SynthResult: mp3: bytes; duration_ms: int
```

**Luồng:**
1. Page `uploaded` → `ocr_processing` → OCR → lưu `text`, `continues` → xoá ảnh → `ocr_done`.
2. Chunker chạy lại cho **phần đuôi** sách mỗi khi có trang `ocr_done` liên tiếp theo `seq` (không chunk khi còn trang trước đó chưa xong, để không đảo thứ tự). Chunk đã `done` không bị cắt lại; chỉ chunk cuối còn mở có thể được nối thêm.
3. Chunk `pending` → `processing` → TtsRouter → ghi `DATA_DIR/library/{book_id}/{seq:05d}-{hash8}.mp3` → `done`.
4. Startup: mọi `*_processing` → quay về trạng thái chờ tương ứng (resume).

**Chunker quy tắc:** ghép paragraph liên trang khi `continues=true`; tách câu theo `. ! ? … : ;` + xuống dòng, gộp câu đến ~1200 ký tự (min 400, max 1500); câu dài > 1500 cắt tại dấu phẩy gần nhất.

**Prompt OCR (tóm tắt):** "Trích nguyên văn nội dung chính của trang sách tiếng Việt. Giữ nguyên dấu, chính tả. Bỏ số trang, tiêu đề chạy, chú thích lề. Nối các dòng bị ngắt trong cùng đoạn. Trả JSON {paragraphs, continues_on_next_page}." Không cho model sửa/diễn giải nội dung.

**Prompt/style TTS Gemini:** cố định 1 voice + style prompt ("Giọng kể chuyện ấm, chậm rãi, truyền cảm") trong config để giọng nhất quán giữa các đoạn.

## Related Code Files
- Create: `app/pipeline/*.py`, `scripts/voice_poc.py`, `tests/test_text_chunker.py`, `tests/test_tts_router.py`, `tests/test_worker_resume.py`
- Modify: `app/main.py` (lifespan start/stop worker), `app/config.py`, `app/api/*` (PATCH/retry kích hoạt lại)

## Implementation Steps
1. **PoC gate (0.5 ngày):** `scripts/voice_poc.py` — 5 ảnh sách thật → OCR → cùng 1 đoạn qua 3–4 voice Gemini + Azure HoaiMy/NamMinh → xuất MP3. **User nghe và chốt voice + style prompt.** Đồng thời ghi lại quota thực tế (RPM/RPD) vào `docs/`.
2. `text_chunker.py` + test (câu dài, đoạn liên trang, trang rỗng, chỉ tiêu đề, ký tự đặc biệt/ngoặc kép Việt).
3. `ocr_gemini.py` với structured JSON output; ảnh > 2000px đã được client resize.
4. `tts_gemini.py`, `tts_azure.py`, `audio_encoding.py`; `tts_router.py` phân loại lỗi: 429/quota → chunk `waiting_quota`, `not_before` = `Retry-After` nếu có, không thì +1h (RPD reset: thử lại mỗi giờ); 5xx/timeout → retry backoff (2s, 8s, 30s) rồi `failed`; 4xx khác → `failed`. Khi 1 chunk bị quota, tạm dừng mọi chunk cùng provider đến `not_before` (tránh đốt request).
5. `worker.py`: poll DB 2s (hoặc `asyncio.Event` đánh thức khi có upload); semaphores; claim nguyên tử (`UPDATE ... WHERE status='pending' RETURNING`).
6. Rate limit mềm theo provider (token bucket theo RPM trong config).
7. Nối lifespan; test resume bằng cách giả lập crash.
8. Log có cấu trúc: `page_id/chunk_id, provider, latency_ms, chars, outcome` — không log text đầy đủ.

## Success Criteria
- [ ] PoC: user đã chọn voice; quota thực tế được ghi lại. — *chưa verify: cần GEMINI/AZURE key thật; `scripts/voice_poc.py` đã sẵn*
- [x] Test chunker pass mọi edge case trên; không chunk nào > 1500 hoặc cắt giữa từ.
- [x] Test router: Gemini 429 → chunk `waiting_quota` + provider tạm dừng, **không** gọi Azure; tới `not_before` tự chạy lại; 5xx 3 lần → `failed` với lỗi rõ ràng.
- [ ] 5 trang thật → audio hoàn tất end-to-end; kill process giữa chừng → chạy lại hoàn tất, không trùng file. — *chưa verify: đã pass với fake provider (`tests/test_pipeline_end_to_end.py`); còn chạy với API thật*
- [x] Ảnh tạm bị xoá sau OCR thành công.

## Risk Assessment
| Rủi ro | L | I | Giảm thiểu |
|---|---|---|---|
| OCR "sửa" hoặc tóm tắt nội dung | M | H | Prompt nghiêm ngặt, temperature 0, cho phép sửa tay trong reader |
| Hết quota làm sách chậm hoàn thành | M | L | Tải ~200K ký tự/tháng nằm xa dưới quota; UI hiện thời điểm dự kiến; user có thể đổi cả sách sang Azure |
| Gemini TTS preview đổi tên/giới hạn | H | M | Model name trong env; PoC ghi lại quota |
| Gemini TTS đọc sai số/viết tắt | M | L | Chấp nhận ở MVP; sửa text đoạn nếu cần |
| Đảo thứ tự đoạn khi trang upload lệch | L | H | Chỉ chunk khi mọi trang `seq` nhỏ hơn đã `ocr_done` |
