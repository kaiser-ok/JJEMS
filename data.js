// ==========================
// Mock data for J&J Power EMS
// ==========================
const SITE = {
  name: "高雄路竹廠 · 表後儲能示範站",
  address: "高雄市路竹區中華四路 2 號",
  contractKW: 2500,
  tariff: "高壓三段式時間電價 (夏月)",
  industry: "電子元件製造",
  systems: [
    {
      id: "SYS-A", model: "Zpower-AC-261L-S120-L125-TR-2H", variant: "wide",
      pcsKW: 125, batteryKWh: 261.248, soc: 65,
      vendor: "J&J Power", cellsConfig: "1P260S", cells: 260, temp: 29.4,
      hasMPPT: true, mpptKW: 120, hasSTS: true, hasTransformer: true,
    },
    {
      id: "SYS-B", model: "Zpower-AC-261L-S60-L125-2H", variant: "wide",
      pcsKW: 125, batteryKWh: 261.248, soc: 72,
      vendor: "J&J Power", cellsConfig: "1P260S", cells: 260, temp: 31.1,
      hasMPPT: true, mpptKW: 60, hasSTS: true, hasTransformer: false,
    },
  ],
  pvKWp: 400,
};

// Available cabinet models (Zpower-AC-261L series, J&J Power × HiTHIUM)
const CABINET_MODELS = {
  "Zpower-AC-261L-S120-L125-TR-2H": { mppt: 120, sts: true, tr: true,  desc: "2×MPPT (120kW) + STS + 幹變" },
  "Zpower-AC-261L-S60-L125-TR-2H":  { mppt: 60,  sts: true, tr: true,  desc: "1×MPPT (60kW) + STS + 幹變" },
  "Zpower-AC-261L-S120-L125-2H":    { mppt: 120, sts: true, tr: false, desc: "2×MPPT (120kW) + STS" },
  "Zpower-AC-261L-S60-L125-2H":     { mppt: 60,  sts: true, tr: false, desc: "1×MPPT (60kW) + STS" },
  "Zpower-AC-261L-S120-2H":         { mppt: 120, sts: false, tr: false, desc: "2×MPPT (120kW)" },
  "Zpower-AC-261L-S60-2H":          { mppt: 60,  sts: false, tr: false, desc: "1×MPPT (60kW)" },
  "Zpower-AC-261L-Narrow":          { mppt: 0,   sts: false, tr: false, desc: "窄版純儲能 (1000mm)" },
};

// Common specs (all 261L cabinets share the same battery + PCS core)
const CABINET_CORE = {
  pcsRatedKW: 125, pcsMaxKW: 150,
  batteryKWh: 261.248, batteryAh: 314, batteryV: 832,
  battery: "LFP 1P260S", cRate: 0.5,
  voltageRange: "728-949V", grid: "300-460Vac",
  cooling: "液冷 (電池) + 智慧風冷 (PCS)",
  fire: "氣溶膠 + 煙感 + 溫感 + 氣體探測",
  ip: "IP55 電池倉 / IP54 電氣倉", c5: true,
  altitude: "≤4000m", noise: "<75dB",
  comm: "RS485 / Ethernet / 4G",
  cert: ["IEC 62619", "IEC 62477", "IEC 60730", "IEC 61000", "UN 38.3"],
  parallelMax: 12, parallelMaxKW: 1500, parallelMaxKWh: 3134,
};

const TARIFF = {
  peak:    { label: "尖峰",    price: 8.05, hours: [16,17,18,19,20,21] },
  midPeak: { label: "半尖峰",  price: 5.02, hours: [9,10,11,12,13,14,15,22,23] },
  offPeak: { label: "離峰",    price: 2.18, hours: [0,1,2,3,4,5,6,7,8] },
};
function tariffOf(h) {
  if (TARIFF.peak.hours.includes(h)) return TARIFF.peak;
  if (TARIFF.midPeak.hours.includes(h)) return TARIFF.midPeak;
  return TARIFF.offPeak;
}

