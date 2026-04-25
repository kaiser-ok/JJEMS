# J&J Power EMS · BMS 應用研究筆記

本文件彙整 **BMS (Battery Management System) 進階應用** 研究成果，並對標 Electra Vehicles 產品線，提出本專案可補強的 BMS 層功能。

---

## Electra Vehicles 產品線剖析

參考來源：https://www.electravehicles.com/products/

| 產品 | 定位 | 與 J&J Power EMS 關係 |
|---|---|---|
| **EnPower™ Design Studio** | 電池設計階段工具 — Digital Twin + ML 狀態估算 + 衰減模擬 | 低（製造前用） |
| **EVE-Ai™ 360 Fleet Analytics** | 車隊級雲端 SOH 分析、早期故障預警 | ⭐ 高 — 可轉為儲能站隊分析 |
| **EVE-Ai™ 360 Adaptive Controls** | 雲 + 嵌入式自適應充放控制 | ⭐⭐ 極高 — EMS 排程背後的智慧層 |
| **EVE-Ai™ Intelligent Display** | 駕駛端里程顯示 | 低（EV 專屬） |
| **EVE-Ai™ EAGLE Battery Passport** | 電池數位護照（歐盟法規合規） | ⭐⭐ 極高 — 2027 EU 強制要求 |

**核心差異化技術**：物理模型 + 機器學習雙引擎，SOH 誤差 **1.6%**（傳統庫倫計算誤差常 5–8%）。

---

## BMS vs EMS 的層次關係

常被混用但職責不同：

```
┌───────────────────────────────────────────────┐
│ EMS (本專案 JJEMS) — 站點級能源調度            │
│ · 運行策略（套利/削峰/sReg/AFC）                │
│ · 電價最佳化、排程、告警、財務分析              │
└──────────────┬────────────────────────────────┘
               │ Modbus/TCP, MQTT
               ▼
┌───────────────────────────────────────────────┐
│ BMS — 電池組級管理（每個電池櫃 1 套）            │
│ · 電芯電壓/電流/溫度即時監測                    │
│ · SoC 估算（庫倫計算 + OCV 校正）               │
│ · SOH 估算（容量衰退、內阻上升）                │
│ · 均衡控制（被動/主動均衡）                     │
│ · 保護（過充/過放/過流/短路/過溫）              │
│ · 故障診斷                                      │
└──────────────┬────────────────────────────────┘
               │ CAN bus
               ▼
┌───────────────────────────────────────────────┐
│ CMU (Cell Monitoring Unit) — 模組級              │
│ · 單顆電芯電壓 / 溫度感測                        │
└───────────────────────────────────────────────┘
```

Electra 的價值：**把 BMS 的邊緣計算能力補強並搬到雲端**，讓雲端能看到每顆電芯，並用 AI 預測衰減。

---

## 進階 BMS 的 6 大能力

### 1. 物理模型 + ML 雙引擎 SOH 估算
- 傳統 BMS：數圈計算（Coulomb counting）→ 誤差 5–8%，隨時間累積漂移
- 進階方案：電化學等效電路模型（ECM / P2D）+ XGBoost / LSTM → 誤差 1.6%
- 輸入特徵：電壓曲線、內阻變化、溫度時序、循環深度、C-rate 歷史

### 2. 電池護照（Battery Passport）
- **歐盟電池法規 (EU 2023/1542)** 自 2027 年強制要求：
  - 所有 > 2 kWh 工業/LMT/EV 電池必備
  - 含化學組成、供應鏈溯源、碳足跡、性能履歷、回收資訊
  - QR code 於電池本體 + 雲端可存取
- 對 J&J Power 125/100 kW 產品而言：是**必要合規成本**，也是**行銷亮點**

### 3. 異常早期預警（Prognostics）
- 鋰沉積 (Lithium Plating)：低溫快充常見，從充電電壓平台偏移抓
- 內短路 (Internal Short Circuit)：內阻突變 + 自放電異常
- 熱失控 (Thermal Runaway)：溫度斜率 + 電壓驟降組合
- SEI 膜破裂：循環效率下降

### 4. 自適應充放控制（Adaptive C-rate）
- 依每顆電芯狀態動態調整 C-rate 上限
- 弱電芯減流、健康電芯正常放電 → 延壽 15–30%
- EMS 下達目標功率時，BMS 回報可承受上限
- Electra EVE-Ai™ Adaptive Controls 的核心

### 5. 雲端隊伍學習（Fleet Learning）
- 多站資料共同訓練模型 → 單站誤差持續下降
- 早期站成為後期站的預測基礎
- 類似 Tesla Fleet Learning 對 Autopilot 的價值

