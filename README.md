# J&J Power EMS

J&J Power EMS is an energy management system for the J&J Power **2 x Zpower-AC-261L (125 kW / 261 kWh)** behind-the-meter commercial and industrial battery site. It monitors battery cabinets, PCS, PV, grid import/export, plant load, alarms, live HiEMS telemetry, and financial operating metrics.

The repo now contains the browser dashboard, Go API/server, PostgreSQL/TimescaleDB schema, field collector scripts, systemd deployment files, and supporting business/demo material.

## System Scope

| Item | Specification |
|---|---|
| **SYS-A** | Zpower-AC-261L-S120-L125-TR-2H, 125 kW PCS, 261.248 kWh, 2x MPPT + STS + transformer |
| **SYS-B** | Zpower-AC-261L-S60-L125-2H, 125 kW PCS, 261.248 kWh, 1x MPPT + STS |
| **Total** | 250 kW / 522 kWh, LFP 1P260S, 832 V, 0.5C |
| **Expandable** | Up to 12 cabinets in parallel, 1.5 MW / 3.13 MWh |
| **Demo site** | Kaohsiung Luzhu plant, 2,500 kW contract capacity, high-voltage three-period TOU tariff |
| **Integration** | 400 kWp PV + behind-the-meter BESS + plant load |
| **EMS controller** | HiEMS-SCU-V2-2 site controller + cabinet integrated controller |
| **Comms** | Cloud via MQTT/TLS, cabinet via Modbus TCP, BCU/BMU via CAN |

Deployment is designed around one codebase and one schema with three operating topologies:

| Topology | Mode | Use case |
|---|---|---|
| **A. Edge single-site** | `edge` / `combined` | Most C&I sites, local operation without cloud dependency |
| **B. Pure IP multi-site** | `cloud` / `flat` | VPP and fully IP-connected deployments |
| **C. Three-tier** | `cloud` / `split` | Larger sites with RS485, DI/O, and peripheral integration |

See [db/DEPLOYMENT.md](./db/DEPLOYMENT.md) for the deployment model.

## Features

The dashboard has seven main views:

| # | View | Purpose |
|---|---|---|
| 1 | Overview | KPI cards, 5-node energy flow, 24h power curves, SoC, energy balance, recent alarms |
| 2 | Site single-line diagram | Dynamic SLD from Taipower 22.8 kV through transformer, LV bus, PCS A/B, batteries, and feeders |
| 3 | Equipment monitoring | SYS-A/SYS-B meter cards, 208-cell temperature heatmap, PCS/BMS values, HVAC/fire/door states |
| 4 | Scheduling and strategy | Arbitrage, peak shaving, sReg, AFC, PV self-consumption, manual mode, tariff and profit preview |
| 5 | Financial benefits | Annual savings, arbitrage revenue, contract-capacity reduction, IRR, monthly and 15-year charts |
| 6 | Alarms and events | Four severity levels, alarm distribution, Line/Email/Webhook notification settings |
| 7 | System settings | Site data, BESS specification, protocol settings, security profile, RBAC-oriented user roles |

The Go backend adds same-origin API endpoints for health, database checks, site/device metadata, telemetry status/history/latest values, BMS temperature, gateway onboarding, and gated HiEMS command requests.

## Repository Layout

```text
.
|-- index.html                 # Browser dashboard shell
|-- styles.css                 # Dashboard UI
|-- app.js                     # SPA router and chart rendering
|-- data.js                    # Site constants and demo data fallback
|-- chat.js                    # Browser chat behavior
|-- api/chat.js                # Vercel/OpenRouter chat endpoint
|-- backend/
|   `-- cmd/
|       |-- jjems-server/      # Go static server + API
|       `-- jjems-collector/   # Go collector prototype
|-- db/
|   |-- schema.sql             # PostgreSQL 16 + TimescaleDB schema
|   |-- seed.sql               # Seed data
|   |-- docker-compose.yml     # Local Postgres/TimescaleDB, Redis, Adminer
|   `-- DEPLOYMENT.md          # Edge/cloud topology notes
|-- deploy/                    # systemd service/timer files and install notes
|-- scripts/                   # HiEMS MQTT, SignalR, Modbus, command, and logging helpers
|-- live/                      # Runtime latest telemetry JSON output
|-- docs/ref/                  # Gateway and MQTT datapoint references
`-- docs/worklog.md            # Field and implementation notes
```

## Tech Stack

| Layer | Stack |
|---|---|
| Frontend | HTML, CSS, vanilla JavaScript, hash router, Chart.js 4 CDN |
| Backend | Go, standard `net/http`, `pgx` PostgreSQL driver |
| Database | PostgreSQL 16, TimescaleDB, Redis for local stack support |
| Collectors | Go prototype plus Python HiEMS/MQTT/SignalR/Modbus field scripts |
| Deployment | Static/Vercel demo option, Go same-origin server, systemd services/timers |

## Local Development

### Static dashboard only

