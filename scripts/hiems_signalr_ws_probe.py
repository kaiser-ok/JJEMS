#!/usr/bin/env python3
import base64
import hashlib
import json
import os
import socket
import ssl
import struct
import time
import urllib.parse
import urllib.request

RS = "\x1e"


def http_json(url, data=None, headers=None, method=None, timeout=10):
    body = None if data is None else json.dumps(data).encode()
    req_headers = dict(headers or {})
    if body is not None:
        req_headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def login(base):
    payload = {
        "username": "admin",
        "password": hashlib.md5(b"hcadmin").hexdigest(),
        "code": "",
        "uuid": "",
    }
    return http_json(base + "/api/login", payload)["data"]


def ws_connect(host, port, path, headers):
    key = base64.b64encode(os.urandom(16)).decode()
    lines = [
        f"GET {path} HTTP/1.1",
        f"Host: {host}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}",
        "Sec-WebSocket-Version: 13",
    ]
    lines += [f"{k}: {v}" for k, v in headers.items()]
    req = "\r\n".join(lines) + "\r\n\r\n"
    sock = socket.create_connection((host, port), timeout=10)
    sock.sendall(req.encode())
    resp = sock.recv(4096).decode(errors="replace")
    if " 101 " not in resp:
        raise RuntimeError(resp)
    sock.settimeout(15)
    return sock


def ws_send_text(sock, text):
    data = text.encode()
    header = bytearray([0x81])
    if len(data) < 126:
        header.append(0x80 | len(data))
    elif len(data) < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack(">H", len(data)))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack(">Q", len(data)))
    mask = os.urandom(4)
    header.extend(mask)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    sock.sendall(header + masked)


def recvn(sock, n):
    out = b""
    while len(out) < n:
        chunk = sock.recv(n - len(out))
        if not chunk:
            raise EOFError
        out += chunk
    return out


def ws_recv_text(sock):
    h = recvn(sock, 2)
    opcode = h[0] & 0x0F
    length = h[1] & 0x7F
    if length == 126:
        length = struct.unpack(">H", recvn(sock, 2))[0]
    elif length == 127:
        length = struct.unpack(">Q", recvn(sock, 8))[0]
    masked = h[1] & 0x80
    mask = recvn(sock, 4) if masked else b""
    payload = recvn(sock, length) if length else b""
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    if opcode == 8:
        raise EOFError
    if opcode == 9:
        return ""
    return payload.decode(errors="replace")


def extract_live_from_buffer(buffer):
    keep = ""
    parts = buffer.split(RS)
    for idx, part in enumerate(parts):
        if idx == len(parts) - 1 and not buffer.endswith(RS):
            keep = part
            continue
        if not part.strip():
            continue
        try:
            frame = json.loads(part)
        except json.JSONDecodeError:
            continue
        if frame.get("type") != 1 or frame.get("target") != "GetDataVueNew":
            continue
        for arg in frame.get("arguments") or []:
            if isinstance(arg, str):
                try:
                    wrapper = json.loads(arg)
                except json.JSONDecodeError:
                    continue
                if isinstance(wrapper.get("data"), str):
                    parsed = json.loads(wrapper["data"])
                    if isinstance(parsed, dict) and "orignData" not in parsed:
                        parsed = {"orignData": parsed}
                    return parsed, keep
    return None, keep


def main():
    base = "http://192.168.1.100"
    token = login(base)
    neg = http_json(
        base + "/sinalr/datahub/negotiate?negotiateVersion=1",
        {},
        {"Authorization": "Bearer " + token},
        method="POST",
    )
    ct = urllib.parse.quote(neg["connectionToken"], safe="")
    path = "/sinalr/datahub?id=" + ct
    sock = ws_connect("192.168.1.100", 80, path, {"Authorization": "Bearer " + token})
    ws_send_text(sock, json.dumps({"protocol": "json", "version": 1}) + RS)
    init = json.dumps({"Name": "admin", "UserId": 20}, ensure_ascii=False)
    ws_send_text(sock, json.dumps({
        "type": 1,
        "invocationId": "1",
        "target": "SetInitVue",
        "arguments": [neg["connectionId"], init],
    }, ensure_ascii=False) + RS)
    deadline = time.time() + 30
    seen = 0
    buffer = ""
    while time.time() < deadline:
        buffer += ws_recv_text(sock)
        
        if os.environ.get("HIEMS_SIGNALR_DEBUG") and seen < 5:
            for part in buffer.split(RS):
                if part.strip():
                    try:
                        fr = json.loads(part)
                        print("DEBUG_FRAME", {"type": fr.get("type"), "target": fr.get("target"), "argTypes": [type(a).__name__ for a in (fr.get("arguments") or [])], "argLens": [len(a) if isinstance(a, str) else None for a in (fr.get("arguments") or [])], "argSamples": [a[:120] if isinstance(a, str) else None for a in (fr.get("arguments") or [])]})
                        seen += 1
                    except Exception:
                        pass
        live, buffer = extract_live_from_buffer(buffer)
        if live:
            data = live.get("orignData") or {}
            if not data:
                continue
            keys = sorted(data)
            out = {
                "gridCandidates": {
                    "276_44889": data.get("276_44889"),
                    "282_44907": data.get("282_44907"),
                    "282_44906": data.get("282_44906"),
                    "282_44895": data.get("282_44895"),
                    "282_44896": data.get("282_44896"),
                },
                "essCandidates": {
                    "271_44760": data.get("271_44760"),
                    "282_44904": data.get("282_44904"),
                },
                "pvCandidates": {"282_44898": data.get("282_44898")},
                "socCandidates": {
                    "272_44568": data.get("272_44568"),
                    "282_44901": data.get("282_44901"),
                },
                "meterKeys": [k for k in keys if k.startswith(("276_", "277_"))],
                "aggregateKeys": [k for k in keys if k.startswith("282_")],
            }
            print(json.dumps(out, ensure_ascii=False, indent=2))
            return 0
    print("no live frame")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
