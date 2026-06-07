# JJEMS Service Runbook

## Installed Service

`jjems-server` is installed as a systemd system service:

```text
Service: jjems-server.service
Unit: /etc/systemd/system/jjems-server.service
Binary: /usr/local/bin/jjems-server
Environment: /etc/jjems/jjems-server.env
Working directory: /home/gentrice/jjems
Static root: /home/gentrice/jjems
HTTP listen: 0.0.0.0:8088
```

Primary URL:

```text
http://127.0.0.1:8088
```

## Current Service Behavior

The Go backend serves:

```text
/                 static SPA
/api/*            same-origin backend APIs
```

Important APIs:

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

Telemetry status currently reports:

```text
source: timescaledb
storage: telemetry_cabinet_1s
postgres: ok
modbus: ok
mqtt: down if 127.0.0.1:1883 is not running
```

`/api/telemetry/latest` and `/api/telemetry/history` prefer TimescaleDB and fall
back to `live/*.json` only if DB data is unavailable.

## Common Commands

Status and logs:

```bash
systemctl status jjems-server --no-pager
journalctl -u jjems-server -n 80 --no-pager
journalctl -u jjems-server -f
```

Restart:

```bash
sudo systemctl restart jjems-server
```

API smoke tests:

```bash
curl -sS http://127.0.0.1:8088/api/health
curl -sS http://127.0.0.1:8088/api/collector/status
curl -sS http://127.0.0.1:8088/api/db/health
curl -sS http://127.0.0.1:8088/api/telemetry/status
curl -sS http://127.0.0.1:8088/api/telemetry/latest
curl -sS http://127.0.0.1:8088/api/hiems/commands/allowlist
```

Dry-run command API test:

```bash
curl -sS -X POST http://127.0.0.1:8088/api/hiems/commands \
  -H 'Content-Type: application/json' \
  --data '{"command":"pcs.active_power_kw","value":1,"operator":"field","reason":"dry-run","dryRun":true,"execute":false}'
```

Expected dry-run result includes:

```text
ok: true
mode: dry-run
plan.rawValue: 10
```

## Build And Deploy

Build without sudo:

```bash
cd /home/gentrice/jjems
/usr/local/go/bin/gofmt -w backend/cmd/jjems-server/main.go
/usr/local/go/bin/go test ./...
/usr/local/go/bin/go build -o /tmp/jjems-server ./backend/cmd/jjems-server
```

Install updated binary:

```bash
sudo /usr/bin/install -m 0755 /tmp/jjems-server /usr/local/bin/jjems-server
sudo systemctl restart jjems-server
```

Verify:

```bash
systemctl status jjems-server --no-pager
curl -sS http://127.0.0.1:8088/api/health
curl -sS http://127.0.0.1:8088/api/collector/status
curl -sS http://127.0.0.1:8088/api/telemetry/status
```

## Scoped Sudoers

The goal is to allow only narrow, service-specific privileged operations.

### Service Management

Validated sudoers source:

```text
/tmp/jjems-server-sudoers
```

Installed target:

```text
/etc/sudoers.d/jjems-server
```

Rule:

```text
gentrice ALL=(root) NOPASSWD: /usr/bin/systemctl start jjems-server, /usr/bin/systemctl stop jjems-server, /usr/bin/systemctl restart jjems-server, /usr/bin/systemctl status jjems-server, /usr/bin/systemctl status jjems-server --no-pager
```

Validate:

```bash
sudo visudo -cf /etc/sudoers.d/jjems-server
```

Allowed commands:

```bash
sudo systemctl start jjems-server
sudo systemctl stop jjems-server
sudo systemctl restart jjems-server
sudo systemctl status jjems-server
sudo systemctl status jjems-server --no-pager
```

### Binary Install

Installed target:

```text
/etc/sudoers.d/jjems-install
```

Rule:

```text
gentrice ALL=(root) NOPASSWD: /usr/bin/install -m 0755 /tmp/jjems-server /usr/local/bin/jjems-server
```

Validate:

```bash
sudo visudo -cf /etc/sudoers.d/jjems-install
```

Allowed command:

```bash
sudo /usr/bin/install -m 0755 /tmp/jjems-server /usr/local/bin/jjems-server
```

Note: sudo is still required because `/usr/local/bin` is system-owned. The
sudoers rule removes the password prompt only for the exact command above.

## Configuration

Current environment file:

```text
/etc/jjems/jjems-server.env
```

Template in repo:

```text
deploy/jjems-server.env.example
```

Important settings:

```text
JJEMS_LISTEN=0.0.0.0:8088
JJEMS_STATIC_ROOT=/home/gentrice/jjems
DATABASE_URL=postgres://ems:ems_dev_only_change_me@localhost:5432/ems
JJEMS_DATABASE_ADDR=127.0.0.1:5432
JJEMS_MQTT_ADDR=127.0.0.1:1883
JJEMS_MODBUS_HOST=192.168.1.100
JJEMS_MODBUS_PORT=502
JJEMS_ENABLE_WRITES=false
JJEMS_COMMAND_MAX_POWER_KW=3
JJEMS_COMMAND_AUDIT_LOG=/home/gentrice/jjems/logs/hiems_command_audit.jsonl
```

Keep `JJEMS_ENABLE_WRITES=false` unless doing controlled field testing.

## Known Notes

- If `jjems-server` fails with `bind: address already in use`, another process
  is already using port `8088`. Stop any manual `go run` or Python static server.
- `MQTT` may show down if no local broker is listening on `127.0.0.1:1883`.
  Either start Mosquitto locally or update `JJEMS_MQTT_ADDR` to the correct host.
- Runtime command audit files are ignored by git via `logs/*.jsonl`.
- There is an unrelated existing untracked file with a malformed name beginning
  `h, registers...`; do not remove it unless explicitly asked.