// Tariff plan (full editable model — used by Tariff editor view)
// 7×24 grid: each cell = period type code 'P' / 'M' / 'O' (peak/mid/off)
// Mon-Fri use full 3-stage; Sat has no peak; Sun is all off-peak
const TARIFF_PLAN = {
  code: "tw-hv-3stage-summer",
  name: "高壓三段式時間電價 (夏月)",
  effectiveFrom: "2024-04-01",
  prices: { P: 8.05, M: 5.02, O: 2.18 },
  basicCharges: {
    routine:   { label: "經常契約 (尖峰)",   ratePerKW: 223.6 },
    midPeak:   { label: "半尖峰契約",         ratePerKW: 166.9 },
    satMidPeak:{ label: "週六半尖峰契約",     ratePerKW: 44.7 },
    offPeak:   { label: "離峰契約",           ratePerKW: 44.7 },
  },
  overContractPenalty: { withinPct: 10, withinMultiplier: 2, abovePct: 10, aboveMultiplier: 3 },
  // grid[day][hour] -> 'P','M','O'  (day: 0=Mon..6=Sun)
  grid: (() => {
    const g = [];
    for (let d = 0; d < 7; d++) {
      const row = [];
      for (let h = 0; h < 24; h++) {
        if (d <= 4) {                        // Mon-Fri
          if (h >= 16 && h <= 21) row.push('P');
          else if (h >= 9 && h <= 15 || h >= 22) row.push('M');
          else row.push('O');
        } else if (d === 5) {                // Sat
          if (h >= 9) row.push('M');
          else row.push('O');
        } else row.push('O');                // Sun
      }
      g.push(row);
    }
    return g;
  })(),
};

// Today snapshot KPIs
const KPI = {
  todayCost: 54280,
  todaySavings: 6820,
  monthSavings: 128420,
  soc: 68,
  cycleEff: 91.8,
  maxCellTemp: 31.1,
  peakShaved: 178,
  co2Avoided: 2.4, // tons
  alarmsOpen: 3,
};

// Generate 24h load / PV / ESS / grid curves (15-min resolution)
// ESS profile is driven by the active strategy via planFor()
function gen24h(strategyId = "arbitrage") {
  const pts = [];
  for (let i = 0; i < 96; i++) {
    const t = i / 4;                         // hour (0..23.75)
    const hr = Math.floor(t);
    // Load profile — industrial two-shift
    let load = 800
      + 900 * Math.max(0, Math.sin((t - 5) / 18 * Math.PI))
      + 220 * Math.sin(t / 1.7) + 60 * (Math.random() - 0.5);
    if (t >= 8 && t <= 19) load += 450;
    load = Math.max(620, load);

    // PV — bell curve 6→18
    let pv = 0;
    if (t > 5.8 && t < 18.2) {
      pv = 360 * Math.sin(((t - 5.8) / 12.4) * Math.PI) ** 1.1;
      pv *= 0.85 + 0.2 * Math.sin(t * 3); // noise
      pv = Math.max(0, pv);
    }

    // ESS — driven by strategy (positive = discharge, negative = charge)
    const plan = planFor(strategyId, hr);
    let ess = plan.kw + (Math.random() - 0.5) * 6;

    const grid = load - pv - ess;             // import from grid
    pts.push({
      t,
      time: `${String(hr).padStart(2,"0")}:${String((i%4)*15).padStart(2,"0")}`,
      load: +load.toFixed(1),
      pv: +pv.toFixed(1),
      ess: +ess.toFixed(1),
      grid: +grid.toFixed(1),
    });
  }
  return pts;
}

// SoC curve over 24h (integrate ess for the given strategy)
function genSoc(strategyId = "arbitrage") {
  const cap = SITE.systems.reduce((s, x) => s + x.batteryKWh, 0); // 476 kWh
  let soc = 50;
  const out = [];
  const pts = gen24h(strategyId);
  for (const p of pts) {
    const kwh = (-p.ess) * (15 / 60); // charge positive energy into battery
    soc += (kwh / cap) * 100;
    soc = Math.min(95, Math.max(10, soc));
    out.push(+soc.toFixed(1));
  }
  return out;
}

// Snapshot of energy balance for a given strategy (kWh totals over 24h)
function dailyBalance(strategyId) {
  const pts = gen24h(strategyId);
  let gridImport = 0, pv = 0, charge = 0, discharge = 0, load = 0;
  for (const p of pts) {
    load       += p.load * 0.25;
    pv         += p.pv   * 0.25;
    if (p.ess > 0) discharge += p.ess  * 0.25;
    if (p.ess < 0) charge    += -p.ess * 0.25;
    if (p.grid > 0) gridImport += p.grid * 0.25;
  }
  return {
    gridImport: Math.round(gridImport),
    pv: Math.round(pv),
    charge: Math.round(charge),
    discharge: Math.round(discharge),
    load: Math.round(load),
  };
}