### 6. 殘值評估 & 二次利用路徑
- 預測電池到 EOL（通常 SOH 80%）後的殘值
- 建議二次利用場景：
  - UPS / 備援電源（仍可用 5–8 年）
  - 慢充樁儲能
  - 離網太陽能儲電
- 若無法二次利用 → 導向回收處理鏈

---

## JJEMS 現有 BMS 相關畫面

「設備監控」頁目前涵蓋：

| 項目 | 狀態 |
|---|---|
| BMS 電芯統計表（模組數、V 極值、溫度、SOH、循環、吞吐） | ✅ 已有 |
| 電芯溫度熱力圖（208 cells × 16 欄） | ✅ 已有 |
| PCS 參數（效率、DC 電壓/電流） | ✅ 已有 |
| 環控系統（AC、消防、門禁） | ✅ 已有 |

**對標 Electra 還需補強**：

| 功能 | 重要性 | 實作難度 |
|---|---|---|
| 單電芯電壓分佈直方圖 | 高 | 低 |
| SOH 時序曲線 + ML 預測線 | 高 | 中 |
| Battery Passport 頁面 | ⭐⭐ 合規必要 | 低 |
| 熱失控/鋰沉積早期指標 | 高 | 中 |
| 各電芯內阻對標（弱電芯排行） | 中 | 低 |
| Adaptive C-rate 策略面板 | 中 | 高（需連 BMS） |

---

## 建議落地路徑

### Phase 1 — Battery Passport 頁面（1 頁，高行銷價值）
- 目的：符合 EU 2027 法規，客戶簡報亮點
- 內容：化學組成、BOM、碳足跡、循環履歷、回收流程、QR code
- 工時：~1 小時

### Phase 2 — 進階 BMS 分析子頁（多圖表）
- 電芯電壓直方圖（判讀均衡品質）
- SOH 時序 + ML 預測曲線（120 天歷史 + 90 天預測）
- Top 10 弱電芯排行（內阻偏高 / 容量偏低）
- 熱失控早期指標儀表板
- 工時：~2–3 小時

### Phase 3 — Adaptive Control 整合
- EMS 排程下達時，顯示 BMS 回報的可承受上限
- 呈現「降載保護」事件發生頻率
- 需接真實 BMS CAN 資料
- 工時：4–8 小時（含後端）

### Phase 4 — Fleet Analytics（跨站）
- 需至少 2 個站點上線
- 雲端 ML 模型持續再訓練
- 站點間對標儀表板
- 工時：大工程（~2 週）

---

## 關鍵法規 / 標準參照

| 標準 | 範圍 | J&J Power 相關 |
|---|---|---|
| **EU 2023/1542** | 電池法規、護照、碳足跡、回收 | 2027 起強制 |
| **UN 38.3** | 電池運輸安全測試 | 已要求 |
| **UL 9540A** | 儲能系統熱失控測試 | 台灣已採用 |
| **IEC 62619** | 工業鋰電池安全 | 已要求 |
| **IEC 63056** | ESS 鋰電池安全 | 相關 |
| **GB/T 36276** | 中國大陸 ESS 標準 | 參考 |
| **台電技術規範 "定置型儲能系統"** | 表前/表後併網 | 必要 |

---

## 同業 BMS 能力對照

| 業者 | SOH 精度 | Battery Passport | Fleet Analytics | 雲端 AI |
|---|---|---|---|---|
| **Electra Vehicles** | 1.6% | EAGLE | ✅ | ✅ |
| Tesla (Autobidder) | 不公開 | ❌ | ✅ | ✅ |
| CATL EnerOne | 廠內 | ❌ | 有限 | 有 |
| Fluence (Mosaic) | 5% | ❌ | ✅ | ✅ |
| **J&J Power (此案)** | 傳統 BMS | 規劃中 | 規劃中 | 規劃中（Energy Copilot） |

導入 Electra 等級 BMS 雲分析 + Energy Copilot 對話介面，可在台灣市場建立明確差異化。

---

_本文件生成於 2026-04-25，對應本專案 repo: https://github.com/kaiser-ok/JJEMS_

_Sources:_
- _[Electra Vehicles — Products](https://www.electravehicles.com/products/)_
- _[EU Battery Regulation 2023/1542](https://eur-lex.europa.eu/eli/reg/2023/1542)_
- _內部參考：POXA SD-EMS、加雲聯網 iVPP、嘉義上評紙廠 EMS 報告_
