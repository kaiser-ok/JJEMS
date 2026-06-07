# JJEMS Database Notes

## Current Local PostgreSQL Status

The local EMS database is already available and initialized.

Connection:

```text
postgres://ems:ems_dev_only_change_me@localhost:5432/ems
```

Confirmed local details:

```text
Host: localhost
Port: 5432
Database: ems
User: ems
Password: ems_dev_only_change_me
PostgreSQL: 16.14
Extensions: timescaledb, pgcrypto, pg_trgm
```

The EMS schema has been loaded. The database currently contains 39 public tables,
including:

```text
sites
devices
cabinets
modbus_points
telemetry_cabinet_1s
telemetry_cell_30s
telemetry_meter_1m
telemetry_pv_1m
alarm_events
dispatch_commands
audit_logs
mqtt_messages_raw
users
user_roles
api_tokens
```

## Repo Database Files

Database assets live under `db/`:

```text
db/schema.sql          PostgreSQL 16 + TimescaleDB DDL
db/seed.sql            Seed data
db/docker-compose.yml  Local TimescaleDB/PostgreSQL, Redis, Adminer, Mosquitto
db/README.md           Database setup notes
db/DEPLOYMENT.md       Deployment topology notes
db/SCHEMA.md           Full schema documentation
```

## Local Checks

Check port reachability:

```bash
nc -vz 127.0.0.1 5432
```

Check database connection:

```bash
psql postgres://ems:ems_dev_only_change_me@localhost:5432/ems -c 'select version();'
```

List tables:

```bash
psql postgres://ems:ems_dev_only_change_me@localhost:5432/ems -c '\dt'
```

List extensions:

```bash
psql postgres://ems:ems_dev_only_change_me@localhost:5432/ems -c "select extname from pg_extension order by extname;"
```

## Backend Direction

For the planned Rust or Go backend, use PostgreSQL/TimescaleDB as the source of
truth for long-running telemetry, alarms, command audit, users, roles, and site
configuration.

Recommended browser/API shape:

```text
Browser -> http://host:8088/
Browser -> http://host:8088/api/*
Backend -> PostgreSQL localhost:5432
Backend -> cabinet controller Modbus TCP, default 192.168.1.100:502
Backend -> MQTT broker if enabled
```

The browser should not call cabinet controller endpoints or local command ports
directly. Frontend API calls should use same-origin relative paths such as:

```text
/api/telemetry/latest
/api/telemetry/history
/api/hiems/commands
/api/hiems/commands/allowlist
/api/hiems/commands/health
```

This keeps firewall exposure simple and allows the backend to enforce RBAC,
command allowlists, safety checks, audit logging, and readback verification.
