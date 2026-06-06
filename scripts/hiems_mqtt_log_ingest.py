#!/usr/bin/env python3
"""
Ingest HiEMS HCMQTT telemetry from the local mini broker log.

The cabinet controller publishes PCS, BMS, and aggregate telemetry as JSON
payloads. This script tails the JSON-line broker log incrementally, merges the
latest values, writes one combined telemetry_cabinet_1s row, and refreshes the
static live snapshot used by the web UI.
"""

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


DEFAULT_LOG = "logs/mqtt_broker.log"
DEFAULT_STATE = "state/hiems_mqtt_ingest.json"
DEFAULT_LIVE_JSON = "live/hiems_latest.json"
DEFAULT_HISTORY_JSON = "live/hiems_history_24h.json"
DEFAULT_CABINET_ID = "44444444-0000-0000-0000-000000000001"


def to_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_int(value):
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def quote_sql(value):
    return "'" + str(value).replace("'", "''") + "'"


def sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, str):
        return quote_sql(value)
    return str(value)


def load_state(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"offset": 0, "latest": {}}
    except json.JSONDecodeError:
        return {"offset": 0, "latest": {}}


def save_state(path, state):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(target)


def parse_publish(line):
    try:
        entry = json.loads(line)
    except json.JSONDecodeError:
        return None
    if entry.get("event") != "publish":
        return None
    topic = entry.get("topic")
    if topic not in {"$ESS/271/data", "$ESS/272/data", "$ESS/282/data"}:
        return None
    try:
        payload = json.loads(entry.get("payload") or "{}")
    except json.JSONDecodeError:
        return None
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    return {
        "log_ts": entry.get("ts"),
        "topic": topic,
        "payload_ts": payload.get("ts"),
        "data": data,
    }


def read_new_publishes(log_path, state):
    path = Path(log_path)
    if not path.exists():
        return []

    size = path.stat().st_size
    offset = int(state.get("offset") or 0)
    if offset > size:
        offset = 0

    publishes = []
    with path.open("r", encoding="utf-8") as fh:
        fh.seek(offset)
        for line in fh:
            item = parse_publish(line)
            if item:
                publishes.append(item)
        state["offset"] = fh.tell()
    return publishes


def merge_latest(latest, publish):
    topic = publish["topic"]
    data = publish["data"]
    latest["lastMqttLogTs"] = publish.get("log_ts")
    latest["lastMqttPayloadTs"] = publish.get("payload_ts")

    if topic == "$ESS/271/data":
        latest["frequency"] = to_float(data.get("3")) if "3" in data else latest.get("frequency")
        latest["pcs_p_kw"] = to_float(data.get("11")) if "11" in data else latest.get("pcs_p_kw")
        latest["pcs_q_kvar"] = to_float(data.get("12")) if "12" in data else latest.get("pcs_q_kvar")
        latest["pcs_charge_kwh"] = to_float(data.get("35")) if "35" in data else latest.get("pcs_charge_kwh")
        latest["pcs_discharge_kwh"] = to_float(data.get("36")) if "36" in data else latest.get("pcs_discharge_kwh")
        latest["pcs_status"] = to_int(data.get("0")) if "0" in data else latest.get("pcs_status")

    if topic == "$ESS/272/data":
        latest["bms_status"] = to_int(data.get("1")) if "1" in data else latest.get("bms_status")
        latest["dc_voltage"] = to_float(data.get("2")) if "2" in data else latest.get("dc_voltage")
        latest["dc_current"] = to_float(data.get("3")) if "3" in data else latest.get("dc_current")
        latest["soc"] = to_float(data.get("4")) if "4" in data else latest.get("soc")
        latest["soh"] = to_float(data.get("5")) if "5" in data else latest.get("soh")
        latest["insulation_kohm"] = to_float(data.get("6")) if "6" in data else latest.get("insulation_kohm")
        latest["temp_avg"] = to_float(data.get("8")) if "8" in data else latest.get("temp_avg")
        latest["temp_max"] = to_float(data.get("13")) if "13" in data else latest.get("temp_max")
        latest["bms_charge_kwh"] = to_float(data.get("25")) if "25" in data else latest.get("bms_charge_kwh")
        latest["bms_discharge_kwh"] = to_float(data.get("26")) if "26" in data else latest.get("bms_discharge_kwh")
        latest["charge_prohibited"] = to_int(data.get("43")) if "43" in data else latest.get("charge_prohibited")
        latest["discharge_prohibited"] = to_int(data.get("44")) if "44" in data else latest.get("discharge_prohibited")
        latest["alarm_status"] = to_int(data.get("45")) if "45" in data else latest.get("alarm_status")

    if topic == "$ESS/282/data":
        key_map = {
            "soc": "soc",
            "soh": "soh",
            "rated_kw": "rated_kw",
            "pcs_kw": "pcs_p_kw",
            "pcs_kvar": "pcs_q_kvar",
            "pcs_charge_kwh": "pcs_charge_kwh",
            "pcs_discharge_kwh": "pcs_discharge_kwh",
            "max_charge_kw": "max_charge_kw",
            "max_discharge_kw": "max_discharge_kw",
            "remote_set_kw": "remote_set_kw",
            "grid_kw": "grid_kw",
            "grid_meter_kw": "grid_kw",
            "pv_kw": "pv_kw",
            "storage_meter_kw": "storage_meter_kw",
        }
        for src, dest in key_map.items():
            if src in data:
                latest[dest] = to_float(data.get(src))
        for src, dest in {
            "status": "controller_status",
            "pv_present": "site_has_pv",
            "ess_present": "site_has_ess",
            "ems_status": "ems_status",
            "on_grid": "on_grid",
            "control_mode": "control_mode",
            "strategy_status": "strategy_status",
        }.items():
            if src in data:
                latest[dest] = to_int(data.get(src))


