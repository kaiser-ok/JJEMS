#!/usr/bin/env python3
"""
Poll HiEMS gateway telemetry and write it to JJEMS.

Outputs:
  - TimescaleDB row: telemetry_cabinet_1s
  - Static web snapshot: live/hiems_latest.json

No third-party Python packages are required. Database writes use either:
  - local `psql` if DATABASE_URL/--db-url is set, or
  - `docker exec -i <container> psql ...` for the db/docker-compose.yml setup.
"""

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request


DEFAULT_HOST = "192.168.1.100"
DEFAULT_HTTP_BASE = "http://192.168.1.100/api"
DEFAULT_PORT = 502
DEFAULT_UNIT_ID = 1
DEFAULT_CABINET_ID = "44444444-0000-0000-0000-000000000001"
DEFAULT_DOCKER_CONTAINER = "jjems-pg"
DEFAULT_DB_USER = "ems"
DEFAULT_DB_NAME = "ems"
DEFAULT_LIVE_JSON = "live/hiems_latest.json"

# Runtime gateway map, zero-based PDU addresses. Station/BMS points are only
# kept when they have been cross-checked against HiEMS HTTP/MQTT values.
MODBUS_POINTS = {
    "socPct": {"fc": 4, "addr": 88, "qty": 1, "type": "u16", "scale": 0.1, "unit": "%", "status": "verified"},
    "sohPct": {"fc": 4, "addr": 89, "qty": 1, "type": "u16", "scale": 0.1, "unit": "%", "status": "candidate"},
    "bmsVoltageV": {"fc": 4, "addr": 86, "qty": 1, "type": "u16", "scale": 0.1, "unit": "V", "status": "candidate"},
    "bmsCurrentA": {"fc": 4, "addr": 87, "qty": 1, "type": "i16", "scale": 0.1, "unit": "A", "status": "vendor-sheet verified"},
    "maxCellTempC": {"fc": 4, "addr": 97, "qty": 1, "type": "i16", "scale": 0.1, "unit": "degC", "status": "vendor-sheet verified"},
    "avgCellTempC": {"fc": 4, "addr": 103, "qty": 1, "type": "i16", "scale": 0.1, "unit": "degC", "status": "vendor-sheet verified"},
    "bmsChargeKWh": {"fc": 4, "addr": 126, "qty": 2, "type": "u32_be_words", "scale": 0.1, "unit": "kWh", "status": "vendor-sheet verified"},
    "bmsDischargeKWh": {"fc": 4, "addr": 128, "qty": 2, "type": "u32_be_words", "scale": 0.1, "unit": "kWh", "status": "vendor-sheet verified"},
}

# Updated vendor sheet: docs/ref/vendor-modbus-update.xlsx, sheet 1.2遥测.
# Modbus地址（04） is used directly as the PDU address on this gateway.
# Modbus系数（/） means engineering value = raw / coefficient.
PCS_UNIT_ID = 2
PCS_POINTS = {
    "frequencyHz": {"fc": 4, "addr": 24, "qty": 1, "type": "u16", "scale": 0.01, "unit": "Hz", "status": "vendor-sheet verified"},
    "pcsKW": {"fc": 4, "addr": 28, "qty": 1, "type": "i16", "scale": 0.1, "unit": "kW", "status": "vendor-sheet verified"},
    "pcsKVar": {"fc": 4, "addr": 32, "qty": 1, "type": "i16", "scale": 0.1, "unit": "kVar", "status": "vendor-sheet verified"},
    "pcsChargeKWh": {"fc": 4, "addr": 45, "qty": 2, "type": "u32_be_words", "scale": 0.001, "unit": "kWh", "status": "vendor-sheet verified"},
    "pcsDischargeKWh": {"fc": 4, "addr": 47, "qty": 2, "type": "u32_be_words", "scale": 0.001, "unit": "kWh", "status": "vendor-sheet verified"},
}