// 32 BMS-level alarm light codes (對標杭州协能 上位機)
const ALARM_LIGHTS = [
  // Row 1
  { code: "ALM-001", label: "充電電池欠溫",   state: "ok" },
  { code: "ALM-002", label: "單體壓差過大",   state: "warn" },
  { code: "ALM-003", label: "單體電壓過低",   state: "ok" },
  { code: "ALM-004", label: "電池溫度差過大", state: "warn" },
  { code: "ALM-005", label: "功能安全告警",   state: "ok" },
  { code: "ALM-006", label: "從控概要故障",   state: "ok" },
  { code: "ALM-007", label: "BMU 通訊故障",   state: "ok" },
  { code: "ALM-008", label: "EEPROM 故障",    state: "ok" },
  // Row 2
  { code: "ALM-009", label: "總電壓差過大",   state: "ok" },
  { code: "ALM-010", label: "充電電流過高",   state: "ok" },
  { code: "ALM-011", label: "極柱溫度過高",   state: "ok" },
  { code: "ALM-012", label: "充電電池過溫",   state: "ok" },
  { code: "ALM-013", label: "放電電池過溫",   state: "ok" },
  { code: "ALM-014", label: "模組過壓",       state: "ok" },
  { code: "ALM-015", label: "EEPROM 故障",    state: "ok" },
  { code: "ALM-016", label: "拓撲故障",       state: "ok" },
  // Row 3
  { code: "ALM-017", label: "熔斷器故障",     state: "ok" },
  { code: "ALM-018", label: "放電電流過高",   state: "ok" },
  { code: "ALM-019", label: "高壓箱溫度過高", state: "ok" },
  { code: "ALM-020", label: "SOC 過高",       state: "ok" },
  { code: "ALM-021", label: "負載絕緣阻值過低", state: "ok" },
  { code: "ALM-022", label: "總電壓低",       state: "ok" },
  { code: "ALM-023", label: "模組欠壓",       state: "ok" },
  { code: "ALM-024", label: "急停報警",       state: "ok" },
  // Row 4
  { code: "ALM-025", label: "高壓箱溫度故障", state: "ok" },
  { code: "ALM-026", label: "MSD 報警",       state: "ok" },
  { code: "ALM-027", label: "電池溫升過高",   state: "ok" },
  { code: "ALM-028", label: "單體電壓過高",   state: "ok" },
  { code: "ALM-029", label: "SOC 過低",       state: "ok" },
  { code: "ALM-030", label: "主控初始化故障", state: "ok" },
  { code: "ALM-031", label: "門禁報警",       state: "ok" },
  { code: "ALM-032", label: "BAU 通訊故障",   state: "ok" },
];

// ────────── Alarm Rules (聯動規則) ──────────
// Editable thresholds + auto-action mapping (與 db/seed.sql alarm_definitions 對應)
const ALARM_RULES = [
  { code:"cell.temp.high",   name:"電芯溫度過高",   sev:"critical", threshold:"≥ 45 °C",  action:"立即停機",       actType:"shutdown", delaySec:0,  enabled:true },
  { code:"cell.temp.warn",   name:"電芯溫度警告",   sev:"warning",  threshold:"≥ 40 °C",  action:"降功率 50%",      actType:"derate",   delaySec:30, enabled:true },
  { code:"cell.imbalance",   name:"電芯不平衡",     sev:"warning",  threshold:"ΔV ≥ 80 mV",action:"通知 + 啟動均衡", actType:"notify",   delaySec:0,  enabled:true },
  { code:"insulation.fault", name:"絕緣異常",       sev:"critical", threshold:"< 100 kΩ",  action:"立即停機",       actType:"shutdown", delaySec:0,  enabled:true },
  { code:"insulation.low",   name:"絕緣值偏低",     sev:"warning",  threshold:"< 500 kΩ",  action:"降功率 70% + 通知",actType:"derate", delaySec:0,  enabled:true },
  { code:"pcs.comm.lost",    name:"PCS 通訊中斷",   sev:"error",    threshold:"≥ 12 秒",   action:"自動重連 3 次",   actType:"reset",    delaySec:0,  enabled:true },
  { code:"bmu.comm.lost",    name:"BMU 通訊中斷",   sev:"error",    threshold:"≥ 30 秒",   action:"通知維運 + Pack 隔離", actType:"notify", delaySec:0, enabled:true },
  { code:"contract.over",    name:"契約超約預警",   sev:"warning",  threshold:"+10%",      action:"降載至 2,300 kW", actType:"derate",   delaySec:5,  enabled:true },
  { code:"soc.low",          name:"SoC 過低",       sev:"info",     threshold:"< 15%",     action:"排程下次充電",   actType:"notify",   delaySec:0,  enabled:true },
  { code:"fire.smoke",       name:"煙感觸發",       sev:"critical", threshold:"煙+溫雙觸發",action:"立即停機 + 排氣", actType:"shutdown", delaySec:0,  enabled:true },
  { code:"fire.aerosol",     name:"氣溶膠釋放",     sev:"critical", threshold:"已觸發",     action:"系統下電",       actType:"shutdown", delaySec:0,  enabled:true },
];