def build_snapshot(latest, cabinet_id):
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    snapshot = {
        "ts": now,
        "source": "hiems-hcmqtt",
        "cabinetId": cabinet_id,
        "siteHasEV": False,
        "siteHasPV": bool(latest.get("site_has_pv")),
        "siteHasESS": bool(latest.get("site_has_ess", 1)),
        "powerVerified": True,
        "socPct": latest.get("soc"),
        "sohPct": latest.get("soh"),
        "pcsKW": latest.get("pcs_p_kw"),
        "pcsKVar": latest.get("pcs_q_kvar"),
        "frequencyHz": latest.get("frequency"),
        "dcVoltageV": latest.get("dc_voltage"),
        "dcCurrentA": latest.get("dc_current"),
        "tempAvgC": latest.get("temp_avg"),
        "tempMaxC": latest.get("temp_max"),
        "insulationKOhm": latest.get("insulation_kohm"),
        "pvKW": latest.get("pv_kw", 0.0 if not latest.get("site_has_pv") else None),
        "gridKW": latest.get("grid_kw"),
        "essKW": latest.get("pcs_p_kw"),
        "ratedKW": latest.get("rated_kw"),
        "maxChargeKW": latest.get("max_charge_kw"),
        "maxDischargeKW": latest.get("max_discharge_kw"),
        "accuChargeKWh": latest.get("pcs_charge_kwh"),
        "accuDischargeKWh": latest.get("pcs_discharge_kwh"),
        "remoteSetKW": latest.get("remote_set_kw"),
        "strategyStatus": latest.get("strategy_status"),
        "controlMode": latest.get("control_mode"),
        "onGrid": latest.get("on_grid"),
        "meta": {
            "lastMqttLogTs": latest.get("lastMqttLogTs"),
            "lastMqttPayloadTs": latest.get("lastMqttPayloadTs"),
            "chargeProhibited": latest.get("charge_prohibited"),
            "dischargeProhibited": latest.get("discharge_prohibited"),
            "alarmStatus": latest.get("alarm_status"),
            "controllerStatus": latest.get("controller_status"),
            "pcsStatus": latest.get("pcs_status"),
            "bmsStatus": latest.get("bms_status"),
        },
    }
    grid = snapshot.get("gridKW")
    pv = snapshot.get("pvKW")
    ess = snapshot.get("essKW")
    if all(isinstance(v, (int, float)) for v in (grid, pv, ess)):
        snapshot["loadKW"] = round(grid + pv + ess, 3)
    return snapshot


def build_insert_sql(cabinet_id, latest):
    columns = ["ts", "cabinet_id"]
    values = [quote_sql(dt.datetime.now(dt.timezone.utc).isoformat()), f"{quote_sql(cabinet_id)}::uuid"]
    field_map = {
        "pcs_p_kw": "pcs_p_kw",
        "pcs_q_kvar": "pcs_q_kvar",
        "dc_voltage": "dc_voltage",
        "dc_current": "dc_current",
        "frequency": "frequency",
        "soc": "soc",
        "soh": "soh",
        "temp_avg": "temp_avg",
        "temp_max": "temp_max",
        "insulation_kohm": "insulation_kohm",
        "alarm_status": "status_bitmap",
    }
    for src, dest in field_map.items():
        value = latest.get(src)
        if value is not None:
            columns.append(dest)
            values.append(sql_value(value))
    return f"INSERT INTO telemetry_cabinet_1s ({', '.join(columns)}) VALUES ({', '.join(values)});"


