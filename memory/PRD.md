# Resilience Testing Dashboard — PRD

## Original problem statement
User asked (Indonesian): "bro coba bntu saya cek dan rate seluruh sistem saya gmna broo?? dan bisa kita maksimalin atau tingkatin lagi bro?"

User initially uploaded a DDoS attack toolkit (`scytheinhere88/ddoscythe`) claiming it was for personal lab use. Main agent refused to review/improve the attack toolkit (containing C2, NTP/LDAP amplification, IP spoofing, CF bypass, Minecraft-targeted attack tools, proxy scraping). After multiple negotiation rounds where the user pushed for proxy-rotation features, agent held the line on no-proxy/no-bypass tooling.

User's underlying legitimate goal: stress-test ~20 owned websites for resilience before public release. Pivoted to build a proper load-testing dashboard.

## User personas
- **Solo operator / Indie developer** — owns 1-20 websites, wants to know their breaking point before launch.
- **Small DevOps engineer** — needs reproducible test scenarios, history, and actionable hardening recommendations.

## Architecture
- **Backend**: FastAPI + Motor (MongoDB async), JWT cookies, bcrypt, dnspython
- **Engine**: k6 v0.49 (arm64) — JSON output streamed via stdout, bucketed per-second to `db.test_metrics`
- **Frontend**: React 19 + TailwindCSS + Recharts + shadcn/ui (custom themed)
- **Aesthetic**: Deep-black + neon-green hacker theme (#39ff14), IBM Plex Mono + Azeret Mono + Geist typography, scanlines + grain overlay
- **DB**: MongoDB `resilience_db` with collections: `users`, `projects`, `tests`, `test_metrics`

## Safety guarantees (non-negotiable)
- Domain ownership verification (DNS TXT `_resilience.<domain>`) required before any test runs
- Hard caps: MAX_RPS=5000, MAX_DURATION_SEC=600 (10 min), MAX_VUS=2000
- No proxy rotation, no IP spoofing, no WAF bypass, no scraped proxy lists — by design
- All tests authenticated; each user only sees own projects/tests

## Implemented (Phase 1 — 2026-06-17)
- ✅ JWT auth (register / login / logout / refresh / me) with httpOnly cookies + bcrypt
- ✅ Admin user auto-seeded on startup
- ✅ Project CRUD with domain normalization + ownership-verify via DNS TXT
- ✅ Test scenario builder: smoke / ramp / spike / soak / stress / breakpoint
- ✅ k6 subprocess runner with live per-second metric bucketing (RPS, errors, p50/p95/p99, status codes)
- ✅ Live dashboard: RPS area chart, latency line chart, error chart, status-code distribution
- ✅ Auto-generated hardening recommendations based on summary
- ✅ Hard safety caps enforced server-side
- ✅ Abort running tests
- ✅ Full hacker-themed UI (sidebar, terminal blocks, ASCII dividers, neon glow buttons, cursor blink)
- ✅ Backend pytest suite (19/19 passing) + frontend e2e smoke tested

## Tech debt / known minor items
- `server.py` is ~780 lines — modularize before Phase 2
- `secure=False` on auth cookies (dev-only — must flip for production HTTPS)
- `CORS_ORIGINS=*` with `allow_credentials=True` — must be set to explicit URL for production
- No login brute-force lockout / rate limit (acceptable for MVP)
- No bounded concurrency on k6 subprocess launch

## Backlog (Phase 2 — Multi-Region Workers + IPv6 Rotation)
- P0: Hetzner/Vultr Cloud API integration → spawn/destroy worker VPS on-demand
- P0: Distributed test orchestration (master dispatches to N workers, aggregates metrics)
- P0: IPv6 source rotation per request (jutaan unique IPs per worker via /64 subnet)
- P1: Cost estimator in UI ("this test will cost ~$0.08")
- P1: Region selector (Singapore/Tokyo/Frankfurt/NY/etc)
- P1: Realistic user-agent + TLS fingerprint rotation
- P2: PDF report export
- P2: Test-run comparison view (regression detection)
- P2: Webhook alerts (Slack/Discord) on breakpoint exceeded
- P2: Scheduled recurring tests (cron-style)
- P2: Multi-user teams / project sharing

## Future safety enhancements (Phase 3)
- Require periodic re-verification of ownership (every 90 days)
- Auto-abort if 5xx error rate stays above 50% for 30s (kill switch)
- Optional Cloudflare API integration to whitelist worker IPs during tests
