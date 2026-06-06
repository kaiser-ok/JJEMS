#!/usr/bin/env python3
"""
HiEMS cabinet controller command API gate.

This local edge API validates remote-control requests before any Modbus TCP
FC05/FC06 write can reach the cabinet controller. It is deliberately small and
uses only the Python standard library.

Default behavior is dry-run only. Real writes require:
  - starting this server with --enable-writes
  - setting JJEMS_COMMAND_TOKEN or --token
  - sending Authorization: Bearer <token>
  - all safety acknowledgements present
  - command listed in ALLOWLIST
"""

import argparse
import datetime as dt
import hmac
import json
import os
from pathlib import Path
import socket
import struct
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

DEFAULT_HOST = "192.168.1.100"
DEFAULT_PORT = 502
DEFAULT_LISTEN = "127.0.0.1"
DEFAULT_API_PORT = 9093
DEFAULT_AUDIT_LOG = "logs/hiems_command_audit.jsonl"

REQUIRED_SAFETY_ACKS = [
    "onsite_operator_present",
    "soc_in_safe_range",
    "no_active_protection_alarm",
    "low_power_test_only",
    "rollback_ready",
]

ALLOWLIST = {
    "pcs.remote_mode": {
        "label": "PCS 遠程/就地設定",
        "unit_id": 2,
        "fc": 5,
        "addr": 7,
        "kind": "coil",
        "allowed_values": [0, 1, False, True],
        "description": "1=遠程；0=就地",
    },
    "pcs.standby": {
        "label": "PCS 設備待機",
        "unit_id": 2,
        "fc": 5,
        "addr": 8,
        "kind": "coil",
        "allowed_values": [0, 1, False, True],
        "description": "1=待機；0=無效",
    },
    "pcs.start": {
        "label": "PCS 設備啟動",
        "unit_id": 2,
        "fc": 5,
        "addr": 2,
        "kind": "coil",
        "allowed_values": [1, True],
        "pulse": True,
        "description": "1=啟動 pulse",
    },
    "pcs.stop": {
        "label": "PCS 設備停機",
        "unit_id": 2,
        "fc": 5,
        "addr": 3,
        "kind": "coil",
        "allowed_values": [1, True],
        "pulse": True,
        "description": "1=停機 pulse",
    },
    "pcs.fault_reset": {
        "label": "PCS 故障復位",
        "unit_id": 2,
        "fc": 5,
        "addr": 1,
        "kind": "coil",
        "allowed_values": [1, True],
        "pulse": True,
        "description": "只在明確故障處置流程使用",
    },
    "pcs.run_mode": {
        "label": "PCS 運行模式選擇",
        "unit_id": 2,
        "fc": 6,
        "addr": 1,
        "kind": "enum_register",
        "allowed_values": [0, 1, 2, 3, 4],
        "description": "0=無；1=恒流充電；2=恒壓充電；3=恒功率充電；4=直流恒壓模式",
    },
    "pcs.active_power_kw": {
        "label": "PCS 恒功率有功功率期望",
        "unit_id": 2,
        "fc": 6,
        "addr": 4,
        "kind": "scaled_kw_register",
        "scale": 10,
        "engineering_unit": "kW",
        "default_abs_limit": 3.0,
        "description": "raw=kW*10；vendor sheet: 負=放電，正=充電；現場先限制低功率",
    },
    "pcs.reactive_power_kvar": {
        "label": "PCS 恒功率無功功率期望",
        "unit_id": 2,
        "fc": 6,
        "addr": 5,
        "kind": "scaled_kvar_register",
        "scale": 10,
        "engineering_unit": "kVar",
        "default_abs_limit": 3.0,
        "description": "raw=kVar*10；非第一階段必要",
    },
}


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def json_response(handler, status, payload):
    data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Access-Control-Allow-Origin", handler.server.cors_origin)
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.end_headers()
    handler.wfile.write(data)


def read_json(handler):
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    if length > 32768:
        raise ValueError("request body too large")
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8"))


def parse_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str) and value.strip() in ("0", "1", "true", "false"):
        return value.strip().lower() in ("1", "true")
    raise ValueError("coil command value must be boolean/0/1")


