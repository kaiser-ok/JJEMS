# HiEMS Gateway Modbus Map for JJEMS

This document records the actual Modbus TCP map observed on the HiEMS gateway at
`192.168.1.100:502`. It is the working map for JJEMS integration.

Do not treat the vendor Excel point tables as the final runtime map without
field verification. The current gateway exposes at least some values through a
different mapping than `261光儲一體機modbustcp_north.xlsx`.

## Connection

| Item | Value |
|---|---|
| Host | `192.168.1.100` |
| Port | `502` |
| Protocol | Modbus TCP |
| JJEMS role | Modbus client/master |
| HiEMS role | Modbus TCP server/slave |
| Unit ID behavior | Unit ID appears ignored or flattened in current gateway test |
| Addressing | Zero-based PDU address |
| Gateway server id | `LMB3.1.4` |

Absolute `400xx` addresses returned illegal data address during testing. Use
zero-based PDU addresses in the Modbus library.

## Verification Sources

### HiEMS Web/API

Login uses MD5 password transform:

```text
username: admin
password payload: md5("hcadmin")
```

Real-time page source:

```text
POST /api/Common/StationInfo?MapId=1
```

Observed response:

```json
{
  "soc": 39.0,
  "soh": 100.0,
  "accuChargeQuantity": 667.192,
  "accDischargeQuantity": 705.39,
  "dayChargeQuantity": 0.0,
  "dayDischargeQuantity": 0.0
}
```

### Gateway Property Table

The HiEMS web API exposes property names such as:

| Property key | Name |
|---|---|
| `272_44568` | `Total SOC of Battery Cluster` |
| `272_44569` | `Total SOH of Battery Cluster` |
| `272_44589` | `Cumulative Charging Energy` |
| `272_44590` | `Cumulative Discharging Energy` |
| `282_44901` | `SOC` |
| `282_44904` | `PCS Total Active Power` |
| `282_44907` | `Grid Meter Total Active Power` |
| `282_44953` | `SOH` |

For the verified SOC point, the field mapping matched:

```text
44568 - 44480 = 88
```

This offset rule is inferred from field testing and must not be assumed for all
properties until individually verified.

Updated vendor sheet `docs/ref/vendor-modbus-update.xlsx` confirms this file is
an IEC104/ModbusTCP point table for the Taiwan 261 kWh cabinet. For Modbus, the
`Modbus地址（04）` column is used directly as the FC04 PDU address on this gateway;
do not subtract 1 and do not use old `400xx` absolute addresses. `Modbus系数（/）`
means engineering value = raw / coefficient. Multi-register energy values use
the listed address range with high word first. Use these verified PCS/BMS reads
instead of the older `essKW addr 424` / `gridKW addr 427` candidates.

## Verified Points

These points have been compared against the HiEMS web/API value.

| JJEMS field | Modbus | Raw | Scale | Value | Verification |
|---|---:|---:|---:|---:|---|
| `socPct` | FC04 unit `1`, addr `88`, count `1` | `390` | `0.1` | `39.0 %` | Matches `StationInfo.soc = 39.0` |
| `frequencyHz` | FC04 unit `2`, addr `24`, count `1` | `5999` | `/100` | `59.99 Hz` | Matches vendor sheet row 電網頻率 |
| `pcsKW` | FC04 unit `2`, addr `28`, count `1` | `0` | signed `/10` | `0.0 kW` | Matches vendor sheet row 總輸出有功功率 |
| `pcsKVar` | FC04 unit `2`, addr `32`, count `1` | `0` | signed `/10` | `0.0 kVar` | Matches vendor sheet row 總輸出無功功率 |
| `pcsChargeKWh` | FC04 unit `2`, addr `45-46`, count `2` | `667192` | `U32 high-word-first /1000` | `667.192 kWh` | Matches `StationInfo.accuChargeQuantity` |
| `pcsDischargeKWh` | FC04 unit `2`, addr `47-48`, count `2` | `705390` | `U32 high-word-first /1000` | `705.39 kWh` | Matches `StationInfo.accDischargeQuantity` |
| `maxCellTempC` | FC04 unit `1`, addr `97`, count `1` | `280` | signed `/10` | `28.0 °C` | Matches BMS/MQTT max temperature |
| `avgCellTempC` | FC04 unit `1`, addr `103`, count `1` | `270` | signed `/10` | `27.0 °C` | Matches BMS/MQTT average temperature |
| `bmsChargeKWh` | FC04 unit `1`, addr `126-127`, count `2` | `4107` | `U32 high-word-first /10` | `410.7 kWh` | Matches BMS/MQTT charge energy |
| `bmsDischargeKWh` | FC04 unit `1`, addr `128-129`, count `2` | `3531` | `U32 high-word-first /10` | `353.1 kWh` | Matches BMS/MQTT discharge energy |

