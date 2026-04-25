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
    { id: "SYS-A", pcsKW: 125, batteryKWh: 261, soc: 65, vendor: "J&J Power", cells: 208, temp: 29.4 },
    { id: "SYS-B", pcsKW: 100, batteryKWh: 215, soc: 72, vendor: "J&J Power", cells: 176, temp: 31.1 },
  ],
  pvKWp: 400,
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

function planFor(strategyId, hour) {
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

// Monthly savings breakdown
const MONTHLY = [
  { mo: "11月", base: 89500, penalty: 6200,  arbitrage: 32400, total: 128100 },
  { mo: "12月", base: 92100, penalty: 4800,  arbitrage: 31200, total: 128100 },
  { mo: "1月",  base: 88200, penalty: 5400,  arbitrage: 29900, total: 123500 },
  { mo: "2月",  base: 84500, penalty: 3100,  arbitrage: 28600, total: 116200 },
  { mo: "3月",  base: 91800, penalty: 7200,  arbitrage: 30100, total: 129100 },
  { mo: "4月",  base: 85700, penalty: 5900,  arbitrage: 36820, total: 128420 },
];
