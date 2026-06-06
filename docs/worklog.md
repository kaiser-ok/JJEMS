# Work Log

## 2026-06-05 - HiEMS Cabinet Controller Integration

### Context
- Site currently has one cabinet controller / 櫃控一體機.
- Cabinet controller IP: `192.168.1.100`.
- HTTP gateway UI/API: `http://192.168.1.100:80`.
- Modbus TCP: `192.168.1.100:502`.
- Local JJEMS web preview: `http://127.0.0.1:9092/`.
- Local mapping page: `http://127.0.0.1:9092/#/gateway-map`.
- No EV charger on this site.
- Gateway device list does not show a PV inverter; PV is treated as absent/0 until provider says otherwise.

### Verified Gateway Data
- `POST /api/Common/StationInfo?MapId=1` returns current station values without login.
- Verified fields from API:
  - `soc = 39.0`
  - `soh = 100.0`
  - `accuChargeQuantity = 667.192 kWh`
  - `accDischargeQuantity = 705.39 kWh`
  - `dayChargeQuantity = 0.0 kWh`
  - `dayDischargeQuantity = 0.0 kWh`
- Verified Modbus point:
  - FC04, unit `1`, zero-based PDU addr `88`, raw `390`, scale `0.1` = `SOC 39.0%`.

### Important Finding
- Vendor/reference Excel northbound map does not match the active runtime mapping for SOC.
- Runtime SOC is not EMS `40061` F32 from the vendor doc; it is currently observed at FC04 addr `88`, u16 x0.1.
- Candidate power registers tested do not match the web screen values yet.
- Current candidate reads around addr `424`/`427` return about `329.2 kW` for both ESS and grid, so they remain unsafe to use as verified power values.

### Database / Cron
- PostgreSQL/TimescaleDB Docker stack is running.
- DB URL used by cron/logger: `postgres://ems:ems_dev_only_change_me@localhost:5432/ems`.
- `psql` is installed and working.
- Schema issue fixed in `db/schema.sql`:
  - Removed invalid expression inside `PRIMARY KEY` for `user_roles`.
  - Added `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
  - Added unique expression index for nullable `site_id` scope.
- Live DB migrated to match the fixed `user_roles` shape.
- Cron job installed:
  - `* * * * * /home/gentrice/jjems/scripts/hiems_soc_logger_cron.sh`
- SOC/SOH logging works and inserts rows into `telemetry_cabinet_1s`.

### Files Added / Updated
- `docs/ref/hiems-gateway-map.md`
  - Runtime gateway mapping notes and verification status.
- `docs/ref/hiems-gateway-map.json`
  - Machine-readable mapping structure.
- `scripts/hiems_soc_logger.py`
  - Polls cabinet controller API/Modbus.
  - Inserts verified SOC/SOH to DB.
  - Writes `live/hiems_latest.json` for static web consumption.
  - Keeps candidate Modbus fields in JSON for mapping work, but does not store unverified power points as real history.
- `scripts/hiems_soc_logger_cron.sh`
  - Cron wrapper for one sample per minute.
- `app.js`
  - Loads `live/hiems_latest.json`.
  - Uses live SOC in dashboard/topbar/SOC graph.
  - Treats PV as absent when `siteHasPV=false`.
  - Does not treat candidate power registers as verified.
  - Added route `#/gateway-map` for cabinet controller mapping table.
- `index.html`
  - Added sidebar link `櫃控點表`.
- `db/schema.sql`
  - Fixed `user_roles` primary key/index definition.
- Generated/ignored runtime data:
  - `live/hiems_latest.json`
  - `logs/hiems_soc_logger.log`

### Current Local Server
- Static server started with:
  - `python3 -m http.server 9092 --bind 127.0.0.1`
- URL:
  - `http://127.0.0.1:9092/`

### Provider Request Needed
Ask cabinet controller provider for the actual runtime ModbusServerTCP mapping table for this exact controller/site.