```bash
python3 -m http.server 8088
```

Open:

```text
http://127.0.0.1:8088
```

### Go server with API

```bash
go run ./backend/cmd/jjems-server
```

The server listens on `0.0.0.0:8088` by default and serves both:

```text
http://127.0.0.1:8088/
http://127.0.0.1:8088/api/*
```

Useful checks:

```bash
curl -sS http://127.0.0.1:8088/api/health
curl -sS http://127.0.0.1:8088/api/collector/status
curl -sS http://127.0.0.1:8088/api/system/status
curl -sS http://127.0.0.1:8088/api/telemetry/latest
```

### Database stack

```bash
cd db
docker compose up -d
sleep 10

docker exec -i jjems-pg psql -U ems -d ems < schema.sql
docker exec -i jjems-pg psql -U ems -d ems < seed.sql
```

Connection defaults:

| Service | URL |
|---|---|
| PostgreSQL | `postgres://ems:ems_dev_only_change_me@localhost:5432/ems` |
| Redis | `redis://localhost:6379` |
| Adminer | `http://localhost:8081` |

## Backend Configuration

The Go server uses these environment variables:

```text
JJEMS_LISTEN                default 0.0.0.0:8088
JJEMS_STATIC_ROOT           default .
JJEMS_DATABASE_URL          default postgres://ems:ems_dev_only_change_me@localhost:5432/ems
JJEMS_DATABASE_ADDR         default 127.0.0.1:5432
JJEMS_MQTT_ADDR             default 127.0.0.1:1883
JJEMS_MODBUS_HOST           default 192.168.1.100
JJEMS_MODBUS_PORT           default 502
JJEMS_ENABLE_WRITES         default false
JJEMS_COMMAND_TOKEN         required only for execute mode
JJEMS_COMMAND_MAX_POWER_KW  default 3
JJEMS_COMMAND_AUDIT_LOG     default logs/hiems_command_audit.jsonl
JJEMS_TCP_TIMEOUT_MS        default 1500
```

HiEMS command writes are disabled by default. Execute mode requires `JJEMS_ENABLE_WRITES=true`, a bearer token, an allowlisted command, all safety acknowledgements, and the configured low-power limit.

## Build And Test

```bash
go test ./...
go build -o /tmp/jjems-server ./backend/cmd/jjems-server
go build -o /tmp/jjems-collector ./backend/cmd/jjems-collector
```

Run the collector once without touching the active live JSON:

```bash
DATABASE_URL=postgres://ems:ems_dev_only_change_me@localhost:5432/ems \
  /tmp/jjems-collector --once --print-json --live-json /tmp/jjems_go_collector_latest.json
```

## Field Deployment

The edge-host systemd install path is documented in [deploy/INSTALL.md](./deploy/INSTALL.md).

High-level flow:

```bash
go test ./...
go build -o /tmp/jjems-server ./backend/cmd/jjems-server
sudo install -m 0755 /tmp/jjems-server /usr/local/bin/jjems-server
sudo cp deploy/jjems-server.env.example /etc/jjems/jjems-server.env
sudo cp deploy/jjems-server.service /etc/systemd/system/jjems-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now jjems-server
```

Collector timer/service units live under [deploy/collectors](./deploy/collectors).

## Vercel Demo Deployment

The static dashboard can still be deployed to Vercel:

1. Import the GitHub repo at `https://vercel.com/new`.
2. Use Framework Preset **Other**.
3. Leave Build Command and Output Directory blank.
4. Deploy.

For Live AI Chat through OpenRouter, set `OPENROUTER_API_KEY` in Vercel environment variables and redeploy. Without the key, the chat UI falls back to local rule-based responses.

## Reference Docs

| File | Purpose |
|---|---|
| [backend/README.md](./backend/README.md) | Go backend API, collector, and smoke tests |
| [db/README.md](./db/README.md) | Database quick start and schema overview |
| [db/SCHEMA.md](./db/SCHEMA.md) | Full database design |
| [deploy/INSTALL.md](./deploy/INSTALL.md) | Go backend systemd installation |
| [deploy/collectors/INSTALL.md](./deploy/collectors/INSTALL.md) | Collector timer installation |
| [docs/ref/hiems-mqtt-datapoints.md](./docs/ref/hiems-mqtt-datapoints.md) | HiEMS MQTT datapoint reference |
| [docs/ref/hiems-gateway-map.md](./docs/ref/hiems-gateway-map.md) | Gateway onboarding and datapoint map |

## Roadmap

- Replace remaining demo-only data paths with live API-backed views.
- Complete Go collector field comparison against active Python wrappers.
- Add user login and RBAC for operator, maintenance, manager, and viewer roles.
- Add interactive schedule editing with approval and audit workflow.
- Add multi-site tenant switching.
- Integrate Taipower OpenADR/sReg dispatch notifications.
- Package PWA/mobile operating mode for field use.

## License

Copyright 2026 J&J Power. All rights reserved.
