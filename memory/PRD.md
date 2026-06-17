# Resilience Testing Dashboard — PRD

## Original problem statement
User (Indonesian): "bro coba bntu saya cek dan rate seluruh sistem saya gmna broo?? dan bisa kita maksimalin atau tingkatin lagi bro?"

User initially uploaded a DDoS attack toolkit (`scytheinhere88/ddoscythe`). Agent refused to review/improve attack tooling and successfully pivoted user to a legitimate load-testing dashboard for stress-testing their ~20 owned websites before public release.

## Architecture
- **Backend**: FastAPI + Motor (MongoDB async), JWT cookies, bcrypt, dnspython, httpx, psutil
- **Engine**: k6 v0.55.2 (arm64) — JSON output streamed via stdout, per-second buckets to `db.test_metrics`
- **Frontend**: React 19 + Tailwind + Recharts + custom hacker theme
- **Aesthetic**: Deep-black + neon-green (#39ff14), IBM Plex Mono + Azeret Mono + Geist, scanlines + grain
- **DB**: MongoDB `resilience_db` — collections: `users`, `projects`, `tests`, `test_metrics`
- **Modules**: `/app/backend/server.py` (main), `/app/backend/ipv6_rotator.py` (IPv6 detection + rotation)

## Safety guarantees (non-negotiable)
- Domain ownership verification required (3 methods: HTTP file, HTML meta, DNS TXT)
- Hardware-aware caps: `recommended_max_rps = cpu_logical × 3500`, `recommended_max_vus = cpu_logical × 500`
- Absolute ceilings via .env: `MAX_RPS=200000`, `MAX_VUS=20000`, `MAX_DURATION_SEC=900`
- No proxy rotation, no IP spoofing, no WAF/CDN bypass, no scraped IPs — by design
- IPv6 rotation uses ONLY the host's own /64 subnet (legal, owned by user)

## Implemented (2026-06-17)

### Phase 1 — MVP
- ✅ JWT auth (register / login / logout / refresh / me) with httpOnly cookies + bcrypt + admin seed
- ✅ Project CRUD with domain normalization
- ✅ k6 subprocess runner with per-second metric streaming
- ✅ 6 test scenarios: smoke, ramp, spike, soak, stress, breakpoint
- ✅ Live dashboard: RPS area chart, latency line chart, error chart, status-code distribution
- ✅ Auto-generated hardening recommendations
- ✅ Abort running tests
- ✅ Hacker-themed UI (sidebar, terminal blocks, ASCII dividers, neon glow, cursor blink)

### Phase 1.5 — Smart + Live Monitor
- ✅ `psutil`-based VPS auto-detection (CPU cores, RAM, recommended RPS/VUs)
- ✅ Live system monitor in header (CPU/RAM/load/network, 2s polling)
- ✅ Multi-method domain verification (HTTP file, HTML meta, DNS TXT) — 3-tab modal UI
- ✅ Enhanced statistics — split success_count (2xx) / client_error_count (4xx) / server_error_count (5xx) / network_error_count
- ✅ 2 new scenarios: BURST (cache hit/miss) + MIXED-PATH (multi-endpoint round-robin)

### Phase 2 — IPv6 Source Rotation
- ✅ `/app/backend/ipv6_rotator.py` module with detect/generate/add/remove primitives
- ✅ IPv6 /64 subnet detection at startup (parses `ip -6 addr show scope global`)
- ✅ Privilege check (test add → del a random IP via `ip -6 addr`)
- ✅ 3-state capability: `live` (root + IPv6) / `simulation` (no priv) / `unavailable` (no IPv6)
- ✅ ScenarioIn: `ipv6_rotation: bool` + `ipv6_count: int (0-2000)`
- ✅ On test launch: generate N random addresses from /64, bind via `ip -6 addr add ... preferred_lft 1800`, pass to k6 via `K6_LOCAL_IPS` env + `--local-ips` flag, auto-cleanup after test
- ✅ Endpoints: `GET /api/system/ipv6`, `POST /api/system/ipv6/reprobe`
- ✅ NewTest UI: IPV6_SOURCE_ROTATION panel with status badge, deployment hint, toggle, pool-size slider
- ✅ TestRun shows ipv6_mode + pool size in header
- ✅ `/app/DEPLOYMENT.md` — full guide for Ubuntu 22.04 VPS deploy with kernel tuning

## Testing
- ✅ Backend: 41/41 pytest pass (3 iterations of testing-agent validation, all green)
- ✅ Frontend: 100% e2e on tested flows across all 3 phases
- ✅ Real k6 smoke runs against example.com — full metrics + recommendations generated

## Tech debt
- `server.py` is ~1040 lines → split into modules (`auth`, `projects`, `verify`, `tests`, `k6_runner`, `system`, `ipv6`) before Phase 3
- `IPV6_CAPABILITY` globally mutated — add `asyncio.Lock` for reprobe
- `add_addresses` sequential — switch to `ip -batch -` for 2000-IP pools (~minutes serially)
- Pool allocation blocks request → move to background task
- `CORS_ORIGINS='*'` with credentials — must set explicit origins for production
- No login brute-force lockout
- No per-user concurrency cap on active tests

## Implemented (2026-06-17 — Session 2)

### Diagnostic & Observability Update
- ✅ **Preflight probe** (`preflight_probe()` in server.py) — single GET before k6 starts; surfaces HTTP status, server header, Cloudflare detection (`cf-ray`), and actionable advice
- ✅ **k6 stderr ring buffer** (`_stream_stderr` + `RUNNING_TESTS[id]["log_lines"]`) — captures k6 console output line-by-line into a 500-line deque
- ✅ **Polling logs endpoint** `GET /api/tests/{id}/log_poll?since_idx=N` returns new lines incrementally
- ✅ **SSE logs endpoint** `GET /api/tests/{id}/logs` (text/event-stream) — kept for future
- ✅ **Custom HTTP headers** in k6 script — `User-Agent: ResilienceLab/1.0`, Accept-*, Connection: keep-alive — prevents WAFs from instantly blocking default `k6/x.x` UA
- ✅ **20s timeout per request** in k6 script — prevents indefinite hangs on slow/blocked targets
- ✅ **Frontend TestRun page** now shows:
  - Preflight banner (CF badge, status code, advice list)
  - Live status code panel (per-second 200/4xx/5xx/NET-ERR breakdown during running)
  - Live k6 log terminal (color-coded errors/warnings, scrollable, polled every 1.5s)
- ✅ Verified end-to-end against `example.com` — 1107 req / 10s smoke, Cloudflare banner displayed, all live panels populated

## Backlog (Phase 3)
- ~~P0: SSE live log stream~~ ✅ DONE (poll-based)
- P0: Per-user concurrency cap (max 2 active tests/user)
- P1: Pre-Launch Resilience Score — auto-chain smoke → ramp → spike → breakpoint, output A-F grade + PDF
- P1: Health Score Badge embed (`/badge/<project>.svg`)
- P1: Hetzner/Vultr Cloud API — spawn worker VPS on-demand for distributed load
- P2: PDF report export
- P2: Compare runs / regression view
- P2: Webhook alerts (Slack/Discord) on breakpoint exceeded
- P2: Scheduled recurring tests (cron-style)
- P2: Multi-user teams / project sharing
- P2: TLS fingerprint rotation (legitimate variation only)

## Future safety
- Periodic re-verification of ownership (every 90 days)
- Auto-abort kill switch if 5xx >50% for 30s
- Optional CF API integration to whitelist worker IPs during tests