Required details:
- Unit ID / slave ID.
- Function code: FC03 / FC04 / FC02 / FC06 / FC16.
- Register address and whether it is zero-based PDU or 30001/40001-style.
- Data type: uint16 / int16 / uint32 / int32 / float32.
- Word order and byte order, especially for F32.
- Scale and unit.
- Sign convention:
  - ESS positive = charge or discharge?
  - Grid positive = import or export?
- Read/write permission.
- Safe write sequence for remote dispatch.
- Confirm no EV charger points for this site.
- Confirm whether PV points are absent or available.

Minimum EMS read points needed:
- SOC %
- SOH %
- PCS active power kW
- Grid meter active power kW
- Load active power kW, or formula source
- PV active power kW, if installed
- Battery voltage V
- Battery current A
- Max cell temperature degC
- Average cell temperature degC
- Alarm/fault status
- System online/running status
- Cumulative charge/discharge energy kWh
- Today charge/discharge energy kWh

Minimum write/control points needed:
- Remote/manual/auto mode select
- Start/stop
- Active power setpoint kW
- Reactive power setpoint kVar
- Grid/off-grid mode, if supported
- Fault reset / clear protection

### Next Actions
1. Send provider request and obtain actual runtime register table.
2. Update `docs/ref/hiems-gateway-map.md` and `.json` with provider table.
3. Update `scripts/hiems_soc_logger.py` with confirmed registers.
4. Compare reads against gateway UI values:
   - SOC
   - grid kW
   - ESS charge/discharge kW
   - load kW
   - voltage/current/temp
   - alarms
5. Only after read mapping is verified, test write commands at low power onsite.

### Known Limitations
- `node` is not installed, so `node --check app.js` could not be run.
- Power registers remain candidate/unverified.
- `apply_patch` failed repeatedly due sandbox helper `bwrap: loopback: Failed RTM_NEWADDR`; scoped direct writes were used instead.


## 2026-06-06 - MQTT Bring-up

### Confirmed
- Cabinet controller firmware supports northbound `HCMQTT` via `网关管理 → 北向主站`.
- Authenticated HTTP API login works with:
  - username: `admin`
  - password payload: `md5("hcadmin") = 99abe6ee8deb3f14ddea2e01c7c063d9`
  - captcha is configured `off`.
- Controller is not listening as an MQTT broker:
  - `192.168.1.100:1883` refused
  - `192.168.1.100:8883` refused
- Controller acts as MQTT client to an external broker.
- Local broker IP selected by route to controller:
  - `192.168.1.123`
- Local Python MQTT broker started:
  - `python3 scripts/mini_mqtt_broker.py --host 0.0.0.0 --port 1883`
- Controller MQTT rule created without touching existing Modbus rule:
  - forwarding rule: `jjems-mqtt`, id `3`, protocol `HCMQTT`
  - master: `jjems-mqtt-master`, id `3`, client to `192.168.1.123:1883`
  - device/client id: `jjems-cabinet-001`
  - username: `jjems`
  - password: `jjems_dev`
  - subscribe/downlink topic: `$ESC/jjems-cabinet-001/rpcreq`
- Controller connected to broker:
  - clientId `jjems-cabinet-001`
  - username `jjems`
  - MQTT level `4` / MQTT 3.1.1
  - keepalive `165`
  - subscribed topic `$ESC/jjems-cabinet-001/rpcreq`
- Downlink test verified:
  - Published `GetStrategyStatus` to `$ESC/jjems-cabinet-001/rpcreq`
  - Controller replied on `$ESS/jjems-cabinet-001/reply`
  - Reply payload: `code=0`, `data.RunStatus=false`

### Current MQTT Topics
- Downlink / controller subscription:
  - `$ESC/jjems-cabinet-001/rpcreq`
- Verified reply topic from test:
  - `$ESS/jjems-cabinet-001/reply`
