#!/usr/bin/env python3
"""
Read one HiEMS SignalR live-data snapshot.

The HiEMS web topology uses /sinalr/datahub and receives GetDataVueNew payloads.
This helper connects with SignalR LongPolling using only Python stdlib so we can
verify grid/load points without adding dependencies.
"""

import argparse
import base64
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error


RS = "\x1e"


def request_json(url, data=None, headers=None, timeout=10, method=None):
    body = None if data is None else json.dumps(data).encode("utf-8")
    req_headers = dict(headers or {})
    if body is not None:
        req_headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def request_text(url, data=None, headers=None, timeout=10, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def login(base, username, password, timeout):
    payload = {
        "username": username,
        "password": hashlib.md5(password.encode("utf-8")).hexdigest(),
        "code": "",
        "uuid": "",
    }
    body = request_json(f"{base}/api/login", payload, timeout=timeout)
    if body.get("code") != 200:
        raise RuntimeError(f"login failed: {body}")
    return body["data"]


def signalr_send(url, token, payload, timeout):
    request_text(
        url,
        data=payload.encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "text/plain;charset=UTF-8",
        },
        timeout=timeout,
        method="POST",
    )


def parse_frames(text):
    for part in text.split(RS):
        part = part.strip()
        if not part:
            continue
        try:
            yield json.loads(part)
        except json.JSONDecodeError:
            continue


def extract_live_payload(frame):
    if frame.get("type") != 1 or frame.get("target") != "GetDataVueNew":
        return None
    args = frame.get("arguments") or []
    for arg in args:
        if not isinstance(arg, str):
            continue
        try:
            wrapper = json.loads(arg)
        except json.JSONDecodeError:
            continue
        data = wrapper.get("data")
        if isinstance(data, str):
            try:
                return json.loads(data)
            except json.JSONDecodeError:
                return None
    return None


def value_for(live, key):
    data = live.get("orignData") or {}
    return data.get(key)


def summarize(live):
    keys = sorted((live.get("orignData") or {}).keys())
    summary = {
        "keyCount": len(keys),
        "gridCandidates": {
            "276_44889": value_for(live, "276_44889"),
            "282_44907": value_for(live, "282_44907"),
        },
        "essCandidates": {
            "271_44760": value_for(live, "271_44760"),
            "282_44904": value_for(live, "282_44904"),
        },
        "pvCandidates": {
            "282_44898": value_for(live, "282_44898"),
        },
        "socCandidates": {
            "272_44568": value_for(live, "272_44568"),
            "282_44901": value_for(live, "282_44901"),
        },
        "meterKeys": [k for k in keys if k.startswith(("276_", "277_"))],
        "aggregateKeys": [k for k in keys if k.startswith("282_")],
    }
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=os.environ.get("HIEMS_BASE", "http://192.168.1.100"))
    parser.add_argument("--username", default=os.environ.get("HIEMS_USER", "admin"))
    parser.add_argument("--password", default=os.environ.get("HIEMS_PASSWORD", "hcadmin"))
    parser.add_argument("--timeout", type=float, default=10)
    parser.add_argument("--polls", type=int, default=8)
    parser.add_argument("--print-raw", action="store_true")
    args = parser.parse_args()

    base = args.base.rstrip("/")
    token = login(base, args.username, args.password, args.timeout)
    auth = {"Authorization": f"Bearer {token}"}
    negotiate = request_json(
        f"{base}/sinalr/datahub/negotiate?negotiateVersion=1",
        data={},
        headers=auth,
        timeout=args.timeout,
        method="POST",
    )
    connection_id = negotiate["connectionId"]
    connection_token = urllib.parse.quote(negotiate["connectionToken"], safe="")
    hub_url = f"{base}/sinalr/datahub?id={connection_token}"
    poll_url = f"{hub_url}&transport=longPolling"

    # Start long-poll transport. The first poll usually returns an empty body.
    try:
        request_text(poll_url, headers=auth, timeout=2)
    except Exception:
        pass

    signalr_send(hub_url, token, json.dumps({"protocol": "json", "version": 1}) + RS, args.timeout)
    init_payload = json.dumps({"Name": args.username, "UserId": 20}, ensure_ascii=False)
    invoke = {
        "type": 1,
        "invocationId": "1",
        "target": "SetInitVue",
        "arguments": [connection_id, init_payload],
    }
    signalr_send(hub_url, token, json.dumps(invoke, ensure_ascii=False) + RS, args.timeout)

    for _ in range(args.polls):
        try:
            text = request_text(poll_url, headers=auth, timeout=args.timeout)
        except urllib.error.HTTPError as exc:
            if exc.code in (204, 404):
                continue
            raise
        for frame in parse_frames(text):
            live = extract_live_payload(frame)
            if live:
                output = {"summary": summarize(live)}
                if args.print_raw:
                    output["live"] = live
                print(json.dumps(output, ensure_ascii=False, indent=2))
                return 0
        time.sleep(0.2)

    print("no GetDataVueNew frame received", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