def to_signed_u16(value):
    ivalue = int(value)
    if ivalue < -32768 or ivalue > 32767:
        raise ValueError("signed register raw value out of int16 range")
    return ivalue & 0xFFFF


def validate_command(body, max_power_kw):
    command = body.get("command")
    spec = ALLOWLIST.get(command)
    if not spec:
        raise ValueError(f"unsupported command: {command}")

    dry_run = body.get("dryRun", True) is not False
    execute = body.get("execute", False) is True
    if execute and dry_run:
        raise ValueError("execute=true requires dryRun=false")

    safety_acks = body.get("safetyAcks") or []
    missing_acks = [x for x in REQUIRED_SAFETY_ACKS if x not in safety_acks]
    if execute and missing_acks:
        raise ValueError("missing safety acknowledgements: " + ", ".join(missing_acks))

    value = body.get("value")
    raw_value = None
    engineering_value = None

    if spec["kind"] == "coil":
        coil = parse_bool(value)
        if coil not in [parse_bool(x) for x in spec["allowed_values"]]:
            raise ValueError("coil value is not allowed for this command")
        raw_value = 0xFF00 if coil else 0x0000
        engineering_value = 1 if coil else 0
    elif spec["kind"] == "enum_register":
        if not isinstance(value, int):
            raise ValueError("enum register value must be an integer")
        if value not in spec["allowed_values"]:
            raise ValueError("enum register value is not allowed")
        raw_value = value
        engineering_value = value
    elif spec["kind"] in ("scaled_kw_register", "scaled_kvar_register"):
        if not isinstance(value, (int, float)):
            raise ValueError("scaled register value must be numeric")
        limit = min(float(max_power_kw), float(spec.get("default_abs_limit", max_power_kw)))
        if abs(float(value)) > limit:
            raise ValueError(f"absolute value exceeds current low-power limit: {limit:g} {spec.get('engineering_unit', '')}".strip())
        engineering_value = float(value)
        raw_value = to_signed_u16(round(engineering_value * spec["scale"]))
    else:
        raise ValueError("unsupported command kind")

    return {
        "command": command,
        "label": spec["label"],
        "unitId": spec["unit_id"],
        "fc": spec["fc"],
        "addr": spec["addr"],
        "value": engineering_value,
        "rawValue": raw_value,
        "dryRun": dry_run,
        "execute": execute,
        "missingSafetyAcks": missing_acks,
        "operator": body.get("operator") or "unknown",
        "reason": body.get("reason") or "",
        "clientTs": body.get("clientTs"),
    }


def modbus_write_single(host, port, unit_id, function_code, address, value, timeout):
    transaction_id = int(time.time() * 1000) & 0xFFFF
    request = struct.pack(
        ">HHHBBHH",
        transaction_id,
        0,
        6,
        unit_id,
        function_code,
        address,
        value,
    )
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(request)
        response = sock.recv(260)

    if len(response) < 12:
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
    echo_addr, echo_value = struct.unpack(">HH", response[8:12])
    if echo_addr != address or echo_value != value:
        raise RuntimeError(f"unexpected write echo: addr={echo_addr} value={echo_value}")
    return {"responseHex": response.hex(" "), "echoAddr": echo_addr, "echoValue": echo_value}


def check_auth(handler):
    expected = handler.server.command_token
    if not expected:
        return False
    header = handler.headers.get("Authorization", "")
    prefix = "Bearer "
    if not header.startswith(prefix):
        return False
    supplied = header[len(prefix):].strip()
    return hmac.compare_digest(supplied, expected)


def append_audit(path, record):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


