# HiEMS HCMQTT Candidate Datapoint Map

This file combines three local sources:

1. `docs/海辰数能EMS对接数能云MQTT协议规范V1.4.xlsx`
   - sheet `上行字段`
   - provides MQTT payload field identifiers (`rulekey` candidates)
2. Cabinet controller HTTP API `business/HiemsDeviceProperty/list`
   - provides internal `propertyid` values required by `HiemsDatatransRulemap`
3. Current site device IDs from `Common/GetDeviceFronTransformer`
   - PCS `271`, BMS `272`, OutMeter `276`, InMeter `277`, Controller `283`

Status: candidate for MQTT uplink configuration. Verify with live publishes before using for production logic.

## MQTT Rule Context

- Forwarding rule: `jjems-mqtt`, id `3`, protocol `HCMQTT`
- Master/client: `jjems-mqtt-master`, id `3`
- Broker: `192.168.1.123:1883`
- MQTT client ID / device ID: `jjems-cabinet-001`
- Downlink topic: `$ESC/jjems-cabinet-001/rpcreq`
- Verified reply topic: `$ESS/jjems-cabinet-001/reply`

## Candidate Core Datapoints

The controller API needs rows shaped like:

```json
{
  "ruledevid": 22,
  "deviceid": 272,
  "propertyid": 44568,
  "rulekey": "4",
  "ruletype": 0,
  "state": 1
}
```

`ruledevid` is the row id from `HiemsDatatransRuledev/ruleid/3`, not the physical device id.

| Device | deviceid | ruledevid | propertyid | Controller property name | MQTT doc field / rulekey | Meaning | Unit | Target |
|---|---:|---:|---:|---|---:|---|---|---|
| PCS | 271 | 21 | 44433 | DevConnStatus | 0 | Device connection status | enum | status |
| PCS | 271 | 21 | 44760 | Total Output Active Power | 11 | Total active power | kW | `pcs_p_kw` / ESS power |
| PCS | 271 | 21 | 44761 | Total Output Reactive Power | 12 | Total reactive power | kVar | `pcs_q_kvar` |
| PCS | 271 | 21 | 44759 | Grid Frequency | 3 | Grid frequency | Hz | `frequency` |
| PCS | 271 | 21 | 44767 | AC Cumulative Charging Energy | 35 | Cumulative charge energy | kWh | energy balance |
| PCS | 271 | 21 | 44768 | AC Cumulative Discharging Energy | 36 | Cumulative discharge energy | kWh | energy balance |
| BMS | 272 | 22 | 44434 | DevConnStatus | 0 | Device connection status | enum | status |
| BMS | 272 | 22 | 44572 | Battery Cluster Battery Status | 1 | Cluster state | enum | status |
| BMS | 272 | 22 | 44566 | Battery Cluster Voltage | 2 | Cluster voltage | V | `dc_voltage` |
| BMS | 272 | 22 | 44567 | Battery Cluster Current Value | 3 | Cluster current | A | `dc_current` |
| BMS | 272 | 22 | 44568 | Total SOC of Battery Cluster | 4 | Cluster SOC | % | `soc` |
| BMS | 272 | 22 | 44569 | Total SOH of Battery Cluster | 5 | Cluster SOH | % | `soh` |
| BMS | 272 | 22 | 44570 | Battery Cluster Insulation Resistance R+ | 6 | Insulation resistance | kΩ | `insulation_kohm` candidate |
| BMS | 272 | 22 | 44579 | Average Battery Temperature | 8 | Average cell temperature | degC | `temp_avg` |
| BMS | 272 | 22 | 44573 | Maximum Battery Temperature | 13 | Maximum cell temperature | degC | `temp_max` |
| BMS | 272 | 22 | 44589 | Cumulative Charging Energy | 25 | Cumulative charge energy | kWh | energy balance |
| BMS | 272 | 22 | 44590 | Cumulative Discharging Energy | 26 | Cumulative discharge energy | kWh | energy balance |
| BMS | 272 | 22 | 44687 | Charge Prohibition Flag | 43 | Charge prohibition flag | bool | constraint |
| BMS | 272 | 22 | 44688 | Discharge Prohibition Flag | 44 | Discharge prohibition flag | bool | constraint |
| BMS | 272 | 22 | 44689 | Alarm Status | 45 | Alarm status | bool/bitmap | alarm |
| OutMeter | 276 | 26 | 44438 | DevConnStatus | 0 | Device connection status | enum | meter status |
| OutMeter | 276 | 26 | 44889 | power | 17 | Active power | kW | `gridKW` / meter `p_kw` |

