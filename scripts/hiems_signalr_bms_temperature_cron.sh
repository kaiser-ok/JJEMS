#!/usr/bin/env bash
set -euo pipefail

cd /home/gentrice/jjems
python3 scripts/hiems_signalr_bms_temperature.py >> logs/hiems_signalr_bms_temperature.log 2>&1