// ────────── Action history (近 30 日自動動作執行) ──────────
const ALARM_HISTORY = {
  totals: { shutdown: 3, derate: 12, notify: 32 },
  downtimeHours: 4.2,
  lostKWh: 612,
  lostNTD: 4927,
  topTriggers: [
    { code:"cell.imbalance",  count:18, recommendation:"建議：縮短均衡周期至 4 小時" },
    { code:"contract.over",   count: 9, recommendation:"建議：將削峰目標調至 2,250 kW" },
    { code:"pcs.comm.lost",   count: 7, recommendation:"建議：檢查 switch port 與 PCS 韌體" },
    { code:"cell.temp.warn",  count: 5, recommendation:"建議：清潔液冷冷凝器、降空調設定 2°C" },
    { code:"soc.low",         count: 4, recommendation:"建議：增加離峰充電功率至 200 kW" },
  ],
  recent: [
    { ts:"昨 22:30", code:"contract.over",  act:"降載至 2,300 kW", actor:"自動 (策略引擎)", duration:"3 分", outcome:"成功" },
    { ts:"昨 18:02", code:"pcs.comm.lost",  act:"重連 PCS-A",     actor:"自動",            duration:"15 秒", outcome:"成功" },
    { ts:"昨 14:18", code:"cell.imbalance", act:"通知 + 均衡",    actor:"自動",            duration:"持續",  outcome:"進行中" },
    { ts:"04/22 03:11", code:"cell.temp.warn", act:"降功率 50%",  actor:"自動 → 王工程師覆蓋", duration:"2 小時", outcome:"已恢復" },
    { ts:"04/19 19:55", code:"cell.temp.high", act:"立即停機",    actor:"自動",            duration:"1.8 小時", outcome:"已恢復" },
  ],
};

// Alarm list
const ALARMS = [
  { ts: "04:12", sev: "warn", sys: "SYS-B",  msg: "電池模組#3 溫差告警", detail: "模組間溫差 4.8°C，超過 4°C 閾值" },
  { ts: "02:47", sev: "info", sys: "SYS-A",  msg: "已完成夜間充電排程", detail: "SoC 48% → 82%，充入 89 kWh" },
  { ts: "昨 22:30", sev: "warn", sys: "Site", msg: "契約超約預警", detail: "最大需量 2,612 kW，超約 4.5%" },
  { ts: "昨 18:02", sev: "err",  sys: "SYS-A", msg: "PCS 通訊中斷 12 秒", detail: "Modbus/TCP 心跳逾時，系統自動重連" },
  { ts: "昨 16:00", sev: "ok",   sys: "Site", msg: "進入尖峰放電策略", detail: "目標削峰 200 kW，執行套利" },
];

