# J&J Power EMS · 資料庫設計 (Database Schema)

> Target: PostgreSQL 16 + TimescaleDB (時序資料) + 可選 Redis (即時 cache)
> Last updated: 2026-04-25

## 〇、定位 — 三種部署拓撲

**J&J Power EMS** 同一份 codebase + 同一份 schema，依 `DEPLOYMENT_MODE` 環境變數與每站 `sites.deployment_mode` 欄位，可部署成三種拓撲。北向統一遵循 [`海辰数能EMS对接数能云MQTT协议规范 V1.4`](../hi_doc/)。

### A. 邊緣單站 (`combined`，最常見)

```
┌────────────────────────────────┐
│  J&J EMS Edge  (案場現場 1 台)  │  Web UI + 內嵌 MQTT broker + DB
└────────┬───────────────────────┘
         ↓ LAN MQTT (QoS 1)
   ┌─────────────┐
   │ 站控 (HiTHIUM SCU 或 J&J Edge) │
   └──────┬──────┘
          ↓ Modbus TCP / CAN / I/O
       [PCS / BCU / BMU / 環控]
```
適用：大部分 C&I 案場、客戶要求資料**不上雲**、單站獨立。

### B. 純 IP 多站 (`flat`，VPP / 大客戶)

```
┌──────────────────────────────────┐
│  J&J EMS Cloud  (取代海辰数能云)   │
└────────┬─────────────────────────┘
         ↓ 公網 MQTT/TLS (port 8883)
   ┌─────────┬─────────┬─────────┐
   │ 櫃控 1  │ 櫃控 2  │ 櫃控 N  │  ← 直連雲，**省站控**
   └─────────┴─────────┴─────────┘
```
適用：全 IP 化案場、無 RS485/DI/O 周邊設備、可信網路。
**省站控**的代價：櫃控要做本地保護、無法整合廠房既有 RS485 電錶或消防 DI/O。

### C. 完整三層 (`split`，大型 / 複雜整合)

```
┌──────────────────────────────────┐
│  J&J EMS Cloud                    │
└────────┬─────────────────────────┘
         ↓ 公網 MQTT/TLS
┌────────┴────────┐  ←── 站控仍然不可或缺，因為：
│ 站控 (per site)  │       1. 整合 RS485 關口表 / 儲能表
└──┬─────────┬───┘       2. DI/DO 接消防、門禁、廠房急停、液冷 alarm
   ↓ Modbus  ↓ DI/O      3. 本地策略執行 (WAN 斷線仍能運轉、安全閥)
[多櫃 + 周邊 RS485/I/O 設備]   4. 流量收斂 (聚合再上送，省頻寬)
```
適用：大型案場、有複雜周邊整合、要做 VPP / 輔助服務市場。

---

### 拓撲對照表

| 拓撲 | `sites.deployment_mode` | DB 部署 | MQTT broker | 是否需站控 | 多租戶 |
|---|---|---|---|---|---|
| **A. 邊緣單站** | `combined` | 本機 PostgreSQL + Timescale | 內嵌 Mosquitto | ✅ | 通常單租戶 |
| **B. 純 IP 多站** | `flat` | 雲端 RDS / Timescale Cloud | Managed (HiveMQ / EMQX) | ❌ | 真多租戶 + RLS |
| **C. 完整三層** | `split` | 雲端 RDS / Timescale Cloud | Managed | ✅ | 真多租戶 + RLS |

詳細部署步驟參見 [`DEPLOYMENT.md`](./DEPLOYMENT.md)。

關鍵：**Schema 都一樣**，不需要為三拓撲維護不同分支。

---

## 一、整體架構

