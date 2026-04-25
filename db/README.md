# `db/` — J&J Power EMS 資料庫

## 檔案

| 檔案 | 用途 |
|---|---|
| [`SCHEMA.md`](./SCHEMA.md) | 完整資料庫設計文件（28 張表、ER、索引、保留策略、查詢範例） |
| [`schema.sql`](./schema.sql) | PostgreSQL 16 + TimescaleDB DDL，可直接 `psql` 執行 |
| [`seed.sql`](./seed.sql) | 種子資料：7 個 cabinet_models、6 strategies、台電電價、demo site |
| [`docker-compose.yml`](./docker-compose.yml) | 本機 PostgreSQL + TimescaleDB + Redis + Adminer |

## 快速開始

```bash
cd db
docker compose up -d                   # 拉起 timescaledb-ha + redis + adminer
sleep 10                               # 等 pg ready

docker exec -i jjems-pg psql -U ems -d ems < schema.sql
docker exec -i jjems-pg psql -U ems -d ems < seed.sql

# 進 SQL shell 看看
docker exec -it jjems-pg psql -U ems -d ems
ems=# \dt          -- 列出所有表
ems=# SELECT * FROM cabinet_models;
ems=# SELECT * FROM v_active_alarms;
```

開 http://localhost:8081 用 Adminer 圖形介面（系統選 PostgreSQL，主機 `postgres`）。

## 連線字串

| 用途 | URL |
|---|---|
| PostgreSQL | `postgres://ems:ems_dev_only_change_me@localhost:5432/ems` |
| Redis | `redis://localhost:6379` |
| Adminer | http://localhost:8081 |

## 關鍵設計原則

1. **多租戶隔離**：所有資料都帶 `org_id`，啟用 PostgreSQL Row Level Security
2. **時序與關聯分離**：高頻遙測（cabinet/cell）走 TimescaleDB hypertable，定義性資料走普通表
3. **點位即文件**：Modbus 寄存器映射用 `modbus_points` 表管理，避免硬編碼
4. **稽核即合規**：所有寫操作 → `audit_logs`，永久保留
5. **壓縮 + 過期**：原始 1 秒級資料 7 天後自動壓縮（~10x 比例），90 天後刪除；連續聚合保留 15 分鐘 / 1 小時 / 1 天的彙總

## 資料量估算

| 規模 | 原始/月 | 壓縮後 |
|---|---|---|
| 1 站 × 2 櫃 | ~3 GB | ~300 MB |
| 100 站 × 2 櫃 | ~300 GB | ~30 GB |
| 1000 站 × 2 櫃 | ~3 TB | ~300 GB |

## 後續步驟

1. ~~schema.sql~~ ✓
2. ~~seed.sql~~ ✓
3. **Prisma schema** (TS 型別、Web/API 用)
4. **Modbus poller worker** (Node.js 或 Python，1 Hz 取資料寫 hypertable)
5. **REST + WebSocket API** 讓現在的 EMS Web 改打 API 取代 mock
6. **告警引擎 worker** (規則 → INSERT alarm_events)
7. **排程最佳化 worker** (MILP 解 24h 排程)