- Configured per-device uplink topics:
  - `$ESS/271/data` PCS
  - `$ESS/272/data` BMS
  - `$ESS/273/data` liquid cooling
  - `$ESS/274/data` fire
  - `$ESS/275/data` dehumidifier
  - `$ESS/276/data` grid/out meter
  - `$ESS/277/data` storage/in meter
  - `$ESS/279/data` water leak
  - `$ESS/282/data` station/HIEMS-like device
  - `$ESS/283/data` controller

### Remaining MQTT Gap
- MQTT connection and command/reply path are working.
- Periodic telemetry publish has not appeared yet.
- `HiemsDatatransRulemap/devid/*` currently returns empty datapoint maps, so the controller likely needs datapoint mapping rows before it publishes telemetry.
- Next step: configure or import datapoint map rows for rule `3` using `business/HiemsDatatransRulemap/all` or the UI data-set detail page.


## 2026-06-06 - MQTT Datapoint Map Applied

### Applied Core Rulemap
- Added 22 core `HiemsDatatransRulemap` rows under MQTT rule `3`.
- Rule device ids used:
  - PCS `271`, ruledevid `21`
  - BMS `272`, ruledevid `22`
  - OutMeter `276`, ruledevid `26`
- Initial `ruletype=0` produced one startup/change publish.
- Changed all 22 core rows to periodic forwarding:
  - `ruletype=1`
  - `rulegap=100` (UI unit is 100 ms, so approx 10 seconds)
  - `state=1`
- Reloaded MQTT master `jjems-mqtt-master` after applying the rulemap.

### Verified MQTT Telemetry Publishes
- Topic `$ESS/271/data` publishes every ~10 seconds.
- Example PCS payload:
  - `0 = 0` device online
  - `11 = 0.000` PCS active power kW
  - `12 = 0.000` PCS reactive power kVar
  - `3 = ~60.0` grid frequency Hz
  - `35 = 667.192` cumulative charge energy kWh
  - `36 = 705.390` cumulative discharge energy kWh
- Topic `$ESS/272/data` publishes every ~10 seconds.
- Example BMS payload:
  - `0 = 0` device online
  - `1 = 4` battery cluster status
  - `2 = 855.500` V
  - `3 = 0.000` A
  - `4 = 39.000` SOC %
  - `5 = 100.000` SOH %
  - `8 = 27.000` avg temp degC
  - `13 = 28.000` max temp degC
  - `25 = 410.700` cumulative charge energy kWh
  - `26 = 353.100` cumulative discharge energy kWh
  - `43/44/45 = 0` charge inhibit / discharge inhibit / alarm status

### Remaining Gap
- Topic `$ESS/276/data` for OutMeter has not published yet, even after adding:
  - property `44438`, rulekey `0`
  - property `44889`, rulekey `17`
- Need further check whether grid meter should use another device id/property, likely InMeter `277`, station aggregate `282`, or a different MQTT field key for this firmware.

## 2026-06-06 - MQTT Aggregate Topic and DB Ingest

### Applied Aggregate Rulemap
- Queried aggregate device `282` properties from the controller API.
- Added 26 MQTT rulemap rows under ruledevid `29` / topic `$ESS/282/data`.
- Used semantic rulekeys such as:
  - `soc`
  - `soh`
  - `rated_kw`
  - `pcs_kw`
  - `pcs_kvar`
  - `max_charge_kw`
  - `max_discharge_kw`
  - `remote_set_kw`
  - `strategy_status`
  - `control_mode`
  - `on_grid`
- Toggled only MQTT master `jjems-mqtt-master` off/on to reload the rulemap.

### Verified Aggregate Publish
- Topic `$ESS/282/data` now publishes every ~10 seconds.
- Confirmed values:
  - SOC `39.0`
  - SOH `100.0`
  - rated power `125.0 kW`
  - PCS active/reactive power `0.0 / 0.0`
  - max charge/discharge power `125.0 / 125.0`
  - remote set power `0`
  - on-grid `1`
  - control mode `1`
  - strategy status `0`
  - PV present `0`

