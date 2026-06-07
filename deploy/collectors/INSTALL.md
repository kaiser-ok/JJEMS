# JJEMS Collector Timers

This documents the active per-minute systemd timer collectors.

Historical crontab entries, now removed:

```text
* * * * * /home/gentrice/jjems/scripts/hiems_mqtt_log_ingest_cron.sh
* * * * * /home/gentrice/jjems/scripts/hiems_signalr_bms_temperature_cron.sh
* * * * * /home/gentrice/jjems/scripts/hiems_soc_logger_cron.sh
```

Active systemd units:

```text
jjems-soc-logger.service
jjems-soc-logger.timer

jjems-mqtt-log-ingest.service
jjems-mqtt-log-ingest.timer

jjems-bms-temperature.service
jjems-bms-temperature.timer
```

## Install Units

```bash
sudo cp deploy/collectors/*.service deploy/collectors/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

## Test One-Shot Services

Run each once before enabling timers:

```bash
sudo systemctl start jjems-soc-logger.service
sudo systemctl start jjems-mqtt-log-ingest.service
sudo systemctl start jjems-bms-temperature.service
```

Check status/logs:

```bash
systemctl status jjems-soc-logger.service --no-pager
systemctl status jjems-mqtt-log-ingest.service --no-pager
systemctl status jjems-bms-temperature.service --no-pager

journalctl -u jjems-soc-logger.service -n 40 --no-pager
journalctl -u jjems-mqtt-log-ingest.service -n 40 --no-pager
journalctl -u jjems-bms-temperature.service -n 40 --no-pager
```

## Enable Timers

```bash
sudo systemctl enable --now jjems-soc-logger.timer
sudo systemctl enable --now jjems-mqtt-log-ingest.timer
sudo systemctl enable --now jjems-bms-temperature.timer
```

Verify timer schedule:

```bash
systemctl list-timers 'jjems-*' --no-pager
```

Verify backend status:

```bash
curl -sS http://127.0.0.1:8088/api/collector/status
curl -sS http://127.0.0.1:8088/api/telemetry/status
```

## Crontab Status

The old user crontab should stay absent while timers are active:

```bash
crontab -l
```

Expected output is `no crontab for gentrice`. Verify the active path instead:

```bash
systemctl list-timers 'jjems-*' --no-pager
curl -sS http://127.0.0.1:8088/api/collector/status
```

## Rollback

Stop timers:

```bash
sudo systemctl disable --now jjems-soc-logger.timer
sudo systemctl disable --now jjems-mqtt-log-ingest.timer
sudo systemctl disable --now jjems-bms-temperature.timer
```

Restore the three crontab lines above with:

```bash
crontab -e
```
