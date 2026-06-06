#!/usr/bin/env bash
set -euo pipefail

cd /home/gentrice/jjems
export DATABASE_URL="${DATABASE_URL:-postgres://ems:ems_dev_only_change_me@localhost:5432/ems}"
python3 scripts/hiems_mqtt_log_ingest.py >> logs/hiems_mqtt_log_ingest.log 2>&1