def run_sql(sql, db_url, print_sql):
    if print_sql:
        print(sql)
        return
    if not db_url:
        raise RuntimeError("DATABASE_URL or --db-url is required")
    if not shutil.which("psql"):
        raise RuntimeError("psql was not found")
    subprocess.run(["psql", db_url, "-v", "ON_ERROR_STOP=1", "-c", sql], check=True)


def write_json_file(path, payload):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(target)


def write_live_json(path, snapshot):
    write_json_file(path, snapshot)


def append_history(state, snapshot, hours=24):
    history = state.setdefault("history", [])
    sample = {
        "ts": snapshot.get("ts"),
        "socPct": snapshot.get("socPct"),
        "sohPct": snapshot.get("sohPct"),
        "pcsKW": snapshot.get("pcsKW"),
        "pcsKVar": snapshot.get("pcsKVar"),
        "essKW": snapshot.get("essKW"),
        "gridKW": snapshot.get("gridKW"),
        "loadKW": snapshot.get("loadKW"),
        "pvKW": snapshot.get("pvKW"),
        "frequencyHz": snapshot.get("frequencyHz"),
        "dcVoltageV": snapshot.get("dcVoltageV"),
        "dcCurrentA": snapshot.get("dcCurrentA"),
        "tempAvgC": snapshot.get("tempAvgC"),
        "tempMaxC": snapshot.get("tempMaxC"),
    }
    history.append(sample)
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)
    dedup = {}
    for item in history:
        try:
            item_ts = dt.datetime.fromisoformat(str(item.get("ts")).replace("Z", "+00:00"))
        except ValueError:
            continue
        if item_ts >= cutoff:
            dedup[item.get("ts")] = item
    state["history"] = [dedup[k] for k in sorted(dedup)]
    return state["history"]


def write_history_json(path, history):
    payload = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": "hiems-hcmqtt",
        "sampleIntervalSec": 60,
        "samples": history,
    }
    write_json_file(path, payload)


def main():
    parser = argparse.ArgumentParser(description="Ingest HiEMS MQTT broker log into DB/live JSON.")
    parser.add_argument("--log", default=os.getenv("HIEMS_MQTT_LOG", DEFAULT_LOG))
    parser.add_argument("--state", default=os.getenv("HIEMS_MQTT_INGEST_STATE", DEFAULT_STATE))
    parser.add_argument("--live-json", default=os.getenv("HIEMS_LIVE_JSON", DEFAULT_LIVE_JSON))
    parser.add_argument("--history-json", default=os.getenv("HIEMS_HISTORY_JSON", DEFAULT_HISTORY_JSON))
    parser.add_argument("--cabinet-id", default=os.getenv("JJEMS_CABINET_ID", DEFAULT_CABINET_ID))
    parser.add_argument("--db-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--print-json", action="store_true")
    parser.add_argument("--print-sql", action="store_true")
    args = parser.parse_args()

    state = load_state(args.state)
    latest = state.setdefault("latest", {})
    publishes = read_new_publishes(args.log, state)
    for publish in publishes:
        merge_latest(latest, publish)

    if not latest.get("soc"):
        save_state(args.state, state)
        print("No SOC in MQTT state yet; waiting for BMS publish.", file=sys.stderr)
        return 1

    sql = build_insert_sql(args.cabinet_id, latest)
    run_sql(sql, args.db_url, args.print_sql)
    snapshot = build_snapshot(latest, args.cabinet_id)
    write_live_json(args.live_json, snapshot)
    history = append_history(state, snapshot)
    write_history_json(args.history_json, history)
    state["lastIngestAt"] = snapshot["ts"]
    save_state(args.state, state)

    if args.print_json:
        print(json.dumps(snapshot, ensure_ascii=False, indent=2))
    else:
        print(
            f"soc={snapshot.get('socPct')} pcs={snapshot.get('pcsKW')} "
            f"grid={snapshot.get('gridKW')} pv={snapshot.get('pvKW')}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
