# Brainstorm: VPS Contabo multi-project hosting (BookSnap first)

Date: 2026-09-30 · Modes: default (no --html/--wiki)

## Problem
Move BookSnap from Railway to self-managed Contabo VPS (4 vCPU / 8 GB / 96 GB, Ubuntu 24.04, no GPU) that will host many future GitHub projects. Need step-by-step HTML guide incl. HTTPS (mandatory: iOS camera + `COOKIE_SECURE=true`).

## Constraints found (scout)
- FastAPI + SQLite WAL + in-process worker → exactly 1 instance; downtime on swap acceptable.
- `storage_health` only enforces volume on Railway → no code change for VPS.
- Rate limiter reads last `X-Forwarded-For` entry → proxy must append real client IP (Caddy default does).
- VPS: no firewall/fail2ban/swap, active SSH brute force, root password leaked in chat.

## Options
| Option | Verdict |
|---|---|
| A. Docker Compose + shared Caddy | **Chosen**: isolation per project, auto TLS, portable, transparent |
| B. systemd + venv + Caddy | Rejected: mixed stacks conflict, harder cleanup |
| C. Coolify/Dokploy | Rejected: black box, ~1 GB RAM, extra attack surface |

## Decisions (user-approved)
- Domain: DuckDNS free (`<sub>.duckdns.org`, project = sub-subdomain); sslip.io fallback only (PSL/rate-limit uncertainty).
- Repo public → HTTPS clone; private deploy-key flow documented.
- Deploy manual `deploy/deploy.sh` first; GitHub Actions appendix (forced-command key).
- Docker files committed to repo. Railway data not migrated (fresh start).
- Guide saved only as `docs/deployment-vps-guide.html`.

## Delivered
- `Dockerfile` (non-root uid 10001, HEALTHCHECK /health), `.dockerignore`, `compose.yml` (named volume, `web` network alias `booksnap`, no ports, mem 1g), `.gitattributes` (LF for sh).
- `deploy/deploy.sh`: ff-only pull → commit-tagged image → pre-deploy backup → swap → health wait → auto rollback.
- `deploy/backup.sh`: SQLite online backup + library tarball, 7-day retention.
- `docs/deployment-vps-guide.html`: 13 chapters, live placeholders (IP/domain/email/repo), copy buttons, dark mode.

## Risks
| Risk | L | I | Mitigation |
|---|---|---|---|
| Data loss (single disk) | M | H | Daily backup + offsite scp |
| Docker ports bypass ufw | H if misused | H | Rule: only Caddy publishes; `ss -tlnp` check |
| Rollback after forward-only migration | L | H | Pre-deploy backup, restore procedure |
| DuckDNS outage | L | H | Buy domain, edit `.caddy` files |
| SSH lockout during hardening | M | M | Keep session open; Contabo VNC |

## Validation
- `bash -n` both scripts OK; Linux cp312 wheels exist for all requirements; HTML tags balanced.
- Not verified: actual `docker build` / Caddy issuance on VPS (to be done while following guide).

## Unresolved
- DuckDNS PSL status / sub-subdomain wildcard behaviour: believed correct, verify at chapter 4–5.
- Future TTS self-host (VieNeu-TTS PoC) out of scope for this round.
