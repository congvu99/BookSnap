---
title: Giọng thực tế của đoạn khi chờ quota + gỡ chờ khi đổi provider
description: >-
  API trả giọng sẽ dùng thật cho đoạn chưa có audio (hết cảnh mỗi đoạn một giọng
  trong player khi chờ quota); đổi provider thì đoạn waiting_quota chạy lại
  ngay.
status: completed
priority: P2
branch: main
tags:
  - api
  - tts
  - bugfix
blockedBy: []
blocks: []
created: '2026-09-30T02:10:45.331Z'
createdBy: 'ck:plan'
source: skill
mode: tdd
---

# Giọng thực tế của đoạn khi chờ quota + gỡ chờ khi đổi provider

## Overview

Nguồn: [brainstorm report](../reports/brainstorm-260930-0909-chunk-effective-voice-during-quota-wait.md) (đã duyệt phương án A + D).

- Triệu chứng: đang chờ quota, user đổi giọng → dòng "Giọng đọc" trong player sheet hiện mỗi đoạn một giọng.
- Nguyên nhân: `chunks.voice` là giá trị chép lúc worker nhận đoạn (`claim_next_pending`). `set_voice` và các bước requeue không cập nhật nó. `chunk_out` lại trả giá trị thô này cho mọi status. Audio cuối vẫn đúng giọng vì lần nhận lại sẽ chép giọng hiện tại của sách.
- Lỗi thật đi kèm: `PUT /voice` đổi provider nhưng đoạn `waiting_quota` vẫn bị giữ đến `not_before`. Docs đã mô tả là được gỡ ngay (hành vi của PATCH cũ).

**TDD:** mỗi phase gồm Tests Before (khóa hành vi đúng hiện có), Tests New (đỏ), Implement, Regression Gate `.venv/Scripts/python -m pytest -q`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Effective chunk voice in API](./phase-01-effective-chunk-voice-in-api.md) | Completed |
| 2 | [Unpark quota wait on provider change](./phase-02-unpark-quota-wait-on-provider-change.md) | Completed |

Thứ tự: 1 → 2 (tách biệt về file, nhưng test phase 2 kiểm `voice` qua API nên cần phase 1).

## Acceptance Criteria

- Đoạn `pending`/`waiting_quota`/`failed` trong `GET /api/books/{id}/chunks`, `PATCH /api/chunks/{id}`, `POST /api/chunks/{id}/retry` trả `voice`/`provider` = giọng hiện tại của sách.
- Đoạn `done`/`processing` trả `voice`/`provider` đã chép vào đoạn.
- `PUT /voice` đổi provider → đoạn `waiting_quota` của sách thành `pending`, `not_before=NULL`. Chỉ đổi giọng trong cùng provider → giữ `waiting_quota`.
- `books.updated_at` không đổi (test hiện có vẫn qua).
- Không migration, không sửa frontend, hình dạng API giữ nguyên.

## Dependencies

- Liên quan (không chặn): [260929-1636-smart-progress-and-voice-picker](../260929-1636-smart-progress-and-voice-picker/plan.md). Phase 2 của plan đó tạo ra `set_voice`. Phase 8 đang làm chỉ đụng docs/env/SW, không trùng file.
