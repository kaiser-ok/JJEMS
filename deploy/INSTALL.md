# JJEMS Go Backend Deployment

This installs the Go backend as a systemd service on the current edge host.

## Build

From the repo root:

```bash
/usr/local/go/bin/go test ./...
/usr/local/go/bin/go build -o /tmp/jjems-server ./backend/cmd/jjems-server
sudo install -m 0755 /tmp/jjems-server /usr/local/bin/jjems-server
```

## Configure

```bash
sudo mkdir -p /etc/jjems
sudo cp deploy/jjems-server.env.example /etc/jjems/jjems-server.env
sudo editor /etc/jjems/jjems-server.env
```

Keep `JJEMS_ENABLE_WRITES=false` for normal operation. Enable writes only for
controlled field testing with a generated `JJEMS_COMMAND_TOKEN`.

## Install Service

```bash
sudo cp deploy/jjems-server.service /etc/systemd/system/jjems-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now jjems-server
```

## Verify

```bash
systemctl status jjems-server --no-pager
curl -sS http://127.0.0.1:8088/api/health
curl -sS http://127.0.0.1:8088/api/db/health
curl -sS http://127.0.0.1:8088/api/telemetry/latest
```

View logs:

```bash
journalctl -u jjems-server -f
```

## Upgrade

```bash
/usr/local/go/bin/go test ./...
/usr/local/go/bin/go build -o /tmp/jjems-server ./backend/cmd/jjems-server
sudo install -m 0755 /tmp/jjems-server /usr/local/bin/jjems-server
sudo systemctl restart jjems-server
```