## Candidate Points

These are likely useful for JJEMS but are not yet verified against the HiEMS UI
or API. Keep them out of production control logic until verified.

| JJEMS field | Candidate source | Purpose | Status |
|---|---|---|---|
| `sohPct` | `StationInfo.soh`; candidate property `282_44953` or `272_44569` | Battery health KPI | API verified, Modbus TBD |
| `accuChargeKWh` | `StationInfo.accuChargeQuantity`; candidate `272_44589` | Finance / energy balance | API verified, Modbus TBD |
| `accuDischargeKWh` | `StationInfo.accDischargeQuantity`; candidate `272_44590` | Finance / energy balance | API verified, Modbus TBD |
| `gridKW` | `282_44907 Grid Meter Total Active Power` or OutMeter `276_44889` | Dashboard grid power flow | Vendor needed; current SignalR/MQTT value empty |
| `pvKW` | `282_44898 PV Total active power` | Dashboard PV power flow | TBD |
| `loadKW` | Derived from `gridKW + pvKW + pcsKW`, or load meter if present | Dashboard load power flow | TBD |
| `maxCellTempC` | `272_44573 Maximum Battery Temperature` | Device/BMS health | TBD |
| `avgCellTempC` | `272_44579 Average Battery Temperature` | Device/BMS health | TBD |
| `bmsVoltageV` | `272_44566 Battery Cluster Voltage` | Device/BMS status | Field value plausible |
| `bmsCurrentA` | `272_44567 Battery Cluster Current Value` | Device/BMS status | TBD |
| `pcsStatus` | `271_44797..44805` | PCS run/grid status | TBD |
| `alarmOpen` | HiEMS alarm APIs or FC02 alarm range | Alarm page | TBD |

## JJEMS Minimum Data Set

First production adapter should target this minimal normalized shape:

```js
{
  ts: "ISO-8601 timestamp",
  socPct: 39.0,
  sohPct: 100.0,
  essKW: null,
  gridKW: null,
  pvKW: null,
  loadKW: null,
  accuChargeKWh: 667.192,
  accuDischargeKWh: 705.39,
  dayChargeKWh: 0.0,
  dayDischargeKWh: 0.0,
  bms: {
    voltageV: null,
    currentA: null,
    maxTempC: null,
    avgTempC: null,
    status: null
  },
  pcs: {
    activePowerKW: null,
    reactivePowerKVar: null,
    status: null,
    fault: null,
    alarm: null
  },
  alarms: []
}
```

## Verification Procedure

For each candidate point:

1. Read the HiEMS web/API value.
2. Read the candidate Modbus register with FC04 or FC03.
3. Test signed/unsigned interpretation and documented scale.
4. Confirm direction convention:
   - ESS positive should mean discharge in JJEMS.
   - ESS negative should mean charge in JJEMS.
5. Record exact raw value, scale, engineering value, and timestamp here.

Do not write control registers until read mapping and sign convention are
verified onsite.

## Known Mismatches

`261光儲一體機modbustcp_north.xlsx` says EMS `40061` is storage SOC as F32.
Field test did not match this:

```text
FC04 addr 60, count 2 -> raw 00 16 05 a8
F32 decode did not equal SOC
```

The active gateway SOC was instead:

```text
FC04 addr 88, count 1 -> raw 390 -> 39.0 %
```