```
┌──────────────────────────────────────────────────────────────┐
│           應用層 (Web UI / API Server / 控制 worker)           │
└──────────────────────────────────────────────────────────────┘
                ↓                    ↓                    ↓
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  PostgreSQL 16   │  │  TimescaleDB     │  │  Redis (option)  │
│  關聯+交易資料     │  │  時序資料 hyper.  │  │  即時 cache+pub  │
│  • 站點/櫃體      │  │  • 遙測 (1s/5s)  │  │  • 即時看板      │
│  • 設備/cells     │  │  • 電芯級資料     │  │  • WebSocket    │
│  • 用戶/RBAC      │  │  • 告警事件       │  │  • Rate limit   │
│  • 排程/策略      │  │  • 結算記錄       │  │                  │
│  • 帳務/結算      │  │                  │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

設計原則：
- **多租戶 (multi-tenant)**：所有資料都帶 `org_id`，行級隔離
- **不可變稽核**：所有寫操作都記 `audit_logs`
- **時序與關聯分離**：高頻遙測進 TimescaleDB hypertable，低頻定義性資料進普通表
- **點位即文件**：所有設備規格、Modbus 地址都資料化，不寫死

---

## 二、資料表分組

依照六大領域劃分 28 張表：

| 領域 | 表 | 用途 |
|---|---|---|
| **A. 多租戶與身份** | organizations, users, roles, user_roles, api_tokens, sessions, audit_logs | 帳號、權限、稽核 |
| **B. 站點與設備** | sites, cabinet_models, cabinets, devices, packs, cells, modbus_points | 案場硬體階層 |
| **C. 策略與排程** | strategies, schedule_overrides, dispatch_commands, strategy_runs | 控制邏輯持久化 |
| **D. 時序遙測** | telemetry_cabinet_1s, telemetry_cell_30s, telemetry_meter_1m, telemetry_pv_1m | 高頻監測資料 |
| **E. 告警與事件** | alarm_definitions, alarm_events, alarm_acks | 告警引擎 |
| **F. 財務與結算** | tariff_plans, tariff_periods, billing_periods, savings_records, capex_records | 電費試算與績效 |
| **G. 預測與最佳化** | load_forecasts, pv_forecasts, weather_observations, optimization_runs | AI / 排程引擎 |
| **H. 外部整合** | tpc_signals, openrouter_credits | 台電、雲端 LLM |
| **I. MQTT 對接層** | mqtt_gateways, mqtt_messages_raw, mqtt_commands, mqtt_field_map | 北向協議 (與 SCU 通訊) |

---

## 三、ER 圖（簡化）

```
organizations 1—N sites 1—N cabinets 1—N devices
                       │            │      │
                       │            │      └─→ packs 1—N cells (512 max)
                       │            │
                       │            └─→ telemetry_cabinet_1s (hypertable)
                       │
                       └─→ strategies 1—N strategy_runs
                       └─→ schedule_overrides
                       └─→ tariff_plans 1—N tariff_periods
                       └─→ billing_periods 1—N savings_records
                       └─→ alarm_events
                       └─→ load_forecasts / pv_forecasts

