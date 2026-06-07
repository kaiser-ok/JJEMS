# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

JANJOON / J&J Power EMS (JJEMS) — a frontend prototype of an Energy Management System for a Taiwan behind-the-meter industrial battery storage site (2× Zpower-AC-261L cabinets, ~250 kW / 522 kWh, LFP, at 高雄路竹). The UI is still primarily a **static single-page app** (vanilla HTML/CSS/JS, no build step, no framework, no bundler), but the repo now also contains local backend/edge integration pieces for HiEMS telemetry, command gating, MQTT ingest, and PostgreSQL/TimescaleDB persistence. The frontend still reads mostly mock/static JSON data today; the intended next step is a formal Go or Rust backend serving the SPA plus same-origin `/api/*` routes.

## Commands

There is no test suite and no build. Useful commands:

```bash
# Frontend-only fallback; normally use the Go service on 8088 instead.
python3 -m http.server 8088

node --check app.js
node --check data.js

/usr/local/go/bin/gofmt -w backend/cmd/jjems-server/main.go
/usr/local/go/bin/go test ./...
/usr/local/go/bin/go build -o /tmp/jjems-server ./backend/cmd/jjems-server
sudo /usr/bin/install -m 0755 /tmp/jjems-server /usr/local/bin/jjems-server
sudo systemctl restart jjems-server
```

Always `node --check` a `.js` file after editing it — a syntax error silently breaks the whole SPA at load time, and there is no compiler to catch it otherwise.

Local PostgreSQL/TimescaleDB is available and initialized:

```bash
psql postgres://ems:ems_dev_only_change_me@localhost:5432/ems -c '\dt'
```

The database contains the EMS schema, including telemetry, alarm, MQTT, audit, user/role, site, device, cabinet, and Modbus point tables. See `db.md` and `db/README.md`.

The Go backend is installed as the systemd service `jjems-server` and normally owns port `8088`. It serves the SPA plus same-origin `/api/*` routes. See `service.md` for the current service runbook, sudoers rules, deployment workflow, and troubleshooting.

The old Python RTU command API gate still exists for reference/fallback:

```bash
python3 scripts/hiems_command_api.py --listen 127.0.0.1 --api-port 9093
```

The current frontend defaults to `/api/hiems/commands` on the Go backend. Keep real command writes disabled by default (`JJEMS_ENABLE_WRITES=false`) unless explicitly requested for controlled field testing.

## Architecture

### File roles (don't be misled by `index.html`)

`index.html` is only ~190 lines: it is the **SPA shell**, not where the logic lives. It defines the topbar, sidebar, the single `<div id="view">` view container, the language/mode pills, and the chat panel, then loads the real code via `<script>` tags. The application is in:

- **`app.js`** (~4100 lines / 215KB) — the hash-based router plus all 11 view controllers and every Chart.js visualization. This is the main file you'll edit.
- **`data.js`** (~680 lines) — site spec, 24h mock telemetry (96 points @ 15-min), dispatch strategies, alarm rules, and the battery-health models (`RACK_HEALTH`, `RISK_LEVELS`, `estimateDegradationCost`).
- **`i18n.js`** (~1000 lines / 103KB) — the `I18N` translation table and lookup helpers; also FX conversion.
- **`chat.js`** (~530 lines) — the "Energy Copilot" chat widget; rule-based replies with a live-LLM fallback that POSTs to `/api/chat`.
- **`api/chat.js`** — a **Vercel Edge function** (`runtime: "edge"`) proxying OpenRouter (`OPENROUTER_API_KEY` env var; primary model `google/gemini-2.5-flash-lite` with a fallback chain). It builds the EMS system prompt from the passed-in site/operational context. This is the only server-side code.
- **`styles.css`** (~1300 lines) — dark navy theme.
- **`db/`** — PostgreSQL 16 + TimescaleDB schema (`schema.sql`, `seed.sql`, `docker-compose.yml`, `DEPLOYMENT.md`). Local PostgreSQL is currently reachable at `postgres://ems:ems_dev_only_change_me@localhost:5432/ems` and has the EMS schema loaded. The static frontend does not yet query it directly; it should be used by the planned formal backend. `DEPLOYMENT.md` describes three deployment topologies (edge single-site / pure-IP multi-site / full three-tier).
- **`db.md`** — current local DB status, connection string, table/extension confirmation, and backend integration direction.
- **`backend/`** — Go backend commands. `cmd/jjems-server` serves the current SPA and same-origin `/api/*` routes. `cmd/jjems-collector` is the first Go collector prototype for the SoC/telemetry path and is not yet the active timer target. The server uses PostgreSQL/TimescaleDB via `pgx`, exposes DB-backed sites/devices/cabinets/modbus-points APIs, command gate APIs, telemetry status/latest/history, and JSON-backed fallback telemetry endpoints.
- **`deploy/`** — systemd unit, env template, and install notes for `jjems-server`.
- **`service.md`** — operational runbook for the installed service, scoped sudoers, build/deploy flow, API smoke tests, and known notes.
- **`scripts/hiems_command_api.py`** — legacy/reference local HiEMS command API gate for `#/rtu-verify`; default port `9093`, dry-run only by default. The Go backend now provides the same primary `/api/hiems/commands` path on port `8088`.
- **`scripts/hiems_*.py`** — local data collection/probing utilities for HiEMS SignalR, BMS temperature, MQTT ingest/subscription, SoC logging, and command gating. The active collector timers still call these wrappers while Go collector output is validated.