// ────────── Strategies ──────────
const STRATEGIES = {
  arbitrage: {
    id: "arbitrage", label: "時間套利",        full: "尖離峰時間套利",
    color: "#00c2a8",
    desc: "依時間電價自動充放電，賺取尖離峰價差",
    benefit: "套利收益最大化",
    constraint: "SoC 15–90%、每日 1 循環",
  },
  peakShave: {
    id: "peakShave", label: "削峰填谷",        full: "削峰填谷 / 契約控制",
    color: "#3b82f6",
    desc: "當需量超過設定上限時放電，壓低契約最大需量",
    benefit: "降基本電費 + 避免超約罰款",
    constraint: "目標 ≤ 2,300 kW，超過即放電",
  },
  sReg: {
    id: "sReg", label: "需量反應",            full: "需量反應 (sReg)",
    color: "#f59e0b",
    desc: "參與台電即時備轉輔助服務，接收 OpenADR 派遣訊號",
    benefit: "容量費 + 電能費收入",
    constraint: "1 秒內響應、執行率 ≥ 95%",
  },
  afc: {
    id: "afc", label: "調頻輔助",              full: "調頻輔助 (AFC / dReg)",
    color: "#8b5cf6",
    desc: "依電網頻率即時雙向調整功率，毫秒級響應",
    benefit: "輔助服務市場高單價收益",
    constraint: "60.00 ± 0.5 Hz 線性響應",
  },
  pvSelf: {
    id: "pvSelf", label: "光儲自用",          full: "光儲自用 (Self-Consumption)",
    color: "#facc15",
    desc: "白天儲存太陽能餘電，夜間放出供廠區使用",
    benefit: "提高綠電自用率、降低市電購入",
    constraint: "PV 餘電 > 50 kW 才啟動充電",
  },
  manual: {
    id: "manual", label: "手動",              full: "手動模式",
    color: "#8b98b0",
    desc: "操作員手動下達 P/Q setpoint，系統不自動排程",
    benefit: "工程測試 / 特殊調度",
    constraint: "人工指令、無自動約束",
  },
};

// Public plan function — checks state.scheduleOverride first (user edits),
// otherwise falls back to strategy default
function planFor(strategyId, hour) {
  if (typeof state !== "undefined" && state.scheduleOverride && state.scheduleOverride[hour] !== undefined) {
    return state.scheduleOverride[hour];
  }
  return _planForStrategy(strategyId, hour);
}

function _planForStrategy(strategyId, hour) {
  switch (strategyId) {
    case "arbitrage":
      if (hour >= 1 && hour <= 5)   return { mode: "charge",    kw: -180, label: "充" };
      if (hour >= 10 && hour <= 14) return { mode: "charge",    kw: -60,  label: "緩充" };
      if (hour >= 16 && hour <= 21) return { mode: "discharge", kw: 215,  label: "放" };
      return { mode: "idle", kw: 0, label: "" };
    case "peakShave":
      if (hour >= 9 && hour <= 11)  return { mode: "discharge", kw: 150, label: "削峰" };
      if (hour >= 14 && hour <= 17) return { mode: "discharge", kw: 180, label: "削峰" };
      if (hour >= 18 && hour <= 21) return { mode: "discharge", kw: 200, label: "削峰" };
      if (hour >= 1 && hour <= 5)   return { mode: "charge",    kw: -150, label: "充" };
      if (hour === 0 || hour >= 22) return { mode: "charge",    kw: -100, label: "充" };
      return { mode: "idle", kw: 0, label: "" };
    case "sReg":
      if (hour >= 0 && hour <= 6)   return { mode: "charge",    kw: -120, label: "預充" };
      if (hour === 14 || hour === 19) return { mode: "discharge", kw: 200, label: "派遣" };
      return { mode: "idle", kw: 0, label: "備轉" };
    case "afc":
      // 頻率回應：每小時模擬不同方向小幅充放
      return hour % 2 === 0
        ? { mode: "discharge", kw: 50,  label: "AFC↑" }
        : { mode: "charge",    kw: -50, label: "AFC↓" };
    case "pvSelf":
      if (hour >= 10 && hour <= 14) return { mode: "charge",    kw: -150, label: "PV充" };
      if (hour >= 17 && hour <= 22) return { mode: "discharge", kw: 180,  label: "自用" };
      return { mode: "idle", kw: 0, label: "" };
    case "manual":
    default:
      return { mode: "idle", kw: 0, label: "" };
  }
}

// 估算今日套利淨益 (簡化：以充/放電 kWh 與該小時電價計算)
function estimateBenefit(strategyId) {
  let chargeCost = 0, dischargeRev = 0, chargeKWh = 0, dischargeKWh = 0;
  for (let h = 0; h < 24; h++) {
    const p = planFor(strategyId, h);
    const price = tariffOf(h).price;
    if (p.mode === "charge")    { chargeCost   += -p.kw * price; chargeKWh    += -p.kw; }
    if (p.mode === "discharge") { dischargeRev +=  p.kw * price; dischargeKWh +=  p.kw; }
  }
  // 系統效率 91.8% 已內含於放電量損失
  return {
    chargeKWh: Math.round(chargeKWh),
    dischargeKWh: Math.round(dischargeKWh * 0.918),
    chargeCost: Math.round(chargeCost),
    dischargeRev: Math.round(dischargeRev * 0.918),
    net: Math.round(dischargeRev * 0.918 - chargeCost),
  };
}

