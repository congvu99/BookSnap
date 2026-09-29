# PM status — BookSnap MVP (2026-09-29)

Plan status: **in-progress** (code done, field verification pending).

| Phase | Status | Criteria [x]/total | Blocking verification |
|---|---|---|---|
| 1 Backend nền | Completed | 6/6 | — |
| 2 Pipeline OCR/TTS | Implemented | 3/5 | PoC giọng + quota thật (key); E2E với API thật |
| 3 PWA camera/thư viện | Implemented | 0/4 | Android/iOS thật, Lighthouse, devtools contrast |
| 4 Reader/player | Implemented | 0/6 | Audio TTS thật, màn hình khoá, offline iOS 206, 2 máy |
| 5 Deploy/vận hành | Implemented | 2/5 | Railway project + Volume, redeploy, cost 1 tuần |
| Plan acceptance | — | 3/10 | như trên |

Quality: 102 pytest pass (3 lần tester chạy, không flaky); JS syntax check pass; review 2 vòng — Critical C1–C4, High H1–H5 + N1–N4 đã sửa có test hồi quy.

Changes vs plan: seal chunk khi TTS claim; seq liên tục + discard (quyết định user); `claim_token` (migration v2); size-limit middleware; `/api/voices`; start command bọc shell.

Docs: giao `docs-manager` (project-overview-pdr, system-architecture, deployment-guide, code-standards, codebase-summary, project-roadmap).

## Unresolved questions
1. Voice + style prompt chốt cuối (PoC cần key).
2. Railway edge có luôn append IP client vào cuối `X-Forwarded-For`? (rate limiter dựa vào đó)
3. `up.railway.app` có trong Public Suffix List? (CSRF chỉ dựa SameSite=Lax)
4. Medium còn mở (M1, M2, M5, M7–M9, N5, N7) — làm trước hay sau lần deploy đầu?