users N—M roles (via user_roles, scoped by site_id)
all writes ─→ audit_logs
```

---

## 四、表結構詳述

### A. 多租戶與身份

#### `organizations`
代表客戶/企業（J&J Power、其下案場業主）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| name | TEXT | 顯示名稱 |
| legal_name | TEXT | 法人名稱 |
| tax_id | TEXT | 統編 |
| contact_email | TEXT | |
| created_at | TIMESTAMPTZ | |

#### `users`
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| org_id | UUID FK | |
| email | TEXT UNIQUE | 登入帳號 |
| password_hash | TEXT | argon2id |
| display_name | TEXT | |
| locale | TEXT | 預設 'zh-TW' |
| mfa_secret | TEXT | TOTP base32 |
| active | BOOLEAN | |
| last_login_at | TIMESTAMPTZ | |

#### `user_roles`
複合鍵，一個 user 可在不同站點有不同角色
| 欄位 | 型別 | 說明 |
|---|---|---|
| user_id | UUID FK | |
| role | ENUM | admin / operator / manager / viewer |
| site_id | UUID FK | NULL = 全站適用 |
| PRIMARY KEY (user_id, role, site_id) | | |

#### `api_tokens`
給機器（Modbus worker、雲端推播）用
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| org_id | UUID FK | |
| name | TEXT | 例：'modbus-worker-1' |
| token_hash | TEXT | SHA-256 |
| scopes | TEXT[] | `['telemetry:write','alarm:read']` |
| expires_at | TIMESTAMPTZ | |
| last_used_at | TIMESTAMPTZ | |

#### `audit_logs`
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | BIGSERIAL PK | |
| ts | TIMESTAMPTZ | |
| user_id | UUID NULL | NULL=系統 |
| action | TEXT | 'strategy.change'、'cabinet.power_off' 等 |
| target_type | TEXT | 'site' / 'cabinet' / 'pcs' |
| target_id | TEXT | |
| ip_address | INET | |
| payload | JSONB | 異動前後快照 |

---

### B. 站點與設備

#### `sites`
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| org_id | UUID FK | |
| code | TEXT UNIQUE | 'kh-luzhu' |
| name | TEXT | '高雄路竹廠' |
| address | TEXT | |
| lat / lon | DECIMAL(9,6) | GPS |
| contract_kw | INTEGER | 契約容量 |
| tariff_plan_id | UUID FK | |
| industry | TEXT | |
| pv_kwp | DECIMAL(8,2) | 太陽能裝置容量 |
| timezone | TEXT | 'Asia/Taipei' |
| active_strategy_id | UUID FK | 當前運行策略 |
| created_at | TIMESTAMPTZ | |

#### `cabinet_models`
規格主檔，6 個寬版 + 1 窄版
| 欄位 | 型別 | 說明 |
|---|---|---|
| model_code | TEXT PK | 'Zpower-AC-261L-S120-L125-TR-2H' |
| series | TEXT | 'Zpower-AC-261L' |
| variant | TEXT | 'wide' / 'narrow' |
| pcs_rated_kw | DECIMAL(7,2) | 125.00 |
| pcs_max_kw | DECIMAL(7,2) | 150.00 |
| battery_kwh | DECIMAL(8,3) | 261.248 |
| battery_chemistry | TEXT | 'LFP' |
| cell_config | TEXT | '1P260S' |
| nominal_voltage | DECIMAL(6,2) | 832.0 |
| c_rate | DECIMAL(3,2) | 0.50 |
| has_mppt | BOOLEAN | |
| mppt_kw | INTEGER | 60 / 120 |
| has_sts | BOOLEAN | |
| has_transformer | BOOLEAN | |
| width_mm / depth_mm / height_mm | INTEGER | |
| weight_kg | INTEGER | |
| ip_battery / ip_electrical | TEXT | 'IP55' |
| description | TEXT | |
| spec_doc_url | TEXT | 內網 docs |

#### `cabinets`
實際安裝的櫃子
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| site_id | UUID FK | |
| code | TEXT | 'SYS-A' |
| model_code | TEXT FK | |
| serial_number | TEXT UNIQUE | 出廠序號 |
| install_date | DATE | |
| warranty_until | DATE | |
| position | TEXT | '東南角 #1' |
| ip_address | INET | 192.168.1.11 |
| modbus_unit_id | INTEGER | |
| firmware_version | TEXT | |
| active | BOOLEAN | |
| UNIQUE(site_id, code) | | |

#### `devices`
PCS / BCU / BMU / 電錶 / HVAC / 消防 / 門禁
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| cabinet_id | UUID FK NULL | 站點級設備 (關口表) cabinet_id 為 NULL |
| site_id | UUID FK | 必填 |
| type | ENUM | pcs / bcu / bmu / meter / hvac / fire / door / pv_inverter |
| code | TEXT | 'PCS-A' |
| vendor | TEXT | 'HiTHIUM' |
| model | TEXT | |
| serial_number | TEXT | |
| ip_address | INET | |
| modbus_unit_id | INTEGER | |
| protocol | TEXT | 'modbus_tcp' / 'modbus_rtu' / 'can' / 'bacnet_ip' |
| parent_device_id | UUID FK NULL | BMU 的 parent 是 BCU |
| metadata | JSONB | 自由欄位 |
| status | TEXT | 'online' / 'offline' / 'fault' |
| last_seen_at | TIMESTAMPTZ | |

#### `packs`
電池模組（1 cabinet × 13 packs 典型）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| cabinet_id | UUID FK | |
| pack_index | INTEGER | 1‥13 |
| bmu_device_id | UUID FK | |
| cell_count | INTEGER | 16 typical |
| UNIQUE(cabinet_id, pack_index) | | |

#### `cells`
單顆電芯（1 cabinet × 208–512 cells）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | BIGSERIAL PK | |
| pack_id | UUID FK | |
| cell_index | INTEGER | 1‥16 within pack |
| global_index | INTEGER | 1‥512 within rack |
| UNIQUE(pack_id, cell_index) | | |

#### `modbus_points`
**設備規格 → Modbus 暫存器**對應表（之前 BMS-EMS xlsx 的內容）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | BIGSERIAL PK | |
| device_type | ENUM | pcs / bcu / bmu / meter |
| vendor | TEXT | 'HiTHIUM' |
| model | TEXT | NULL = 所有型號通用 |
| name_zh / name_en | TEXT | 'Rack SOC' |
| address | INTEGER | 寄存器地址 |
| function_code | INTEGER | 3 / 4 / 6 / 16 |
| data_type | TEXT | 'uint16' / 'int16' / 'uint32' / 'float32' |
| scale | DECIMAL | 0.1 (e.g., SOC stored as ‰) |
| unit | TEXT | 'kW' / '°C' / '%' |
| description | TEXT | |
| writable | BOOLEAN | |

---

### C. 策略與排程

#### `strategies`
6 種預設策略 + 自訂
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| org_id | UUID FK | |
| code | TEXT | 'arbitrage' / 'peak_shave' / ... |
| name | TEXT | |
| description | TEXT | |
| color | TEXT | hex |
| params | JSONB | SoC 上下限、最大功率、削峰目標等 |
| is_system | BOOLEAN | true=內建不可刪 |

#### `schedule_overrides`
使用者畫的 24h 客製排程
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| site_id | UUID FK | |
| effective_date | DATE | |
| hour | SMALLINT | 0‥23 |
| mode | ENUM | charge / discharge / idle |
| target_kw | DECIMAL(7,2) | charge 為負 |
| label | TEXT | '充'、'放'、'sReg' |
| created_by | UUID FK | |
| created_at | TIMESTAMPTZ | |
| UNIQUE(site_id, effective_date, hour) | | |

#### `dispatch_commands`
EMS → PCS 實際下發的指令
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | BIGSERIAL PK | |
| ts | TIMESTAMPTZ | |
| cabinet_id | UUID FK | |
| device_id | UUID FK | 通常是 PCS |
| command_type | TEXT | 'p_setpoint' / 'q_setpoint' / 'mode' / 'reset' |
| value | DECIMAL | |
| source | TEXT | 'strategy' / 'manual' / 'safety' |
| issued_by | UUID FK NULL | NULL=自動 |
| ack_status | TEXT | pending / ok / fail / timeout |
| ack_ts | TIMESTAMPTZ | |
| error_msg | TEXT | |

→ 應建為 hypertable

#### `strategy_runs`
策略生效歷史（哪段時間用哪個策略）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| site_id | UUID FK | |
| strategy_id | UUID FK | |
| started_at | TIMESTAMPTZ | |
| ended_at | TIMESTAMPTZ NULL | NULL=當前運行 |
| changed_by | UUID FK NULL | |
| changed_via | TEXT | 'web' / 'api' / 'auto' |

---

### D. 時序遙測（TimescaleDB hypertables）

#### `telemetry_cabinet_1s`
每櫃每秒 1 筆
| 欄位 | 型別 | 說明 |
|---|---|---|
| ts | TIMESTAMPTZ NOT NULL | partition key |
| cabinet_id | UUID NOT NULL | |
| pcs_p_kw | REAL | 即時功率 (放電為正) |
| pcs_q_kvar | REAL | |
| dc_voltage | REAL | |
| dc_current | REAL | |
| ac_voltage | REAL | |
| frequency | REAL | |
| soc | REAL | 0‥100 |
| soh | REAL | 0‥100 |
| temp_avg | REAL | |
| temp_max | REAL | |
| temp_min | REAL | |
| insulation_kohm | REAL | |
| efficiency_pct | REAL | |
| status_bitmap | INTEGER | |

設定：
```sql
SELECT create_hypertable('telemetry_cabinet_1s', 'ts', chunk_time_interval => INTERVAL '1 day');
ALTER TABLE telemetry_cabinet_1s SET (timescaledb.compress, timescaledb.compress_segmentby = 'cabinet_id');
SELECT add_compression_policy('telemetry_cabinet_1s', INTERVAL '7 days');
SELECT add_retention_policy('telemetry_cabinet_1s', INTERVAL '90 days');
```
→ 7 天後自動壓縮（壓縮率 ~10x），90 天後刪除

#### `telemetry_cell_30s`
每電芯每 30 秒 1 筆（資料量大，採稀疏採樣）
| 欄位 | 型別 | 說明 |
|---|---|---|
| ts | TIMESTAMPTZ | |
| cabinet_id | UUID | |
| cell_global_index | SMALLINT | 1‥512 |
| voltage_mv | SMALLINT | 3,200‥3,600 |
| temp_c10 | SMALLINT | 溫度 × 10，省空間 |
| balancing | BOOLEAN | 主動均衡中 |

→ Hypertable + 7 天壓縮 + 30 天降採樣為 5min 平均移到 `telemetry_cell_5m`

#### `telemetry_meter_1m`
關口表/儲能表 每分鐘
| 欄位 | 型別 | 說明 |
|---|---|---|
| ts | TIMESTAMPTZ | |
| device_id | UUID | |
| p_kw | REAL | |
| q_kvar | REAL | |
| pf | REAL | 功率因數 |
| voltage_avg | REAL | |
| frequency | REAL | |
| import_kwh_cumul | DOUBLE PRECISION | 累計購入 |
| export_kwh_cumul | DOUBLE PRECISION | 累計賣出 |
| max_demand_15min | REAL | 15 分鐘需量 |

#### `telemetry_pv_1m`
| 欄位 | 型別 | 說明 |
|---|---|---|
| ts | TIMESTAMPTZ | |
| device_id | UUID | inverter |
| ac_p_kw | REAL | |
| dc_voltage | REAL | |
| dc_current | REAL | |
| daily_kwh | REAL | |
| irradiance_w_m2 | REAL | (從氣象 API 配對) |

---

### E. 告警與事件

#### `alarm_definitions`
告警範本
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| code | TEXT UNIQUE | 'cell.temp.high' |
| name_zh / name_en | TEXT | |
| severity | ENUM | info / warning / error / critical |
| category | TEXT | 'thermal' / 'comm' / 'safety' |
| auto_action | TEXT | 'derate' / 'shutdown' / 'notify' / NULL |
| description | TEXT | |
| recommended_action | TEXT | |

#### `alarm_events`
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | BIGSERIAL PK | |
| ts | TIMESTAMPTZ | |
| site_id | UUID FK | |
| device_id | UUID FK NULL | |
| alarm_def_id | UUID FK | |
| severity | ENUM | 重複以利索引 |
| state | ENUM | active / acked / cleared |
| value | DECIMAL | 觸發時的數值 |
| threshold | DECIMAL | |
| metadata | JSONB | |

→ Hypertable, 365 天保留

#### `alarm_acks`
| 欄位 | 型別 | 說明 |
|---|---|---|
| event_id | BIGINT FK | |
| user_id | UUID FK | |
| ts | TIMESTAMPTZ | |
| comment | TEXT | |

---

### F. 財務與結算

#### `tariff_plans`
電價方案主檔
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| code | TEXT UNIQUE | 'tw-hv-3stage-summer' |
| name | TEXT | '高壓三段式時間電價 (夏月)' |
| effective_from | DATE | |
| effective_until | DATE NULL | |
| basic_charge_per_kw | DECIMAL(6,2) | 經常契約基本電費 |
| metadata | JSONB | |

#### `tariff_periods`
時段定義
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| plan_id | UUID FK | |
| period_type | ENUM | peak / mid_peak / off_peak |
| weekday_mask | SMALLINT | bit 0=Mon ... 6=Sun |
| start_hour | SMALLINT | |
| end_hour | SMALLINT | |
| price_per_kwh | DECIMAL(6,3) | 'NT$/度' |

#### `billing_periods`
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| site_id | UUID FK | |
| month | DATE | YYYY-MM-01 |
| basic_charge | DECIMAL(10,2) | |
| energy_charge | DECIMAL(10,2) | |
| penalty | DECIMAL(10,2) | 超約罰款 |
| total | DECIMAL(10,2) | |
| max_demand_kw | DECIMAL(7,2) | 月內最大需量 |
| total_kwh | DECIMAL(10,2) | |
| co2_kg | DECIMAL(10,2) | |
| issued_at | TIMESTAMPTZ | |

#### `savings_records`
儲能效益分解
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| billing_period_id | UUID FK | |
| basic_saved | DECIMAL(10,2) | 契約降載省下 |
| penalty_avoided | DECIMAL(10,2) | 避免超約 |
| arbitrage_revenue | DECIMAL(10,2) | 尖離峰套利 |
| sreg_revenue | DECIMAL(10,2) | sReg 收益 |
| afc_revenue | DECIMAL(10,2) | 調頻收益 |
| total_saved | DECIMAL(10,2) | GENERATED |
| cycles_count | DECIMAL(5,2) | 循環次數 |

#### `capex_records`
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| site_id | UUID FK | |
| item | TEXT | 'SYS-A 採購' / 'EPC' |
| amount | DECIMAL(12,2) | |
| paid_date | DATE | |
| depreciation_years | SMALLINT | |
| salvage_value_pct | DECIMAL(4,2) | |

---

### G. 預測與最佳化

#### `load_forecasts`
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| site_id | UUID FK | |
| forecast_for | TIMESTAMPTZ | 預測對應時間 |
| horizon_h | SMALLINT | 1‥72 |
| predicted_kw | REAL | |
| confidence_low | REAL | 80% PI 下界 |
| confidence_high | REAL | |
| model_name | TEXT | 'lstm-v1' |
| created_at | TIMESTAMPTZ | |

#### `pv_forecasts`
同上結構，加 `irradiance_w_m2`

#### `weather_observations`
| 欄位 | 型別 | 說明 |
|---|---|---|
| ts | TIMESTAMPTZ | |
| site_id | UUID FK | |
| temperature | REAL | |
| humidity | REAL | |
| irradiance | REAL | |
| cloud_cover | REAL | 0‥1 |
| wind_speed | REAL | |
| source | TEXT | 'cwa' / 'openweather' |

#### `optimization_runs`
排程最佳化執行紀錄
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| site_id | UUID FK | |
| triggered_at | TIMESTAMPTZ | |
| solver | TEXT | 'milp-glpk' / 'rule-based' |
| objective | TEXT | 'cost_min' / 'soc_balance' |
| input_params | JSONB | |
| output_schedule | JSONB | 24h 排程結果 |
| solve_time_ms | INTEGER | |
| status | TEXT | success / infeasible / timeout |

---

### H. 外部整合

#### `tpc_signals`
台電 OpenADR / sReg 派遣
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| received_at | TIMESTAMPTZ | |
| event_id | TEXT | 台電給的 event ID |
| event_type | TEXT | 'sreg' / 'dr_program' / 'dispatch' |
| start_at / end_at | TIMESTAMPTZ | |
| target_kw | DECIMAL(8,2) | 目標降載/供電 |
| price_per_kwh | DECIMAL(6,3) | 補償單價 |
| status | TEXT | accepted / declined / completed |
| compliance_pct | DECIMAL(5,2) | 執行率 |

---

### I. MQTT 對接層 (Northbound, with HiTHIUM SCU)

#### `mqtt_gateways`
每台註冊到雲端的站控（MQTT client）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| site_id | UUID FK | 通常 1 站對 1 gateway |
| client_id | TEXT UNIQUE | 雲端核發 |
| username | TEXT | 雲端核發 |
| password_hash | TEXT | argon2 |
| device_topic | TEXT | 上行 topic 中的 `{設備主題}` |
| gateway_topic | TEXT | 下行 topic 中的 `{網關設備標識}` |
| firmware_version | TEXT | |
| last_connect_at | TIMESTAMPTZ | |
| last_disconnect_at | TIMESTAMPTZ | |
| connection_state | TEXT | 'online' / 'offline' |
| ip_address | INET | broker 端紀錄的客戶端 IP |
| metadata | JSONB | |

#### `mqtt_messages_raw`
**所有上行訊息原始 payload（Hypertable，稽核 + 重放用）**
| 欄位 | 型別 | 說明 |
|---|---|---|
| ts | TIMESTAMPTZ | 接收時間 |
| gateway_id | UUID | |
| topic | TEXT | `$ESS/.../data` |
| direction | ENUM | inbound / outbound |
| method | TEXT | FULL / VARY / RPC name |
| msg_id | TEXT | client 端訊息序號 |
| device_id | TEXT | payload 內 `dId` |
| payload | JSONB | 完整原始 JSON |
| qos | SMALLINT | |
| size_bytes | INTEGER | |

→ Hypertable, 7 天壓縮, 30 天保留（重放、debug 用，不用永久存）

#### `mqtt_commands`
**所有下行 RPC 與其回覆**
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | UUID PK | |
| gateway_id | UUID FK | |
| issued_at | TIMESTAMPTZ | |
| issued_by | UUID FK NULL | NULL=自動策略 |
| method | TEXT | UpdateStrategyData / SetStrategyPower / StartStrategy / ... |
| dId | TEXT | 目標設備 ID |
| msg_id | TEXT UNIQUE | |
| request_payload | JSONB | 完整 payload |
| resp_topic | TEXT | 回覆 topic |
| ack_status | TEXT | pending / success / failed / timeout |
| ack_code | INTEGER | 0=成功, 1=失敗 |
| ack_payload | JSONB | |
| ack_at | TIMESTAMPTZ | |
| timeout_at | TIMESTAMPTZ | issued_at + 30s |

#### `mqtt_field_map`
107 個上行字段的對應表（規格表 → 我方資料庫欄位）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | BIGSERIAL PK | |
| device_kind | TEXT | 'BMS' / 'PCS' / '溫濕度' / '消防' / '關口表' / '儲能表' |
| field_id | INTEGER | 1‥107 之類 |
| name_zh | TEXT | '簇電壓' |
| name_en | TEXT | 'Rack Voltage' |
| data_type | TEXT | '遙測' / '遙信' |
| value_type | TEXT | 'int16' / 'float' / 'enum' / 'bitmap' |
| unit | TEXT | 'V' / 'kW' / '%' |
| scale | DECIMAL | |
| enum_values | JSONB | `{"0":"在線","1":"離線"}` |
| target_table | TEXT | 'telemetry_cabinet_1s' / 'telemetry_cell_30s' |
| target_column | TEXT | 'soc' / 'temp_max' |

讓 ETL worker 不用寫死 fields，可以動態映射。

---

## 五、索引策略

```sql
-- B-tree on FKs (自動建)
-- 額外加：
CREATE INDEX idx_telemetry_cabinet_1s_cabinet_ts ON telemetry_cabinet_1s (cabinet_id, ts DESC);
CREATE INDEX idx_alarm_events_state_severity ON alarm_events (state, severity, ts DESC) WHERE state='active';
CREATE INDEX idx_dispatch_commands_cabinet_ts ON dispatch_commands (cabinet_id, ts DESC);
CREATE INDEX idx_audit_logs_user_ts ON audit_logs (user_id, ts DESC);

