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
  "nav.tariff":      ["電價方案", "Tariff Plan", "Tarifplan", "料金プラン"],
  "nav.finance":     ["財務效益", "Financial", "Finanzen", "財務分析"],
  "nav.alarms":      ["告警與事件", "Alarms", "Alarme", "アラーム"],
  "nav.settings":    ["系統設定", "Settings", "Einstellungen", "設定"],
  "bnav.dashboard":  ["總覽", "Home", "Start", "概要"],
  "bnav.sld":        ["單線圖", "SLD", "SLD", "単線"],
  "bnav.devices":    ["設備", "Devices", "Geräte", "機器"],
  "bnav.passport":   ["護照", "Passport", "Pass", "パス"],
  "bnav.schedule":   ["排程", "Schedule", "Plan", "予定"],
  "bnav.tariff":     ["電價", "Tariff", "Tarif", "料金"],
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
  "pp.serial":       ["序號", "Serial No.", "Seriennr.", "シリアル番号"],
  "pp.immutable":    ["🔒 不可篡改", "🔒 Immutable", "🔒 Unveränderlich", "🔒 改ざん防止"],
  "pp.immutableSub": ["DB + 簽章 + 第三方稽核 · 公鏈錨定 2027", "DB + signature + 3rd-party audit · public-chain anchoring 2027", "DB + Signatur + Drittprüfung · Public-Chain-Anker 2027", "DB+署名+第三者監査 · 公開チェーン2027"],

  // ─── Chemistry table ───
  "pp.ch.type":      ["化學類型", "Chemistry type", "Chemie-Typ", "化学種別"],
  "pp.ch.cathode":   ["正極材料", "Cathode", "Kathode", "正極材料"],
  "pp.ch.anode":     ["負極材料", "Anode", "Anode", "負極材料"],
  "pp.ch.electrolyte":["電解液", "Electrolyte", "Elektrolyt", "電解液"],
  "pp.ch.separator": ["隔膜", "Separator", "Separator", "セパレータ"],
  "pp.ch.cellMaker": ["電芯廠", "Cell maker", "Zellhersteller", "セルメーカー"],
  "pp.ch.cellModel": ["電芯型號", "Cell model", "Zellmodell", "セル型番"],
  "pp.ch.cellCount": ["電芯數量", "Cell count", "Zellenanzahl", "セル数"],
  "pp.ch.cellSpec":  ["單顆規格", "Cell spec", "Zellspez.", "セル仕様"],

  // ─── Carbon card ───
  "pp.carb.totalEmit": ["總排放", "Total emissions", "Gesamtemissionen", "総排出"],
  "pp.carb.tons":    ["噸 CO₂e", "t CO₂e", "t CO₂e", "t CO₂e"],

  // ─── Performance card ───
  "pp.perf.rated":   ["額定容量", "Rated capacity", "Nennkapazität", "定格容量"],
  "pp.perf.actual":  ["實測容量", "Measured capacity", "Gemessene Kap.", "実測容量"],
  "pp.perf.cycles":  ["累積循環", "Cycles used", "Verwendete Zyklen", "累積サイクル"],
  "pp.perf.thru":    ["累積吞吐", "Cum. throughput", "Kum. Durchsatz", "累積スループット"],
  "pp.perf.avgEff":  ["平均效率", "Avg. efficiency", "Ø Wirkungsgrad", "平均効率"],
  "pp.perf.sohTrend":["SOH 衰退率", "SOH decay rate", "SOH-Abfallrate", "SOH低下率"],
  "pp.perf.perMonth":["%/月", "%/mo", "%/Monat", "%/月"],
  "pp.perf.cycleUsage":["循環使用率", "Cycle usage", "Zyklusnutzung", "サイクル使用率"],

  // ─── SOH RUL card ───
  "pp.soh.title":    ["📈 SOH 時序與 RUL 預測 (24 個月)", "📈 SOH Trend & RUL Forecast (24 mo)", "📈 SOH-Trend & RUL-Prognose (24 Mon.)", "📈 SOH推移とRUL予測 (24ヶ月)"],
  "pp.soh.retrain":  ["每月重訓 · 信賴區間 95%", "Retrained monthly · 95% CI", "Monatlich neu trainiert · 95% KI", "毎月再学習 · 95% CI"],
  "pp.soh.current":  ["當前 SOH", "Current SOH", "Aktueller SOH", "現在 SOH"],
  "pp.soh.monthly":  ["月衰退", "Monthly decay", "Monatlicher Abfall", "月次低下"],
  "pp.soh.rul":      ["預估剩餘壽命 (RUL)", "Remaining Useful Life (RUL)", "Restnutzungsdauer (RUL)", "残存寿命 (RUL)"],
  "pp.soh.toEol":    ["至 SOH 80% (EOL)", "to SOH 80% (EOL)", "bis SOH 80% (EOL)", "SOH 80% (EOL) まで"],
  "pp.soh.eolDate":  ["預估 EOL 日期", "Forecast EOL date", "Prognostiziertes EOL-Datum", "EOL予測日"],
  "pp.soh.eolCi":    ["含信賴區間 ±2 月", "incl. ±2 mo CI", "inkl. ±2 Mon. KI", "±2ヶ月 CI 含む"],
  "pp.soh.aiObs":    ["🤖 AI 觀察", "🤖 AI Observation", "🤖 KI-Beobachtung", "🤖 AI 観察"],

  // ─── Materials card ───
  "pp.mat.thMat":    ["材料", "Material", "Material", "材料"],
  "pp.mat.thWeight": ["重量比", "Weight %", "Gewicht %", "重量比"],
  "pp.mat.thRecyc":  ["再生料", "Recycled %", "Recycelt %", "再生材"],
  "pp.mat.thVerify": ["來源驗證", "Source verification", "Quellverifizierung", "源泉検証"],
  "pp.mat.verified": ["已驗證", "Verified", "Verifiziert", "検証済"],
  "pp.mat.foot":     ["※ 依 EU 2023/1542 §8 揭露要求；2027 年起鋰再生料須 ≥ 6%、鈷 ≥ 16%", "※ Per EU 2023/1542 §8; from 2027: Li recycled ≥ 6%, Co ≥ 16%", "※ Gemäß EU 2023/1542 §8; ab 2027: Li recycelt ≥ 6%, Co ≥ 16%", "※ EU 2023/1542 §8準拠;2027年からLi再生材 ≥ 6%、Co ≥ 16%"],

  // ─── Recycling card ───
  "pp.rec.partner":  ["回收夥伴", "Recycling partner", "Recyclingpartner", "リサイクルパートナー"],
  "pp.rec.contact":  ["聯繫", "Contact", "Kontakt", "連絡"],
  "pp.rec.standard": ["標準", "Standard", "Standard", "標準"],
  "pp.rec.recovery": ["材料回收率", "Material recovery rate", "Materialrückgewinnung", "材料回収率"],
  "pp.rec.destination":["處理流向", "Destination", "Bestimmung", "処理先"],
  "pp.rec.eolEst":   ["EOL 預估", "EOL estimate", "EOL-Prognose", "EOL予測"],
  "pp.rec.eolValue": ["EOL 殘值", "EOL residual value", "EOL-Restwert", "EOL残存価値"],
  "pp.rec.suggested":["建議二次利用路徑", "Suggested second-life paths", "Empfohlene Second-Life-Pfade", "推奨セカンドライフ経路"],

  // ─── Certs card ───
  "pp.cert.allValid":["全部有效", "all valid", "alle gültig", "すべて有効"],
  "pp.cert.urgent":  ["需復驗", "need renewal", "Erneuerung nötig", "更新要"],
  "pp.cert.totalOf": ["共", "of", "von", "合計"],
  "pp.cert.recallBtn":["🔍 召回追溯", "🔍 Recall lookup", "🔍 Rückruf prüfen", "🔍 リコール照会"],
  "pp.cert.exportBtn":["📦 匯出合規包", "📦 Export bundle", "📦 Bundle exportieren", "📦 コンプラパック出力"],
  "pp.cert.renewBtn":["📤 更新", "📤 Renew", "📤 Erneuern", "📤 更新"],
  "pp.cert.daysLeft":["剩 {d} 天", "{d} d left", "{d} T verbleibend", "残り {d} 日"],
  "pp.cert.expired": ["已過期 {d} 天", "expired {d} d ago", "vor {d} T abgelaufen", "{d} 日前に失効"],
  "pp.cert.expireToday":["今日到期", "Expires today", "Läuft heute ab", "本日失効"],
  "pp.cert.issued":  ["發證", "Issued", "Ausgestellt", "発行"],
  "pp.cert.expiry":  ["到期", "Expires", "Läuft ab", "有効期限"],
  "pp.cert.footnote":["※ 到期前 90 天 黃燈 · 30 天 紅燈 · 系統會於 30/7/1 天時自動推 Email + Line 給維運主管", "※ 90 d → amber · 30 d → red · system auto-pushes Email + Line at 30/7/1 d", "※ 90 T → gelb · 30 T → rot · System sendet Email + Line bei 30/7/1 T", "※ 90日前 黄信号 · 30日前 赤信号 · 30/7/1日前にEmail+Line自動通知"],

  // ─── Common ───
  "common.tonnes":   ["噸", "t", "t", "t"],

  // ─── Page: Schedule ───
  "page.sch.title":  ["排程與策略", "Schedule & Strategy", "Zeitplan & Strategie", "スケジュール・戦略"],
  "card.strategy":   ["運行策略", "Operating Strategy", "Betriebsstrategie", "運転戦略"],
  "strategy.tap":    ["點選即時切換", "Tap to switch", "Klicken zum Wechseln", "クリックで切替"],
  "card.todayBenefit": ["今日效益試算", "Today's Benefit Estimate", "Heutige Nutzenschätzung", "本日効果試算"],
  "card.tariff":     ["時間電價 (NT$/度)", "Time-of-Use Tariff (NT$/kWh)", "Zeitvariabler Tarif (NT$/kWh)", "時間別料金 (NT$/kWh)"],

  // ─── Page: Tariff ───
  "page.tar.title":  ["電價方案", "Tariff Plan", "Tarifplan", "料金プラン"],
  "page.tar.sub":    ["編輯時段、單價、契約配置 — 所有計算（排程、財務頁）即時連動", "Edit periods, prices, contract — schedule & finance views update live", "Zeiten, Preise, Vertrag bearbeiten — Zeitplan & Finanzen aktualisieren live", "時間帯・単価・契約を編集 — スケジュールと財務に即反映"],
  "tar.btn.reset":   ["恢復預設", "Reset Defaults", "Standard zurücksetzen", "デフォルトに戻す"],
  "tar.btn.add":     ["新增方案", "Add Plan", "Plan hinzufügen", "プラン追加"],
  "tar.btn.save":    ["儲存變更", "Save Changes", "Änderungen speichern", "変更を保存"],

  "tar.planSelect":  ["📋 方案選擇", "📋 Plan Selection", "📋 Planauswahl", "📋 プラン選択"],
  "tar.effectiveFrom":["生效期 {d} 起", "Effective from {d}", "Gültig ab {d}", "{d} から有効"],
  "tar.copyCurrent": ["複製當前", "Copy current", "Aktuell kopieren", "現プランをコピー"],
  "tar.exportJson":  ["匯出 JSON", "Export JSON", "JSON exportieren", "JSON出力"],
  "tar.option.tpc3w":["高壓三段式時間電價 (非夏月)", "TPC HV 3-stage ToU (Non-summer)", "TPC HV 3-Stufen-ToU (Nicht-Sommer)", "台電HV 3段ToU (非夏月)"],
  "tar.option.tpc2": ["高壓二段式時間電價", "TPC HV 2-stage ToU", "TPC HV 2-Stufen-ToU", "台電HV 2段ToU"],
  "tar.option.lv":   ["低壓電力", "LV Power", "NS-Strom", "低圧電力"],
  "tar.option.add":  ["+ 新增自訂方案…", "+ Add custom plan…", "+ Eigenen Plan hinzufügen…", "+ カスタムプラン追加…"],

  "tar.timeViz":     ["🗓 時段視覺化 (24h × 7day)", "🗓 Period Heatmap (24h × 7day)", "🗓 Zeitplan-Heatmap (24h × 7T)", "🗓 時間帯ヒートマップ (24h × 7日)"],
  "tar.brush":       ["畫筆", "Brush", "Pinsel", "ブラシ"],
  "tar.period.P":    ["尖峰", "Peak", "Spitzenzeit", "ピーク"],
  "tar.period.M":    ["半尖峰", "Mid-peak", "Halb-Spitzenzeit", "中ピーク"],
  "tar.period.O":    ["離峰", "Off-peak", "Schwachlast", "オフピーク"],
  "tar.undo":        ["↶ 復原", "↶ Undo", "↶ Rückgängig", "↶ 取消"],
  "tar.undoN":       ["↶ 復原 ({n})", "↶ Undo ({n})", "↶ Rückgängig ({n})", "↶ 取消 ({n})"],
  "tar.heatHint":    ["點擊或拖曳格子套用畫筆。常見用法：複製週一規則到週二–週五，或把週六改半尖峰。", "Click or drag cells to paint. Common: replicate Mon to Tue–Fri, or set Sat to mid-peak.", "Zellen klicken/ziehen zum Malen. Beispiel: Mo auf Di–Fr kopieren oder Sa auf Halb-Spitze.", "セルをクリック・ドラッグで適用。例：月曜のパターンを火-金にコピー、土曜を中ピークに変更。"],
  "tar.day.1":       ["週一", "Mon", "Mo", "月"],
  "tar.day.2":       ["週二", "Tue", "Di", "火"],
  "tar.day.3":       ["週三", "Wed", "Mi", "水"],
  "tar.day.4":       ["週四", "Thu", "Do", "木"],
  "tar.day.5":       ["週五", "Fri", "Fr", "金"],
  "tar.day.6":       ["週六", "Sat", "Sa", "土"],
  "tar.day.7":       ["週日", "Sun", "So", "日"],

  "tar.flowPrice":   ["💰 流動電費 (NT$/度)", "💰 Energy Charge (NT$/kWh)", "💰 Arbeitspreis (NT$/kWh)", "💰 従量料金 (NT$/kWh)"],
  "tar.peakSpread":  ["當前尖離峰價差", "Current peak/off-peak spread", "Aktueller Spitzen/Schwach-Spread", "現在のピーク/オフピーク差"],
  "tar.arbHint":     ["套利空間", "arbitrage opportunity", "Arbitrage-Chance", "アービトラージ機会"],
  "tar.basicCharge": ["📐 基本電費 (契約容量)", "📐 Demand Charge (Contracted)", "📐 Leistungspreis (Vertragsleistung)", "📐 基本料金 (契約容量)"],
  "tar.basic.routine":["經常契約 (尖峰)", "Routine (peak)", "Routine (Spitze)", "経常契約 (ピーク)"],
  "tar.basic.midPeak":["半尖峰契約", "Mid-peak", "Halb-Spitze", "中ピーク契約"],
  "tar.basic.satMidPeak":["週六半尖峰契約", "Saturday mid-peak", "Samstag-Halb-Spitze", "土曜中ピーク契約"],
  "tar.basic.offPeak":["離峰契約", "Off-peak", "Schwachlast", "オフピーク契約"],
  "tar.unitNTPerKwMo":["元/kW · 月", "NT$/kW · mo", "NT$/kW · Mon", "NT$/kW · 月"],
  "tar.overRule":    ["超約附加費規則：≤10% × {a} 倍、>10% × {b} 倍", "Over-contract penalty: ≤10% × {a}, >10% × {b}", "Vertragsüberschreitung: ≤10% × {a}, >10% × {b}", "契約超過追加：≤10% × {a}倍、>10% × {b}倍"],

  "tar.monthlyEst":  ["🧮 本月電費試算", "🧮 Monthly Bill Estimate", "🧮 Monatliche Schätzung", "🧮 本月電気料金試算"],
  "tar.byStrategy":  ["依當前策略", "by current strategy", "nach aktueller Strategie", "現戦略による"],
  "tar.overByPct":   ["超約 {p}%", "Over {p}%", "Über {p}%", "超過 {p}%"],
  "tar.notOver":     ["未超約", "Within contract", "Im Vertrag", "契約内"],
  "tar.thItem":      ["項目", "Item", "Posten", "項目"],
  "tar.thUsage":     ["用量", "Usage", "Verbrauch", "使用量"],
  "tar.thUnitPrice": ["單價", "Unit price", "Stückpreis", "単価"],
  "tar.thSubtotal":  ["小計", "Subtotal", "Zwischensumme", "小計"],
  "tar.flowItem":    ["流動電費", "energy", "Arbeitspreis", "従量料金"],
  "tar.basicItem":   ["基本電費 (經常契約)", "Demand charge (routine)", "Leistung (Routine)", "基本料金 (経常)"],
  "tar.overPenalty": ["超約罰款", "Over-contract penalty", "Vertragsstrafe", "契約超過罰金"],
  "tar.basicTimes":  ["× 基本", "× base", "× Basis", "× 基本"],
  "tar.totalMonthly":["本月總電費", "Total monthly", "Gesamt monatlich", "月次合計"],
  "tar.includes":    ["含基本 {b} + 流動 {e}", "incl. base {b} + energy {e}", "inkl. Basis {b} + Arbeit {e}", "基本 {b} + 従量 {e}"],
  "tar.plusPenalty": ["+ 罰款 {p}", "+ penalty {p}", "+ Strafe {p}", "+ 罰金 {p}"],
  "tar.kWh":         ["度", "kWh", "kWh", "kWh"],
  "tar.estFoot":     ["※ 試算依當前策略 24h 模擬曲線推估，實際以台電帳單為準。", "※ Estimate based on the current strategy's 24h simulated curve; actual charges per TPC bill.", "※ Schätzung basiert auf der 24h-Simulationskurve der aktuellen Strategie; tatsächlich gemäß TPC-Rechnung.", "※ 現戦略の24h曲線推定。実際は台電請求書による。"],

  "tar.toast.priceUpd":["流動電費已更新（影響排程試算）", "Energy charge updated (affects schedule estimate)", "Arbeitspreis aktualisiert (Zeitplan-Schätzung betroffen)", "従量料金を更新 (スケジュールに影響)"],
  "tar.toast.reset": ["已恢復預設電價方案", "Restored default tariff plan", "Standardplan wiederhergestellt", "デフォルトプランを復元"],
  "tar.toast.saved": ["✓ 電價方案已儲存（生效於下個結算週期）", "✓ Tariff plan saved (effective next billing cycle)", "✓ Tarif gespeichert (gültig ab nächstem Abrechnungszeitraum)", "✓ プラン保存 (次の請求サイクルで有効)"],
  "tar.toast.undone":["已復原 {n} 格", "Undone {n} cells", "{n} Zellen rückgängig", "{n} セル取消"],

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
