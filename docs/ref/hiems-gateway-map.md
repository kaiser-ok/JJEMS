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

## Verified Points

These points have been compared against the HiEMS web/API value.

| JJEMS field | Modbus | Raw | Scale | Value | Verification |
|---|---:|---:|---:|---:|---|
| `socPct` | FC04 unit `1`, addr `88`, count `1` | `390` | `0.1` | `39.0 %` | Matches `StationInfo.soc = 39.0` |

## Candidate Points

These are likely useful for JJEMS but are not yet verified against the HiEMS UI
or API. Keep them out of production control logic until verified.

| JJEMS field | Candidate source | Purpose | Status |
|---|---|---|---|
| `sohPct` | `StationInfo.soh`; candidate property `282_44953` or `272_44569` | Battery health KPI | API verified, Modbus TBD |
| `accuChargeKWh` | `StationInfo.accuChargeQuantity`; candidate `272_44589` | Finance / energy balance | API verified, Modbus TBD |
| `accuDischargeKWh` | `StationInfo.accDischargeQuantity`; candidate `272_44590` | Finance / energy balance | API verified, Modbus TBD |
| `essKW` | `282_44904 PCS Total Active Power` or PCS `271_44760` | Dashboard ESS power flow | TBD |
| `gridKW` | `282_44907 Grid Meter Total Active Power` or OutMeter `276_44889` | Dashboard grid power flow | TBD |
| `pvKW` | `282_44898 PV Total active power` | Dashboard PV power flow | TBD |
| `loadKW` | Derived from `gridKW + pvKW - essKW`, or load meter if present | Dashboard load power flow | TBD |
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