-- JSONB GIN (for flexible querying)
CREATE INDEX idx_strategies_params ON strategies USING GIN (params);
CREATE INDEX idx_devices_metadata ON devices USING GIN (metadata);
```

---

## 六、TimescaleDB 連續聚合 (Continuous Aggregate)

預先計算常用時段的聚合，加速儀表板查詢：

```sql
CREATE MATERIALIZED VIEW telemetry_cabinet_15m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('15 minutes', ts) AS bucket,
  cabinet_id,
  AVG(pcs_p_kw) AS avg_p_kw,
  MAX(pcs_p_kw) AS max_p_kw,
  AVG(soc) AS avg_soc,
  MAX(temp_max) AS max_temp,
  MIN(temp_min) AS min_temp
FROM telemetry_cabinet_1s
GROUP BY bucket, cabinet_id;

-- 每 5 分鐘自動 refresh 過去 1 小時資料
SELECT add_continuous_aggregate_policy('telemetry_cabinet_15m',
  start_offset => INTERVAL '2 hours',
  end_offset => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '5 minutes');
```

類似還可建：`telemetry_cabinet_1h`、`telemetry_cabinet_1d`

---

## 七、資料保留 (Retention)

| 表 | 原始保留 | 壓縮起點 | 過期刪除 |
|---|---|---|---|
| telemetry_cabinet_1s | 90 天 | 7 天 | 90 天 |
| telemetry_cell_30s | 30 天 | 7 天 | 30 天 |
| telemetry_meter_1m | 365 天 | 30 天 | 永久（合規） |
| dispatch_commands | 365 天 | 30 天 | 7 年 |
| alarm_events | 永久 | 90 天 | 永久 |
| audit_logs | 永久 | 30 天 | 永久（合規） |
| billing_periods | 永久 | - | 永久 |

長期歷史值：通過連續聚合保留聚合（15min/1h/1d），原始秒級資料過期釋放空間。

---

## 八、權限模型 (Row Level Security)

PostgreSQL RLS 啟用，每個 query 都帶 session 變數 `app.current_user_id`、`app.current_org_id`。

範例策略：
```sql
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY sites_org_isolation ON sites
  USING (org_id = current_setting('app.current_org_id')::UUID);