### Go backend and service

The current production-like local path is the Go service, not `python3 -m http.server`:

```text
Systemd service: jjems-server.service
Binary: /usr/local/bin/jjems-server
Env: /etc/jjems/jjems-server.env
Working directory/static root: /home/gentrice/jjems
URL: http://127.0.0.1:8088
```

Important checks:

```bash
systemctl status jjems-server --no-pager
journalctl -u jjems-server -n 80 --no-pager
curl -sS http://127.0.0.1:8088/api/health
curl -sS http://127.0.0.1:8088/api/collector/status
curl -sS http://127.0.0.1:8088/api/telemetry/status
```

Go collector prototype validation:

```bash
/usr/local/go/bin/go build -o /tmp/jjems-collector ./backend/cmd/jjems-collector
DATABASE_URL=postgres://ems:ems_dev_only_change_me@localhost:5432/ems \
  /tmp/jjems-collector --once --print-json --live-json /tmp/jjems_go_collector_latest.json
```

Build/deploy workflow:

```bash
/usr/local/go/bin/gofmt -w backend/cmd/jjems-server/main.go
/usr/local/go/bin/go test ./...
/usr/local/go/bin/go build -o /tmp/jjems-server ./backend/cmd/jjems-server
sudo /usr/bin/install -m 0755 /tmp/jjems-server /usr/local/bin/jjems-server
sudo systemctl restart jjems-server
```

Scoped sudoers have been configured for service management, collector timer management, and exact binary install commands; keep them narrow. See `service.md`. Collector timers are installed and active; the old user crontab has been removed. Collector timer runbook docs live at `deploy/collectors/INSTALL.md`.

Telemetry behavior:

- `/api/collector/status` reports the current collector path: systemd timers under `deploy/collectors/`. It includes log/file freshness and latest DB insert age.
- `/api/telemetry/status`, `/api/telemetry/latest`, and `/api/telemetry/history` use TimescaleDB (`telemetry_cabinet_1s`) where possible.
- `/api/telemetry/latest` and `/api/telemetry/history` fall back to `live/*.json` if DB data is unavailable.
- `/api/telemetry/bms-temperature` and `/api/telemetry/gateway-onboarding` still serve existing JSON files.
- MQTT may report down if nothing is listening on `127.0.0.1:1883`; update `JJEMS_MQTT_ADDR` or start Mosquitto if needed.

### Standalone pages (NOT part of the SPA)

`slides.html` (pitch deck), `whitepaper.html`, `competitive-advantage.html` are each fully self-contained (own inline `<style>`/`<script>`, do not use `styles.css` or `app.js`). Editing the dashboard does not touch these and vice-versa.

### SPA routing & views