### Local DB Collection
- Added `scripts/hiems_mqtt_log_ingest.py`.
- Added cron wrapper `scripts/hiems_mqtt_log_ingest_cron.sh`.
- Installed crontab line:
  - `* * * * * /home/gentrice/jjems/scripts/hiems_mqtt_log_ingest_cron.sh`
- First verified DB row in `telemetry_cabinet_1s` contains:
  - SOC/SOH
  - PCS kW/kVar
  - DC voltage/current
  - frequency
  - average/max temperature
  - insulation and alarm/status fields where available
- `live/hiems_latest.json` now uses source `hiems-hcmqtt` after the MQTT ingest runs.

### Remaining Gap
- MQTT aggregate rulemap accepted `grid_kw`, `grid_meter_kw`, `pv_kw`, and `storage_meter_kw`, but the live `$ESS/282/data` payload omits them.
- Because grid/load active power are still absent from MQTT, do not rely on MQTT alone for site load/grid EMS decisions yet.
- Next technical step: identify the web/API endpoint that feeds the visible gateway cards for `市電`, `儲能充電/放電`, and `負載`, or ask the provider which MQTT property/rulekey exposes those station power values on this firmware.

## 2026-06-06 - Gateway Onboarding Autoconfig

### Added
- Added `scripts/hiems_gateway_onboard.py` for HiEMS cabinet-controller onboarding.
- The script logs into `http://192.168.1.100/api`, inspects northbound forwarding rules, master entries, rule devices, and MQTT rulemaps.
- Default dry-run command:
  - `python3 scripts/hiems_gateway_onboard.py --ensure-mqtt --ensure-modbus --ensure-mqtt-rulemap`
- Apply command, for administrator-controlled gateway writes:
  - `python3 scripts/hiems_gateway_onboard.py --ensure-mqtt --ensure-modbus --ensure-mqtt-rulemap --apply`
- The script writes `live/hiems_gateway_onboarding.json` for the web settings page.
- `/settings` now loads the onboarding JSON and shows Gateway MQTT / Modbus TCP enablement state plus pending actions.

### Current Gateway Status
- HCMQTT is already enabled:
  - rule `jjems-mqtt`, id `3`
  - master `jjems-mqtt-master`, id `3`
  - broker `192.168.1.123:1883`
  - client id `jjems-cabinet-001`
- MQTT core rulemap is already present:
  - 22/22 PCS/BMS/OutMeter core rows found
  - no pending MQTT core rulemap rows
- ModbusServerTCP forwarding rule exists:
  - rule `jjems`, id `2`
- ModbusServerTCP master/server entry is missing:
  - pending action creates `HiemsDatatransMgr` row `jjems-modbus-server`
  - protocol `ModbusServerTCP`
  - `servtype=服务端`
  - `ip=0.0.0.0`
  - `port=502`
  - `ifcert=0`

### Safety Note
- Web is still a static app, so it displays the onboarding state and exact pending gateway payload.
- Actual gateway writes are intentionally performed by the server-side script with `--apply`, not directly by the browser.

## 2026-06-06 - Settings Cabinet Controller Management

### Added
- Added a `/settings` section named `櫃控管理`.
- The section supports add, edit, and delete for cabinet-controller profiles.
- Default seeded controller uses the current project data:
  - IP `192.168.1.100`
  - HTTP port `80`
  - Modbus TCP port `502`
  - MQTT client id `jjems-cabinet-001`
  - rated power `125 kW`
  - battery capacity `261.248 kWh`
  - model family `Zpower-AC-261L`
- Data is currently persisted in browser `localStorage` under `jjems-cabinet-controllers`.

### UI Adjustment
- Gateway enablement/status is now shown as selected-cabinet detail instead of a global settings card.
- `/settings` first shows `櫃控管理`; clicking a cabinet row's `Gateway` button opens a popup window for that cabinet's MQTT / Modbus TCP status.

### Next
- Replace the localStorage persistence layer with a DB-backed settings API when the backend API service is added.
- Map this data to `cabinets`, `devices`, and gateway connection/protocol-map tables.

## 2026-06-06 - Settings Protocol Map Per Cabinet