CREATE POLICY sites_admin_full ON sites
  TO admin_role
  USING (true);
```

---

## 九、預估資料量

假設 1 站 × 2 櫃 × 13 packs × 16 cells = 416 cells (用 208 計算)：

| 資料源 | 採樣率 | 每天筆數 | 每月筆數 | 估計大小/月 |
|---|---|---|---|---|
| telemetry_cabinet_1s | 1 Hz × 2 櫃 | 172,800 | 5.18M | ~1 GB（壓縮前） |
| telemetry_cell_30s | 1/30 Hz × 416 cells | 1,198,080 | 35.9M | ~1.5 GB |
| telemetry_meter_1m | 1/60 Hz × 4 meter | 5,760 | 173K | ~10 MB |
| alarm_events | 偶發 | ~50 | ~1,500 | <1 MB |
| dispatch_commands | 1/30 sec × 2 櫃 | 5,760 | 173K | ~20 MB |

**單站每月 ~3 GB 原始資料，壓縮後 ~300 MB**。
1000 站規模 → 300 GB/月 壓縮後資料，TimescaleDB 雙節點 + S3 冷儲應付得來。

---

## 十、遷移與部署

### 推薦工具鏈
- **Prisma** ORM（schema.prisma + auto-migration）+ 手寫 SQL for TimescaleDB hypertable / RLS
- **node-pg-migrate** 或 **dbmate**（純 SQL migration）
- 容器：PostgreSQL 16 + `timescale/timescaledb-ha:pg16-latest` Docker image

### 環境
| 環境 | 用途 |
|---|---|
| dev | 本機 Docker 單節點 |
| staging | 雲端單節點 + S3 backup |
| prod | TimescaleDB HA (主從) + WAL streaming + 跨可用區備份 |

### 備份策略
- **WAL streaming**：寫入即時複製到 standby
- **每日全備份**：dump 到 S3，加密保留 90 天
- **PITR**（point-in-time recovery）：保留 7 天 WAL

---

## 十一、查詢範例

### 最近 1 小時 SYS-A 平均功率與最高溫度
```sql
SELECT time_bucket('1 minute', ts) AS minute,
       AVG(pcs_p_kw) AS avg_kw,
       MAX(temp_max) AS peak_temp