A **hash-based router** — `router()` in `app.js`, bound to `window`'s `hashchange` event — clears `#view` and calls the matching `viewXxx()` for the route (e.g. `#/dashboard` → `viewDashboard`). Routes include `dashboard`, `sld` (single-line diagram), `protection`, `comm`, `devices` (includes the BMS Pro tab), `passport` (battery passport), `schedule`, `tariff`, `finance`, `alarms`, `settings`, and `rtu-verify`. Nav links in `index.html` use `href="#/<route>"` + `data-route`. Each `viewXxx()` sets `$("#view").innerHTML = ...` from a template string, then wires up charts/handlers. **To add a page**: write a `viewXxx()`, add its route case in `router()`, add the nav link(s) in `index.html`, and put backing data in `data.js`.

Shared app state lives in the `state` object (`state.strategy`, `state.lang`, schedule overrides). The selected strategy and language are global across views.

### Charts

Visualizations use **Chart.js 4** (jsDelivr CDN, loaded in `index.html`), created inside the `viewXxx()` controllers. QR codes use the `qrcode-generator` CDN library. Chart instances are tracked in a module-level `charts[]` array via `addChart(new Chart(...))`; the router calls `killCharts()` before rendering a new view to `destroy()` them. **Always register a new chart with `addChart(...)`** so it gets cleaned up — otherwise you'll hit canvas-reuse errors on navigation.

### i18n (the dominant ongoing effort in git history)

Four languages, ordered **`[zh-TW, en, de, ja]`** (see `LANG_INDEX` in `i18n.js`); `zh-TW` is the default. The `I18N` object maps each key to an array of four strings in that exact order:

```js
"some.key": ["繁中…", "English…", "Deutsch…", "日本語…"],
```

Two complementary mechanisms:
- **Static shell markup** (`index.html`) uses `data-i18n="key"` attributes; `applyI18nDom()` walks them and fills text.
- **View bodies** (built as HTML strings in `app.js`) pull strings inline via `t(key)`.

`setLang(lang)` persists the choice to `localStorage["ems-lang"]`, updates `state.lang`, runs `applyI18nDom()`, and re-renders the current view, so language changes apply live. **When adding UI text, add an `I18N` key with all four translations** and render it via `t()` (in views) or `data-i18n` (in the shell) — don't hardcode. Missing entries fall back to the key.

Currency is language-linked: `fmt()`/`money()` in `app.js` use the `FX` table (`fxOf()`) to convert from base TWD into the active locale's currency/symbol (USD/EUR/JPY) — so monetary values should go through `money()`, not be printed raw.

### Domain concepts

- **Taiwan tariff model** — cost/arbitrage logic uses Taiwan's high-voltage three-tier time-of-use pricing.
- **Battery-lifetime-aware dispatch** (the product differentiator) — dispatch is evaluated net of **degradation cost** (`estimateDegradationCost` in `data.js`), not just energy arbitrage. The mental model is three layers: (1) BMS hard limits (never overridden), (2) health-aware soft constraints from the Battery Intelligence layer (`RACK_HEALTH`, `RISK_LEVELS`), (3) economic optimization. See the dashboard Battery Intelligence card, the schedule benefit table, the finance "Battery Lifetime Asset Value" section, and the alarms health-aware derating matrix; background in `docs/` and `competitive-advantage.html`.

## Working in this repo

- The large files (`app.js`, `i18n.js`) hold many concerns inline — locate code by function name (`viewDashboard`, `viewFinance`, …) or DOM id rather than expecting modules.
- This is a CDN-dependent static app (Chart.js, qrcode, Google Fonts) — it needs network access to render fully; it is not offline-first.
- Deploys to Vercel (Framework Preset: Other; empty build command/output dir). Pushing to `main` auto-deploys.
- Go backend migration is active. Prefer same-origin browser access through `jjems-server` on `8088`; keep internal ports such as legacy command API `9093`, Modbus `502`, PostgreSQL `5432`, and MQTT `1883` behind the backend or local service boundary.
- Before ending backend work, run `gofmt`, `go test ./...`, build `/tmp/jjems-server`, install it, restart `jjems-server`, and smoke-test `/api/health`, `/api/collector/status`, and `/api/telemetry/status` when the user has allowed service deployment.
