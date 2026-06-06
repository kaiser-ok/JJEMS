#!/usr/bin/env python3
"""Capture BMS temperature distribution from HiEMS SignalR live stream."""

import argparse
import datetime as dt
import json
from pathlib import Path
import queue
import statistics
import threading
import time
import urllib.parse
import urllib.request

DEFAULT_BASE = "http://192.168.1.100/sinalr/datahub"
DEFAULT_OUT = "live/hiems_bms_temperature.json"
TARGET_KEYS = {
    "272_44606": "cellTempC",
    "272_44747": "poleTempC",
    "272_44573": "tempMaxC",
    "272_44576": "tempMinC",
    "272_44579": "tempAvgC",
    "272_44568": "socPct",
    "272_44569": "sohPct",
}


def parse_float_list(value):
    if value in (None, ""):
        return []
    out = []
    for item in str(value).split(','):
        item = item.strip()
        if not item:
            continue
        try:
            out.append(float(item))
        except ValueError:
            pass
    return out


def parse_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def write_json(path, payload):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + '.tmp')
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    tmp.replace(target)


def post_frame(base, token, obj):
    body = (json.dumps(obj, separators=(',', ':')) + '\x1e').encode()
    req = urllib.request.Request(
        base + '?id=' + urllib.parse.quote(token),
        data=body,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    urllib.request.urlopen(req, timeout=5).read()


def capture(args):
    negotiate_req = urllib.request.Request(
        args.base.rstrip('/') + '/negotiate?negotiateVersion=1',
        data=b'{}',
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    neg = json.load(urllib.request.urlopen(negotiate_req, timeout=5))
    base = args.base.rstrip('/')
    token = neg['connectionToken']
    connection_id = neg['connectionId']
    messages = queue.Queue()

    def reader():
        req = urllib.request.Request(base + '?id=' + urllib.parse.quote(token), headers={'Accept': 'text/event-stream'})
        try:
            with urllib.request.urlopen(req, timeout=args.seconds + 10) as resp:
                for raw in resp:
                    line = raw.decode('utf-8', 'ignore').strip()
                    if line.startswith('data: '):
                        messages.put(line[6:])
        except Exception as exc:
            messages.put('__ERR__ ' + repr(exc))

    threading.Thread(target=reader, daemon=True).start()
    time.sleep(0.4)
    post_frame(base, token, {'protocol': 'json', 'version': 1})
    post_frame(base, token, {
        'type': 1,
        'target': 'SetInitVue',
        'arguments': [connection_id, json.dumps({'Name': 'admin', 'UserId': '20'}, separators=(',', ':'))],
    })

    found = {}
    start = time.time()
    while time.time() - start < args.seconds:
        try:
            msg = messages.get(timeout=1)
        except queue.Empty:
            continue
        if msg.startswith('__ERR__'):
            continue
        for part in msg.split('\x1e'):
            part = part.strip()
            if not part:
                continue
            try:
                outer = json.loads(part)
            except json.JSONDecodeError:
                continue
            if outer.get('target') != 'GetDataVueNew':
                continue
            values = outer.get('arguments') or []
            if len(values) < 2:
                continue
            try:
                body = json.loads(values[1])
                data = json.loads(body.get('data') or '{}')
            except json.JSONDecodeError:
                continue
            for key in TARGET_KEYS:
                if key in data:
                    found[key] = data[key]

    cells = parse_float_list(found.get('272_44606'))
    poles = parse_float_list(found.get('272_44747'))
    if not cells:
        raise RuntimeError('No 272_44606 cell/module temperature array received from SignalR')

    summary = {
        'count': len(cells),
        'min': min(cells),
        'avg': round(statistics.fmean(cells), 3),
        'max': max(cells),
        'spread': round(max(cells) - min(cells), 3),
    }
    payload = {
        'ts': dt.datetime.now(dt.timezone.utc).isoformat(),
        'source': 'hiems-signalr',
        'connectionId': connection_id,
        'deviceId': 272,
        'keys': {
            'cellTempC': '272_44606',
            'poleTempC': '272_44747',
            'tempMaxC': '272_44573',
            'tempMinC': '272_44576',
            'tempAvgC': '272_44579',
        },
        'socPct': parse_float(found.get('272_44568')),
        'sohPct': parse_float(found.get('272_44569')),
        'tempMinC': parse_float(found.get('272_44576')),
        'tempAvgC': parse_float(found.get('272_44579')),
        'tempMaxC': parse_float(found.get('272_44573')),
        'summary': summary,
        'cellTempC': cells,
        'poleTempC': poles,
    }
    write_json(args.out, payload)
    return payload


def main():
    parser = argparse.ArgumentParser(description='Capture BMS temperature distribution from HiEMS SignalR.')
    parser.add_argument('--base', default=DEFAULT_BASE)
    parser.add_argument('--out', default=DEFAULT_OUT)
    parser.add_argument('--seconds', type=float, default=12)
    parser.add_argument('--print-json', action='store_true')
    args = parser.parse_args()
    payload = capture(args)
    if args.print_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        s = payload['summary']
        print(f"count={s['count']} min={s['min']} avg={s['avg']} max={s['max']} spread={s['spread']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
