# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

JANJOON / J&J Power EMS (JJEMS) — a frontend prototype of an Energy Management System for a Taiwan behind-the-meter industrial battery storage site (2× Zpower-AC-261L cabinets, ~250 kW / 522 kWh, LFP, at 高雄路竹). It is a **static single-page app** (vanilla HTML/CSS/JS, no build step, no framework, no bundler). All operational data is **mocked in JS** — there is no live backend wired up. It deploys to Vercel as static files plus one serverless function for the AI chat.

## Commands

There is no test suite and no build. Useful commands:

```bash
python3 -m http.server 8088     # serve locally, then open http://127.0.0.1:8088
node --check app.js             # syntax-check a JS file (this is the closest thing to a linter)
node --check data.js            # do the same for any JS file you edit
```

Always `node --check` a `.js` file after editing it — a syntax error silently breaks the whole SPA at load time, and there is no compiler to catch it otherwise.

## Architecture

### File roles (don't be misled by `index.html`)

`index.html` is only ~190 lines: it is the **SPA shell**, not where the logic lives. It defines the topbar, sidebar, the single `<div id="view">` view container, the language/mode pills, and the chat panel, then loads the real code via `<script>` tags. The application is in:

- **`app.js`** (~4100 lines / 215KB) — the hash-based router plus all 11 view controllers and every Chart.js visualization. This is the main file you'll edit.
- **`data.js`** (~680 lines) — site spec, 24h mock telemetry (96 points @ 15-min), dispatch strategies, alarm rules, and the battery-health models (`RACK_HEALTH`, `RISK_LEVELS`, `estimateDegradationCost`).
- **`i18n.js`** (~1000 lines / 103KB) — the `I18N` translation table and lookup helpers; also FX conversion.
- **`chat.js`** (~530 lines) — the "Energy Copilot" chat widget; rule-based replies with a live-LLM fallback that POSTs to `/api/chat`.
- **`api/chat.js`** — a **Vercel Edge function** (`runtime: "edge"`) proxying OpenRouter (`OPENROUTER_API_KEY` env var; primary model `google/gemini-2.5-flash-lite` with a fallback chain). It builds the EMS system prompt from the passed-in site/operational context. This is the only server-side code.
- **`styles.css`** (~1300 lines) — dark navy theme.
- **`db/`** — PostgreSQL 16 + TimescaleDB schema (`schema.sql`, `seed.sql`, `docker-compose.yml`, `DEPLOYMENT.md`). This is the *intended future* real backend; the static frontend does **not** use it. `DEPLOYMENT.md` describes three deployment topologies (edge single-site / pure-IP multi-site / full three-tier).

### Standalone pages (NOT part of the SPA)

`slides.html` (pitch deck), `whitepaper.html`, `competitive-advantage.html` are each fully self-contained (own inline `<style>`/`<script>`, do not use `styles.css` or `app.js`). Editing the dashboard does not touch these and vice-versa.

### SPA routing & views

A **hash-based router** — `router()` in `app.js`, bound to `window`'s `hashchange` event — clears `#view` and calls the matching `viewXxx()` for the route (e.g. `#/dashboard` → `viewDashboard`). The 11 views: `dashboard`, `sld` (single-line diagram), `protection`, `comm`, `devices` (includes the BMS Pro tab), `passport` (battery passport), `schedule`, `tariff`, `finance`, `alarms`, `settings`. Nav links in `index.html` use `href="#/<route>"` + `data-route`. Each `viewXxx()` sets `$("#view").innerHTML = ...` from a template string, then wires up charts/handlers. **To add a page**: write a `viewXxx()`, add its route case in `router()`, add the nav link(s) in `index.html`, and put backing data in `data.js`.

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
