#!/usr/bin/env python3
"""
HiEMS gateway onboarding helper for JJEMS.

The script inspects a cabinet controller's northbound forwarding setup and
prints a deterministic plan. With --apply it can create or enable the JJEMS
MQTT and Modbus TCP entries using the same RuoYi-style API used by the HiEMS UI.
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_GATEWAY = "http://192.168.1.100/api"
DEFAULT_USER = "admin"
DEFAULT_PASSWORD = "hcadmin"
DEFAULT_MQTT_NAME = "jjems-mqtt"
DEFAULT_MQTT_MASTER = "jjems-mqtt-master"
DEFAULT_MODBUS_NAME = "jjems"
DEFAULT_MODBUS_MASTER = "jjems-modbus-server"
DEFAULT_CLIENT_ID = "jjems-cabinet-001"
DEFAULT_MQTT_USER = "jjems"
DEFAULT_MQTT_PASSWORD = "jjems_dev"
DEFAULT_MQTT_PORT = 1883
DEFAULT_MODBUS_PORT = 502
DEFAULT_OUT = "live/hiems_gateway_onboarding.json"


CORE_RULEMAP = [
    # ruledevid is discovered after rule devices are created/listed.
    {"deviceid": 271, "propertyid": 44433, "rulekey": "0", "meaning": "PCS online"},
    {"deviceid": 271, "propertyid": 44759, "rulekey": "3", "meaning": "frequency"},
    {"deviceid": 271, "propertyid": 44760, "rulekey": "11", "meaning": "pcs_p_kw"},
    {"deviceid": 271, "propertyid": 44761, "rulekey": "12", "meaning": "pcs_q_kvar"},
    {"deviceid": 271, "propertyid": 44767, "rulekey": "35", "meaning": "pcs_charge_kwh"},
    {"deviceid": 271, "propertyid": 44768, "rulekey": "36", "meaning": "pcs_discharge_kwh"},
    {"deviceid": 272, "propertyid": 44434, "rulekey": "0", "meaning": "BMS online"},
    {"deviceid": 272, "propertyid": 44572, "rulekey": "1", "meaning": "bms_status"},
    {"deviceid": 272, "propertyid": 44566, "rulekey": "2", "meaning": "dc_voltage"},
    {"deviceid": 272, "propertyid": 44567, "rulekey": "3", "meaning": "dc_current"},
    {"deviceid": 272, "propertyid": 44568, "rulekey": "4", "meaning": "soc"},
    {"deviceid": 272, "propertyid": 44569, "rulekey": "5", "meaning": "soh"},
    {"deviceid": 272, "propertyid": 44570, "rulekey": "6", "meaning": "insulation"},
    {"deviceid": 272, "propertyid": 44579, "rulekey": "8", "meaning": "temp_avg"},
    {"deviceid": 272, "propertyid": 44573, "rulekey": "13", "meaning": "temp_max"},
    {"deviceid": 272, "propertyid": 44589, "rulekey": "25", "meaning": "bms_charge_kwh"},
    {"deviceid": 272, "propertyid": 44590, "rulekey": "26", "meaning": "bms_discharge_kwh"},
    {"deviceid": 272, "propertyid": 44687, "rulekey": "43", "meaning": "charge_prohibited"},
    {"deviceid": 272, "propertyid": 44688, "rulekey": "44", "meaning": "discharge_prohibited"},
    {"deviceid": 272, "propertyid": 44689, "rulekey": "45", "meaning": "alarm_status"},
    {"deviceid": 276, "propertyid": 44438, "rulekey": "0", "meaning": "OutMeter online"},
    {"deviceid": 276, "propertyid": 44889, "rulekey": "17", "meaning": "grid_kw"},
]


class GatewayClient:
    def __init__(self, base_url, username, password, timeout):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.timeout = timeout
        self.token = None

    def request(self, method, path, payload=None, token=True):
        url = self.base_url + path
        data = None
        headers = {"Content-Type": "application/json"}
        if token and self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            text = resp.read().decode("utf-8")
        return json.loads(text) if text else {}

    def login(self):
        password_md5 = hashlib.md5(self.password.encode("utf-8")).hexdigest()
        body = self.request(
            "POST",
            "/login",
            {"username": self.username, "password": password_md5, "code": "", "uuid": ""},
            token=False,
        )
        token = body.get("data") or body.get("token")
        if not token:
            raise RuntimeError(f"gateway login failed: {body}")
        self.token = token
        return body

    def list_rows(self, entity, **params):
        query = {"pageNum": 1, "pageSize": 1000}
        query.update({k: v for k, v in params.items() if v is not None})
        path = f"/business/{entity}/list?{urllib.parse.urlencode(query)}"
        body = self.request("GET", path)
        data = body.get("data")
        if isinstance(data, dict) and isinstance(data.get("result"), list):
            return data["result"]
        if isinstance(data, list):
            return data
        return body.get("rows") or []

    def get_ruledevs(self, rule_id):
        body = self.request("GET", f"/business/HiemsDatatransRuledev/ruleid/{rule_id}")
        data = body.get("data")
        if isinstance(data, dict) and isinstance(data.get("result"), list):
            return data["result"]
        return data or body.get("rows") or []

    def get_rulemaps(self, ruledev_id):
        body = self.request("GET", f"/business/HiemsDatatransRulemap/devid/{ruledev_id}")
        data = body.get("data")
        if isinstance(data, dict) and isinstance(data.get("result"), list):
            return data["result"]
        return data or body.get("rows") or []

    def add(self, entity, payload):
        return self.request("POST", f"/business/{entity}", payload)

    def create_returnid(self, entity, payload):
        return self.request("POST", f"/business/{entity}/returnid", payload)

    def edit(self, entity, payload):
        return self.request("PUT", f"/business/{entity}", payload)

    def upsert_rulemap_all(self, rows):
        return self.request("POST", "/business/HiemsDatatransRulemap/all", rows)


def local_ip_for(remote_host):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect((remote_host, 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def row_id(row):
    for key in ("id", "ruleid", "masterid", "devid"):
        if key in row and row[key] is not None:
            return row[key]
    return None


def row_enabled(row):
    for key in ("state", "enable", "enabled", "status"):
        if key in row:
            return str(row[key]) in {"1", "true", "True", "online", "0"}
    return True


def has_protocol(row, protocol):
    haystack = json.dumps(row, ensure_ascii=False).lower()
    return protocol.lower() in haystack


def find_named(rows, name, protocol=None):
    name_lower = name.lower()
    for row in rows:
        values = [str(v).lower() for v in row.values() if isinstance(v, (str, int, float))]
        if any(name_lower == v for v in values):
            return row
    if protocol:
        for row in rows:
            if has_protocol(row, protocol):
                return row
    return None


def derive_payload_from_existing(existing, overrides):
    payload = dict(existing or {})
    payload.update({k: v for k, v in overrides.items() if v is not None})
    return payload


def build_create_payload(kind, args, rule_id=None):
    if kind == "mqtt_rule":
        return {
            "rulename": args.mqtt_rule_name,
            "name": args.mqtt_rule_name,
            "protocol": "HCMQTT",
            "state": 1,
        }
    if kind == "modbus_rule":
        return {
            "rulename": args.modbus_rule_name,
            "name": args.modbus_rule_name,
            "protocol": "ModbusServerTCP",
            "state": 1,
        }
    if kind == "mqtt_master":
        return {
            "name": args.mqtt_master_name,
            "ruleid": rule_id,
            "protocol": "HCMQTT",
            "ip": args.mqtt_broker_host,
            "port": args.mqtt_broker_port,
            "mqttdeviceid": args.mqtt_client_id,
            "mqttuser": args.mqtt_username,
            "mqttpass": args.mqtt_password,
            "mqtttopic": f"$ESC/{args.mqtt_client_id}/rpcreq",
            "servtype": "客户端",
            "ifcert": 0,
            "state": 1,
        }
    if kind == "modbus_master":
        return {
            "name": args.modbus_master_name,
            "ruleid": rule_id,
            "protocol": "ModbusServerTCP",
            "ip": "0.0.0.0",
            "port": args.modbus_port,
            "servtype": "服务端",
            "ifcert": 0,
            "state": 1,
        }
    raise ValueError(kind)


def make_rulemap_rows(ruledevs):
    by_device = {}
    for dev in ruledevs:
        deviceid = dev.get("deviceid") or dev.get("devid") or dev.get("deviceId")
        if deviceid is not None:
            by_device[int(deviceid)] = row_id(dev)
    rows = []
    missing = []
    for item in CORE_RULEMAP:
        ruledev_id = by_device.get(item["deviceid"])
        if not ruledev_id:
            missing.append(item)
            continue
        rows.append({
            "ruledevid": ruledev_id,
            "deviceid": item["deviceid"],
            "propertyid": item["propertyid"],
            "rulekey": item["rulekey"],
            "ruletype": 1,
            "rulegap": 100,
            "state": 1,
        })
    return rows, missing


def inspect_gateway(args):
    client = GatewayClient(args.gateway_api, args.username, args.password, args.timeout)
    client.login()
    rules = client.list_rows("HiemsDatatransRule")
    masters = client.list_rows("HiemsDatatransMgr")

    mqtt_rule = find_named(rules, args.mqtt_rule_name, "HCMQTT")
    modbus_rule = find_named(rules, args.modbus_rule_name, "ModbusServerTCP")
    mqtt_master = find_named(masters, args.mqtt_master_name, "HCMQTT")
    modbus_master = find_named(masters, args.modbus_master_name, "ModbusServerTCP")

    result = {
        "ts": dt.datetime.now(dt.timezone.utc).isoformat(),
        "gatewayApi": args.gateway_api,
        "mode": "apply" if args.apply else "dry-run",
        "mqtt": {
            "wanted": {
                "ruleName": args.mqtt_rule_name,
                "masterName": args.mqtt_master_name,
                "brokerHost": args.mqtt_broker_host,
                "brokerPort": args.mqtt_broker_port,
                "clientId": args.mqtt_client_id,
                "downlinkTopic": f"$ESC/{args.mqtt_client_id}/rpcreq",
            },
            "rule": mqtt_rule,
            "master": mqtt_master,
            "enabled": bool(mqtt_rule and mqtt_master and row_enabled(mqtt_rule) and row_enabled(mqtt_master)),
        },
        "modbusTcp": {
            "wanted": {
                "ruleName": args.modbus_rule_name,
                "masterName": args.modbus_master_name,
                "listenIp": "0.0.0.0",
                "listenPort": args.modbus_port,
            },
            "rule": modbus_rule,
            "master": modbus_master,
            "enabled": bool(modbus_rule and modbus_master and row_enabled(modbus_rule) and row_enabled(modbus_master)),
        },
        "actions": [],
        "manualActions": [],
    }

    def ensure_rule(kind, existing):
        if existing:
            if not row_enabled(existing):
                result["actions"].append({"action": "enable", "entity": "HiemsDatatransRule", "id": row_id(existing), "kind": kind})
                if args.apply:
                    payload = derive_payload_from_existing(existing, {"state": 1})
                    client.edit("HiemsDatatransRule", payload)
            return existing
        payload = build_create_payload(kind, args)
        result["actions"].append({"action": "create", "entity": "HiemsDatatransRule", "kind": kind, "payload": payload})
        if args.apply:
            body = client.create_returnid("HiemsDatatransRule", payload)
            result["actions"][-1]["response"] = body
            return find_named(client.list_rows("HiemsDatatransRule"), payload["name"], payload["protocol"])
        return None

    def ensure_master(kind, existing, rule):
        if existing:
            if not row_enabled(existing):
                result["actions"].append({"action": "enable", "entity": "HiemsDatatransMgr", "id": row_id(existing), "kind": kind})
                if args.apply:
                    payload = derive_payload_from_existing(existing, {"state": 1})
                    client.edit("HiemsDatatransMgr", payload)
            return existing
        rule_id = row_id(rule) if rule else None
        payload = build_create_payload(kind, args, rule_id=rule_id)
        result["actions"].append({"action": "create", "entity": "HiemsDatatransMgr", "kind": kind, "payload": payload})
        if args.apply and rule_id:
            body = client.create_returnid("HiemsDatatransMgr", payload)
            result["actions"][-1]["response"] = body
            return find_named(client.list_rows("HiemsDatatransMgr"), payload["name"], payload["protocol"])
        if not rule_id:
            result["manualActions"].append({"reason": "missing rule id", "kind": kind, "payload": payload})
        return None

    if args.ensure_mqtt:
        mqtt_rule = ensure_rule("mqtt_rule", mqtt_rule)
        mqtt_master = ensure_master("mqtt_master", mqtt_master, mqtt_rule)

    if args.ensure_modbus:
        modbus_rule = ensure_rule("modbus_rule", modbus_rule)
        modbus_master = ensure_master("modbus_master", modbus_master, modbus_rule)

    if mqtt_rule:
        ruledevs = client.get_ruledevs(row_id(mqtt_rule))
        rulemap_rows, missing_ruledevs = make_rulemap_rows(ruledevs)
        existing_maps = []
        for dev in ruledevs:
            dev_id = row_id(dev)
            if dev_id:
                existing_maps.extend(client.get_rulemaps(dev_id))
        existing_by_key = {}
        for item in existing_maps:
            key = (int(item.get("ruledevid") or 0), int(item.get("propertyid") or 0), str(item.get("rulekey")))
            existing_by_key[key] = item
        rows_to_apply = []
        for row in rulemap_rows:
            key = (int(row["ruledevid"]), int(row["propertyid"]), str(row["rulekey"]))
            existing = existing_by_key.get(key)
            if not existing:
                rows_to_apply.append(row)
                continue
            if any(str(existing.get(k)) != str(row[k]) for k in ("ruletype", "rulegap", "state")):
                merged = dict(existing)
                merged.update(row)
                rows_to_apply.append(merged)
        result["mqtt"]["ruledevs"] = ruledevs
        result["mqtt"]["coreRulemapRows"] = rulemap_rows
        result["mqtt"]["existingCoreRulemapRows"] = len(rulemap_rows) - len(rows_to_apply)
        result["mqtt"]["pendingCoreRulemapRows"] = rows_to_apply
        result["mqtt"]["missingRuleDevices"] = missing_ruledevs
        if args.ensure_mqtt_rulemap and rows_to_apply:
            result["actions"].append({
                "action": "upsert-core-rulemap",
                "entity": "HiemsDatatransRulemap",
                "rows": len(rows_to_apply),
            })
            if args.apply:
                result["actions"][-1]["response"] = client.upsert_rulemap_all(rows_to_apply)
        elif missing_ruledevs:
            result["manualActions"].append({
                "reason": "MQTT rule has no ruledev row for one or more devices",
                "devices": sorted({x["deviceid"] for x in missing_ruledevs}),
            })

    if args.apply:
        rules = client.list_rows("HiemsDatatransRule")
        masters = client.list_rows("HiemsDatatransMgr")
        result["mqtt"]["rule"] = find_named(rules, args.mqtt_rule_name, "HCMQTT")
        result["mqtt"]["master"] = find_named(masters, args.mqtt_master_name, "HCMQTT")
        result["modbusTcp"]["rule"] = find_named(rules, args.modbus_rule_name, "ModbusServerTCP")
        result["modbusTcp"]["master"] = find_named(masters, args.modbus_master_name, "ModbusServerTCP")
        result["mqtt"]["enabled"] = bool(result["mqtt"]["rule"] and result["mqtt"]["master"])
        result["modbusTcp"]["enabled"] = bool(result["modbusTcp"]["rule"] and result["modbusTcp"]["master"])

    return result


def write_json(path, payload):
    if not path:
        return
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(target)


def main():
    parser = argparse.ArgumentParser(description="Inspect or enable HiEMS Gateway northbound setup.")
    parser.add_argument("--gateway-api", default=os.getenv("HIEMS_GATEWAY_API", DEFAULT_GATEWAY))
    parser.add_argument("--username", default=os.getenv("HIEMS_USERNAME", DEFAULT_USER))
    parser.add_argument("--password", default=os.getenv("HIEMS_PASSWORD", DEFAULT_PASSWORD))
    parser.add_argument("--timeout", type=float, default=float(os.getenv("HIEMS_TIMEOUT", "8")))
    parser.add_argument("--mqtt-rule-name", default=os.getenv("HIEMS_MQTT_RULE_NAME", DEFAULT_MQTT_NAME))
    parser.add_argument("--mqtt-master-name", default=os.getenv("HIEMS_MQTT_MASTER_NAME", DEFAULT_MQTT_MASTER))
    parser.add_argument("--mqtt-broker-host", default=os.getenv("JJEMS_MQTT_BROKER_HOST") or local_ip_for("192.168.1.100"))
    parser.add_argument("--mqtt-broker-port", type=int, default=int(os.getenv("JJEMS_MQTT_BROKER_PORT", DEFAULT_MQTT_PORT)))
    parser.add_argument("--mqtt-client-id", default=os.getenv("HIEMS_MQTT_CLIENT_ID", DEFAULT_CLIENT_ID))
    parser.add_argument("--mqtt-username", default=os.getenv("HIEMS_MQTT_USERNAME", DEFAULT_MQTT_USER))
    parser.add_argument("--mqtt-password", default=os.getenv("HIEMS_MQTT_PASSWORD", DEFAULT_MQTT_PASSWORD))
    parser.add_argument("--modbus-rule-name", default=os.getenv("HIEMS_MODBUS_RULE_NAME", DEFAULT_MODBUS_NAME))
    parser.add_argument("--modbus-master-name", default=os.getenv("HIEMS_MODBUS_MASTER_NAME", DEFAULT_MODBUS_MASTER))
    parser.add_argument("--modbus-port", type=int, default=int(os.getenv("HIEMS_MODBUS_PORT", DEFAULT_MODBUS_PORT)))
    parser.add_argument("--ensure-mqtt", action="store_true")
    parser.add_argument("--ensure-modbus", action="store_true")
    parser.add_argument("--ensure-mqtt-rulemap", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Write changes to the gateway. Default is dry-run only.")
    parser.add_argument("--out", default=os.getenv("HIEMS_GATEWAY_ONBOARDING_JSON", DEFAULT_OUT))
    args = parser.parse_args()

    try:
        result = inspect_gateway(args)
    except (urllib.error.URLError, TimeoutError, RuntimeError, OSError) as exc:
        result = {
            "ts": dt.datetime.now(dt.timezone.utc).isoformat(),
            "gatewayApi": args.gateway_api,
            "mode": "apply" if args.apply else "dry-run",
            "error": str(exc),
        }
        write_json(args.out, result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2

    write_json(args.out, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
