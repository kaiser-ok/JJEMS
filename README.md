# J&J Power EMS · 儲能能源管理系統 (Web 雛形)

針對 J&J Power **2 × Zpower-AC-261L (125 kW / 261 kWh)** 表後工商業儲能整合系統的能源管理系統 (EMS) Web 雛形，集中監控儲能、太陽能、市電與廠區負載，提供時間套利、削峰填谷、需量反應與財務試算。

> 設計參考：POXA SD-EMS、加雲聯網 iVPP、嘉義上評紙廠 EMS 報告。

---

## 系統規格

| 項目 | 規格 |
|---|---|
| **SYS-A** | Zpower-AC-261L-S120-L125-TR-2H · 125 kW PCS · 261.248 kWh · 2× MPPT + STS + 幹變 |
| **SYS-B** | Zpower-AC-261L-S60-L125-2H · 125 kW PCS · 261.248 kWh · 1× MPPT + STS |
| **合計** | 250 kW / 522 kWh (LFP 1P260S · 832V · 0.5C) |
| **可擴展** | 並聯最多 12 櫃 → 1.5 MW / 3.13 MWh |
| **櫃體** | 1800×1350×2280 mm · 3,500 kg · IP55/IP54 · 防腐 C5 |
| **示範站** | 高雄路竹廠 · 契約容量 2,500 kW · 高壓三段式時間電價 |
| **整合** | 太陽能 400 kWp + 表後儲能 + 廠區負載 |
| **EMS 控制器** | HiEMS-SCU-V2-2 (站控) + 櫃控一體機 (隨櫃標配) |
| **通訊** | 站控 ↔ 雲: MQTT/TLS · 站控 ↔ 櫃控: Modbus TCP · 櫃控 ↔ BCU/BMU: CAN |

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

### 啟用 Live AI Chat（OpenRouter LLM）

預設聊天使用本地規則匹配（mock）。要改用真實 LLM：

1. 到 https://openrouter.ai/settings/keys 建立 API key
2. Vercel Dashboard → 你的專案 → **Settings** → **Environment Variables**
3. 新增 `OPENROUTER_API_KEY` = 你的 key（**不要寫進程式碼**）
4. Redeploy

預設模型 `google/gemini-flash-1.5-8b`（cheap paid，約 $0.0375/M input、$0.15/M output — 上千次 demo 才花幾美分）。Fallback 鏈含 `gemini-2.0-flash-exp:free` 與 `llama-3.3-70b:free`。要換可改 `api/chat.js` 的 `MODELS` 陣列。

LLM 在線時 Chat 視窗副標題會顯示「● Live (LLM)」綠燈。失敗會自動 fallback 到本地 mock 回覆。

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
