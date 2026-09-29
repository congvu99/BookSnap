---
phase: 3
title: Backend voice preview endpoint
status: completed
priority: P2
dependencies:
  - 2
effort: M
---

# Phase 3: Endpoint nghe thử giọng

## Overview
`GET /api/voices/{provider}/{voice}/preview?v={key}` trả MP3 đọc một câu mẫu cố định, cache trên disk.
- Mỗi giọng chỉ có một lần synth chạy tại một thời điểm.
- Lỗi được cache lại để không bị gọi liên tục.
- Có giới hạn theo user và timeout.
- Không dùng chung rate limiter của worker, không refactor lifespan. <!-- Red Team: preview được làm lại theo hướng tối giản và an toàn quota -->

## Requirements
- Chỉ user đã đăng nhập. `provider/voice` phải thuộc `allowed_voices` (phase 2), nếu không → 404. Provider chưa cấu hình → 409 `provider_unavailable`.
- Câu mẫu là hằng số ở server (`PREVIEW_TEXT`). **Không nhận text từ client.**
- **Cache key** = `sha256(provider \0 voice \0 provider.model \0 provider.style \0 PREVIEW_TEXT)[:16]`.
  - Model/style đọc từ **chính instance provider** được dùng để synth, không đọc từ settings.
  - Azure: model/style là chuỗi rỗng.
  - File: `DATA_DIR/voice-previews/{key}.mp3`.
- **`/api/voices`**: mỗi voice có `preview_url` kèm `?v={key}` (additive). Cache hit → `FileResponse(audio/mpeg)`, `Cache-Control: private, max-age=31536000, immutable` (cùng pattern với `audio_routes.py:51-52`). <!-- Red Team: URL có version -->
- **Single-flight:** `VoicePreviewService` giữ `dict[key, asyncio.Task]`. <!-- Red Team: lock chỉ chặn khi thành công -->
  - Mọi request cho cùng key `await asyncio.shield(task)` và nhận cùng kết quả, **kể cả khi lỗi**.
  - Task chạy độc lập với request, nên client ngắt kết nối không hủy synth. Usage được ghi ngay trong task.
  - Request chờ tối đa 30s (`asyncio.wait_for` bọc ngoài `shield`). Quá hạn → 503 `tts_timeout`, task vẫn chạy tiếp và ghi cache.
- **Cache lỗi (trong memory của service):** <!-- Red Team: đốt quota -->
  - Lỗi thường → trong 60s trả luôn 502 `tts_failed`, không gọi provider.
  - Lỗi quota → trả 503 `tts_quota` + `Retry-After` cho tới hết `retry_after` (mặc định 60s nếu provider không trả).
- **Giới hạn theo user:** `RateLimiter` có sẵn (`app/auth/rate_limiter.py`), 6 lần gọi provider mỗi phút cho mỗi user. Chỉ tính khi cache miss. Vượt → 429 `rate_limited`.
- Lỗi trả thông điệp **cố định** (tiếng Việt), không kèm text của provider. Text chi tiết chỉ ghi vào log server. `Retry-After = str(math.ceil(retry_after))`. <!-- Red Team: float header, lộ message -->
- Ghi file atomic: `{key}.{uuid}.tmp`, sau đó `os.replace`. Nếu synth lỗi thì xoá `.tmp` trong `finally`.
- Mỗi lần gọi provider đều ghi usage: `ctx.usage.record("gemini_tts"|"azure_tts", outcome, chars, book_id=None)`.
- Log: `voice_preview user_id=%s provider=%s voice=%s cache_hit=%s ms=%d outcome=%s`. <!-- Red Team: truy vết -->

## Architecture
- `app/voice_preview.py`: `class VoicePreviewService` với:
  - `__init__(settings, usage_repo, provider_factory)`
  - `preview_path(provider, voice)`
  - `cache_key(provider, voice)`
  - `get_or_create(provider, voice, user_id) -> Path`
- Tạo service một lần trong `AppContext.build` (field `voice_preview`), tồn tại theo process. **Không** dùng lock hoặc task map ở cấp module, vì pytest-asyncio tạo event loop mới cho mỗi test. <!-- Red Team: lifetime -->
- `provider_factory(name) -> TtsProvider`: mặc định tạo `GeminiTtsProvider(key, model, style)` / `AzureTtsProvider(key, region)` và cache instance trong service. Test override: `ctx_of(app).voice_preview.provider_factory = lambda n: fake`.
- Cho `GeminiTtsProvider` expose thuộc tính chỉ đọc `model`/`style` để tính cache key.
- Không sửa `main.py` lifespan hay `Worker`. Không dùng `RpmLimiter` của worker: preview có limiter theo user và cache lỗi, đổi lại có thể chiếm tối đa vài slot RPM của worker trong một phút. Chấp nhận được.
- Route nằm trong `voices_routes.py`, chỉ gọi service rồi map lỗi sang `ApiError`.

## Related Code Files
- Create: `app/voice_preview.py`, `tests/test_voice_preview.py`
- Modify: `app/app_context.py`, `app/api/voices_routes.py`, `app/pipeline/tts_gemini.py` (expose `model`/`style`)

## Implementation Steps
1. **Tests Before:** `pytest -q` baseline sau phase 2.
2. **Tests New (đỏ)**, dùng fake provider có bộ đếm và cờ `configured` (settings test set key giả để qua check 409):
   - Chưa đăng nhập → 401. `NotAVoice` / `Kore%22` → 404. Provider chưa cấu hình → 409.
   - Lần 1 → 200 `audio/mpeg`, fake được gọi 1 lần. Lần 2 → 200, fake không bị gọi thêm.
   - 2 request đồng thời, cache lạnh, fake **thành công** → fake gọi 1 lần.
   - 2 request đồng thời, fake **lỗi** → fake gọi 1 lần, cả 2 request nhận 502. Request thứ 3 trong 60s → 502, fake không bị gọi.
   - Fake quota với `retry_after=12.5` → 503, header `Retry-After: 13`, không có file cache. Gọi lại trước 13s → 503, fake không bị gọi.
   - Body lỗi không chứa text của fake exception.
   - Vượt 6 lần gọi provider/phút/user → 429.
   - Provider có style khác → cache key khác.
   - Mỗi lần gọi provider có 1 dòng `provider_usage` với `book_id IS NULL`.
   - `/api/voices` có `preview_url` chứa `?v=`.
3. **Implement.**
4. **Regression Gate:** `pytest -q`.

## Success Criteria
- [ ] Không có kịch bản nào khiến N request thành N lần gọi provider cho cùng một giọng.
- [ ] Không có đường nào để client đưa text tùy ý vào TTS.
- [ ] Lỗi không lộ thông điệp của provider.
- [ ] Không thay đổi lifespan hay worker.

## Risk Assessment
- **Preview không biết worker đang pause quota** (pause chỉ lưu trong memory của Worker). Preview có thể gọi thêm 1 lần và dính 429, sau đó cache lỗi chặn các lần tiếp theo. Chấp nhận.
- **Cache lỗi và task map chỉ nằm trong 1 process:** đúng với ràng buộc 1 replica trên Railway.
- **File cache mồ côi** khi đổi model/style: rất nhỏ, ghi chú trong docs.
- **Rollback:** endpoint mới và field additive.
