# J&J Power EMS · 儲能能源管理系統 (Web 雛形)

針對 J&J Power **125 kW / 261 kWh** + **100 kW / 215 kWh** 表後工商業儲能整合系統的能源管理系統 (EMS) Web 雛形，集中監控儲能、太陽能、市電與廠區負載，提供時間套利、削峰填谷、需量反應與財務試算。

> 設計參考：POXA SD-EMS、加雲聯網 iVPP、嘉義上評紙廠 EMS 報告。

---

## 系統規格

| 項目 | 規格 |
|---|---|
| **SYS-A** | PCS 125 kW · 電池 261 kWh · LFP 液冷 · 2.09h |
| **SYS-B** | PCS 100 kW · 電池 215 kWh · LFP 液冷 · 2.15h |
| **合計** | 225 kW / 476 kWh |
| **示範站** | 高雄路竹廠 · 契約容量 2,500 kW · 高壓三段式時間電價 |
| **整合** | 太陽能 400 kWp + 表後儲能 + 廠區負載 |

---

## 功能總覽（7 個畫面）

| # | 畫面 | 重點 |
|---|---|---|
| 1 | **首頁總覽** | 6 張 KPI 卡、能源流向 5 節點圖、24h 功率曲線 (市電/PV/儲能/負載)、SoC 曲線、能量平衡、近期告警 |
| 2 | **案場單線圖** | SVG 動態 SLD：台電 22.8kV → 主變壓器 → LV BUS → PCS-A/B → 電池櫃 → 負載饋線；含動畫電流方向、CB 狀態、保護電驛 |
| 3 | **設備監控** | 兩系統儀表卡、208 cells 電芯溫度熱力圖、PCS/BMS 即時參數、HVAC/消防/門禁環控 |
| 4 | **排程與策略** | 6 種策略（套利/削峰/sReg/AFC/光儲自用/手動）、24h 視覺化排程格、電價曲線、套利試算 |
| 5 | **財務效益** | 年節費 / 套利收益 / 契約降載 / IRR；月度堆疊柱、15 年累積現金流、月度明細表 |
| 6 | **告警與事件** | 4 級分類 (ok/info/warn/err)、告警分佈、Line/Email/Webhook 推播設定 |
| 7 | **系統設定** | 站點資料、儲能規格、通訊協定 (Modbus / BACnet / IEC 61850 / MQTT)、資安 (IEC 62443 / X.509 / RBAC)、使用者權限 |

---

## 技術棧

- **純靜態 SPA**（無需 build step，部署即用）
- HTML / CSS / Vanilla JS
- [Chart.js 4](https://www.chartjs.org/) (CDN)
- Hash-based router · 深色主題 · 響應式 layout
- Mock 資料模擬 96 點 (15 分鐘) 24h 功率曲線

---

## 專案結構

```
.
├── index.html      # SPA 骨架（側邊選單 + 頂部狀態列）
├── styles.css      # 深色儀表板主題
├── data.js         # 站點規格 / 24h mock 資料 / 告警清單
├── app.js          # 7 視圖路由 + Chart.js 視覺化
├── .gitignore
└── .vercelignore
```

---

## 本機預覽

```bash
# 任一靜態伺服器即可
python3 -m http.server 8088
# 或
npx serve .
```

開啟 http://127.0.0.1:8088

---

## 部署到 Vercel

GitHub 連動方式（推薦）：

1. 進入 https://vercel.com/new
2. Import this repo → Framework Preset: **Other**
3. Build Command / Output Directory **留空**
4. Deploy ✅

每次 push 到 `main` 自動部署，PR 自動產生 preview URL。

---

## Roadmap

- [ ] 接入真實 Modbus TCP / MQTT 資料源
- [ ] 加入使用者登入與 RBAC（站場 / 維運 / 主管 / 訪客）
- [ ] 排程編輯互動（拖拉、複製貼上、批次套用）
- [ ] 多站點切換 (multi-tenant)
- [ ] 國際化 (i18n) — zh-TW / en
- [ ] 接台電 OpenADR sReg 通知
- [ ] 行動裝置 PWA 支援

---

## 授權

© 2026 J&J Power. All rights reserved.
