#!/usr/bin/env python3
"""Tiny MQTT 3.1.1 broker for HiEMS bring-up.

Supports enough MQTT to receive cabinet-controller publishes:
CONNECT, SUBSCRIBE, PUBLISH QoS0/QoS1, PINGREQ, DISCONNECT.
It logs all publishes to stdout and logs/mqtt_broker.log.
"""

import argparse
import datetime as dt
import json
import socket
import struct
import threading
from pathlib import Path

clients = []
clients_lock = threading.Lock()
log_lock = threading.Lock()


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
            raise EOFError
        byte = b[0]
        value += (byte & 127) * multiplier
        if not (byte & 128):
            return value
        multiplier *= 128


def read_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError
        buf.extend(chunk)
    return bytes(buf)


def read_string(body, pos):
    ln = struct.unpack("!H", body[pos:pos + 2])[0]
    pos += 2
    return body[pos:pos + ln].decode("utf-8", errors="replace"), pos + ln


def mqtt_string(text):
    data = text.encode("utf-8")
    return struct.pack("!H", len(data)) + data


def log(path, event):
    line = json.dumps(event, ensure_ascii=False)
    with log_lock:
        print(line, flush=True)
        if path:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                f.write(line + "\n")


def send_publish(client, topic, payload):
    body = mqtt_string(topic) + payload
    packet = bytes([0x30]) + enc_len(len(body)) + body
    try:
        client.sendall(packet)
    except OSError:
        pass


def client_loop(sock, addr, args):
    client_id = None
    username = None
    subscriptions = set()
    try:
        while True:
            fixed = read_exact(sock, 1)[0]
            ptype = fixed >> 4
            flags = fixed & 0x0F
            remaining = dec_len(sock)
            body = read_exact(sock, remaining)
            if ptype == 1:  # CONNECT
                proto, pos = read_string(body, 0)
                level = body[pos]
                connect_flags = body[pos + 1]
                keepalive = struct.unpack("!H", body[pos + 2:pos + 4])[0]
                pos += 4
                client_id, pos = read_string(body, pos)
                if connect_flags & 0x80:
                    username, pos = read_string(body, pos)
                if connect_flags & 0x40:
                    _password, pos = read_string(body, pos)
                sock.sendall(b"\x20\x02\x00\x00")
                with clients_lock:
                    clients.append(sock)
                log(args.log_file, {"ts": dt.datetime.now().isoformat(), "event": "connect", "addr": addr[0], "clientId": client_id, "username": username, "proto": proto, "level": level, "keepalive": keepalive})
            elif ptype == 8:  # SUBSCRIBE
                packet_id = struct.unpack("!H", body[:2])[0]
                pos = 2
                granted = []
                while pos < len(body):
                    topic, pos = read_string(body, pos)
                    qos = body[pos]
                    pos += 1
                    subscriptions.add(topic)
                    granted.append(min(qos, 1))
                sock.sendall(bytes([0x90]) + enc_len(2 + len(granted)) + struct.pack("!H", packet_id) + bytes(granted))
                log(args.log_file, {"ts": dt.datetime.now().isoformat(), "event": "subscribe", "clientId": client_id, "topics": list(subscriptions)})
            elif ptype == 3:  # PUBLISH
                topic, pos = read_string(body, 0)
                qos = (flags >> 1) & 0x03
                packet_id = None
                if qos:
                    packet_id = struct.unpack("!H", body[pos:pos + 2])[0]
                    pos += 2
                payload = body[pos:]
                text = payload.decode("utf-8", errors="replace")
                event = {"ts": dt.datetime.now().isoformat(), "event": "publish", "clientId": client_id, "topic": topic, "qos": qos, "payload": text}
                log(args.log_file, event)
                if qos == 1 and packet_id is not None:
                    sock.sendall(bytes([0x40, 0x02]) + struct.pack("!H", packet_id))
                with clients_lock:
                    for c in list(clients):
                        if c is not sock:
                            send_publish(c, topic, payload)
            elif ptype == 12:  # PINGREQ
                sock.sendall(b"\xd0\x00")
            elif ptype == 14:  # DISCONNECT
                break
            else:
                log(args.log_file, {"ts": dt.datetime.now().isoformat(), "event": "packet", "clientId": client_id, "type": ptype, "body": body.hex(" ")})
    except EOFError:
        pass
    except Exception as exc:
        log(args.log_file, {"ts": dt.datetime.now().isoformat(), "event": "error", "clientId": client_id, "error": str(exc)})
    finally:
        with clients_lock:
            if sock in clients:
                clients.remove(sock)
        try:
            sock.close()
        except OSError:
            pass
        log(args.log_file, {"ts": dt.datetime.now().isoformat(), "event": "disconnect", "addr": addr[0], "clientId": client_id})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=1883)
    parser.add_argument("--log-file", default="logs/mqtt_broker.log")
    args = parser.parse_args()
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((args.host, args.port))
    srv.listen(20)
    log(args.log_file, {"ts": dt.datetime.now().isoformat(), "event": "listen", "host": args.host, "port": args.port})
    while True:
        sock, addr = srv.accept()
        threading.Thread(target=client_loop, args=(sock, addr, args), daemon=True).start()


if __name__ == "__main__":
    main()
