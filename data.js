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
function gen24h() {
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

    // ESS — charge at off-peak (0-6, 9-15), discharge at peak (16-22)
    let ess = 0;
    if (hr >= 1 && hr <= 5) ess = -180;       // charge (negative = grid-to-battery)
    else if (hr >= 10 && hr <= 14) ess = -60; // trickle charge midday using surplus PV
    else if (hr >= 16 && hr <= 21) ess = 215; // discharge (positive)
    else ess = 0;
    ess += (Math.random() - 0.5) * 8;

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

// SoC curve over 24h (integrate ess)
function genSoc() {
  const cap = SITE.systems.reduce((s, x) => s + x.batteryKWh, 0); // 476 kWh
  let soc = 50;
  const out = [];
  const pts = window.__POINTS__ || (window.__POINTS__ = gen24h());
  for (const p of pts) {
    const kwh = (-p.ess) * (15 / 60); // charge positive energy into battery
    soc += (kwh / cap) * 100;
    soc = Math.min(95, Math.max(10, soc));
    out.push(+soc.toFixed(1));
  }
  return out;
}

// Alarm list
const ALARMS = [
  { ts: "04:12", sev: "warn", sys: "SYS-B",  msg: "電池模組#3 溫差告警", detail: "模組間溫差 4.8°C，超過 4°C 閾值" },
  { ts: "02:47", sev: "info", sys: "SYS-A",  msg: "已完成夜間充電排程", detail: "SoC 48% → 82%，充入 89 kWh" },
  { ts: "昨 22:30", sev: "warn", sys: "Site", msg: "契約超約預警", detail: "最大需量 2,612 kW，超約 4.5%" },
  { ts: "昨 18:02", sev: "err",  sys: "SYS-A", msg: "PCS 通訊中斷 12 秒", detail: "Modbus/TCP 心跳逾時，系統自動重連" },
  { ts: "昨 16:00", sev: "ok",   sys: "Site", msg: "進入尖峰放電策略", detail: "目標削峰 200 kW，執行套利" },
];

// Monthly savings breakdown
const MONTHLY = [
  { mo: "11月", base: 89500, penalty: 6200,  arbitrage: 32400, total: 128100 },
  { mo: "12月", base: 92100, penalty: 4800,  arbitrage: 31200, total: 128100 },
  { mo: "1月",  base: 88200, penalty: 5400,  arbitrage: 29900, total: 123500 },
  { mo: "2月",  base: 84500, penalty: 3100,  arbitrage: 28600, total: 116200 },
  { mo: "3月",  base: 91800, penalty: 7200,  arbitrage: 30100, total: 129100 },
  { mo: "4月",  base: 85700, penalty: 5900,  arbitrage: 36820, total: 128420 },
];
