#!/usr/bin/env bash
set -euo pipefail

cd /home/gentrice/jjems
export DATABASE_URL='postgres://ems:ems_dev_only_change_me@localhost:5432/ems'

mkdir -p /home/gentrice/jjems/logs

{
  echo "[$(date --iso-8601=seconds)] hiems_soc_logger start"
  /usr/bin/python3 /home/gentrice/jjems/scripts/hiems_soc_logger.py --once
  echo "[$(date --iso-8601=seconds)] hiems_soc_logger ok"
} >> /home/gentrice/jjems/logs/hiems_soc_logger.log 2>&1