### Added
- Replaced the static `/settings` communication-protocol SVG map with selected-cabinet mapping rows.
- Added explicit `選取` action in `櫃控管理`; the selected cabinet drives the protocol map content.
- `通訊協議地圖` now shows rows scoped by cabinet controller id and seeded from current project findings:
  - MQTT BMS/PCS verified datapoints
  - SignalR BMS cell/pole temperature arrays
  - MQTT aggregate/rated power
  - Modbus SOC fallback
  - grid/load rows marked missing/blocked because OutMeter/grid power remains unavailable
- Replaced the old static protocol summary table with a selected-cabinet protocol summary generated from the same mapping rows.

### Verification
- `node --check app.js` passed.

## 2026-06-06 - Protocol Map Auto Single Cabinet + Visual

### Updated
- `通訊協議地圖` now auto-loads the only cabinet controller when the site has a single controller.
- Multi-cabinet sites still require selecting one cabinet in `櫃控管理` before the protocol map is shown.
- Added a data-driven visual topology above the mapping rows:
  - JJEMS normalization node
  - selected cabinet controller
  - MQTT Broker, SignalR/HTTP, Modbus TCP sources
  - PCS/BMS/OutMeter southbound nodes
  - verified/pending counts derived from the selected cabinet mapping rows
- The visual is generated from the same mapping row set as the table, not from the old static SVG/mock protocol diagram.

### Verification
- `node --check app.js` passed.

## 2026-06-06 - Protocol Topology Semantics Fix

### Updated
- Redrew the protocol visual map so HCMQTT, HTTP/SignalR, and Modbus TCP are shown between JJEMS and the selected cabinet controller.
- Southbound PCS/BMS/OutMeter nodes are now shown as the cabinet controller's managed device tree, not as direct JJEMS connections.
- Kept the mapping rows unchanged; only the visual topology semantics were corrected.

### Verification
- `node --check app.js` passed.

## 2026-06-06 - Protocol Visual Adapter Placement

### Updated
- Moved the HCMQTT, HTTP/SignalR, and FC04 adapter boxes inside the selected cabinet-controller box.
- JJEMS now connects to the cabinet controller through a single northbound line; the internal boxes represent interfaces exposed by the gateway.
- Southbound device tree remains outside the controller box as gateway-managed PCS/BMS/OutMeter devices.

### Verification
- `node --check app.js` passed.

## 2026-06-06 - Protocol Visual Southbound Simplification

### Updated
- Removed the duplicate right-side `Southbound Device Tree` summary box from the protocol visual.
- PCS 271, BMS 272, and OutMeter 276 now appear only once as the southbound device nodes.
- Simplified southbound labeling to one trunk label from the cabinet controller to the device nodes.

### Verification
- `node --check app.js` passed.

## 2026-06-06 - Protocol Visual Internal Tree vs Southbound

### Updated
- Separated `internal device tree` and `southbound` semantics in the protocol visual.
- `internal device tree` now appears inside the cabinet controller box as the gateway's logical deviceId/propertyId/rulemap model.
- `southbound` now labels the link from the cabinet controller to the physical PCS/BMS/OutMeter nodes.

### Verification
- `node --check app.js` passed.

## 2026-06-06 - Settings Mock Section Removal

### Updated
- Removed the mock `儲能系統規格` card from `/settings`; cabinet specs should come from `櫃控管理` / DB-backed cabinet data instead.
- Removed the mock `使用者權限` role-count card from `/settings`.
- Kept cabinet management, site settings, selected-cabinet protocol map, protocol summary, and security settings visible.

### Verification
- `node --check app.js` passed.


## 2026-06-06 - Modbus TCP PCS Point Table Correction

