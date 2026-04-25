# 部署指南 — 三種拓撲

J&J Power EMS 同一份 codebase + schema，依部署選擇切換為三種拓撲。

| 拓撲 | env `DEPLOYMENT_MODE` | 站點 `deployment_mode` | 適用 | 月費 (估) |
|---|---|---|---|---|
| **A. 邊緣單站** | `edge` | `combined` | 大部分 C&I 案場 | NT$ 0 (硬體 NT$ 30K 一次性) |
| **B. 純 IP 多站** | `cloud` | `flat` | VPP / 大客戶 / 全 IP 案場 | NT$ 5K–30K |
| **C. 完整三層** | `cloud` | `split` | 大型 + 複雜整合 | NT$ 5K–30K + 站控成本 |

---

## A. 邊緣單站（最常見）

### 架構

```
┌────────────────────────────────────────┐
│  Edge Box  (案場機房，1 台 mini-PC)      │
│  ┌──────────────────────────────────┐  │
│  │ Docker compose stack:             │  │
│  │  · web (J&J EMS Web UI)           │  │
│  │  · api (Node.js / Python)         │  │
│  │  · postgres + timescaledb         │  │
│  │  · mosquitto (MQTT broker)        │  │
│  │  · redis                          │  │
│  └──────────────────────────────────┘  │
└────────┬───────────────────────────────┘
         │ LAN (192.168.x.x)
         ↓ MQTT QoS 1
   [HiTHIUM SCU 站控] ← Modbus/CAN/I/O → [櫃 + PCS + BCU + 周邊]
```

### 硬體建議

- **CPU**：4 核 / 8 GB RAM 起跳
- **儲存**：SSD 256 GB+（時序資料用）
- **產品**：Intel NUC、Advantech ARK、OnLogic FR201、ASRock 工業 PC
- **網卡**：雙網口（一邊接案場 LAN、一邊管理）
- **電源**：UPS 必備

### 設定

```bash
# .env
DEPLOYMENT_MODE=edge
DATABASE_URL=postgres://ems:xxx@localhost:5432/ems
MQTT_BROKER_URL=mqtt://localhost:1883
ORG_ID=22222222-0000-0000-0000-000000000001
SITE_ID=33333333-0000-0000-0000-000000000001
```

```bash
cd db && docker compose up -d
docker exec -i jjems-pg psql -U ems -d ems < schema.sql
docker exec -i jjems-pg psql -U ems -d ems < seed.sql
```

UI 開放在 `http://192.168.x.x:8088`，廠內任何電腦可登入。

### 特點
- ✅ 資料完全自有，不上雲
- ✅ WAN 斷線完全不影響運轉
- ✅ 部署最簡單、月費 NT$ 0
- ❌ 不支援多站點聚合
- ❌ 客戶要分權限自行管

---

## B. 純 IP 多站（VPP / 大客戶）

### 架構

```
┌──────────────────────────────────┐
│  J&J EMS Cloud  (AWS / GCP)        │
│  ┌──────────────────────────────┐ │
│  │ · Web (Vercel / Cloudflare)   │ │
│  │ · API (containerized)         │ │
│  │ · PostgreSQL (RDS / Aurora)   │ │
│  │ · TimescaleDB (Timescale Cloud)│ │
│  │ · MQTT broker (HiveMQ Cloud)  │ │
│  └──────────────────────────────┘ │
└────────┬─────────────────────────┘
         ↓ 公網 MQTT/TLS (port 8883, X.509 雙向認證)
   ┌─────────┬─────────┬─────────┐
   │ 櫃控-1   │ 櫃控-2  │ 櫃控-N  │  ← 各案場獨立網路
   └─────────┴─────────┴─────────┘
```

### 設定

```bash
# .env (cloud)
DEPLOYMENT_MODE=cloud
DATABASE_URL=postgres://...@db.timescale.cloud:5432/ems
MQTT_BROKER_URL=mqtts://x.eu-central-1.hivemq.cloud:8883
MQTT_TLS_CA=/secrets/ca.pem
ENABLE_RLS=true
```

每站新增到資料庫：
```sql
INSERT INTO sites (org_id, code, name, deployment_mode, ...)
VALUES (..., 'kh-luzhu', '高雄路竹廠', 'flat', ...);
```

每櫃配發 MQTT 帳密：
```sql
INSERT INTO mqtt_gateways (site_id, client_id, username, password_hash, ...)
VALUES (..., 'jj-kh-luzhu-cab-001', 'cab001', '$argon2id$...', ...);
```

### 特點
- ✅ 多站集中監控、跨站排程最佳化
- ✅ 適合 VPP / 輔助服務市場聚合
- ✅ 無需站控硬體，BOM 較低
- ❌ 案場必須全 IP 化（無法接 RS485 電錶）
- ❌ 無法接消防/門禁等 DI/O
- ❌ WAN 斷線時各櫃只能執行最後一次下發的策略

---

## C. 完整三層（大型 / 複雜整合）

### 架構

```
J&J EMS Cloud
     ↓ 公網 MQTT/TLS
┌────┴─────┐
│ 站控 (per site) │ ← 仍然不可或缺：
└──┬───────┬──┘    1. 整合 RS485 關口表 / 儲能表 / 老舊 PMS
   ↓ Modbus ↓ DI/O   2. 接消防、門禁、廠房急停、液冷 alarm
[多櫃 + 周邊 RS485/I/O]   3. 本地保護 (ms 級安全閥)
                       4. 流量收斂上送
```

### 何時要選 C 而不是 B

| 條件 | 必選 C |
|---|---|
| 案場有 RS485 電錶（傳統電力監控、台電 MOF） | ✅ |
| 接消防 VESDA / 煙感 / 氣溶膠 | ✅ |
| 接門禁系統、廠房急停按鈕 | ✅ |
| WAN 不穩定、需離線運轉 | ✅ |
| 要參與台電 sReg / AFC（毫秒級響應） | ✅ |
| 多櫃並聯需本地協調 | ✅ |

### 設定

雲端與 B 相同，差別只在每站 `deployment_mode = 'split'`，且要為每站採購 1 台站控（HiTHIUM SCU 或 J&J Edge）。

---

## 升級路徑

### A → C （單站擴充為多站集中）
1. 在雲端開新環境（AWS / Timescale Cloud + HiveMQ Cloud）
2. `pg_dump` 邊緣 DB → 雲端 restore（保留歷史資料）
3. 邊緣站控改連雲端 broker（修 MQTT URL）
4. UI 改用雲端網域、邊緣 EMS 改成唯讀備份模式
5. 新增站點全跑 cloud 模式

### A → B （邊緣升級為純 IP 雲端）
僅當案場無 RS485/DI/O 周邊才適用。否則應升級到 C。

### B ↔ C 切換
只是 `sites.deployment_mode` 欄位改值 + 是否裝站控的硬體決策。
應用層自動依此調整：
- `flat` 模式下，UI 顯示「直連櫃控」
- `split` 模式下，UI 顯示站控節點