def read_modbus_registers(host, port, unit_id, function_code, address, quantity, timeout):
    transaction_id = int(time.time() * 1000) & 0xFFFF
    request = struct.pack(
        ">HHHBBHH",
        transaction_id,
        0,
        6,
        unit_id,
        function_code,
        address,
        quantity,
    )

    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(request)
        response = sock.recv(260)

    if len(response) < 9:
        raise RuntimeError(f"short Modbus response: {response.hex(' ')}")

    resp_tid, protocol_id, _length = struct.unpack(">HHH", response[:6])
    resp_unit = response[6]
    resp_func = response[7]

    if resp_tid != transaction_id:
        raise RuntimeError(f"transaction id mismatch: expected {transaction_id}, got {resp_tid}")
    if protocol_id != 0:
        raise RuntimeError(f"unexpected Modbus protocol id: {protocol_id}")
    if resp_unit != unit_id:
        raise RuntimeError(f"unit id mismatch: expected {unit_id}, got {resp_unit}")
    if resp_func & 0x80:
        raise RuntimeError(f"Modbus exception for FC{function_code} addr {address}: code {response[8]}")
    if resp_func != function_code:
        raise RuntimeError(f"function code mismatch: expected {function_code}, got {resp_func}")

    byte_count = response[8]
    payload = response[9:9 + byte_count]
    if byte_count != quantity * 2 or len(payload) != quantity * 2:
        raise RuntimeError(f"unexpected register payload: {payload.hex(' ')}")

    return [int.from_bytes(payload[i:i + 2], "big", signed=False) for i in range(0, len(payload), 2)]


def decode_registers(registers, dtype):
    if dtype == "u16":
        return registers[0]
    if dtype == "i16":
        return struct.unpack(">h", registers[0].to_bytes(2, "big"))[0]
    if dtype == "u32_be_words":
        return (registers[0] << 16) | registers[1]
    if dtype == "i32_be_words":
        value = (registers[0] << 16) | registers[1]
        return value - 2**32 if value >= 2**31 else value
    if dtype == "u32_le_words":
        return (registers[1] << 16) | registers[0]
    if dtype == "i32_le_words":
        value = (registers[1] << 16) | registers[0]
        return value - 2**32 if value >= 2**31 else value
    raise ValueError(f"unsupported data type: {dtype}")


def post_json(url, payload, timeout):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def read_station_info(http_base, timeout):
    try:
        body = post_json(f"{http_base.rstrip('/')}/Common/StationInfo?MapId=1", {}, timeout)
        if body.get("code") == 200 and isinstance(body.get("data"), dict):
            return body["data"]
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return {"_error": str(exc)}
    return {}


def read_modbus_points(args, points, unit_id=None):
    values = {}
    raw = {}
    errors = {}
    target_unit_id = args.unit_id if unit_id is None else unit_id
    for name, spec in points.items():
        try:
            regs = read_modbus_registers(args.host, args.port, target_unit_id, spec["fc"], spec["addr"], spec["qty"], args.timeout)
            decoded = decode_registers(regs, spec["type"])
            raw[name] = decoded
            values[name] = round(decoded * spec["scale"], 3)
        except Exception as exc:
            errors[name] = str(exc)
    return values, raw, errors


def quote_sql(value):
    return "'" + str(value).replace("'", "''") + "'"


def sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, str):
        return quote_sql(value)
    return str(value)


def build_insert_sql(cabinet_id, snapshot):
    ts = dt.datetime.now(dt.timezone.utc).isoformat()
    columns = ["ts", "cabinet_id"]
    values = [quote_sql(ts), f"{quote_sql(cabinet_id)}::uuid"]
    # Only API/field-verified values are inserted into telemetry history.
    # Candidate Modbus points remain visible in live JSON for mapping work.
    field_map = {
        "socPct": "soc",
        "sohPct": "soh",
    }
    for src, dest in field_map.items():
        val = snapshot.get(src)
        if val is not None:
            columns.append(dest)
            values.append(sql_value(val))
    return f"INSERT INTO telemetry_cabinet_1s ({', '.join(columns)}) VALUES ({', '.join(values)});"


def run_sql(sql, args):
    if args.print_sql:
        print(sql, flush=True)
        return

    if args.db_url:
        if not shutil.which("psql"):
            raise RuntimeError("psql was not found; use --docker-container or install psql")
        cmd = ["psql", args.db_url, "-v", "ON_ERROR_STOP=1", "-c", sql]
    else:
        if not shutil.which("docker"):
            raise RuntimeError("docker was not found; set --db-url for local psql")
        cmd = [
            "docker", "exec", "-i", args.docker_container,
            "psql", "-U", args.db_user, "-d", args.db_name,
            "-v", "ON_ERROR_STOP=1", "-c", sql,
        ]

    subprocess.run(cmd, check=True)


def write_live_json(path, snapshot):
    if not path:
        return
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(target)


