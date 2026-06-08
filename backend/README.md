# JJEMS Go Backend

This is the first Go backend migration slice for JJEMS.

The backend is designed to replace the local static-only server and make the
browser use one same-origin entrypoint:

```text
Browser -> http://host:8088/
Browser -> http://host:8088/api/*
```

It currently uses only the Go standard library.

## Run

From the repo root:

```bash
go run ./backend/cmd/jjems-server
```

Then open:

```text
http://127.0.0.1:8088
```

## Build

```bash
/usr/local/go/bin/go test ./...
/usr/local/go/bin/go build -o /tmp/jjems-server ./backend/cmd/jjems-server
```

## Systemd Deployment

Deployment files live in `deploy/`:

```text
deploy/jjems-server.service
deploy/jjems-server.env.example
deploy/INSTALL.md
```

The service runs `/usr/local/bin/jjems-server`, serves the current repo as the static root, and keeps command writes disabled by default. See `deploy/INSTALL.md` for install, verify, and upgrade commands.

## Environment

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

## API

```text
GET  /api/health
GET  /api/collector/status
GET  /api/system/status
GET  /api/db/health
GET  /api/sites
GET  /api/devices
GET  /api/cabinets
GET  /api/modbus-points
GET  /api/telemetry/status
GET  /api/telemetry/latest
GET  /api/telemetry/history
GET  /api/telemetry/bms-temperature
GET  /api/telemetry/gateway-onboarding
GET  /api/hiems/commands/health
GET  /api/hiems/commands/allowlist
POST /api/hiems/commands
```

`POST /api/hiems/commands` mirrors the current Python command API gate behavior:

- Default behavior is dry-run.
- Commands must be in the allowlist.
- Execute mode requires `JJEMS_ENABLE_WRITES=true`.
- Execute mode requires `Authorization: Bearer <JJEMS_COMMAND_TOKEN>`.
- Execute mode requires all safety acknowledgements.
- Low-power active/reactive power commands are limited by
  `JJEMS_COMMAND_MAX_POWER_KW`.
- All requests are appended to the command audit log.


## Go Collector Prototype

A Go collector prototype lives at `backend/cmd/jjems-collector`. It now runs
separate poll groups: `power` defaults to 1s for PCS power/frequency telemetry,
and `critical_alarm` defaults to 5s for SOC/SOH/BMS voltage/current/temperature
telemetry plus latest-state metadata. Each group writes sparse rows into
`telemetry_cabinet_1s`, upserts `telemetry_cabinet_latest`, and refreshes the
merged `live/hiems_latest.json`. `dc_voltage` / `dc_current` remain the BMS
battery-cluster values; PCS-side DC input values are stored separately as
`pcs_dc_power_kw`, `pcs_dc_voltage`, and `pcs_dc_current`. The active systemd
timers still call the existing Python wrappers until the Go collector has been
compared in the field.

Build and test without touching the active live JSON:

```bash
/usr/local/go/bin/go build -o /tmp/jjems-collector ./backend/cmd/jjems-collector
DATABASE_URL=postgres://ems:ems_dev_only_change_me@localhost:5432/ems \
  /tmp/jjems-collector --once --print-json --live-json /tmp/jjems_go_collector_latest.json

# Runtime defaults: --power-interval=1s, --critical-interval=5s.
```

## Smoke Tests

```bash
curl -sS http://127.0.0.1:8088/api/health
curl -sS http://127.0.0.1:8088/api/collector/status
curl -sS http://127.0.0.1:8088/api/system/status
curl -sS http://127.0.0.1:8088/api/db/health
curl -sS http://127.0.0.1:8088/api/sites
curl -sS http://127.0.0.1:8088/api/devices
curl -sS http://127.0.0.1:8088/api/cabinets
curl -sS http://127.0.0.1:8088/api/modbus-points
curl -sS http://127.0.0.1:8088/api/telemetry/status
curl -sS http://127.0.0.1:8088/api/telemetry/latest
curl -sS http://127.0.0.1:8088/api/telemetry/history
curl -sS http://127.0.0.1:8088/api/telemetry/bms-temperature
curl -sS http://127.0.0.1:8088/api/telemetry/gateway-onboarding
curl -sS http://127.0.0.1:8088/api/hiems/commands/allowlist
curl -sS -X POST http://127.0.0.1:8088/api/hiems/commands \
  -H 'Content-Type: application/json' \
  --data '{"command":"pcs.active_power_kw","value":1,"operator":"field","reason":"dry-run","dryRun":true,"execute":false}'
```
