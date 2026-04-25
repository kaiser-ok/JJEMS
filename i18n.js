// ==========================
// i18n — zh-TW (default) / en / de / ja
// ==========================
const LANGS = {
  "zh-TW": { code: "繁中", name: "繁體中文" },
  "en":    { code: "EN",   name: "English" },
  "de":    { code: "DE",   name: "Deutsch" },
  "ja":    { code: "JA",   name: "日本語" },
};

// Locale + FX rates (approximate, for demo). Base currency: TWD.
const FX = {
  "zh-TW": { rate: 1,         locale: "zh-TW", symbol: "NT$ ", suffix: "",     code: "TWD" },
  "en":    { rate: 1/31.5,    locale: "en-US", symbol: "$",    suffix: "",     code: "USD" },
  "de":    { rate: 1/35.0,    locale: "de-DE", symbol: "",     suffix: " €",   code: "EUR" },
  "ja":    { rate: 4.6,       locale: "ja-JP", symbol: "¥",    suffix: "",     code: "JPY" },
};
function fxOf() { return FX[(typeof state !== "undefined" && state.lang) || "zh-TW"] || FX["zh-TW"]; }
const LANG_INDEX = { "zh-TW": 0, "en": 1, "de": 2, "ja": 3 };

// Each key: [zh-TW, en, de, ja]
const I18N = {
  // ─── Brand / nav ───
  "brand.sub":       ["儲能能源管理系統", "Energy Storage Mgmt", "Energiespeicher-Mgmt", "蓄電エネルギー管理"],
  "nav.dashboard":   ["首頁總覽", "Overview", "Übersicht", "概要"],
  "nav.sld":         ["案場單線圖", "Single-Line Diagram", "Schaltbild", "単線結線図"],
  "nav.devices":     ["設備監控", "Devices", "Geräte", "機器監視"],
  "nav.passport":    ["電池護照", "Battery Passport", "Batteriepass", "電池パスポート"],
  "nav.schedule":    ["排程與策略", "Schedule", "Zeitplan", "スケジュール"],
  "nav.finance":     ["財務效益", "Financial", "Finanzen", "財務分析"],
  "nav.alarms":      ["告警與事件", "Alarms", "Alarme", "アラーム"],
  "nav.settings":    ["系統設定", "Settings", "Einstellungen", "設定"],
  "bnav.dashboard":  ["總覽", "Home", "Start", "概要"],
  "bnav.sld":        ["單線圖", "SLD", "SLD", "単線"],
  "bnav.devices":    ["設備", "Devices", "Geräte", "機器"],
  "bnav.passport":   ["護照", "Passport", "Pass", "パス"],
  "bnav.schedule":   ["排程", "Schedule", "Plan", "予定"],
  "bnav.finance":    ["財務", "Finance", "Finanz", "財務"],

  // ─── Topbar ───
  "topbar.site":     ["高雄路竹廠 · 225kW / 476kWh", "Kaohsiung Lujhu · 225kW / 476kWh", "Werk Lujhu · 225kW / 476kWh", "高雄路竹工場 · 225kW / 476kWh"],
  "topbar.modeSfx":  ["模式", " Mode", "-Modus", "モード"],
  "topbar.user":     ["維運管理員", "Operations Admin", "Betriebsadmin", "運用管理者"],
  "topbar.userName": ["王工程師", "Mr. Wang", "Hr. Wang", "王エンジニア"],
  "tstat.grid":      ["市電", "Grid", "Netz", "系統電力"],
  "tstat.essDis":    ["儲能放電", "ESS Discharge", "BESS Entladung", "蓄電放電"],
  "tstat.essChg":    ["儲能充電", "ESS Charge", "BESS Ladung", "蓄電充電"],
  "tstat.essIdle":   ["儲能待機", "ESS Idle", "BESS Leerlauf", "蓄電待機"],
  "tstat.load":      ["負載", "Load", "Last", "負荷"],
  "tstat.savings":   ["今日預估節費", "Est. Savings Today", "Heutige Einsparung", "本日節約予測"],

  // ─── Common buttons ───
  "btn.today":       ["今日", "Today", "Heute", "本日"],
  "btn.month":       ["本月", "This Month", "Dieser Monat", "今月"],
  "btn.year":        ["本年", "This Year", "Dieses Jahr", "今年"],
  "btn.export":      ["匯出報表", "Export Report", "Bericht exportieren", "レポート出力"],
  "btn.exportExcel": ["匯出 Excel", "Export Excel", "Excel exportieren", "Excel出力"],
  "btn.exportPDF":   ["下載 PDF", "Download PDF", "PDF herunterladen", "PDFダウンロード"],
  "btn.print":       ["列印", "Print", "Drucken", "印刷"],
  "btn.save":        ["儲存變更", "Save Changes", "Änderungen speichern", "変更を保存"],
  "btn.cancel":      ["取消", "Cancel", "Abbrechen", "キャンセル"],
  "btn.activate":    ["啟用排程", "Activate Schedule", "Plan aktivieren", "予定を有効化"],
  "btn.tomorrow":    ["明日", "Tomorrow", "Morgen", "明日"],
  "btn.downloadLog": ["下載日誌", "Download Logs", "Logs herunterladen", "ログDL"],
  "btn.adjust":      ["調整策略 →", "Adjust Strategy →", "Strategie anpassen →", "戦略を調整 →"],
  "btn.dispatch":    ["派工", "Dispatch", "Auftrag", "派遣"],
  "btn.confirm":     ["確認", "Confirm", "Bestätigen", "確認"],
  "btn.reset":       ["重置編輯", "Reset Edits", "Bearbeitung zurücksetzen", "編集リセット"],

  // ─── Page: Dashboard ───
  "page.dash.title": ["首頁總覽", "Site Overview", "Standort-Übersicht", "サイト概要"],
  "page.dash.sub":   ["即時監控與效益概要", "Live monitoring and benefit summary", "Live-Überwachung und Nutzenübersicht", "リアルタイム監視・効果概要"],
  "card.activeStrategy": ["當前運行策略", "Active Strategy", "Aktive Strategie", "現在の戦略"],
  "card.benefitMode":["收益模式", "Revenue Model", "Erlösmodell", "収益モデル"],
  "card.constraint": ["約束", "Constraints", "Einschränkungen", "制約条件"],
  "kpi.todayCost":   ["今日電費", "Today's Cost", "Heutige Kosten", "本日の電気代"],
  "kpi.todaySavings":["今日預估節費", "Est. Savings Today", "Geschätzte Einsparung", "本日節約予測"],
  "kpi.monthSavings":["本月累計節費", "Monthly Savings", "Monatliche Einsparung", "月間節約累計"],
  "kpi.avgSoc":      ["儲能平均 SoC", "Avg SoC", "Ø SoC", "平均SoC"],
  "kpi.maxDis":      ["最大放電功率", "Max Discharge", "Max. Entladung", "最大放電"],
  "kpi.maxTemp":     ["最高電芯溫度", "Max Cell Temp", "Max. Zellentemp.", "セル最高温度"],
  "card.flowMini":   ["即時能源流向", "Live Energy Flow", "Live-Energiefluss", "リアルタイムエネルギーフロー"],
  "card.chart24h":   ["24 小時功率趨勢", "24h Power Trend", "24h-Lastgang", "24時間電力トレンド"],
  "card.socCurve":   ["儲能 SoC 曲線", "ESS SoC Curve", "BESS SoC-Kurve", "蓄電SoC曲線"],
  "card.balance":    ["今日能量平衡", "Today's Energy Balance", "Heutige Energiebilanz", "本日エネルギー収支"],
  "card.tpcMsg":     ["台電即時訊息", "TPC Live Status", "TPC-Livestatus", "台電リアルタイム"],
  "card.recentAlarm":["近期告警", "Recent Alarms", "Aktuelle Alarme", "最近のアラーム"],
  "balance.gridImport": ["市電購入", "Grid Import", "Netzbezug", "系統購入"],
  "balance.pv":       ["太陽能發電", "Solar PV", "Solar PV", "太陽光発電"],
  "balance.essDis":   ["儲能放電", "ESS Discharge", "BESS Entladung", "蓄電放電"],
  "balance.essChg":   ["儲能充電", "ESS Charge", "BESS Ladung", "蓄電充電"],
  "balance.totalLoad":["總負載", "Total Load", "Gesamtlast", "総負荷"],
  "tpc.normal":       ["正常供電", "Normal Supply", "Normale Versorgung", "正常供給"],
  "tpc.spinning":     ["備轉通知", "Spinning Reserve", "Reserveleistung", "予備力通知"],
  "tpc.dr":           ["需量反應", "Demand Response", "Demand Response", "デマンドレスポンス"],
  "tpc.events":       ["0 事件", "0 events", "0 Ereignisse", "0件"],
  "tpc.notRecv":      ["未接收", "Not received", "Nicht empfangen", "未受信"],
  "tpc.none":         ["7 日內無", "None in 7 days", "Keine in 7 Tagen", "7日間なし"],
  "tpc.source":       ["資料來源：台電公司 openAPI", "Source: Taipower openAPI", "Quelle: Taipower openAPI", "出典: 台電openAPI"],
  "alarm.viewAll":    ["全部 →", "View all →", "Alle anzeigen →", "全表示 →"],

  // ─── Page: SLD ───
  "page.sld.title":  ["案場單線圖", "Single-Line Diagram", "Schaltbild", "単線結線図"],
  "page.sld.sub":    ["設備級配線與即時電力流向", "Wiring and live power flow", "Verkabelung und Live-Lastfluss", "配線とリアルタイム電力フロー"],
  "sld.diagram":     ["單線圖", "SLD", "Schaltbild", "単線図"],
  "sld.protection":  ["電氣保護", "Protection", "Schutz", "保護"],
  "sld.comm":        ["通訊狀態", "Comm Status", "Komm.-Status", "通信状態"],
  "card.transformer":["主變壓器", "Main Transformer", "Haupttransformator", "主変圧器"],
  "card.vQuality":   ["電壓品質", "Voltage Quality", "Spannungsqualität", "電圧品質"],
  "card.protRelay":  ["保護電驛", "Protection Relays", "Schutzrelais", "保護リレー"],
  "tag.normal":      ["正常", "Normal", "Normal", "正常"],
  "tag.allOk":       ["全部正常", "All OK", "Alle OK", "全て正常"],
  "tag.qualified":   ["合格", "Qualified", "Qualifiziert", "合格"],
  "card.contactor":  ["⚡ 接觸器 / 隔離開關狀態", "⚡ Contactor / Isolator Status", "⚡ Schütz / Trennschalter", "⚡ 接触器・断路器状態"],
  "card.dio":        ["📡 DIO 數位輸入/輸出狀態", "📡 DIO Status", "📡 DIO-Status", "📡 DIO状態"],
  "ct.remote":       ["遠端", "Remote", "Fern", "遠隔"],
  "ct.closed":       ["閉合", "Closed", "Geschlossen", "閉"],
  "ct.open":         ["斷開", "Open", "Offen", "開"],

  // ─── Page: Devices ───
  "page.dev.title":  ["設備監控", "Device Monitoring", "Geräteüberwachung", "機器監視"],
  "page.dev.sub":    ["PCS · BMS · 電池模組 · 環控 · 進階電芯分析", "PCS · BMS · Battery Modules · HVAC · Advanced Cell Analytics", "PCS · BMS · Module · HLK · Erweiterte Zellenanalyse", "PCS・BMS・電池モジュール・空調・セル解析"],
  "tab.monitor":     ["📟 即時監控", "📟 Live Monitor", "📟 Live-Monitor", "📟 リアルタイム"],
  "tab.analytics":   ["🔬 電芯分析", "🔬 Cell Analytics", "🔬 Zellenanalyse", "🔬 セル解析"],

  // ─── Page: Battery Passport ───
  "page.pp.title":   ["電池數位護照", "Digital Battery Passport", "Digitaler Batteriepass", "デジタル電池パスポート"],
  "page.pp.sub":     ["符合 EU 2023/1542 電池法規 · 完整生命週期履歷", "EU 2023/1542 compliant · Full lifecycle record", "EU 2023/1542-konform · Vollständige Lebenszyklus-Historie", "EU 2023/1542準拠 · ライフサイクル全履歴"],
  "pp.scan":         ["掃描查看完整履歷", "Scan to view full record", "Scannen für Vollhistorie", "スキャンで全履歴表示"],
  "pp.passportId":   ["護照 ID", "Passport ID", "Pass-ID", "パスポートID"],
  "pp.cert":         ["✓ 已認證", "✓ Certified", "✓ Zertifiziert", "✓ 認証済"],
  "pp.lastUpdate":   ["最後更新", "Last update", "Letzte Aktualisierung", "最終更新"],
  "pp.manufacturer": ["製造商", "Manufacturer", "Hersteller", "製造元"],
  "pp.mfgDate":      ["出廠日期", "Mfg date", "Herstellungsdatum", "製造日"],
  "pp.installDate":  ["安裝日期", "Install date", "Installationsdatum", "設置日"],
  "pp.warrantyEnd":  ["保固至", "Warranty until", "Garantie bis", "保証期限"],
  "pp.chemistry":    ["⚗ 化學組成", "⚗ Chemistry", "⚗ Chemie", "⚗ 化学組成"],
  "pp.carbon":       ["🌱 碳足跡", "🌱 Carbon Footprint", "🌱 CO₂-Fußabdruck", "🌱 カーボンフットプリント"],
  "pp.performance":  ["📈 性能履歷", "📈 Performance History", "📈 Leistungshistorie", "📈 性能履歴"],
  "pp.materials":    ["📦 材料組成與再生比例", "📦 Materials & Recycled Content", "📦 Materialien & Recycling-Anteil", "📦 材料・リサイクル比"],
  "pp.recycling":    ["♻ 回收路徑與二次利用", "♻ Recycling & Second-Life", "♻ Recycling & Second-Life", "♻ リサイクル・二次利用"],
  "pp.certs":        ["🏛 合規認證", "🏛 Compliance Certifications", "🏛 Konformitäten", "🏛 認証"],
  "pp.timeline":     ["🕒 維運事件時間軸", "🕒 Service Event Timeline", "🕒 Service-Zeitachse", "🕒 サービス履歴"],
  "pp.blockchain":   ["區塊鏈不可篡改紀錄", "Blockchain-anchored record", "Blockchain-verankerte Aufzeichnung", "ブロックチェーン記録"],

  // ─── Page: Schedule ───
  "page.sch.title":  ["排程與策略", "Schedule & Strategy", "Zeitplan & Strategie", "スケジュール・戦略"],
  "card.strategy":   ["運行策略", "Operating Strategy", "Betriebsstrategie", "運転戦略"],
  "strategy.tap":    ["點選即時切換", "Tap to switch", "Klicken zum Wechseln", "クリックで切替"],
  "card.todayBenefit": ["今日效益試算", "Today's Benefit Estimate", "Heutige Nutzenschätzung", "本日効果試算"],
  "card.tariff":     ["時間電價 (NT$/度)", "Time-of-Use Tariff (NT$/kWh)", "Zeitvariabler Tarif (NT$/kWh)", "時間別料金 (NT$/kWh)"],

  // ─── Page: Finance ───
  "page.fin.title":  ["財務效益分析", "Financial Impact", "Finanzwirkungsanalyse", "財務分析"],
  "page.fin.sub":    ["月度節費組成、IRR 與投報試算", "Monthly savings, IRR, ROI calculator", "Monatliche Einsparungen, IRR, ROI", "月次節約・IRR・ROI試算"],

  // ─── Page: Alarms ───
  "page.alm.title":  ["告警與事件", "Alarms & Events", "Alarme & Ereignisse", "アラーム・イベント"],
  "page.alm.sub":    ["全站設備即時告警 / 歷史事件 / 通訊軟體推播", "Live alarms, history, push notifications", "Live-Alarme, Verlauf, Push", "リアルタイム・履歴・通知"],
  "alm.led.title":   ["🚨 系統故障燈牆 (BMS Direct)", "🚨 Fault LED Wall (BMS Direct)", "🚨 Fehler-Leuchtwand (BMS Direkt)", "🚨 故障LEDウォール (BMS直結)"],
  "alm.led.poll":    ["項全站故障點 · 直接讀取 BMS BCU 暫存器 · 每秒輪詢", "site-wide fault points · BCU register polled every second", "Standortfehlerpunkte · BCU-Register sekündlich abgefragt", "全サイト故障点 · BCUレジスタ毎秒ポーリング"],

  // ─── Page: Settings ───
  "page.set.title":  ["系統設定", "Settings", "Einstellungen", "設定"],
  "page.set.sub":    ["站點資訊、電價方案、設備規格、通訊協定", "Site, tariff, specs, protocols", "Standort, Tarif, Spezifikationen, Protokolle", "サイト・料金・仕様・プロトコル"],

  // ─── Strategies (label / full / desc / benefit / constraint) ───
  "strat.arbitrage.label":  ["時間套利", "Arbitrage", "Arbitrage", "アービトラージ"],
  "strat.arbitrage.full":   ["尖離峰時間套利", "Time-of-Use Arbitrage", "Zeit-Arbitrage", "時間帯アービトラージ"],
  "strat.arbitrage.desc":   ["依時間電價自動充放電,賺取尖離峰價差", "Auto charge/discharge by ToU tariff, capture peak/off-peak spread", "Auto-Lade/Entladung nach Tarif, Peak/Off-Peak-Spread nutzen", "時間料金で自動充放電、ピーク差で収益"],
  "strat.peakShave.label":  ["削峰填谷", "Peak Shaving", "Spitzenkappung", "ピークカット"],
  "strat.peakShave.full":   ["削峰填谷 / 契約控制", "Peak Shaving / Demand Mgmt", "Spitzenkappung / Demand Mgmt", "ピークカット / デマンド制御"],
  "strat.peakShave.desc":   ["當需量超過設定上限時放電,壓低契約最大需量", "Discharge when load exceeds threshold to lower contract demand", "Entladen bei Lastspitzen, Vertragsspitze senken", "需要超過時放電、契約最大需要を低減"],
  "strat.sReg.label":       ["需量反應", "Demand Response", "Demand Response", "デマンドレスポンス"],
  "strat.sReg.full":        ["需量反應 (sReg)", "Demand Response (sReg)", "Demand Response (sReg)", "デマンドレスポンス (sReg)"],
  "strat.sReg.desc":        ["參與台電即時備轉輔助服務,接收 OpenADR 派遣訊號", "Participate in TPC sReg, receive OpenADR dispatch signals", "Teilnahme an TPC-sReg, OpenADR-Dispatch-Signale", "台電sReg参加、OpenADRディスパッチ受信"],
  "strat.afc.label":        ["調頻輔助", "Freq. Regulation", "Frequenzregelung", "周波数調整"],
  "strat.afc.full":         ["調頻輔助 (AFC / dReg)", "Frequency Regulation (AFC/dReg)", "Frequenzregelung (AFC/dReg)", "周波数調整 (AFC/dReg)"],
  "strat.afc.desc":         ["依電網頻率即時雙向調整功率,毫秒級響應", "Bidirectional power adjust by grid frequency, millisecond response", "Bidirektionale Leistungsanpassung nach Netzfrequenz, ms-Reaktion", "系統周波数で双方向調整、ミリ秒応答"],
  "strat.pvSelf.label":     ["光儲自用", "PV Self-Use", "PV-Eigenverbrauch", "PV自家消費"],
  "strat.pvSelf.full":      ["光儲自用 (Self-Consumption)", "PV Self-Consumption", "PV-Eigenverbrauch", "PV自家消費"],
  "strat.pvSelf.desc":      ["白天儲存太陽能餘電,夜間放出供廠區使用", "Store surplus PV by day, discharge at night for plant use", "Tags PV-Überschuss speichern, nachts entladen", "昼間PV余剰を蓄電、夜間に放電"],
  "strat.manual.label":     ["手動", "Manual", "Manuell", "手動"],
  "strat.manual.full":      ["手動模式", "Manual Mode", "Manueller Modus", "手動モード"],
  "strat.manual.desc":      ["操作員手動下達 P/Q setpoint,系統不自動排程", "Operator issues P/Q setpoints; no auto-scheduling", "Bediener gibt P/Q-Sollwerte; keine Automatik", "オペレータがP/Q指令、自動制御なし"],
  "strat.benefit.arbitrage":["套利收益最大化", "Maximize arbitrage revenue", "Max. Arbitrage-Erlös", "アービトラージ収益最大化"],
  "strat.benefit.peakShave":["降基本電費 + 避免超約罰款", "Reduce demand charge + avoid penalty", "Grundgebühr senken + Strafen vermeiden", "基本料金削減・超過罰金回避"],
  "strat.benefit.sReg":     ["容量費 + 電能費收入", "Capacity + energy market revenue", "Kapazitäts- + Energieerlöse", "容量・電力料金収益"],
  "strat.benefit.afc":      ["輔助服務市場高單價收益", "High-margin ancillary services revenue", "Hochpreisige Systemdienstleistung", "アンシラリーサービス収益"],
  "strat.benefit.pvSelf":   ["提高綠電自用率、降低市電購入", "Boost PV self-consumption, reduce grid import", "PV-Eigenverbrauch erhöhen, Netzbezug senken", "PV自家消費率向上・購入電力削減"],
  "strat.benefit.manual":   ["工程測試 / 特殊調度", "Engineering test / special dispatch", "Engineering-Test / Sonderdispatch", "技術テスト・特別運用"],
  "strat.cnst.arbitrage":   ["SoC 15–90%、每日 1 循環", "SoC 15–90%, 1 cycle/day", "SoC 15–90 %, 1 Zyklus/Tag", "SoC 15–90%、1日1サイクル"],
  "strat.cnst.peakShave":   ["目標 ≤ 2,300 kW，超過即放電", "Target ≤ 2,300 kW, discharge over", "Ziel ≤ 2.300 kW, darüber entladen", "目標 ≤ 2,300 kW、超過時放電"],
  "strat.cnst.sReg":        ["1 秒內響應、執行率 ≥ 95%", "<1 s response, ≥95% execution rate", "<1 s Reaktion, ≥95 % Ausführung", "1秒以内応答、執行率95%以上"],
  "strat.cnst.afc":         ["60.00 ± 0.5 Hz 線性響應", "60.00 ± 0.5 Hz linear response", "60,00 ± 0,5 Hz lineare Reaktion", "60.00 ± 0.5 Hz 線形応答"],
  "strat.cnst.pvSelf":      ["PV 餘電 > 50 kW 才啟動充電", "Charge only when PV surplus > 50 kW", "Laden nur bei PV-Überschuss > 50 kW", "PV余剰 > 50 kWで充電開始"],
  "strat.cnst.manual":      ["人工指令、無自動約束", "Operator command, no auto constraints", "Bedienerbefehl, keine Auto-Beschränkung", "手動指令、自動制約なし"],

  // ─── Sidebar conn ───
  "conn.modbus":     ["Modbus TCP", "Modbus TCP", "Modbus TCP", "Modbus TCP"],
  "conn.mqtt":       ["MQTT (TLS)", "MQTT (TLS)", "MQTT (TLS)", "MQTT (TLS)"],
  "conn.tpc":        ["台電 OpenAPI", "Taipower API", "Taipower API", "台電 OpenAPI"],
  "conn.bms":        ["BMS CAN Bridge", "BMS CAN Bridge", "BMS CAN-Bridge", "BMS CAN ブリッジ"],
  "conn.cloud":      ["雲端 (TimescaleDB)", "Cloud (TimescaleDB)", "Cloud (TimescaleDB)", "クラウド (TimescaleDB)"],

  // ─── Chat suggestions ───
  "chat.lang.partial": ["※ 對話僅支援繁體中文", "※ Chat available in zh-TW only", "※ Chat nur auf Chinesisch", "※ チャットは繁体字中文のみ"],
  "lang.fxNote":      ["金額依語系自動轉換 (示意匯率)", "Amounts auto-converted by locale (illustrative FX)", "Beträge automatisch umgerechnet (Demo-Kurs)", "金額はロケールに応じて変換 (参考レート)"],

  // ─── 32 BMS Alarm light labels ───
  "alm.001": ["充電電池欠溫",   "Charge cell undertemp",      "Lade-Zelle Untertemp.",      "充電セル低温"],
  "alm.002": ["單體壓差過大",   "Cell V spread excessive",    "Zellen-V Spreizung zu hoch", "セル電圧偏差過大"],
  "alm.003": ["單體電壓過低",   "Cell undervoltage",          "Zellen-Unterspannung",       "セル電圧低下"],
  "alm.004": ["電池溫度差過大", "Cell ΔT excessive",          "Zellen-ΔT zu hoch",          "セル温度差過大"],
  "alm.005": ["功能安全告警",   "Functional safety alarm",    "Funktionssicherheits-Alarm", "機能安全アラーム"],
  "alm.006": ["從控概要故障",   "Slave summary fault",        "Slave-Sammelfehler",         "従制御概要故障"],
  "alm.007": ["BMU 通訊故障",   "BMU comm fault",             "BMU-Kommunikationsfehler",   "BMU通信故障"],
  "alm.008": ["EEPROM 故障",    "EEPROM fault",               "EEPROM-Fehler",              "EEPROM故障"],
  "alm.009": ["總電壓差過大",   "Pack V difference high",     "Pack-V-Differenz zu hoch",   "総電圧差過大"],
  "alm.010": ["充電電流過高",   "Charge overcurrent",         "Lade-Überstrom",             "充電過電流"],
  "alm.011": ["極柱溫度過高",   "Terminal overtemp",          "Polübertemp.",               "端子過温"],
  "alm.012": ["充電電池過溫",   "Charge cell overtemp",       "Lade-Zelle Übertemp.",       "充電セル過温"],
  "alm.013": ["放電電池過溫",   "Discharge cell overtemp",    "Entlade-Zelle Übertemp.",    "放電セル過温"],
  "alm.014": ["模組過壓",       "Module overvoltage",         "Modul-Überspannung",         "モジュール過電圧"],
  "alm.015": ["EEPROM 故障",    "EEPROM fault",               "EEPROM-Fehler",              "EEPROM故障"],
  "alm.016": ["拓撲故障",       "Topology fault",             "Topologie-Fehler",           "トポロジー故障"],
  "alm.017": ["熔斷器故障",     "Fuse fault",                 "Sicherungsfehler",           "ヒューズ故障"],
  "alm.018": ["放電電流過高",   "Discharge overcurrent",      "Entlade-Überstrom",          "放電過電流"],
  "alm.019": ["高壓箱溫度過高", "HV box overtemp",            "HV-Box Übertemp.",           "高圧BOX過温"],
  "alm.020": ["SOC 過高",       "SOC too high",               "SOC zu hoch",                "SOC過高"],
  "alm.021": ["負載絕緣阻值過低","Load insulation low",       "Last-Isolation niedrig",     "負荷絶縁低下"],
  "alm.022": ["總電壓低",       "Pack undervoltage",          "Pack-Unterspannung",         "総電圧低下"],
  "alm.023": ["模組欠壓",       "Module undervoltage",        "Modul-Unterspannung",        "モジュール低電圧"],
  "alm.024": ["急停報警",       "E-stop alarm",               "Not-Halt Alarm",             "緊急停止アラーム"],
  "alm.025": ["高壓箱溫度故障", "HV box temp fault",          "HV-Box Temp.-Fehler",        "高圧BOX温度故障"],
  "alm.026": ["MSD 報警",       "MSD alarm",                  "MSD-Alarm",                  "MSDアラーム"],
  "alm.027": ["電池溫升過高",   "Cell ΔT/Δt high",            "Zellen-ΔT/Δt hoch",          "セル温度上昇大"],
  "alm.028": ["單體電壓過高",   "Cell overvoltage",           "Zellen-Überspannung",        "セル過電圧"],
  "alm.029": ["SOC 過低",       "SOC too low",                "SOC zu niedrig",             "SOC低下"],
  "alm.030": ["主控初始化故障", "Master init fault",          "Master-Init-Fehler",         "主制御初期化故障"],
  "alm.031": ["門禁報警",       "Door alarm",                 "Türalarm",                   "ドアアラーム"],
  "alm.032": ["BAU 通訊故障",   "BAU comm fault",             "BAU-Kommunikationsfehler",   "BAU通信故障"],
  "alm.legend.ok":      ["正常", "Normal", "Normal", "正常"],
  "alm.legend.warn":    ["預警", "Pre-warn", "Vorwarnung", "予警"],
  "alm.legend.err":     ["告警", "Alarm", "Alarm", "アラーム"],
  "alm.legend.protect": ["保護", "Protected", "Schutz", "保護"],
};

function t(key) {
  const arr = I18N[key];
  if (!arr) return key;
  const i = LANG_INDEX[(typeof state !== "undefined" && state.lang) || "zh-TW"] || 0;
  return arr[i] || arr[0];
}

function setLang(lang) {
  if (!LANGS[lang]) return;
  state.lang = lang;
  try { localStorage.setItem("ems-lang", lang); } catch {}
  document.documentElement.lang = lang === "zh-TW" ? "zh-Hant" : lang;
  applyI18nDom();
  // Update language pill
  const code = document.getElementById("lang-code");
  if (code) code.textContent = LANGS[lang].code;
  // Re-render mode pill + topbar + current view
  if (typeof renderModePill === "function") renderModePill();
  if (typeof renderTopbar === "function")  renderTopbar();
  if (typeof router === "function")        router();
}

function applyI18nDom() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = t(key);
  });
}