def build_snapshot(args):
    modbus_values, modbus_raw, modbus_errors = read_modbus_points(args, MODBUS_POINTS)
    pcs_values, pcs_raw, pcs_errors = read_modbus_points(args, PCS_POINTS, PCS_UNIT_ID)
    station = read_station_info(args.http_base, args.timeout)

    snapshot = {
        "ts": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": "hiems-gateway",
        "host": args.host,
        "siteHasPV": False,
        "siteHasEV": False,
        "powerVerified": False,
        "pvKW": 0.0,
        "meta": {
            "modbusStatus": {k: v["status"] for k, v in MODBUS_POINTS.items()},
            "pcsStatus": {k: v["status"] for k, v in PCS_POINTS.items()},
            "modbusRaw": modbus_raw,
            "modbusErrors": modbus_errors,
            "pcsRaw": pcs_raw,
            "pcsErrors": pcs_errors,
            "stationInfoName": station.get("name"),
        },
    }

    snapshot.update(modbus_values)
    snapshot.update(pcs_values)

    # Prefer API-verified values where available.
    api_map = {
        "soc": "socPct",
        "soh": "sohPct",
        "accuChargeQuantity": "accuChargeKWh",
        "accDischargeQuantity": "accuDischargeKWh",
        "dayChargeQuantity": "dayChargeKWh",
        "dayDischargeQuantity": "dayDischargeKWh",
    }
    for api_key, target_key in api_map.items():
        if isinstance(station.get(api_key), (int, float)):
            snapshot[target_key] = station[api_key]

    return snapshot


def poll_once(args):
    snapshot = build_snapshot(args)
    if not 0 <= float(snapshot.get("socPct", -1)) <= 100:
        raise RuntimeError(f"SOC out of range: {snapshot.get('socPct')}")

    sql = build_insert_sql(args.cabinet_id, snapshot)
    run_sql(sql, args)
    write_live_json(args.live_json, snapshot)
    return snapshot


def main():
    parser = argparse.ArgumentParser(description="Log HiEMS telemetry to JJEMS DB and live JSON.")
    parser.add_argument("--host", default=os.getenv("HIEMS_HOST", DEFAULT_HOST))
    parser.add_argument("--http-base", default=os.getenv("HIEMS_HTTP_BASE", DEFAULT_HTTP_BASE))
    parser.add_argument("--port", type=int, default=int(os.getenv("HIEMS_PORT", DEFAULT_PORT)))
    parser.add_argument("--unit-id", type=int, default=int(os.getenv("HIEMS_UNIT_ID", DEFAULT_UNIT_ID)))
    parser.add_argument("--cabinet-id", default=os.getenv("JJEMS_CABINET_ID", DEFAULT_CABINET_ID))
    parser.add_argument("--interval", type=float, default=float(os.getenv("SOC_LOG_INTERVAL_SEC", "60")))
    parser.add_argument("--timeout", type=float, default=float(os.getenv("HIEMS_TIMEOUT_SEC", "5")))
    parser.add_argument("--once", action="store_true", help="Read and insert one sample, then exit.")
    parser.add_argument("--print-sql", action="store_true", help="Print INSERT SQL instead of writing DB.")
    parser.add_argument("--print-json", action="store_true", help="Print the snapshot JSON after polling.")
    parser.add_argument("--live-json", default=os.getenv("HIEMS_LIVE_JSON", DEFAULT_LIVE_JSON))
    parser.add_argument("--db-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--docker-container", default=os.getenv("JJEMS_DB_CONTAINER", DEFAULT_DOCKER_CONTAINER))
    parser.add_argument("--db-user", default=os.getenv("JJEMS_DB_USER", DEFAULT_DB_USER))
    parser.add_argument("--db-name", default=os.getenv("JJEMS_DB_NAME", DEFAULT_DB_NAME))
    args = parser.parse_args()

    while True:
        try:
            snapshot = poll_once(args)
            now = dt.datetime.now().isoformat(timespec="seconds")
            print(
                f"{now} soc={snapshot.get('socPct')}% soh={snapshot.get('sohPct')}% "
                f"grid={snapshot.get('gridKW')}kW ess={snapshot.get('essKW')}kW load={snapshot.get('loadKW')}kW",
                flush=True,
            )
            if args.print_json:
                print(json.dumps(snapshot, ensure_ascii=False, indent=2), flush=True)
        except Exception as exc:
            print(f"ERROR: {exc}", file=sys.stderr, flush=True)
            if args.once:
                return 1

        if args.once:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