// ────────── Battery Passports (EU 2023/1542 合規) ──────────
const PASSPORTS = {
  "SYS-A": {
    sn: "JJP-A-2025-0042",
    model: "JJ-ESS-125-261",
    rated: { kw: 125, kwh: 261, voltage: "768 V", current: "163 A" },
    manufacturer: "J&J Power Co., Ltd.",
    factoryAddress: "新竹市東區光復路二段 195 號",
    mfgDate: "2025-08-15",
    installDate: "2025-12-03",
    warrantyEnd: "2035-12-03",
    chemistry: {
      type: "LFP (磷酸鐵鋰 LiFePO₄)",
      cathode: "LiFePO₄",
      anode: "Graphite",
      electrolyte: "LiPF₆ + EC/DMC",
      separator: "PE/PP 複合膜",
      cellMaker: "EVE Energy",
      cellModel: "LF280K",
      cellCount: 208,
      cellNominal: "3.2 V / 280 Ah",
    },
    carbon: {
      total: 24300, perKWh: 93.1,
      breakdown: [
        { stage: "原料採掘", value: 8200 },
        { stage: "電芯製造", value: 11400 },
        { stage: "Pack 組裝", value: 2600 },
        { stage: "運輸",     value: 1500 },
        { stage: "現場安裝", value: 600 },
      ],
    },
    performance: {
      ratedKWh: 261, actualKWh: 256.4,
      soh: 98.2, sohTrend: -0.18,
      cyclesUsed: 182, cyclesRated: 6000,
      throughputMWh: 44.2, avgEff: 96.8,
      lastTestDate: "2026-04-15",
    },
    materials: [
      { name: "鋰 (Li)",  percent: 1.8,  recycled: 12 },
      { name: "鐵 (Fe)",  percent: 32.4, recycled: 38 },
      { name: "磷 (P)",   percent: 8.2,  recycled: 0 },
      { name: "鋁 (Al)",  percent: 12.6, recycled: 64 },
      { name: "銅 (Cu)",  percent: 6.8,  recycled: 52 },
      { name: "石墨",     percent: 18.5, recycled: 8 },
      { name: "電解液",   percent: 15.2, recycled: 0 },
      { name: "其他",     percent: 4.5,  recycled: 0 },
    ],
    recycling: {
      partner: "台灣鋰電池回收聯盟",
      contact: "+886-3-578-3001",
      standard: "EU 2023/1542 · GB/T 38915",
      recoveryRate: 94,
      destination: "鎖定二次利用 → 化學回收",
    },
    secondLife: {
      eolEstimate: "2038-Q3 (預估 SOH ~80%)",
      paths: ["UPS 備援 (5–8 年)", "離網太陽能儲電", "慢充樁儲能"],
      residualValue: 380000,
    },
    events: [
      { date: "2026-04-15", type: "例行檢測", note: "SOH 量測 98.2%、絕緣電阻合格" },
      { date: "2026-02-10", type: "韌體更新", note: "BMS v2.4.1 → v2.5.0 (改善溫度補償)" },
      { date: "2026-01-20", type: "均衡執行", note: "全 Pack 主動均衡 6 小時" },
      { date: "2025-12-03", type: "安裝啟用", note: "現場併網測試通過、PR 認證合格" },
      { date: "2025-08-15", type: "出廠檢驗", note: "EOL 100% 容量、UN38.3 通過" },
    ],
    certs: [
      { name: "UL 9540A",     scope: "熱失控測試",       status: "通過", date: "2025-06" },
      { name: "IEC 62619",    scope: "工業鋰電池安全",   status: "通過", date: "2025-07" },
      { name: "UN 38.3",      scope: "運輸安全",         status: "通過", date: "2025-07" },
      { name: "CNS 15364-2",  scope: "鋰電池安全",       status: "通過", date: "2025-08" },
      { name: "EU 2023/1542", scope: "電池護照合規",     status: "符合", date: "2026-04" },
      { name: "ISO 14064-1",  scope: "碳足跡查證",       status: "通過", date: "2026-03" },
    ],
  },
  "SYS-B": {
    sn: "JJP-B-2025-0043",
    model: "JJ-ESS-100-215",
    rated: { kw: 100, kwh: 215, voltage: "768 V", current: "130 A" },
    manufacturer: "J&J Power Co., Ltd.",
    factoryAddress: "新竹市東區光復路二段 195 號",
    mfgDate: "2025-08-22",
    installDate: "2025-12-03",
    warrantyEnd: "2035-12-03",
    chemistry: {
      type: "LFP (磷酸鐵鋰 LiFePO₄)",
      cathode: "LiFePO₄",
      anode: "Graphite",
      electrolyte: "LiPF₆ + EC/DMC",
      separator: "PE/PP 複合膜",
      cellMaker: "EVE Energy",
      cellModel: "LF280K",
      cellCount: 176,
      cellNominal: "3.2 V / 280 Ah",
    },
    carbon: {
      total: 19800, perKWh: 92.1,
      breakdown: [
        { stage: "原料採掘", value: 6700 },
        { stage: "電芯製造", value: 9200 },
        { stage: "Pack 組裝", value: 2200 },
        { stage: "運輸",     value: 1200 },
        { stage: "現場安裝", value: 500 },
      ],
    },
    performance: {
      ratedKWh: 215, actualKWh: 212.1,
      soh: 98.6, sohTrend: -0.14,
      cyclesUsed: 176, cyclesRated: 6000,
      throughputMWh: 34.8, avgEff: 96.4,
      lastTestDate: "2026-04-15",
    },
    materials: [
      { name: "鋰 (Li)",  percent: 1.8,  recycled: 12 },
      { name: "鐵 (Fe)",  percent: 32.4, recycled: 38 },
      { name: "磷 (P)",   percent: 8.2,  recycled: 0 },
      { name: "鋁 (Al)",  percent: 12.6, recycled: 64 },
      { name: "銅 (Cu)",  percent: 6.8,  recycled: 52 },
      { name: "石墨",     percent: 18.5, recycled: 8 },
      { name: "電解液",   percent: 15.2, recycled: 0 },
      { name: "其他",     percent: 4.5,  recycled: 0 },
    ],
    recycling: {
      partner: "台灣鋰電池回收聯盟",
      contact: "+886-3-578-3001",
      standard: "EU 2023/1542 · GB/T 38915",
      recoveryRate: 94,
      destination: "鎖定二次利用 → 化學回收",
    },
    secondLife: {
      eolEstimate: "2038-Q4 (預估 SOH ~80%)",
      paths: ["UPS 備援 (5–8 年)", "離網太陽能儲電", "慢充樁儲能"],
      residualValue: 312000,
    },
    events: [
      { date: "2026-04-15", type: "例行檢測", note: "SOH 量測 98.6%、絕緣電阻合格" },
      { date: "2026-02-10", type: "韌體更新", note: "BMS v2.4.1 → v2.5.0" },
      { date: "2025-12-03", type: "安裝啟用", note: "現場併網測試通過" },
      { date: "2025-08-22", type: "出廠檢驗", note: "EOL 100% 容量、UN38.3 通過" },
    ],
    certs: [
      { name: "UL 9540A",     scope: "熱失控測試",       status: "通過", date: "2025-06" },
      { name: "IEC 62619",    scope: "工業鋰電池安全",   status: "通過", date: "2025-07" },
      { name: "UN 38.3",      scope: "運輸安全",         status: "通過", date: "2025-07" },
      { name: "CNS 15364-2",  scope: "鋰電池安全",       status: "通過", date: "2025-08" },
      { name: "EU 2023/1542", scope: "電池護照合規",     status: "符合", date: "2026-04" },
      { name: "ISO 14064-1",  scope: "碳足跡查證",       status: "通過", date: "2026-03" },
    ],
  },
};

// Monthly savings breakdown
const MONTHLY = [
  { mo: "11月", base: 89500, penalty: 6200,  arbitrage: 32400, total: 128100 },
  { mo: "12月", base: 92100, penalty: 4800,  arbitrage: 31200, total: 128100 },
  { mo: "1月",  base: 88200, penalty: 5400,  arbitrage: 29900, total: 123500 },
  { mo: "2月",  base: 84500, penalty: 3100,  arbitrage: 28600, total: 116200 },
  { mo: "3月",  base: 91800, penalty: 7200,  arbitrage: 30100, total: 129100 },
  { mo: "4月",  base: 85700, penalty: 5900,  arbitrage: 36820, total: 128420 },
];