- Vendor clarified Modbus TCP should follow the PCS point table.
- Re-tested PCS FC04 with unit `2`; runtime PDU addressing is still zero-based and 32-bit counters are low-word-first.
- Removed stale `essKW addr 424` / `gridKW addr 427` candidates from the SOC logger output because they produced misleading values.
- Verified PCS values:
  - `frequencyHz`: unit 2, FC04, PDU addr `24`, u16 x0.01 -> about `59.96 Hz`
  - `pcsKW`: unit 2, FC04, PDU addr `32`, i32 low-word-first x0.1 -> `0.0 kW`
  - `pcsKVar`: unit 2, FC04, PDU addr `34`, i32 low-word-first x0.1 -> `0.0 kVar`
  - `pcsChargeKWh`: unit 2, FC04, PDU addr `46`, u32 low-word-first x0.001 -> `667.192 kWh`
  - `pcsDischargeKWh`: unit 2, FC04, PDU addr `48`, u32 low-word-first x0.001 -> `705.39 kWh`
- Grid/load remain not verified; `282_44907`, `282_44906`, and `276_44889` are empty/not published in current SignalR/MQTT tests.

## 2026-06-06 - Vendor Modbus Sheet Analysis

- Downloaded updated sheet to `docs/ref/vendor-modbus-update.xlsx` from the vendor Google Sheets link.
- Sheets include `说明`, `1.1遥信`, `1.2遥测`, `1.3遥控`, `1.4遥调`.
- Modbus support is explicit:
  - FC02: 遥信 / discrete input
  - FC04: 遥测 / input register
  - FC05: 遥控 / single coil
  - FC06: 遥调 / single register
- FC04 `Modbus地址（04）` is used directly as the runtime PDU address on this gateway. No `-1` offset was observed.
- FC04 `Modbus系数（/）` means engineering value = raw / coefficient; FC06 `Modbus系数（*）` means write raw = engineering value * coefficient.
- Corrected PCS/BMS Modbus mappings in `scripts/hiems_soc_logger.py`:
  - PCS frequency addr 24 /100
  - PCS active power addr 28 /10
  - PCS reactive power addr 32 /10
  - PCS charge energy addr 45-46 high-word-first /1000
  - PCS discharge energy addr 47-48 high-word-first /1000
  - BMS max/avg temp addr 97/103 /10
  - BMS charge/discharge energy addr 126-127 /10 and 128-129 /10
## 2026-06-06 · HiEMS 遙測遙控驗證 API gate
- 新增 `scripts/hiems_command_api.py`：本機 HTTP API，預設 dry-run only，實際 FC05/FC06 寫入需 `--enable-writes` + Bearer token + safety acknowledgements。
- API endpoints：`GET /api/hiems/commands/allowlist`、`GET /api/hiems/commands/health`、`POST /api/hiems/commands`。
- Allowlist 目前限 PCS：遠程/就地、待機、啟動、停機、故障復位、運行模式、有功/無功功率期望。
- 有功功率期望採 vendor sheet `FC06 addr 4`，`raw = kW * 10`，低功率測試預設限制 `abs(kW) <= 3`；文件方向為負=放電、正=充電，仍需現場低功率確認。
- 前端 `#/rtu-verify` 新增 Command API Gate 區塊，可送 dry-run 或在安全條件勾選後送 execute。
- 本次只 dry-run 測試：`pcs.active_power_kw=1` 產生 `unitId=2, fc=6, addr=4, rawValue=10`，未對櫃控寫入。

啟動方式：
```bash
# dry-run only
python3 scripts/hiems_command_api.py --listen 127.0.0.1 --api-port 9093

# 現場測試寫入，需先設定 token
export JJEMS_COMMAND_TOKEN='change-this-token'
python3 scripts/hiems_command_api.py --listen 127.0.0.1 --api-port 9093 --enable-writes
```
## 2026-06-06 · Commit note
- Prepared commit for HiEMS vendor Modbus mapping correction, `#/rtu-verify` verification workbench, and local `scripts/hiems_command_api.py` API gate.
- Verification before commit: `node --check app.js`; `python3 -m py_compile scripts/hiems_command_api.py scripts/hiems_soc_logger.py`; dry-run command API test only, no real FC05/FC06 write.
- Left unrelated malformed untracked filename untouched.