## Notes

- `docs/ref/hiems-gateway-map.md` contains runtime Modbus observations, not MQTT rulemap rows.
- The MQTT doc gives the published field identifiers, but not controller `propertyid` values.
- The controller HTTP API gives the internal `propertyid` values.
- `ruletype=0` is assumed for initial full/value forwarding because the UI disables `rulegap` and `rulegate` for ruletype 0. Confirm in UI before production.
- Start with `state=1` only for the core points above. Avoid enabling all alarm bits until payload volume and field semantics are verified.

## Next Test

1. Create `HiemsDatatransRulemap` rows for the core points above under rule `3`.
2. Watch broker:

```bash
tail -f logs/mqtt_broker.log
```

3. Confirm publishes appear on:

```text
$ESS/271/data
$ESS/272/data
$ESS/276/data
```

4. Verify payload values against HTTP `StationInfo` and UI before writing to production telemetry tables.


## Applied Result

Applied on 2026-06-06:

- 22 core rows were created successfully via `business/HiemsDatatransRulemap/all`.
- Rows were changed to periodic forwarding:
  - `ruletype = 1`
  - `rulegap = 100`
  - `state = 1`
- Verified repeating MQTT telemetry:
  - `$ESS/271/data` PCS
  - `$ESS/272/data` BMS
- Not yet publishing:
  - `$ESS/276/data` OutMeter

Verified values from MQTT:

| Topic | Field | Value Example | Meaning |
|---|---:|---:|---|
| `$ESS/271/data` | `3` | `59.98..60.03` | Grid frequency |
| `$ESS/271/data` | `11` | `0.000` | PCS active power |
| `$ESS/271/data` | `35` | `667.192` | PCS cumulative charge energy |
| `$ESS/271/data` | `36` | `705.390` | PCS cumulative discharge energy |
| `$ESS/272/data` | `2` | `855.500` | Battery voltage |
| `$ESS/272/data` | `3` | `0.000` | Battery current |
| `$ESS/272/data` | `4` | `39.000` | SOC |
| `$ESS/272/data` | `5` | `100.000` | SOH |
| `$ESS/272/data` | `8` | `27.000` | Average battery temperature |
| `$ESS/272/data` | `13` | `28.000` | Maximum battery temperature |

## Aggregate Topic Applied Result

Applied on 2026-06-06:

- Added 26 semantic rows under station aggregate device `282`, ruledevid `29`.
- MQTT master `jjems-mqtt-master` was toggled off/on to reload the new rulemap.
- Verified topic `$ESS/282/data` publishing every ~10 seconds.
- The aggregate topic uses semantic `rulekey` strings because the vendor MQTT workbook does not define a HIEMS/station aggregate field table.

Verified aggregate payload example:

```json
{
  "status": "0",
  "pv_present": "0",
  "ess_present": "1",
  "soc": "39.0",
  "rated_kw": "125.0",
  "pcs_kw": "0.0",
  "pcs_kvar": "0.0",
  "pcs_charge_kwh": "667.2",
  "pcs_discharge_kwh": "705.4",
  "max_charge_kw": "125.0",
  "max_discharge_kw": "125.0",
  "remote_set_kw": "0",
  "ems_status": "0",
  "on_grid": "1",
  "control_mode": "1",
  "strategy_status": "0",
  "soh": "100.0"
}
```

Configured but not present in live aggregate payload yet:

- `grid_kw` / `grid_meter_kw`
- `pv_kw`
- `storage_meter_kw`
- grid import/export energy fields

Interpretation: MQTT is sufficient for battery/PCS/state telemetry and strategy status, but this firmware is not currently publishing grid/load active power through the configured MQTT rulemap. Keep using the web/API source or request provider confirmation for the grid meter datapoints before using MQTT alone for load/grid EMS decisions.

## Local Collection

- `scripts/hiems_mqtt_log_ingest.py` reads `logs/mqtt_broker.log`, merges latest `$ESS/271/data`, `$ESS/272/data`, and `$ESS/282/data`, writes `telemetry_cabinet_1s`, and refreshes `live/hiems_latest.json`.
- Cron wrapper: `scripts/hiems_mqtt_log_ingest_cron.sh`.
- Installed crontab:

```cron
* * * * * /home/gentrice/jjems/scripts/hiems_mqtt_log_ingest_cron.sh
```

First verified DB insert included:

- SOC `39`
- SOH `100`
- PCS active/reactive power `0 / 0`
- DC voltage/current `855.5 / 0`
- frequency `60.04`
- average/max temp `27 / 28`