class CommandHandler(BaseHTTPRequestHandler):
    server_version = "JJEMSHiEMSCommandAPI/0.1"

    def log_message(self, fmt, *args):
        if self.server.verbose:
            super().log_message(fmt, *args)

    def do_OPTIONS(self):
        json_response(self, 200, {"ok": True})

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/hiems/commands/allowlist":
            public = {k: {kk: vv for kk, vv in spec.items() if kk not in ("allowed_values",)} for k, spec in ALLOWLIST.items()}
            json_response(self, 200, {
                "ok": True,
                "ts": now_iso(),
                "host": self.server.modbus_host,
                "port": self.server.modbus_port,
                "writesEnabled": self.server.enable_writes,
                "tokenConfigured": bool(self.server.command_token),
                "requiredSafetyAcks": REQUIRED_SAFETY_ACKS,
                "commands": public,
            })
            return
        if path == "/api/hiems/commands/health":
            json_response(self, 200, {"ok": True, "ts": now_iso(), "writesEnabled": self.server.enable_writes})
            return
        json_response(self, 404, {"ok": False, "error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/hiems/commands":
            json_response(self, 404, {"ok": False, "error": "not found"})
            return

        audit = {"ts": now_iso(), "path": path, "remote": self.client_address[0], "status": "received"}
        try:
            body = read_json(self)
            plan = validate_command(body, self.server.max_power_kw)
            audit.update({"request": body, "plan": plan})

            if plan["execute"]:
                if not self.server.enable_writes:
                    raise PermissionError("writes are disabled; restart API with --enable-writes")
                if not check_auth(self):
                    raise PermissionError("missing or invalid bearer token")
                result = modbus_write_single(
                    self.server.modbus_host,
                    self.server.modbus_port,
                    plan["unitId"],
                    plan["fc"],
                    plan["addr"],
                    plan["rawValue"],
                    self.server.timeout,
                )
                audit.update({"status": "executed", "result": result})
                append_audit(self.server.audit_log, audit)
                json_response(self, 200, {"ok": True, "mode": "executed", "plan": plan, "result": result, "auditLog": self.server.audit_log})
                return

            audit.update({"status": "dry-run"})
            append_audit(self.server.audit_log, audit)
            json_response(self, 200, {"ok": True, "mode": "dry-run", "plan": plan, "auditLog": self.server.audit_log})
        except PermissionError as exc:
            audit.update({"status": "rejected", "error": str(exc)})
            append_audit(self.server.audit_log, audit)
            json_response(self, 403, {"ok": False, "error": str(exc)})
        except Exception as exc:
            audit.update({"status": "rejected", "error": str(exc)})
            append_audit(self.server.audit_log, audit)
            json_response(self, 400, {"ok": False, "error": str(exc)})


def main():
    p = argparse.ArgumentParser(description="HiEMS Modbus command API gate")
    p.add_argument("--listen", default=DEFAULT_LISTEN)
    p.add_argument("--api-port", type=int, default=DEFAULT_API_PORT)
    p.add_argument("--host", default=DEFAULT_HOST, help="HiEMS cabinet controller Modbus host")
    p.add_argument("--port", type=int, default=DEFAULT_PORT, help="HiEMS cabinet controller Modbus TCP port")
    p.add_argument("--timeout", type=float, default=3.0)
    p.add_argument("--audit-log", default=DEFAULT_AUDIT_LOG)
    p.add_argument("--enable-writes", action="store_true", help="Allow real FC05/FC06 writes when token auth and safety checks pass")
    p.add_argument("--token", default=os.environ.get("JJEMS_COMMAND_TOKEN", ""), help="Bearer token for execute mode; can also use JJEMS_COMMAND_TOKEN")
    p.add_argument("--max-power-kw", type=float, default=float(os.environ.get("JJEMS_COMMAND_MAX_POWER_KW", "3")))
    p.add_argument("--cors-origin", default=os.environ.get("JJEMS_COMMAND_CORS_ORIGIN", "*"))
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args()

    server = ThreadingHTTPServer((args.listen, args.api_port), CommandHandler)
    server.modbus_host = args.host
    server.modbus_port = args.port
    server.timeout = args.timeout
    server.enable_writes = args.enable_writes
    server.command_token = args.token
    server.max_power_kw = args.max_power_kw
    server.audit_log = args.audit_log
    server.cors_origin = args.cors_origin
    server.verbose = args.verbose

    print(json.dumps({
        "service": "hiems-command-api",
        "listen": args.listen,
        "apiPort": args.api_port,
        "modbusHost": args.host,
        "modbusPort": args.port,
        "writesEnabled": args.enable_writes,
        "tokenConfigured": bool(args.token),
        "maxPowerKw": args.max_power_kw,
        "auditLog": args.audit_log,
    }, ensure_ascii=False), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
