#!/usr/bin/env python3
"""Minimal MQTT subscriber for HiEMS cabinet-controller bring-up.

No third-party dependencies. Subscribes to '#' and prints every publish frame.
Optionally inserts raw JSON/text payloads into mqtt_messages_raw when DATABASE_URL
and JJEMS_MQTT_GATEWAY_ID are set.
"""

import argparse
import datetime as dt
import json
import os
import socket
import struct
import subprocess
import sys


def enc_len(n):
    out = bytearray()
    while True:
        b = n % 128
        n //= 128
        if n:
            b |= 128
        out.append(b)
        if not n:
            return bytes(out)


def dec_len(sock):
    multiplier = 1
    value = 0
    while True:
        b = sock.recv(1)
        if not b:
            raise EOFError("connection closed while reading remaining length")
        byte = b[0]
        value += (byte & 127) * multiplier
        if not (byte & 128):
            return value
        multiplier *= 128


def mqtt_string(text):
    data = text.encode("utf-8")
    return struct.pack("!H", len(data)) + data


def read_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError("connection closed")
        buf.extend(chunk)
    return bytes(buf)


def connect(sock, client_id, username=None, password=None, keepalive=60):
    flags = 0x02  # clean session
    payload = mqtt_string(client_id)
    if username is not None:
        flags |= 0x80
        payload += mqtt_string(username)
    if password is not None:
        flags |= 0x40
        payload += mqtt_string(password)
    variable = mqtt_string("MQTT") + bytes([4, flags]) + struct.pack("!H", keepalive)
    packet = bytes([0x10]) + enc_len(len(variable) + len(payload)) + variable + payload
    sock.sendall(packet)
    header = read_exact(sock, 4)
    if header[0] != 0x20 or header[1] != 0x02 or header[3] != 0:
        raise RuntimeError(f"CONNACK failed: {header.hex(' ')}")


def subscribe(sock, topic="#", qos=1, packet_id=1):
    payload = mqtt_string(topic) + bytes([qos])
    variable = struct.pack("!H", packet_id)
    packet = bytes([0x82]) + enc_len(len(variable) + len(payload)) + variable + payload
    sock.sendall(packet)
    fixed = read_exact(sock, 1)
    if fixed[0] != 0x90:
        raise RuntimeError(f"expected SUBACK, got {fixed.hex(' ')}")
    remaining = dec_len(sock)
    body = read_exact(sock, remaining)
    if len(body) < 3 or body[2] == 0x80:
        raise RuntimeError(f"SUBACK rejected: {body.hex(' ')}")


def quote_sql(v):
    return "'" + str(v).replace("'", "''") + "'"


def insert_raw(db_url, gateway_id, topic, payload, method=None):
    ts = dt.datetime.now(dt.timezone.utc).isoformat()
    try:
        payload_json = json.loads(payload)
        payload_expr = quote_sql(json.dumps(payload_json, ensure_ascii=False)) + "::jsonb"
        method = method or payload_json.get("method")
        msg_id = payload_json.get("msgId")
        device_id = payload_json.get("dId")
    except Exception:
        payload_expr = quote_sql(json.dumps({"raw": payload}, ensure_ascii=False)) + "::jsonb"
        msg_id = None
        device_id = None
    sql = (
        "INSERT INTO mqtt_messages_raw "
        "(ts, gateway_id, topic, direction, qos, retained, payload, method, msg_id, device_id) VALUES ("
        f"{quote_sql(ts)}, {quote_sql(gateway_id)}::uuid, {quote_sql(topic)}, 'inbound', 1, false, "
        f"{payload_expr}, {quote_sql(method) if method else 'NULL'}, {quote_sql(msg_id) if msg_id else 'NULL'}, {quote_sql(device_id) if device_id else 'NULL'});"
    )
    subprocess.run(["psql", db_url, "-v", "ON_ERROR_STOP=1", "-c", sql], check=False)


def loop(args):
    db_url = args.db_url or os.getenv("DATABASE_URL")
    gateway_id = args.gateway_id or os.getenv("JJEMS_MQTT_GATEWAY_ID")
    with socket.create_connection((args.host, args.port), timeout=args.timeout) as sock:
        sock.settimeout(None)
        connect(sock, args.client_id, args.username, args.password, args.keepalive)
        subscribe(sock, args.topic)
        print(f"subscribed topic={args.topic} broker={args.host}:{args.port}", flush=True)
        while True:
            first = read_exact(sock, 1)[0]
            packet_type = first >> 4
            flags = first & 0x0F
            remaining = dec_len(sock)
            body = read_exact(sock, remaining)
            if packet_type == 3:  # PUBLISH
                topic_len = struct.unpack("!H", body[:2])[0]
                topic = body[2:2 + topic_len].decode("utf-8", errors="replace")
                pos = 2 + topic_len
                qos = (flags >> 1) & 0x03
                packet_id = None
                if qos:
                    packet_id = struct.unpack("!H", body[pos:pos + 2])[0]
                    pos += 2
                payload = body[pos:].decode("utf-8", errors="replace")
                now = dt.datetime.now().isoformat(timespec="seconds")
                print(f"[{now}] topic={topic} qos={qos} payload={payload}", flush=True)
                if db_url and gateway_id:
                    insert_raw(db_url, gateway_id, topic, payload)
                if qos == 1 and packet_id is not None:
                    sock.sendall(bytes([0x40, 0x02]) + struct.pack("!H", packet_id))
            elif packet_type == 13:  # PINGRESP
                continue
            else:
                print(f"packet type={packet_type} body={body.hex(' ')}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.getenv("MQTT_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("MQTT_PORT", "1883")))
    parser.add_argument("--client-id", default=os.getenv("MQTT_CLIENT_ID", "jjems-debug-sub"))
    parser.add_argument("--username", default=os.getenv("MQTT_USERNAME"))
    parser.add_argument("--password", default=os.getenv("MQTT_PASSWORD"))
    parser.add_argument("--topic", default=os.getenv("MQTT_TOPIC", "#"))
    parser.add_argument("--keepalive", type=int, default=60)
    parser.add_argument("--timeout", type=float, default=10)
    parser.add_argument("--db-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--gateway-id", default=os.getenv("JJEMS_MQTT_GATEWAY_ID"))
    args = parser.parse_args()
    loop(args)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("stopped", flush=True)