FROM telemetry_cabinet_1s
WHERE cabinet_id = $1 AND ts > NOW() - INTERVAL '1 hour'
GROUP BY minute ORDER BY minute;
```

### 本月節費組成
```sql
SELECT
  s.basic_saved, s.penalty_avoided,
  s.arbitrage_revenue, s.sreg_revenue, s.afc_revenue,
  s.total_saved
FROM savings_records s
JOIN billing_periods b ON b.id = s.billing_period_id
WHERE b.site_id = $1 AND b.month = date_trunc('month', NOW());
```

### 找出電芯不平衡
```sql
WITH latest AS (
  SELECT DISTINCT ON (cell_global_index)
    cell_global_index, voltage_mv
  FROM telemetry_cell_30s
  WHERE cabinet_id = $1
  ORDER BY cell_global_index, ts DESC
)
SELECT
  MAX(voltage_mv) - MIN(voltage_mv) AS delta_mv,
  ARRAY_AGG(cell_global_index) FILTER (WHERE voltage_mv = (SELECT MAX(voltage_mv) FROM latest)) AS hot_cells
FROM latest;
```

### 過去 7 天告警類別統計（給儀表板甜甜圈圖）
```sql
SELECT a.category, COUNT(*) AS n
FROM alarm_events e
JOIN alarm_definitions a ON a.id = e.alarm_def_id
WHERE e.site_id = $1 AND e.ts > NOW() - INTERVAL '7 days'
GROUP BY a.category;
```

---

## 十二、後續工作

1. **schema.sql** — 完整 DDL（同目錄下）
2. **seed.sql** — 種子資料：3 個 organization、6 cabinet_models、6 strategies、tariff_plan + periods、208 cells
3. **prisma/schema.prisma** — Node 端 ORM 定義（自動產生 TS 型別）
4. **migrations/** — 版本化 SQL 遷移檔
5. 寫 ETL worker：Modbus poller → INSERT into telemetry_cabinet_1s
6. API 層：REST + WebSocket，前端 EMS 改打 API 取代 mock 資料
