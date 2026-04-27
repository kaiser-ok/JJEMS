// ==========================
// J&J Power EMS – SPA router
// ==========================
const $  = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => [...el.querySelectorAll(q)];
function fmt(n, d=0) {
  if (n == null) return "-";
  const fx = (typeof fxOf === "function") ? fxOf() : { locale: "zh-TW" };
  return n.toLocaleString(fx.locale, { maximumFractionDigits: d, minimumFractionDigits: d });
}
function money(n) {
  const fx = (typeof fxOf === "function") ? fxOf() : { rate: 1, locale: "zh-TW", symbol: "NT$ ", suffix: "" };
  const v = Math.round(n * fx.rate);
  const formatted = v.toLocaleString(fx.locale, { maximumFractionDigits: 0 });
  return `${fx.symbol}${formatted}${fx.suffix}`;
}

// Chart.js global style
Chart.defaults.color = "#8b98b0";
Chart.defaults.borderColor = "rgba(139,152,176,0.12)";
Chart.defaults.font.family = '"Noto Sans TC","Inter",system-ui,sans-serif';

// Track chart instances to destroy on view switch
const charts = [];
function addChart(c) { charts.push(c); return c; }
function killCharts() { while (charts.length) { try { charts.pop().destroy(); } catch {} } }

// Global app state — strategy is shared across views
const state = {
  strategy: "arbitrage",
  scheduleOverride: {},   // hour (0-23) -> { mode, kw, label }
  editTool: "auto",       // "auto" | "charge" | "discharge" | "idle"
  lang: (() => { try { return localStorage.getItem("ems-lang") || "zh-TW"; } catch { return "zh-TW"; } })(),
};

// ────────── Toast notifications ──────────
function showToast(msg, type = "info", duration = 3000) {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-icon">${ {info:"ⓘ",ok:"✓",warn:"!",err:"✕"}[type] || "ⓘ" }</span><span>${msg}</span>`;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, duration);
}

// ────────── Critical alarm banner (full-screen, with countdown) ──────────
const alarmBannerState = { active: null, timer: null };

function showCriticalAlarm({
  code, severity = "critical", device = "—", message,
  detail = "", action = "立即停機", actionType = "shutdown",
  threshold = "", value = "", recommendation = "",
  countdownSec = 12, onExecute, onCancel
}) {
  // Don't stack — close existing first
  closeCriticalAlarm();

  const overlay = document.createElement("div");
  overlay.className = `critical-alarm-overlay sev-${severity}`;
  overlay.innerHTML = `
    <div class="critical-alarm">
      <div class="ca-header">
        <span class="ca-icon">${severity === "critical" ? "🚨" : severity === "error" ? "⛔" : "⚠️"}</span>
        <div class="ca-titles">
          <div class="ca-title">${ {critical:"重大告警",error:"嚴重告警",warning:"告警",info:"通知"}[severity] || "告警"} · ${device}</div>
          <div class="ca-msg">${message}</div>
        </div>
        <div class="ca-code">${code || ""}</div>
      </div>

      <div class="ca-body">
        ${detail ? `<div class="ca-detail">${detail}</div>` : ""}
        ${(threshold || value) ? `
          <div class="ca-metrics">
            ${value ? `<div><span class="muted">當前值</span><strong>${value}</strong></div>` : ""}
            ${threshold ? `<div><span class="muted">閾值</span><strong>${threshold}</strong></div>` : ""}
          </div>` : ""}
        <div class="ca-action-row">
          <span class="ca-action-label">自動動作：</span>
          <span class="ca-action-tag ca-act-${actionType}">${
            actionType==="shutdown" ? "🛑" : actionType==="derate" ? "🔻" : actionType==="reset" ? "🔁" : "⚡"
          } ${action}</span>
        </div>
        <div class="ca-countdown" id="caCountdown">
          倒數 <strong id="caSec">${countdownSec}</strong> 秒後執行
          <div class="ca-progress"><div class="ca-progress-bar" id="caBar" style="width:100%"></div></div>
        </div>
        ${recommendation ? `
          <div class="ca-recommendation">
            <strong>建議處置：</strong>${recommendation}
          </div>` : ""}
      </div>

      <div class="ca-actions">
        <button class="btn ca-btn-pause" id="caPause">⏸ 暫停倒數</button>
        <button class="btn btn-primary ca-btn-now" id="caNow">✓ 立即執行</button>
        <button class="btn ca-btn-cancel" id="caCancel">✕ 取消動作</button>
      </div>
      <div class="ca-footer muted">操作員：王工程師 · ${new Date().toLocaleString("zh-TW", { hour12:false })}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  alarmBannerState.active = overlay;

  // Beep (browser audio)
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = (freq, dur, delay) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.2, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
      o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + dur);
    };
    if (severity === "critical") { beep(880,0.2,0); beep(660,0.2,0.25); beep(880,0.3,0.5); }
    else if (severity === "error") { beep(660,0.3,0); }
  } catch {}

  // Countdown
  let remaining = countdownSec;
  let paused = false;
  const secEl = overlay.querySelector("#caSec");
  const barEl = overlay.querySelector("#caBar");
  const tick = () => {
    if (paused) return;
    remaining -= 0.1;
    secEl.textContent = Math.max(0, Math.ceil(remaining));
    barEl.style.width = Math.max(0, (remaining / countdownSec * 100)).toFixed(1) + "%";
    if (remaining <= 0) {
      clearInterval(alarmBannerState.timer);
      execute();
    }
  };
  alarmBannerState.timer = setInterval(tick, 100);

  const execute = () => {
    closeCriticalAlarm();
    if (onExecute) onExecute();
    showToast(`✓ ${action} 已執行`, "ok", 4000);
  };
  const cancel = () => {
    closeCriticalAlarm();
    if (onCancel) onCancel();
    showToast(`動作已取消，告警仍存在 (操作員覆蓋)`, "warn", 4000);
  };

  overlay.querySelector("#caPause").addEventListener("click", () => {
    paused = !paused;
    overlay.querySelector("#caPause").textContent = paused ? "▶ 繼續倒數" : "⏸ 暫停倒數";
    overlay.querySelector("#caCountdown").style.opacity = paused ? "0.5" : "1";
  });
  overlay.querySelector("#caNow").addEventListener("click", execute);
  overlay.querySelector("#caCancel").addEventListener("click", cancel);
}

function closeCriticalAlarm() {
  if (alarmBannerState.timer) { clearInterval(alarmBannerState.timer); alarmBannerState.timer = null; }
  if (alarmBannerState.active) { alarmBannerState.active.remove(); alarmBannerState.active = null; }
}

// Demo trigger (used by alarms page button)
function demoTriggerAlarm(kind = "thermal") {
  const presets = {
    thermal: {
      code: "cell.temp.high", severity: "critical",
      device: "SYS-B · Pack #07 Cell #142",
      message: "電芯溫度過高",
      detail: "液冷回水溫度上升至 32 °C，AC-3 風扇全速仍無法降溫；推測冷凝器積塵或冷媒不足。",
      threshold: "≥ 45 °C", value: "47.2 °C",
      action: "降功率 50% → 5 秒後停機", actionType: "shutdown",
      recommendation: "立即派人檢查液冷機組、清潔冷凝器、確認冷媒壓力 (E70C/E70D 暫存器查詢)。",
      countdownSec: 12,
      onExecute: () => showToast("PCS-B 已下達 P=0 指令，BCU 進入安全模式", "info", 5000),
    },
    fire: {
      code: "fire.smoke", severity: "critical",
      device: "SYS-A · 電池倉",
      message: "煙感探測器觸發",
      detail: "VESDA #1 煙感與 #2 溫感同時觸發，符合消防策略觸發條件。",
      threshold: "煙 + 溫雙觸發", value: "已確認",
      action: "立即系統下電 + 啟動氣溶膠", actionType: "shutdown",
      recommendation: "全員撤離廠區，連絡 119，確認門禁狀態。",
      countdownSec: 5,
      onExecute: () => showToast("SYS-A 已下電、消防氣溶膠已釋放、保險公司已通知", "err", 8000),
    },
    contract: {
      code: "contract.over", severity: "warning",
      device: "全廠 · 關口表",
      message: "契約超約預警",
      detail: "本期最大需量達 2,612 kW，超過契約 2,500 kW 共 4.5%。15 分鐘內若不降載，本月將觸發超約罰款 2 倍基本電費。",
      threshold: "≥ 2,500 kW", value: "2,612 kW",
      action: "啟動削峰策略，目標 2,300 kW", actionType: "derate",
      recommendation: "確認非必要負載 (HVAC、空壓) 是否可暫停。",
      countdownSec: 30,
      onExecute: () => { setStrategy("peakShave"); showToast("已切換為削峰填谷策略", "ok", 4000); },
    },
  };
  const cfg = presets[kind] || presets.thermal;
  showCriticalAlarm(cfg);
}

function setStrategy(id) {
  if (!STRATEGIES[id] || state.strategy === id) return;
  const hadEdits = Object.keys(state.scheduleOverride).length > 0;
  state.strategy = id;
  state.scheduleOverride = {}; // clear edits when strategy changes
  renderModePill();
  router(); // re-render current view to reflect new strategy
  showToast(`已切換為「${STRATEGIES[id].full}」${hadEdits ? "，自訂排程已清除" : ""}`, "ok");
}

function renderModePill() {
  const s = STRATEGIES[state.strategy];
  const txt = $("#mode-pill-text");
  if (txt) txt.textContent = t(`strat.${s.id}.label`) + t("topbar.modeSfx");
  const pill = $("#mode-pill");
  if (pill) pill.style.borderColor = s.color + "55";
}

function buildModeDropdown() {
  const dd = $("#mode-dropdown");
  if (!dd) return;
  dd.innerHTML = Object.values(STRATEGIES).map(s => `
    <div class="mode-opt ${state.strategy === s.id ? "active" : ""}" role="menuitemradio" data-strategy="${s.id}">
      <span class="mode-opt-dot" style="background:${s.color}"></span>
      <div class="mode-opt-body">
        <div class="mode-opt-label">${t(`strat.${s.id}.full`)}</div>
        <div class="mode-opt-desc">${t(`strat.${s.id}.desc`)}</div>
      </div>
      ${state.strategy === s.id ? `<span class="mode-opt-check">✓</span>` : ""}
    </div>
  `).join("");
  dd.querySelectorAll(".mode-opt").forEach(el => {
    el.addEventListener("click", () => {
      setStrategy(el.dataset.strategy);
      closeDropdown();
    });
  });
}
function openDropdown()  { $("#mode-dropdown").classList.add("open");  $("#mode-pill").setAttribute("aria-expanded","true");  buildModeDropdown(); }
function closeDropdown() { $("#mode-dropdown").classList.remove("open"); $("#mode-pill").setAttribute("aria-expanded","false"); }

// ────────── Topbar ticker ──────────
function renderTopbar() {
  const hr = new Date().getHours();
  const plan = planFor(state.strategy, hr);
  const benefit = estimateBenefit(state.strategy);
  const rand = (min, max) => +(min + Math.random() * (max - min)).toFixed(0);
  const pv = hr >= 6 && hr <= 18 ? rand(160, 340) : 0;
  const load = rand(1500, 1950);
  const ess = +(plan.kw + (Math.random() - 0.5) * 6).toFixed(0);
  const grid = load - pv - ess;
  const soc = genSoc(state.strategy)[Math.min(95, hr * 4)];
  const essLabel = ess > 0 ? t("tstat.essDis") : ess < 0 ? t("tstat.essChg") : t("tstat.essIdle");
  $("#topbar-stats").innerHTML = `
    <div class="tstat"><span class="tlabel">${t("tstat.grid")}</span><span class="tvalue">${fmt(grid)}</span><span class="tunit">kW</span></div>
    <div class="tstat"><span class="tlabel">PV</span><span class="tvalue" style="color:var(--pv-yellow)">${fmt(pv)}</span><span class="tunit">kW</span></div>
    <div class="tstat"><span class="tlabel">${essLabel}</span><span class="tvalue" style="color:var(--ess-teal)">${fmt(Math.abs(ess))}</span><span class="tunit">kW</span></div>
    <div class="tstat"><span class="tlabel">${t("tstat.load")}</span><span class="tvalue" style="color:var(--load-purple)">${fmt(load)}</span><span class="tunit">kW</span></div>
    <div class="tstat"><span class="tlabel">SoC</span><span class="tvalue" style="color:var(--green)">${soc.toFixed(0)}</span><span class="tunit">%</span></div>
    <div class="tstat"><span class="tlabel">${t("tstat.savings")}</span><span class="tvalue" style="color:${benefit.net>=0?'var(--green)':'var(--red)'}">${money(benefit.net)}</span></div>
  `;
}

// ────────── Routing ──────────
state.passportSys = "SYS-A";
const routes = {
  dashboard: viewDashboard,
  sld: viewSLD,
  protection: viewProtection,
  comm: viewComm,
  devices: viewDevices,
  passport: viewPassport,
  schedule: viewSchedule,
  tariff: viewTariff,
  finance: viewFinance,
  alarms: viewAlarms,
  settings: viewSettings,
};
function router() {
  const hash = (location.hash || "#/dashboard").replace("#/", "");
  const route = routes[hash] ? hash : "dashboard";
  killCharts();
  // protection / comm 屬於 sld 群組，sidebar 仍標 sld
  const navRoute = (route === "protection" || route === "comm") ? "sld" : route;
  $$(".nav-item, .bnav-item").forEach(el => el.classList.toggle("active", el.dataset.route === navRoute));
  $("#view").innerHTML = "";
  routes[route]();
  window.scrollTo(0,0);
}
window.addEventListener("hashchange", router);

// ────────── 1. Dashboard ──────────
function viewDashboard() {
  const s = STRATEGIES[state.strategy];
  const benefit = estimateBenefit(state.strategy);
  const bal = dailyBalance(state.strategy);
  const socSeries = genSoc(state.strategy);
  const avgSoc = (socSeries.reduce((a,b)=>a+b,0) / socSeries.length).toFixed(0);
  const cycles = (benefit.dischargeKWh / 476).toFixed(2);
  const monthFactor = +cycles >= 0.8 ? 1 : +cycles >= 0.4 ? 0.7 : 0.3;
  const monthSavings = Math.round(benefit.net * 22 * monthFactor); // 約 22 個工作日
  const peakShaved = Math.round(Math.max(...socSeries.map((_,i)=>{
    const p = planFor(state.strategy, Math.floor(i/4));
    return p.mode==="discharge" ? p.kw : 0;
  })));
  const v = $("#view");
  v.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${t("page.dash.title")}</h1>
        <p class="page-sub">${t("topbar.site")} · ${t("page.dash.sub")}</p>
      </div>
      <div class="page-actions">
        <button class="btn">${t("btn.today")}</button>
        <button class="btn btn-ghost">${t("btn.month")}</button>
        <button class="btn btn-ghost">${t("btn.year")}</button>
        <button class="btn btn-primary">${t("btn.export")}</button>
      </div>
    </div>

    <!-- Active strategy banner -->
    <div class="card mb-16" style="border-left:4px solid ${s.color};padding:14px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div style="flex:0 0 auto">
        <div class="muted" style="font-size:11.5px">${t("card.activeStrategy")}</div>
        <div style="font-size:16px;font-weight:700;color:${s.color};margin-top:2px">${t(`strat.${s.id}.full`)}</div>
      </div>
      <div style="flex:1;min-width:180px;border-left:1px solid var(--border-soft);padding-left:14px">
        <div class="muted" style="font-size:11.5px">${t("card.benefitMode")}</div>
        <div style="font-size:13px;margin-top:2px">${t(`strat.benefit.${s.id}`)}</div>
      </div>
      <div style="flex:1;min-width:180px;border-left:1px solid var(--border-soft);padding-left:14px">
        <div class="muted" style="font-size:11.5px">${t("card.constraint")}</div>
        <div style="font-size:13px;margin-top:2px">${t(`strat.cnst.${s.id}`)}</div>
      </div>
      <a href="#/schedule" class="btn">${t("btn.adjust")}</a>
    </div>

    <!-- KPI Cards -->
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">${t("kpi.todayCost")}</div>
        <div class="kpi-value">${money(bal.gridImport * 5.0)}</div>
        <div class="kpi-foot">${fmt(bal.gridImport)} kWh × avg</div>
      </div>
      <div class="kpi green">
        <div class="kpi-label">${t("kpi.todaySavings")}</div>
        <div class="kpi-value" style="color:${benefit.net>=0?'var(--green)':'var(--red)'}">${money(benefit.net)}</div>
        <div class="kpi-foot">${t(`strat.${s.id}.label`)} · ${cycles}</div>
      </div>
      <div class="kpi blue">
        <div class="kpi-label">${t("kpi.monthSavings")}</div>
        <div class="kpi-value">${money(monthSavings)}</div>
        <div class="kpi-foot"><span class="strong">${Math.min(100, Math.round(monthSavings/156000*100))}%</span> / ${money(156000)}</div>
      </div>
      <div class="kpi amber">
        <div class="kpi-label">${t("kpi.avgSoc")}</div>
        <div class="kpi-value">${avgSoc}<span class="unit">%</span></div>
        <div class="kpi-foot"><span class="strong">${KPI.cycleEff}%</span> · ${cycles}</div>
      </div>
      <div class="kpi purple">
        <div class="kpi-label">${t("kpi.maxDis")}</div>
        <div class="kpi-value">${peakShaved}<span class="unit">kW</span></div>
        <div class="kpi-foot">${t(`strat.${s.id}.label`)}</div>
      </div>
      <div class="kpi pink">
        <div class="kpi-label">${t("kpi.maxTemp")}</div>
        <div class="kpi-value">${KPI.maxCellTemp}<span class="unit">°C</span></div>
        <div class="kpi-foot">SYS-B</div>
      </div>
    </div>

    <!-- Power flow mini map -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>${t("card.flowMini")}</h3>
        <span class="tag info">5s</span>
      </div>
      <div class="flow-mini" id="flowmini"></div>
    </div>

    <!-- Main charts -->
    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-head">
          <h3>${t("card.chart24h")}</h3>
          <div class="row">
            <span class="tag mute">◼ ${t("tstat.grid")}</span>
            <span class="tag" style="color:var(--pv-yellow);background:rgba(250,204,21,0.1)">◼ PV</span>
            <span class="tag" style="color:var(--ess-teal);background:rgba(20,184,166,0.1)">◼ ESS</span>
            <span class="tag" style="color:var(--load-purple);background:rgba(167,139,250,0.1)">◼ ${t("tstat.load")}</span>
          </div>
        </div>
        <div class="chart-wrap tall"><canvas id="chart24h"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>${t("card.socCurve")}</h3>
          <span class="tag ok">${t("tag.normal")}</span>
        </div>
        <div class="chart-wrap tall"><canvas id="chartSoc"></canvas></div>
      </div>
    </div>

    <div class="grid g-3">
      <div class="card">
        <div class="card-head"><h3>${t("card.balance")}</h3><span class="tag" style="background:${s.color}1a;color:${s.color}">${t(`strat.${s.id}.label`)}</span></div>
        <table class="data" style="margin:-4px 0">
          <tbody>
            <tr><td>${t("balance.gridImport")}</td><td class="num">${fmt(bal.gridImport)} kWh</td></tr>
            <tr><td>${t("balance.pv")}</td><td class="num">${fmt(bal.pv)} kWh</td></tr>
            <tr><td>${t("balance.essDis")}</td><td class="num">${fmt(bal.discharge)} kWh</td></tr>
            <tr><td>${t("balance.essChg")}</td><td class="num">${fmt(bal.charge)} kWh</td></tr>
            <tr><td>${t("balance.totalLoad")}</td><td class="num strong">${fmt(bal.load)} kWh</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-head"><h3>${t("card.tpcMsg")}</h3></div>
        <div class="row mb-12"><span class="dot dot-ok"></span><span>${t("tpc.normal")}</span><span class="muted" style="margin-left:auto">${t("tpc.events")}</span></div>
        <div class="row mb-12"><span class="dot dot-idle"></span><span>${t("tpc.spinning")}</span><span class="muted" style="margin-left:auto">${t("tpc.notRecv")}</span></div>
        <div class="row mb-12"><span class="dot dot-idle"></span><span>${t("tpc.dr")}</span><span class="muted" style="margin-left:auto">${t("tpc.none")}</span></div>
        <div class="muted mt-16" style="font-size:12px">${t("tpc.source")}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${t("card.recentAlarm")}</h3><a href="#/alarms" class="muted" style="font-size:12px">${t("alarm.viewAll")}</a></div>
        ${ALARMS.slice(0,4).map(a => `
          <div class="alarm-row" style="padding:8px 0">
            <span class="alarm-ts">${a.ts}</span>
            <div class="alarm-msg">${a.msg}<span class="sub">${a.sys}</span></div>
            <span class="tag ${a.sev}">${t(`sev.${a.sev}`)}</span>
          </div>
        `).join("")}
      </div>
    </div>

    <!-- 🔮 AI 明日預測 (Layer 3 · 建議層) -->
    <div class="card mt-16" style="border-left:3px solid var(--purple)">
      <div class="card-head">
        <h3>${t("fc.title")} (${t("fc.layer3")})</h3>
        <div class="row" style="gap:6px">
          <span class="tag" style="background:rgba(139,92,246,0.12);color:var(--purple);font-size:11px">LSTM v2.3</span>
          <span class="muted" style="font-size:11.5px">${t("fc.lastTrain")}</span>
        </div>
      </div>
      <div class="grid g-2" style="gap:14px">
        <div>
          <div class="muted mb-8" style="font-size:12px">${t("fc.chartHint")}</div>
          <div class="chart-wrap" style="height:200px"><canvas id="chartForecast"></canvas></div>
        </div>
        <div>
          <div class="muted mb-8" style="font-size:12px">${t("fc.aiObs")}</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="padding:10px 14px;background:rgba(245,158,11,0.08);border-left:3px solid var(--amber);border-radius:6px;font-size:12.5px;line-height:1.6">
              <strong>${t("fc.warn.title")}</strong><br>
              <span class="muted">${t("fc.warn.body")}</span>
            </div>
            <div style="padding:10px 14px;background:rgba(59,130,246,0.08);border-left:3px solid var(--blue);border-radius:6px;font-size:12.5px;line-height:1.6">
              <strong>${t("fc.cloud.title")}</strong><br>
              <span class="muted">${t("fc.cloud.body")}</span>
            </div>
            <div style="padding:10px 14px;background:rgba(0,194,168,0.1);border-left:3px solid var(--primary);border-radius:6px;font-size:12.5px;line-height:1.6">
              <strong>${t("fc.advise.title")}</strong>
              <ul style="margin:6px 0 0 18px;padding:0;line-height:1.8;color:var(--text-muted)">
                <li>${t("fc.advise.1")}</li>
                <li>${t("fc.advise.2")}</li>
                <li>${t("fc.advise.3")}</li>
              </ul>
            </div>
            <div class="row mt-8" style="gap:8px">
              <button class="btn btn-primary" style="font-size:12.5px;padding:6px 14px" id="applyAiAdvice">${t("fc.btn.apply")}</button>
              <button class="btn" style="font-size:12px;padding:6px 12px" id="dismissForecast">${t("fc.btn.dismiss")}</button>
              <span class="muted" style="font-size:11px;margin-left:auto">${t("fc.notice")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 🎬 Compact alarm-action demo strip -->
    <div class="demo-strip" id="demoStrip">
      <div class="demo-strip-icon">🎬</div>
      <div class="demo-strip-text">
        <strong>${t("ds.title")}</strong>
        <span class="muted" style="font-size:11.5px">${t("ds.sub")}</span>
      </div>
      <div class="demo-strip-buttons">
        <button class="btn-mini" id="dashDemoThermal">${t("ds.btn.thermal")}</button>
        <button class="btn-mini" id="dashDemoFire" style="border-color:var(--red);color:var(--red)">${t("ds.btn.fire")}</button>
        <button class="btn-mini" id="dashDemoContract">${t("ds.btn.contract")}</button>
        <a href="#/alarms" class="muted" style="font-size:11px;text-decoration:none">${t("ds.editRules")}</a>
      </div>
    </div>
  `;

  drawFlowMini();
  drawChart24h();
  drawChartSoc();
  drawForecastChart();

  $("#dashDemoThermal")?.addEventListener("click", () => demoTriggerAlarm("thermal"));
  $("#dismissForecast")?.addEventListener("click", () => showToast(t("toast.aiDismissed"), "info"));
  $("#applyAiAdvice")?.addEventListener("click", () => {
    state.strategy = "aiAdvisory";
    state.scheduleOverride = {};        // clear manual edits so the AI baseline is clean
    renderModePill();
    showToast(t("toast.aiApplied"), "ok", 3500);
    location.hash = "#/schedule";
  });
  $("#dashDemoFire")?.addEventListener("click",    () => demoTriggerAlarm("fire"));
  $("#dashDemoContract")?.addEventListener("click",() => demoTriggerAlarm("contract"));
}

function drawFlowMini() {
  const hr = new Date().getHours();
  const plan = planFor(state.strategy, hr);
  const bal = dailyBalance(state.strategy);
  const socSeries = genSoc(state.strategy);
  const soc = socSeries[Math.min(95, hr*4)].toFixed(0);
  const pv = hr >= 6 && hr <= 18 ? Math.round(160 + Math.random()*180) : 0;
  const load = Math.round(1500 + Math.random()*450);
  const ess = Math.round(plan.kw + (Math.random()-0.5)*6);
  const grid = load - pv - ess;
  const essLabel = ess > 0 ? "儲能放電" : ess < 0 ? "儲能充電" : "儲能待機";
  const essDir = ess > 0 ? `SoC ${soc}% · 放電中` : ess < 0 ? `SoC ${soc}% · 充電中` : `SoC ${soc}% · 待機`;
  const data = [
    { cls:"grid",  label:"台電市電",  val: grid, unit:"kW", sub: grid>0 ? "流入" : "回饋" },
    { cls:"pv",    label:"太陽能發電", val: pv,   unit:"kW", sub: pv>0 ? "發電中" : "夜間休息" },
    { cls:"ess",   label: essLabel,   val: Math.abs(ess), unit:"kW", sub: essDir },
    { cls:"load",  label:"廠區負載",   val: load, unit:"kW", sub:"運轉中" },
    { cls:"meter", label:"用電表",     val: bal.load/1000, unit:"MWh", sub:"今日累積" },
  ];
  $("#flowmini").innerHTML = data.map(d => `
    <div class="flow-node ${d.cls}">
      <div class="fn-label">${d.label}</div>
      <div class="fn-val">${fmt(d.val, d.unit==="MWh"?2:0)} <span class="fn-unit">${d.unit}</span></div>
      <div class="fn-unit">${d.sub}</div>
    </div>
  `).join("");
}

function drawChart24h() {
  const pts = gen24h(state.strategy);
  const labels = pts.map(p => p.time);
  const ctx = $("#chart24h");
  addChart(new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label:"負載",  data: pts.map(p=>p.load), borderColor:"#a78bfa", backgroundColor:"rgba(167,139,250,0.12)", fill:true, tension:.3, pointRadius:0, borderWidth:1.5 },
        { label:"市電",  data: pts.map(p=>p.grid), borderColor:"#fbbf24", backgroundColor:"rgba(251,191,36,0.1)",  fill:false,tension:.3, pointRadius:0, borderWidth:1.5, borderDash:[4,3] },
        { label:"太陽能",data: pts.map(p=>p.pv),   borderColor:"#facc15", backgroundColor:"rgba(250,204,21,0.25)", fill:true, tension:.35,pointRadius:0, borderWidth:1.5 },
        { label:"儲能",  data: pts.map(p=>p.ess),  borderColor:"#14b8a6", backgroundColor:"rgba(20,184,166,0.25)", fill:true, tension:.25,pointRadius:0, borderWidth:1.5 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0f1729", borderColor: "#1b2740", borderWidth: 1,
          titleColor: "#e6edf5", bodyColor: "#cbd5e1",
          callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y,0)} kW` }
        }
      },
      scales: {
        x: { grid: { color: "rgba(139,152,176,0.06)" }, ticks: { maxTicksLimit: 12 } },
        y: { grid: { color: "rgba(139,152,176,0.08)" }, ticks: { callback: v => v + " kW" } }
      }
    }
  }));
}

function drawChartSoc() {
  const pts = gen24h(state.strategy);
  const soc = genSoc(state.strategy);
  addChart(new Chart($("#chartSoc"), {
    type: "line",
    data: {
      labels: pts.map(p=>p.time),
      datasets: [
        { label:"SoC", data: soc, borderColor:"#10b981", backgroundColor:"rgba(16,185,129,0.18)", fill:true, tension:.35, pointRadius:0, borderWidth:2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `SoC: ${c.parsed.y.toFixed(1)}%` } }
      },
      scales: {
        x: { grid: { display:false }, ticks: { maxTicksLimit: 8 } },
        y: { min: 0, max: 100, grid:{color:"rgba(139,152,176,0.08)"}, ticks: { callback: v => v + "%" } }
      }
    }
  }));
}

function drawForecastChart() {
  const ctx = $("#chartForecast"); if (!ctx) return;
  const f = genTomorrowForecast();
  addChart(new Chart(ctx, {
    type: "line",
    data: {
      labels: f.map(p => p.hourLabel),
      datasets: [
        // Load CI band (high - low as range fill)
        { label:"負載 CI", data: f.map(p=>p.loadHigh), borderColor:"transparent", backgroundColor:"rgba(167,139,250,0.12)", fill:"+1", pointRadius:0 },
        { label:"_loadLow", data: f.map(p=>p.loadLow),  borderColor:"transparent", backgroundColor:"transparent", fill:false, pointRadius:0 },
        // Load forecast line
        { label:"負載預測", data: f.map(p=>p.load), borderColor:"#a78bfa", borderWidth:2, fill:false, tension:.35, pointRadius:0 },
        // PV CI band
        { label:"PV CI", data: f.map(p=>p.pvHigh), borderColor:"transparent", backgroundColor:"rgba(250,204,21,0.18)", fill:"+1", pointRadius:0, yAxisID:"y" },
        { label:"_pvLow", data: f.map(p=>p.pvLow), borderColor:"transparent", backgroundColor:"transparent", fill:false, pointRadius:0 },
        { label:"PV 預測", data: f.map(p=>p.pv), borderColor:"#facc15", borderWidth:2, fill:false, tension:.35, pointRadius:0 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:"index", intersect:false },
      plugins: {
        legend: {
          labels: { filter: i => !i.text.startsWith("_"), boxWidth: 12, font:{ size:11 } },
          position:"top", align:"end",
        },
        tooltip: {
          filter: i => !i.dataset.label.startsWith("_") && !i.dataset.label.endsWith("CI"),
          callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y,0)} kW` }
        }
      },
      scales: {
        x: { grid:{ display:false }, ticks:{ maxTicksLimit: 8 } },
        y: { grid:{ color:"rgba(139,152,176,0.08)" }, ticks:{ callback: v => v + " kW" } }
      }
    }
  }));
}

// ────────── 2. Single-line diagram ──────────
// ── Shared SLD-group tab bar ──
function sldTabBar(active) {
  return `
    <div class="page-tabs">
      <a class="page-tab ${active==='diagram'?'active':''}" href="#/sld">${t("sld.tab.diagram")}</a>
      <a class="page-tab ${active==='protection'?'active':''}" href="#/protection">${t("sld.tab.protection")}</a>
      <a class="page-tab ${active==='comm'?'active':''}" href="#/comm">${t("sld.tab.comm")}</a>
    </div>`;
}

function viewSLD() {
  const v = $("#view");
  v.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${t("page.sld.title")}</h1>
        <p class="page-sub">${t("page.sld.sub")}</p>
      </div>
    </div>
    ${sldTabBar("diagram")}

    <div class="card">
      <svg class="sld" viewBox="0 0 1080 560" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#fbbf24"/>
          </marker>
          <marker id="arrTeal" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#14b8a6"/>
          </marker>
          <marker id="arrPurple" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#a78bfa"/>
          </marker>
          <marker id="arrYellow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#facc15"/>
          </marker>
          <!-- Battery water-fill gradients -->
          <linearGradient id="batGradGood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#0fa776"/>
            <stop offset="50%"  stop-color="#10b981"/>
            <stop offset="100%" stop-color="#0d8a64"/>
          </linearGradient>
          <linearGradient id="batGradLow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#f59e0b"/>
            <stop offset="100%" stop-color="#b8741b"/>
          </linearGradient>
        </defs>

        <!-- Equipment ownership zones (subtle background bands) -->
        <g opacity="0.7">
          <!-- TPC zone (upper-right) -->
          <rect x="430" y="6" width="220" height="120" rx="6" fill="rgba(251,191,36,0.04)" stroke="rgba(251,191,36,0.25)" stroke-dasharray="4,3"/>
          <text x="440" y="20" fill="#fbbf24" font-size="9.5" font-weight="700" letter-spacing="1">${t("sld.zone.tpc")}</text>
          <!-- Customer infrastructure zone (transformer + LV BUS area, middle band) -->
          <rect x="6" y="200" width="1068" height="60" rx="6" fill="rgba(59,130,246,0.04)" stroke="rgba(59,130,246,0.25)" stroke-dasharray="4,3"/>
          <text x="1064" y="215" text-anchor="end" fill="#3b82f6" font-size="9.5" font-weight="700" letter-spacing="1">${t("sld.zone.cust")}</text>
          <!-- J&J product zone (PV + cabinets, bottom + left source) -->
          <rect x="60" y="6" width="200" height="190" rx="6" fill="rgba(0,194,168,0.04)" stroke="rgba(0,194,168,0.3)" stroke-dasharray="4,3"/>
          <rect x="280" y="270" width="340" height="180" rx="6" fill="rgba(0,194,168,0.04)" stroke="rgba(0,194,168,0.3)" stroke-dasharray="4,3"/>
          <text x="612" y="445" text-anchor="end" fill="#00c2a8" font-size="9.5" font-weight="700" letter-spacing="1">${t("sld.zone.jj")}</text>
        </g>

        <!-- TPC Grid -->
        <g>
          <rect x="460" y="20" width="160" height="58" rx="8" fill="#14213d" stroke="#fbbf24" stroke-width="1.5"/>
          <text x="540" y="42" text-anchor="middle" fill="#fbbf24" font-size="13" font-weight="700">${t("sld.svg.tpcGrid")}</text>
          <text x="540" y="60" text-anchor="middle" fill="#cbd5e1" font-size="11">${t("sld.svg.tpcSpec")}</text>
          <text x="540" y="72" text-anchor="middle" fill="#8b98b0" font-size="10">MOF · PT · CT</text>
        </g>

        <!-- vertical grid line -->
        <line x1="540" y1="78" x2="540" y2="130" stroke="#fbbf24" stroke-width="2" stroke-dasharray="5,3" marker-end="url(#arr)">
          <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.2s" repeatCount="indefinite"/>
        </line>
        <text x="556" y="108" fill="#fbbf24" font-size="12" font-weight="600">+1,412 kW</text>

        <!-- Main transformer -->
        <g>
          <rect x="450" y="130" width="180" height="60" rx="8" fill="#101a2e" stroke="#3b82f6" stroke-width="1.5"/>
          <circle cx="510" cy="160" r="12" fill="none" stroke="#3b82f6" stroke-width="1.5"/>
          <circle cx="528" cy="160" r="12" fill="none" stroke="#3b82f6" stroke-width="1.5"/>
          <text x="555" y="156" fill="#e6edf5" font-size="11" font-weight="600">${t("sld.svg.transformer")}</text>
          <text x="555" y="172" fill="#8b98b0" font-size="10">${t("sld.svg.transformerSpec")}</text>
        </g>

        <!-- LV bus -->
        <line x1="100" y1="232" x2="980" y2="232" stroke="#3b82f6" stroke-width="3"/>
        <line x1="540" y1="190" x2="540" y2="232" stroke="#3b82f6" stroke-width="2"/>
        <text x="100" y="248" fill="#3b82f6" font-size="11" font-weight="600">${t("sld.svg.lvbus")}</text>

        <!-- PV (上方來源) — 直接 DC 接入 SYS-A 寬版光儲一體機內建 MPPT -->
        <g>
          <rect x="80" y="20" width="180" height="58" rx="8" fill="#1a1505" stroke="#facc15" stroke-width="1.5"/>
          <text x="170" y="42" text-anchor="middle" fill="#facc15" font-size="13" font-weight="700">${t("sld.svg.pv")}</text>
          <text x="170" y="60" text-anchor="middle" fill="#e6edf5" font-size="14" font-weight="700">308 kW</text>
          <text x="170" y="72" text-anchor="middle" fill="#8b98b0" font-size="10">${t("sld.svg.pvHint")}</text>

          <!-- DC line going down to SYS-A 's MPPT input -->
          <path d="M 170 78 L 170 260 L 360 260 L 360 280" stroke="#facc15" stroke-width="2" fill="none" stroke-dasharray="5,3" marker-end="url(#arrYellow)">
            <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.3s" repeatCount="indefinite"/>
          </path>
          <text x="180" y="180" fill="#facc15" font-size="11" font-weight="600">${t("sld.svg.dcDirect")}</text>
          <text x="180" y="194" fill="#8b98b0" font-size="9">650-950V (4 串 × 2)</text>
        </g>

        <!-- PCS-A / BAT-A (125kW / 261kWh) -->
        <g>
          <line x1="360" y1="232" x2="360" y2="280" stroke="#14b8a6" stroke-width="2" marker-end="url(#arrTeal)">
            <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.1s" repeatCount="indefinite"/>
          </line>
          <rect x="300" y="280" width="120" height="46" rx="6" fill="#0a2320" stroke="#14b8a6" stroke-width="1.5"/>
          <text x="360" y="298" text-anchor="middle" fill="#14b8a6" font-size="12" font-weight="700">PCS-A</text>
          <text x="360" y="316" text-anchor="middle" fill="#e6edf5" font-size="11">125 kW · 480V</text>
          <line x1="360" y1="326" x2="360" y2="352" stroke="#14b8a6" stroke-width="2"/>
          <!-- 電池槽（水位視覺）SoC 65% — 容器 80px 高，水位 = 80 × 0.65 = 52px → y=348 起填 -->
          <g>
            <!-- 電池正極帽 -->
            <rect x="346" y="346" width="28" height="6" rx="1.5" fill="#14b8a6"/>
            <!-- 容器外框 (y=352, h=80) -->
            <rect x="300" y="352" width="120" height="80" rx="6" fill="#031a17" stroke="#14b8a6" stroke-width="2"/>
            <!-- 水位填充 (clip 到容器內) -->
            <clipPath id="batTankA"><rect x="300" y="352" width="120" height="80" rx="6"/></clipPath>
            <g clip-path="url(#batTankA)">
              <!-- 主水位區塊 (高度 = SoC × 容器高 = 0.65 × 80 = 52) -->
              <rect x="300" y="380" width="120" height="52" fill="url(#batGradGood)"/>
              <!-- 波浪表面 (animate translateX) -->
              <path d="M 280 380 Q 300 376 320 380 T 360 380 T 400 380 T 440 380 L 440 432 L 280 432 Z"
                    fill="rgba(16,185,129,0.45)">
                <animateTransform attributeName="transform" type="translate"
                                   from="0 0" to="-40 0" dur="3s" repeatCount="indefinite"/>
              </path>
              <!-- 氣泡 -->
              <circle cx="320" cy="420" r="2" fill="rgba(255,255,255,0.4)">
                <animate attributeName="cy" from="430" to="385" dur="2.4s" repeatCount="indefinite"/>
                <animate attributeName="opacity" from="0.6" to="0" dur="2.4s" repeatCount="indefinite"/>
              </circle>
              <circle cx="400" cy="425" r="1.5" fill="rgba(255,255,255,0.4)">
                <animate attributeName="cy" from="430" to="385" dur="3s" begin="0.8s" repeatCount="indefinite"/>
                <animate attributeName="opacity" from="0.6" to="0" dur="3s" begin="0.8s" repeatCount="indefinite"/>
              </circle>
            </g>
            <!-- SoC 刻度線 -->
            <line x1="300" y1="372" x2="306" y2="372" stroke="#14b8a6" stroke-width="0.8" opacity="0.5"/>
            <line x1="414" y1="372" x2="420" y2="372" stroke="#14b8a6" stroke-width="0.8" opacity="0.5"/>
            <text x="424" y="375" fill="#14b8a6" font-size="7" opacity="0.6">90</text>
            <line x1="300" y1="392" x2="306" y2="392" stroke="#14b8a6" stroke-width="0.8" opacity="0.5"/>
            <line x1="414" y1="392" x2="420" y2="392" stroke="#14b8a6" stroke-width="0.8" opacity="0.5"/>
            <text x="424" y="395" fill="#14b8a6" font-size="7" opacity="0.6">65</text>
            <line x1="300" y1="412" x2="306" y2="412" stroke="#14b8a6" stroke-width="0.8" opacity="0.5"/>
            <text x="424" y="415" fill="#14b8a6" font-size="7" opacity="0.6">40</text>

            <!-- 標籤文字 -->
            <text x="360" y="367" text-anchor="middle" fill="#e6edf5" font-size="11" font-weight="700">SYS-A · 261 kWh</text>
            <text x="360" y="402" text-anchor="middle" fill="#fff" font-size="20" font-weight="900" style="text-shadow:0 1px 2px rgba(0,0,0,0.5)">65%</text>
            <text x="360" y="424" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-size="10">29.4°C</text>
          </g>
          <text x="360" y="263" text-anchor="middle" fill="#14b8a6" font-size="11" font-weight="600">${t("sld.svg.discharge").replace("{kw}", 118)}</text>
        </g>

        <!-- PCS-B / BAT-B (100kW / 215kWh) -->
        <g>
          <line x1="540" y1="232" x2="540" y2="280" stroke="#14b8a6" stroke-width="2" marker-end="url(#arrTeal)">
            <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.1s" repeatCount="indefinite"/>
          </line>
          <rect x="480" y="280" width="120" height="46" rx="6" fill="#0a2320" stroke="#14b8a6" stroke-width="1.5"/>
          <text x="540" y="298" text-anchor="middle" fill="#14b8a6" font-size="12" font-weight="700">PCS-B</text>
          <text x="540" y="316" text-anchor="middle" fill="#e6edf5" font-size="11">100 kW · 480V</text>
          <line x1="540" y1="326" x2="540" y2="352" stroke="#14b8a6" stroke-width="2"/>
          <!-- 電池槽（水位視覺）SoC 72% — 容器 80px 高，水位 = 80 × 0.72 = 57.6px → y=374.4 起填 -->
          <g>
            <rect x="526" y="346" width="28" height="6" rx="1.5" fill="#14b8a6"/>
            <rect x="480" y="352" width="120" height="80" rx="6" fill="#031a17" stroke="#14b8a6" stroke-width="2"/>
            <clipPath id="batTankB"><rect x="480" y="352" width="120" height="80" rx="6"/></clipPath>
            <g clip-path="url(#batTankB)">
              <rect x="480" y="374.4" width="120" height="57.6" fill="url(#batGradGood)"/>
              <path d="M 460 374 Q 480 370 500 374 T 540 374 T 580 374 T 620 374 L 620 432 L 460 432 Z"
                    fill="rgba(16,185,129,0.45)">
                <animateTransform attributeName="transform" type="translate"
                                   from="0 0" to="-40 0" dur="3.2s" repeatCount="indefinite"/>
              </path>
              <circle cx="500" cy="420" r="2" fill="rgba(255,255,255,0.4)">
                <animate attributeName="cy" from="430" to="380" dur="2.6s" begin="0.4s" repeatCount="indefinite"/>
                <animate attributeName="opacity" from="0.6" to="0" dur="2.6s" begin="0.4s" repeatCount="indefinite"/>
              </circle>
              <circle cx="580" cy="425" r="1.5" fill="rgba(255,255,255,0.4)">
                <animate attributeName="cy" from="430" to="380" dur="3.4s" begin="1.2s" repeatCount="indefinite"/>
                <animate attributeName="opacity" from="0.6" to="0" dur="3.4s" begin="1.2s" repeatCount="indefinite"/>
              </circle>
            </g>
            <line x1="480" y1="372" x2="486" y2="372" stroke="#14b8a6" stroke-width="0.8" opacity="0.5"/>
            <line x1="594" y1="372" x2="600" y2="372" stroke="#14b8a6" stroke-width="0.8" opacity="0.5"/>
            <text x="604" y="375" fill="#14b8a6" font-size="7" opacity="0.6">90</text>
            <line x1="594" y1="389" x2="600" y2="389" stroke="#14b8a6" stroke-width="0.8" opacity="0.5"/>
            <text x="604" y="392" fill="#14b8a6" font-size="7" opacity="0.6">72</text>
            <line x1="480" y1="412" x2="486" y2="412" stroke="#14b8a6" stroke-width="0.8" opacity="0.5"/>
            <text x="604" y="415" fill="#14b8a6" font-size="7" opacity="0.6">40</text>

            <text x="540" y="367" text-anchor="middle" fill="#e6edf5" font-size="11" font-weight="700">SYS-B · 261 kWh</text>
            <text x="540" y="402" text-anchor="middle" fill="#fff" font-size="20" font-weight="900" style="text-shadow:0 1px 2px rgba(0,0,0,0.5)">72%</text>
            <text x="540" y="424" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-size="10">31.1°C</text>
          </g>
          <text x="540" y="263" text-anchor="middle" fill="#14b8a6" font-size="11" font-weight="600">${t("sld.svg.discharge").replace("{kw}", 97)}</text>
        </g>

        <!-- Load feeders -->
        <g>
          <line x1="740" y1="232" x2="740" y2="300" stroke="#a78bfa" stroke-width="2" marker-end="url(#arrPurple)">
            <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.5s" repeatCount="indefinite"/>
          </line>
          <rect x="680" y="300" width="120" height="78" rx="8" fill="#170e2a" stroke="#a78bfa" stroke-width="1.5"/>
          <text x="740" y="324" text-anchor="middle" fill="#a78bfa" font-size="13" font-weight="700">${t("sld.svg.prodLoad")}</text>
          <text x="740" y="345" text-anchor="middle" fill="#e6edf5" font-size="16" font-weight="700">1,735 kW</text>
          <text x="740" y="365" text-anchor="middle" fill="#8b98b0" font-size="10">${t("sld.svg.prodHint")}</text>
        </g>
        <g>
          <line x1="900" y1="232" x2="900" y2="300" stroke="#a78bfa" stroke-width="2" marker-end="url(#arrPurple)">
            <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.6s" repeatCount="indefinite"/>
          </line>
          <rect x="840" y="300" width="120" height="78" rx="8" fill="#170e2a" stroke="#a78bfa" stroke-width="1.5"/>
          <text x="900" y="324" text-anchor="middle" fill="#a78bfa" font-size="13" font-weight="700">${t("sld.svg.hvac")}</text>
          <text x="900" y="345" text-anchor="middle" fill="#e6edf5" font-size="16" font-weight="700">385 kW</text>
          <text x="900" y="365" text-anchor="middle" fill="#8b98b0" font-size="10">${t("sld.svg.hvacHint")}</text>
        </g>

        <!-- Protection / CB status -->
        <g font-size="10" fill="#10b981">
          <circle cx="100" cy="232" r="5" fill="#10b981"/>
          <circle cx="180" cy="232" r="5" fill="#10b981"/>
          <circle cx="360" cy="232" r="5" fill="#10b981"/>
          <circle cx="540" cy="232" r="5" fill="#10b981"/>
          <circle cx="740" cy="232" r="5" fill="#10b981"/>
          <circle cx="900" cy="232" r="5" fill="#10b981"/>
          <circle cx="980" cy="232" r="5" fill="#10b981"/>
        </g>

        <!-- Legend -->
        <g transform="translate(20, 470)">
          <text fill="#8b98b0" font-size="11" font-weight="600">${t("sld.legend.title")}</text>
          <g transform="translate(0, 14)">
            <rect x="0" y="0" width="12" height="3" fill="#fbbf24"/>
            <text x="20" y="4" fill="#cbd5e1" font-size="11">${t("sld.legend.hv")}</text>
          </g>
          <g transform="translate(110, 14)">
            <rect x="0" y="0" width="12" height="3" fill="#3b82f6"/>
            <text x="20" y="4" fill="#cbd5e1" font-size="11">${t("sld.legend.lv")}</text>
          </g>
          <g transform="translate(210, 14)">
            <rect x="0" y="0" width="12" height="3" fill="#14b8a6"/>
            <text x="20" y="4" fill="#cbd5e1" font-size="11">${t("sld.legend.essLn")}</text>
          </g>
          <g transform="translate(310, 14)">
            <rect x="0" y="0" width="12" height="3" fill="#facc15"/>
            <text x="20" y="4" fill="#cbd5e1" font-size="11">${t("sld.legend.pv")}</text>
          </g>
          <g transform="translate(400, 14)">
            <rect x="0" y="0" width="12" height="3" fill="#a78bfa"/>
            <text x="20" y="4" fill="#cbd5e1" font-size="11">${t("sld.legend.load")}</text>
          </g>
          <g transform="translate(500, 14)">
            <circle cx="6" cy="2" r="5" fill="#10b981"/>
            <text x="20" y="6" fill="#cbd5e1" font-size="11">${t("sld.legend.cb")}</text>
          </g>
        </g>
      </svg>
    </div>

    <div id="sld-mode-content"></div>

    <!-- 接觸器 / DIO 控制面板 -->
    <div class="grid g-2 mt-16">
      <div class="card">
        <div class="card-head">
          <h3>${t("sld.contactor.title")}</h3>
          <span class="tag ok">${t("sld.contactor.remote")}</span>
        </div>
        <div class="contactor-grid">
          <div class="contactor-card closed">
            <div class="ct-label">${t("sld.contactor.mainIso")}</div>
            <div class="ct-state">${t("sld.contactor.closed")}</div>
            <div class="ct-icon">━●━</div>
            <div class="ct-meta">${t("sld.contactor.mainCircuit")}</div>
          </div>
          <div class="contactor-card closed">
            <div class="ct-label">${t("sld.contactor.kPos")}</div>
            <div class="ct-state">${t("sld.contactor.closed")}</div>
            <div class="ct-icon">━●━</div>
            <div class="ct-meta">SYS-A · DC+</div>
          </div>
          <div class="contactor-card closed">
            <div class="ct-label">${t("sld.contactor.kNeg")}</div>
            <div class="ct-state">${t("sld.contactor.closed")}</div>
            <div class="ct-icon">━●━</div>
            <div class="ct-meta">SYS-A · DC−</div>
          </div>
          <div class="contactor-card open">
            <div class="ct-label">${t("sld.contactor.preCharge")}</div>
            <div class="ct-state">${t("sld.contactor.open")}</div>
            <div class="ct-icon">━ ●━</div>
            <div class="ct-meta">${t("sld.contactor.preChargeDone")}</div>
          </div>
          <div class="contactor-card closed">
            <div class="ct-label">${t("sld.contactor.kPos")}</div>
            <div class="ct-state">${t("sld.contactor.closed")}</div>
            <div class="ct-icon">━●━</div>
            <div class="ct-meta">SYS-B · DC+</div>
          </div>
          <div class="contactor-card closed">
            <div class="ct-label">${t("sld.contactor.kNeg")}</div>
            <div class="ct-state">${t("sld.contactor.closed")}</div>
            <div class="ct-icon">━●━</div>
            <div class="ct-meta">SYS-B · DC−</div>
          </div>
        </div>
        <div class="muted mt-12" style="font-size:11.5px">${t("sld.contactor.foot")}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>${t("sld.dio.title")}</h3>
          <span class="muted" style="font-size:11.5px">${t("sld.dio.count")}</span>
        </div>
        <div class="dio-grid">
          ${[
            { tag: "DI1", label: t("sld.dio.di1"),  on: false },
            { tag: "DI2", label: t("sld.dio.di2"),  on: false },
            { tag: "DI3", label: t("sld.dio.di3"),  on: false },
            { tag: "DI4", label: t("sld.dio.di4"),  on: false },
            { tag: "DI5", label: t("sld.dio.di5"),  on: false },
            { tag: "DI6", label: t("sld.dio.di6"),  on: true  },
            { tag: "DI7", label: t("sld.dio.di7"),  on: true  },
            { tag: "DI8", label: t("sld.dio.di8"),  on: false },
            { tag: "DO1", label: t("sld.dio.do1"),  on: false },
            { tag: "DO2", label: t("sld.dio.do2"),  on: false },
            { tag: "DO3", label: t("sld.dio.do3"),  on: true  },
            { tag: "DO4", label: t("sld.dio.do4"),  on: false },
            { tag: "DO5", label: t("sld.dio.do5"),  on: false },
            { tag: "DO6", label: t("sld.dio.do6"),  on: false },
            { tag: "DO7", label: t("sld.dio.di8"),  on: false },
            { tag: "DO8", label: t("sld.dio.di8"),  on: false },
          ].map(d => `
            <div class="dio-cell ${d.on?'on':'off'} ${d.tag.startsWith('DI')?'di':'do'}">
              <span class="dio-tag">${d.tag}</span>
              <span class="dio-name">${d.label}</span>
              <span class="dio-led"></span>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;

  // diagram-mode body
  $("#sld-mode-content").innerHTML = `
    <div class="grid g-3 mt-16">
      <div class="card">
        <div class="card-head"><h3>${t("sld.pq.title")}</h3><span class="tag ok">${t("sld.pq.realtime")}</span></div>
        <table class="data">
          <tr><td>${t("sld.pq.phaseR")}</td><td class="num">489.2 V</td></tr>
          <tr><td>${t("sld.pq.phaseS")}</td><td class="num">487.8 V</td></tr>
          <tr><td>${t("sld.pq.phaseT")}</td><td class="num">488.4 V</td></tr>
          <tr><td>${t("sld.pq.freq")}</td><td class="num">60.02 Hz</td></tr>
          <tr><td>${t("sld.pq.pf")}</td><td class="num">0.96</td></tr>
          <tr><td>${t("sld.pq.thdv")}</td><td class="num">2.1%</td></tr>
        </table>
        <div class="muted mt-8" style="font-size:11px">${t("sld.pq.source")}</div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>${t("sld.tx.title")}</h3>
          <span class="tag mute">${t("sld.tx.optional")}</span>
        </div>
        <table class="data" style="opacity:0.7">
          <tr><td>${t("sld.tx.oilTemp")}</td><td class="num">— °C</td></tr>
          <tr><td>${t("sld.tx.windTemp")}</td><td class="num">— °C</td></tr>
          <tr><td>${t("sld.tx.tap")}</td><td class="num">— / 5</td></tr>
          <tr><td>${t("sld.tx.loadRatio")}</td><td class="num">— %</td></tr>
          <tr><td>${t("sld.tx.gas")}</td><td class="num">—</td></tr>
        </table>
        <div class="row mt-8" style="padding:8px 10px;background:rgba(245,158,11,0.06);border-left:3px solid var(--amber);border-radius:6px;font-size:11.5px;line-height:1.5">
          <span>${t("sld.tx.iedHint")}</span>
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>${t("sld.relay.title")}</h3>
          <span class="tag mute">${t("sld.tx.optional")} IED</span>
        </div>
        <table class="data" style="opacity:0.7">
          <tr><td>50/51 過流</td><td><span class="tag mute">${t("sld.relay.iedNeeded")}</span></td></tr>
          <tr><td>27/59 欠過壓</td><td><span class="tag mute">${t("sld.relay.iedNeeded")}</span></td></tr>
          <tr><td>81 頻率</td><td><span class="tag mute">${t("sld.relay.iedNeeded")}</span></td></tr>
          <tr><td>87T 差動</td><td><span class="tag mute">${t("sld.relay.iedNeeded")}</span></td></tr>
          <tr><td>Buchholz</td><td><span class="tag mute">${t("sld.relay.iedNeeded")}</span></td></tr>
        </table>
        <a href="#/protection" class="btn btn-ghost mt-8" style="font-size:12px;width:100%;text-align:center;padding:6px">${t("sld.relay.gotoPage")}</a>
      </div>
    </div>`;
}

// ────────── 2b. Protection (separate route, dedicated page) ──────────
function viewProtection() {
  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${t("page.prot.title")}</h1>
        <p class="page-sub">${t("page.prot.sub")}</p>
      </div>
    </div>
    ${sldTabBar("protection")}
    <div id="protection-content"></div>`;
  renderProtectionContent($("#protection-content"));
}

function renderProtectionContent(host) {
  if (true) {
    host.innerHTML = `
      <div class="grid g-3 mt-16">
        <div class="card">
          <div class="card-head"><h3>${t("prot.relay.title")}</h3><span class="tag ok">${t("prot.relay.allOk").replace("{n}", "8/8")}</span></div>
          <table class="data" style="font-size:12.5px">
            <thead><tr><th>${t("prot.relay.thAnsi")}</th><th>${t("prot.relay.thName")}</th><th class="right">${t("prot.relay.thSet")}</th><th>${t("prot.relay.thStat")}</th></tr></thead>
            <tbody>
              <tr><td><code>50/51</code></td><td>${t("prot.relay.50_51")}</td><td class="num right">450A · 0.3s</td><td><span class="tag ok">${t("prot.relay.normal")}</span></td></tr>
              <tr><td><code>50G/51G</code></td><td>${t("prot.relay.50G_51G")}</td><td class="num right">80A inst · 0.5In td=1s</td><td><span class="tag ok">${t("prot.relay.normal")}</span></td></tr>
              <tr><td><code>27/59</code></td><td>${t("prot.relay.27_59")}</td><td class="num right">±10/15% × Vn</td><td><span class="tag ok">${t("prot.relay.normal")}</span></td></tr>
              <tr><td><code>81U/81O</code></td><td>${t("prot.relay.81U_81O")}</td><td class="num right">59.5 / 60.5 Hz</td><td><span class="tag ok">${t("prot.relay.normal")}</span></td></tr>
              <tr><td><code>87T</code></td><td>${t("prot.relay.87T")}</td><td class="num right">0.3In · slope 30%</td><td><span class="tag ok">${t("prot.relay.normal")}</span></td></tr>
              <tr><td><code>25</code></td><td>${t("prot.relay.25")}</td><td class="num right">±10° / ±0.2 Hz</td><td><span class="tag ok">${t("prot.relay.enabled")}</span></td></tr>
              <tr><td><code>49</code></td><td>${t("prot.relay.49")}</td><td class="num right">τ = 30 min</td><td><span class="tag ok">${t("prot.relay.normal")}</span></td></tr>
              <tr><td><code>Buchholz</code></td><td>${t("prot.relay.buchholz")}</td><td class="num right">${t("prot.relay.firstWarnSecondTrip")}</td><td><span class="tag ok">${t("prot.relay.normal")}</span></td></tr>
            </tbody>
          </table>
          <div class="muted mt-8" style="font-size:11px">${t("prot.relay.foot")}</div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${t("prot.sc.title")}</h3><span class="tag ok">${t("prot.sc.sufficient")}</span></div>
          <table class="data">
            <tr><td>${t("prot.sc.hvIsc")}</td><td class="num right">12.4 kA</td></tr>
            <tr><td>${t("prot.sc.lvIsc")}</td><td class="num right">32.5 kA</td></tr>
            <tr><td>${t("prot.sc.acbIcu")}</td><td class="num right">≥ 50 kA</td><td><span class="tag ok">${t("prot.sc.ample")}</span></td></tr>
            <tr><td>${t("prot.sc.dcFuse")}</td><td class="num right">200A · 1000VDC</td></tr>
            <tr><td>${t("prot.sc.txZ")}</td><td class="num right">6.0%</td></tr>
            <tr><td>${t("prot.sc.grounding")}</td><td class="num right">${t("prot.sc.ngr")}</td></tr>
          </table>
          <div class="muted mt-8" style="font-size:11px">${t("prot.sc.foot")}</div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${t("prot.trip.title")}</h3><span class="tag warn">${t("prot.trip.count").replace("{n}", 2)}</span></div>
          <table class="data" style="font-size:12.5px">
            <thead><tr><th>${t("prot.trip.thTime")}</th><th>${t("prot.trip.thDevice")}</th><th>${t("prot.trip.thAct")}</th><th>${t("prot.trip.thReason")}</th></tr></thead>
            <tbody>
              <tr>
                <td class="num muted">04/11 14:23</td>
                <td>VCB-SYS-A</td>
                <td><span class="tag warn">${t("prot.trip.51oc")}</span></td>
                <td class="muted">${t("prot.trip.r1")}</td>
              </tr>
              <tr>
                <td class="num muted">04/03 09:08</td>
                <td>${t("prot.curve.upstream").replace(/\s*\(.*\)/, "")}</td>
                <td><span class="tag info">${t("prot.trip.25sync")}</span></td>
                <td class="muted">${t("prot.trip.r2")}</td>
              </tr>
              <tr>
                <td class="num muted">03/17 02:55</td>
                <td>VCB-SYS-B</td>
                <td><span class="tag warn">${t("prot.trip.81uf")}</span></td>
                <td class="muted">${t("prot.trip.r3")}</td>
              </tr>
            </tbody>
          </table>
          <div class="row mt-12" style="padding:8px 12px;background:rgba(0,194,168,0.06);border-left:3px solid var(--primary);border-radius:6px;font-size:12px">
            <span>${t("prot.trip.coord")}</span>
          </div>
        </div>
      </div>

      <div class="grid g-2 mt-16">
        <div class="card">
          <div class="card-head"><h3>${t("prot.iso.title")}</h3><span class="tag ok">${t("prot.iso.healthy")}</span></div>
          <table class="data">
            <tr><td>${t("prot.iso.sysIso")}</td><td class="num right" style="color:var(--green)">1,650 kΩ</td></tr>
            <tr><td>${t("prot.iso.posIso")}</td><td class="num right">3,420 kΩ</td></tr>
            <tr><td>${t("prot.iso.negIso")}</td><td class="num right">3,180 kΩ</td></tr>
            <tr><td>${t("prot.iso.thresh")}</td><td class="num right">≥ 500 kΩ</td></tr>
            <tr><td>${t("prot.iso.leak")}</td><td class="num right">2.4 mA</td></tr>
            <tr><td>${t("prot.iso.ngrR")}</td><td class="num right">${t("prot.iso.ngrOk")}</td></tr>
          </table>
          <div class="muted mt-8" style="font-size:11px">${t("prot.iso.foot")}</div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${t("prot.curve.title")}</h3><span class="tag info">${t("prot.curve.iec")}</span></div>
          <svg viewBox="0 0 360 180" style="width:100%;height:180px">
            <line x1="40" y1="20" x2="40" y2="160" stroke="#8b98b0" stroke-width="1"/>
            <line x1="40" y1="160" x2="340" y2="160" stroke="#8b98b0" stroke-width="1"/>
            <text x="20" y="25" fill="#8b98b0" font-size="9">t (s)</text>
            <text x="320" y="175" fill="#8b98b0" font-size="9">I/In</text>
            <text x="35" y="55" fill="#8b98b0" font-size="8" text-anchor="end">10</text>
            <text x="35" y="100" fill="#8b98b0" font-size="8" text-anchor="end">1.0</text>
            <text x="35" y="145" fill="#8b98b0" font-size="8" text-anchor="end">0.1</text>
            <text x="80" y="172" fill="#8b98b0" font-size="8" text-anchor="middle">2</text>
            <text x="160" y="172" fill="#8b98b0" font-size="8" text-anchor="middle">5</text>
            <text x="240" y="172" fill="#8b98b0" font-size="8" text-anchor="middle">10</text>
            <text x="320" y="172" fill="#8b98b0" font-size="8" text-anchor="middle">20</text>

            <path d="M 60 30 Q 100 60, 160 90 T 320 145" stroke="#3b82f6" stroke-width="2" fill="none"/>
            <text x="200" y="78" fill="#3b82f6" font-size="10" font-weight="600">${t("prot.curve.upstream")}</text>

            <path d="M 60 60 Q 100 90, 160 115 T 320 158" stroke="#facc15" stroke-width="2" fill="none"/>
            <text x="200" y="135" fill="#facc15" font-size="10" font-weight="600">${t("prot.curve.downstream")}</text>

            <path d="M 100 70 L 100 92 M 200 92 L 200 122 M 300 137 L 300 155" stroke="#10b981" stroke-width="1" stroke-dasharray="2,2"/>
            <text x="240" y="50" fill="#10b981" font-size="9">${t("prot.curve.margin")}</text>
          </svg>
          <div class="muted mt-8" style="font-size:11px">${t("prot.curve.foot")}</div>
        </div>
      </div>`;
  }
}

// ────────── 2c. Communications (separate route, dedicated page) ──────────
function viewComm() {
  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${t("page.comm.title")}</h1>
        <p class="page-sub">${t("page.comm.sub")}</p>
      </div>
    </div>
    ${sldTabBar("comm")}
    <div id="comm-content"></div>`;
  renderCommContent($("#comm-content"));
}

function renderCommContent(host) {
  {
    const justNow = t("comm.justNow");
    const secAgo = (n) => t("comm.secAgo").replace("{n}", n);
    const links = [
      { dev:"PCS-A",                 proto:"Modbus TCP",   addr:"192.168.1.11:502",     latency:"12 ms",  loss:"0.0%", lastSeen:justNow, status:"ok" },
      { dev:"PCS-B",                 proto:"Modbus TCP",   addr:"192.168.1.12:502",     latency:"14 ms",  loss:"0.0%", lastSeen:justNow, status:"ok" },
      { dev:"BCU-A",                 proto:"Modbus TCP",   addr:"192.168.1.21:502",     latency:"9 ms",   loss:"0.0%", lastSeen:justNow, status:"ok" },
      { dev:"BCU-B",                 proto:"Modbus TCP",   addr:"192.168.1.22:502",     latency:"11 ms",  loss:"0.1%", lastSeen:justNow, status:"ok" },
      { dev:"BMU 1-13 (A)",          proto:"CAN bus",      addr:"125 kbps",             latency:"2 ms",   loss:"0.0%", lastSeen:justNow, status:"ok" },
      { dev:"BMU 1-11 (B)",          proto:"CAN bus",      addr:"125 kbps",             latency:"2 ms",   loss:"0.0%", lastSeen:justNow, status:"ok" },
      { dev:t("comm.dev.meterMain"), proto:"DLT645/RS485", addr:"COM1, addr=01",        latency:"82 ms",  loss:"0.3%", lastSeen:secAgo(3), status:"ok" },
      { dev:t("comm.dev.meterEss"),  proto:"Modbus RTU",   addr:"COM2, addr=02",        latency:"75 ms",  loss:"0.2%", lastSeen:secAgo(3), status:"ok" },
      { dev:"PV Inverter",           proto:"Modbus TCP",   addr:"192.168.1.31:502",     latency:"18 ms",  loss:"0.0%", lastSeen:justNow, status:"ok" },
      { dev:"HVAC AC-1",             proto:"BACnet/IP",    addr:"192.168.1.41:47808",   latency:"28 ms",  loss:"0.0%", lastSeen:justNow, status:"ok" },
      { dev:"HVAC AC-2",             proto:"BACnet/IP",    addr:"192.168.1.42:47808",   latency:"31 ms",  loss:"0.0%", lastSeen:justNow, status:"ok" },
      { dev:"HVAC AC-3",             proto:"BACnet/IP",    addr:"192.168.1.43:47808",   latency:"245 ms", loss:"4.2%", lastSeen:secAgo(12), status:"warn" },
      { dev:t("comm.dev.fire"),      proto:"DI/Relay",     addr:"DI 4",                 latency:"-",      loss:"-",    lastSeen:justNow, status:"ok" },
      { dev:t("comm.dev.door"),      proto:"DI/Relay",     addr:"DI 2-3",               latency:"-",      loss:"-",    lastSeen:justNow, status:"ok" },
      { dev:t("comm.dev.openadr"),   proto:"IEC 61850",    addr:"adr.taipower.com.tw",  latency:"180 ms", loss:"0.5%", lastSeen:secAgo(30), status:"ok" },
      { dev:t("comm.dev.mqtt"),      proto:"MQTT/TLS",     addr:"$ESS/site/data:8883",  latency:"145 ms", loss:"0.2%", lastSeen:justNow, status:"ok" },
    ];
    const okN = links.filter(l => l.status === "ok").length;
    const warnN = links.filter(l => l.status === "warn").length;

    const sec = (n) => t("comm.faults.sec").replace("{n}", n);
    host.innerHTML = `
      <!-- Data path: EMS → SCU → BCU → BMS/PCS -->
      <div class="card mt-16">
        <div class="card-head">
          <h3>${t("comm.dp.title")}</h3>
          <span class="muted" style="font-size:11.5px">${t("comm.dp.sub")}</span>
        </div>
        <svg viewBox="0 0 1080 270" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
          <defs>
            <marker id="arrDP" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill="#94a3b8"/>
            </marker>
          </defs>

          <g>
            <rect x="380" y="10" width="320" height="48" rx="8" fill="#0a2924" stroke="#00c2a8" stroke-width="1.5"/>
            <text x="540" y="32" text-anchor="middle" fill="#00c2a8" font-size="13" font-weight="700">J&amp;J Power EMS</text>
            <text x="540" y="48" text-anchor="middle" fill="#cbd5e1" font-size="10.5">${t("comm.dp.emsRole")}</text>
          </g>

          <line x1="540" y1="58" x2="540" y2="92" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrDP)"/>
          <text x="556" y="74" fill="#3b82f6" font-size="10.5" font-weight="600">MQTT / TLS</text>
          <text x="556" y="86" fill="#8b98b0" font-size="9.5">↑ $ESS/{dev}/data 1-5s · ↓ $ESC/{gw}/rpcreq</text>

          <g>
            <rect x="320" y="92" width="440" height="48" rx="8" fill="#101a2e" stroke="#3b82f6" stroke-width="1.5"/>
            <text x="540" y="114" text-anchor="middle" fill="#3b82f6" font-size="13" font-weight="700">${t("comm.dp.scu")}</text>
            <text x="540" y="130" text-anchor="middle" fill="#cbd5e1" font-size="10.5">${t("comm.dp.scuRole")}</text>
          </g>

          <line x1="430" y1="140" x2="200" y2="178" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrDP)"/>
          <text x="240" y="158" fill="#14b8a6" font-size="10.5" font-weight="600">Modbus TCP @ 1s</text>
          <text x="240" y="170" fill="#8b98b0" font-size="9.5">${t("comm.dp.poll107")}</text>

          <line x1="540" y1="140" x2="540" y2="178" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrDP)"/>
          <text x="552" y="158" fill="#fbbf24" font-size="10.5" font-weight="600">Modbus RTU @ 5s</text>
          <text x="552" y="170" fill="#8b98b0" font-size="9.5">DLT645 · RS485</text>

          <line x1="650" y1="140" x2="880" y2="178" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrDP)"/>
          <text x="780" y="158" fill="#a78bfa" font-size="10.5" font-weight="600">BACnet/IP · DI/O</text>
          <text x="780" y="170" fill="#8b98b0" font-size="9.5">${t("comm.dp.peripheralWire")}</text>

          <g>
            <rect x="60" y="180" width="280" height="44" rx="8" fill="#0a2320" stroke="#14b8a6" stroke-width="1.5"/>
            <text x="200" y="201" text-anchor="middle" fill="#14b8a6" font-size="12.5" font-weight="700">${t("comm.dp.bcu")}</text>
            <text x="200" y="215" text-anchor="middle" fill="#8b98b0" font-size="10">${t("comm.dp.bcuRole")}</text>
          </g>

          <g>
            <rect x="430" y="180" width="220" height="44" rx="8" fill="#1a1505" stroke="#fbbf24" stroke-width="1.5"/>
            <text x="540" y="201" text-anchor="middle" fill="#fbbf24" font-size="12.5" font-weight="700">${t("comm.dp.meters")}</text>
            <text x="540" y="215" text-anchor="middle" fill="#8b98b0" font-size="10">${t("comm.dp.metersRole")}</text>
          </g>

          <g>
            <rect x="740" y="180" width="280" height="44" rx="8" fill="#170e2a" stroke="#a78bfa" stroke-width="1.5"/>
            <text x="880" y="201" text-anchor="middle" fill="#a78bfa" font-size="12.5" font-weight="700">${t("comm.dp.peripheral")}</text>
            <text x="880" y="215" text-anchor="middle" fill="#8b98b0" font-size="10">${t("comm.dp.peripheralRole")}</text>
          </g>

          <line x1="130" y1="224" x2="105" y2="246" stroke="#94a3b8" stroke-width="1.2" marker-end="url(#arrDP)"/>
          <line x1="270" y1="224" x2="295" y2="246" stroke="#94a3b8" stroke-width="1.2" marker-end="url(#arrDP)"/>

          <g>
            <rect x="20" y="246" width="170" height="20" rx="4" fill="rgba(16,185,129,0.08)" stroke="#10b981" stroke-width="1"/>
            <text x="105" y="260" text-anchor="middle" fill="#10b981" font-size="10.5" font-weight="700">${t("comm.dp.bms")}</text>
          </g>
          <g>
            <rect x="210" y="246" width="170" height="20" rx="4" fill="rgba(20,184,166,0.08)" stroke="#14b8a6" stroke-width="1"/>
            <text x="295" y="260" text-anchor="middle" fill="#14b8a6" font-size="10.5" font-weight="700">${t("comm.dp.pcs")}</text>
          </g>
          <text x="105" y="240" text-anchor="middle" fill="#8b98b0" font-size="9">${t("comm.dp.canBms")}</text>
          <text x="295" y="240" text-anchor="middle" fill="#8b98b0" font-size="9">${t("comm.dp.canPcs")}</text>
        </svg>
        <div class="grid g-3 mt-12" style="font-size:11.5px;line-height:1.6">
          <div style="padding:8px 12px;background:rgba(0,194,168,0.06);border-left:3px solid var(--primary);border-radius:6px">
            <strong>${t("comm.dp.cardEms")}</strong>：${t("comm.dp.cardEmsBody")}
          </div>
          <div style="padding:8px 12px;background:rgba(59,130,246,0.06);border-left:3px solid var(--blue);border-radius:6px">
            <strong>${t("comm.dp.cardRpc")}</strong>：${t("comm.dp.cardRpcBody")}
          </div>
          <div style="padding:8px 12px;background:rgba(245,158,11,0.06);border-left:3px solid var(--amber);border-radius:6px">
            <strong>${t("comm.dp.cardDerived")}</strong>：${t("comm.dp.cardDerivedBody")}
          </div>
        </div>
      </div>

      <!-- KPI summary -->
      <div class="kpi-grid mt-16" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpi green">
          <div class="kpi-label">${t("comm.kpi.online")}</div>
          <div class="kpi-value">${okN}<span class="unit">/${links.length}</span></div>
          <div class="kpi-foot">${t("comm.kpi.uptime").replace("{p}", "99.4")}</div>
        </div>
        <div class="kpi blue">
          <div class="kpi-label">${t("comm.kpi.avgLat")}</div>
          <div class="kpi-value">42<span class="unit">ms</span></div>
          <div class="kpi-foot">${t("comm.kpi.avgLatFoot")}</div>
        </div>
        <div class="kpi amber">
          <div class="kpi-label">${t("comm.kpi.attention")}</div>
          <div class="kpi-value">${warnN}</div>
          <div class="kpi-foot">${t("comm.kpi.attentionFoot")}</div>
        </div>
        <div class="kpi purple">
          <div class="kpi-label">${t("comm.kpi.reconn")}</div>
          <div class="kpi-value">3<span class="unit">${t("comm.kpi.times")}</span></div>
          <div class="kpi-foot">${t("comm.kpi.reconnFoot")}</div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head">
          <h3>${t("comm.list.title").replace("{n}", links.length)}</h3>
          <span class="muted" style="font-size:11.5px">${t("comm.list.poll5s")}</span>
        </div>
        <table class="data" style="font-size:12.5px">
          <thead><tr><th>${t("comm.list.thDev")}</th><th>${t("comm.list.thProto")}</th><th>${t("comm.list.thAddr")}</th><th class="right">${t("comm.list.thLat")}</th><th class="right">${t("comm.list.thLoss")}</th><th class="right">${t("comm.list.thLast")}</th><th>${t("comm.list.thStat")}</th></tr></thead>
          <tbody>
            ${links.map(l => `
              <tr ${l.status==='warn'?'style="background:rgba(245,158,11,0.04)"':''}>
                <td><strong>${l.dev}</strong></td>
                <td><span class="tag info" style="font-size:11px">${l.proto}</span></td>
                <td class="muted" style="font-family:ui-monospace,monospace;font-size:11px">${l.addr}</td>
                <td class="num right">${l.latency}</td>
                <td class="num right">${l.loss}</td>
                <td class="num right muted">${l.lastSeen}</td>
                <td><span class="tag ${l.status}">${l.status==='ok'?t("comm.list.online"):t("comm.list.warn")}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="grid g-2 mt-16">
        <div class="card">
          <div class="card-head"><h3>${t("comm.health.title")}</h3></div>
          <table class="data">
            <thead><tr><th>${t("comm.health.thLink")}</th><th class="right">${t("comm.health.thAvail")}</th><th class="right">${t("comm.health.thLat")}</th><th class="right">${t("comm.health.thRetx")}</th></tr></thead>
            <tbody>
              <tr><td>Modbus TCP (PCS/BCU)</td><td class="num right" style="color:var(--green)">99.98%</td><td class="num right">12 ms</td><td class="num right">2</td></tr>
              <tr><td>CAN bus (BMU)</td><td class="num right" style="color:var(--green)">100.00%</td><td class="num right">2 ms</td><td class="num right">0</td></tr>
              <tr><td>Modbus RTU (Meter)</td><td class="num right" style="color:var(--green)">99.7%</td><td class="num right">80 ms</td><td class="num right">7</td></tr>
              <tr><td>BACnet/IP (HVAC)</td><td class="num right" style="color:var(--amber)">95.8%</td><td class="num right">102 ms</td><td class="num right">38</td></tr>
              <tr><td>MQTT/TLS (Cloud)</td><td class="num right" style="color:var(--green)">99.2%</td><td class="num right">145 ms</td><td class="num right">5</td></tr>
              <tr><td>OpenADR (TPC)</td><td class="num right" style="color:var(--green)">99.5%</td><td class="num right">180 ms</td><td class="num right">3</td></tr>
            </tbody>
          </table>
          <div class="muted mt-8" style="font-size:11px">${t("comm.health.foot")}</div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${t("comm.faults.title")}</h3></div>
          <table class="data" style="font-size:12.5px">
            <thead><tr><th>${t("comm.faults.thTime")}</th><th>${t("comm.faults.thDev")}</th><th>${t("comm.faults.thEvent")}</th><th>${t("comm.faults.thRecov")}</th></tr></thead>
            <tbody>
              <tr><td class="num muted">${t("comm.faults.today")} 03:15</td><td>HVAC AC-3</td><td><span class="tag warn">${t("comm.faults.bacnetTo")}</span></td><td><span class="tag ok">${sec(12)}</span></td></tr>
              <tr><td class="num muted">${t("comm.faults.yesterday")} 18:02</td><td>PCS-A</td><td><span class="tag err">${t("comm.faults.modbusHb")}</span></td><td><span class="tag ok">${sec(15)}</span></td></tr>
              <tr><td class="num muted">04/22 09:30</td><td>${t("comm.dev.meterMain").replace(/\s*\(.*\)/, "")}</td><td><span class="tag warn">${t("comm.faults.crcErr")}</span></td><td><span class="tag ok">${t("comm.faults.instant")}</span></td></tr>
              <tr><td class="num muted">04/19 14:48</td><td>${t("comm.dev.mqtt")}</td><td><span class="tag warn">${t("comm.faults.tlsLag")}</span></td><td><span class="tag ok">${sec(2)}</span></td></tr>
              <tr><td class="num muted">04/19 04:12</td><td>HVAC AC-3</td><td><span class="tag warn">${t("comm.faults.bacnetTo")}</span></td><td><span class="tag ok">${sec(8)}</span></td></tr>
            </tbody>
          </table>
          <div class="row mt-12" style="padding:8px 12px;background:rgba(245,158,11,0.06);border-left:3px solid var(--amber);border-radius:6px;font-size:12px">
            <span>${t("comm.faults.diag")}</span>
          </div>
        </div>
      </div>`;
  }
}

// ────────── 3. Device monitoring ──────────
function viewDevices() {
  const tab = state.devicesTab || "monitor";
  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${t("page.dev.title")}</h1>
        <p class="page-sub">${t("page.dev.sub")}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary">${t("btn.downloadLog")}</button>
      </div>
    </div>

    <div class="tabs-strip mb-16">
      <button class="tab ${tab==='monitor'?'active':''}" data-tab="monitor">${t("tab.monitor")}</button>
      <button class="tab ${tab==='analytics'?'active':''}" data-tab="analytics">${t("tab.analytics")} <span class="tab-pro">BMS Pro</span></button>
    </div>

    <div id="dev-content"></div>
  `;

  $$(".tabs-strip .tab").forEach(t => t.addEventListener("click", () => {
    state.devicesTab = t.dataset.tab;
    router();
  }));

  if (tab === "analytics") return renderDevicesAnalytics();
  // Default monitor tab
  $("#dev-content").innerHTML = `
    <div class="grid g-2e mb-16">
      ${SITE.systems.map(renderSysCard).join("")}
    </div>

    <div class="card mb-16">
      <div class="card-head">
        <h3>${t("dev.mod.title").replace("{sys}", "SYS-A")} <span class="muted" style="font-size:11px;font-weight:400">${t("dev.mod.subtitle")}</span></h3>
        <div class="row" style="gap:6px;font-size:11px;color:var(--muted)">
          <span><span style="display:inline-block;width:10px;height:10px;background:#10b981;border-radius:50%;vertical-align:-1px"></span> ${t("dev.mod.legendOk")}</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#f59e0b;border-radius:50%;vertical-align:-1px"></span> ${t("dev.mod.legendMid")}</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:50%;vertical-align:-1px"></span> ${t("dev.mod.legendHi")}</span>
        </div>
      </div>
      <div id="mod-temp"></div>
    </div>

    <div class="grid g-3 mb-16">
      <div class="card">
        <div class="card-head"><h3>${t("dev.iso.title")}</h3><span class="tag ok">${t("dev.iso.normal")}</span></div>
        <table class="data">
          <tr><td>${t("dev.iso.posGnd")}</td><td class="num right">3,420 kΩ</td></tr>
          <tr><td>${t("dev.iso.negGnd")}</td><td class="num right">3,180 kΩ</td></tr>
          <tr><td>${t("dev.iso.total")}</td><td class="num right">1,650 kΩ</td></tr>
          <tr><td>${t("dev.iso.thresh")}</td><td class="num right">≥ 500 kΩ</td></tr>
          <tr><td>${t("dev.iso.period")}</td><td class="num right">${t("dev.iso.5sec")}</td></tr>
        </table>
        <div class="muted mt-8" style="font-size:11px">Modbus reg: Rack Insulation Value / Pos / Neg</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${t("dev.imb.title")}</h3><span class="tag warn">${t("dev.imb.attention")}</span></div>
        <table class="data">
          <tr><td>${t("dev.imb.maxV")}</td><td class="num right">#142 · 3.418 V</td></tr>
          <tr><td>${t("dev.imb.minV")}</td><td class="num right">#057 · 3.352 V</td></tr>
          <tr><td>${t("dev.imb.dv")}</td><td class="num right">66 mV</td></tr>
          <tr><td>${t("dev.imb.thresh")}</td><td class="num right">≥ 80 mV</td></tr>
          <tr><td>${t("dev.imb.balance")}</td><td><span class="tag ok">${t("dev.imb.balOn")}</span></td></tr>
        </table>
        <div class="muted mt-8" style="font-size:11px">Modbus reg: Max/Min Cell Voltage + Cell ID</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${t("dev.bmu.title")}</h3><span class="tag ok">${t("dev.bmu.online")}</span></div>
        <table class="data" style="font-size:12px">
          <tr><td>BMU 1–4</td><td class="num right" style="color:var(--green)">●●●●</td></tr>
          <tr><td>BMU 5–8</td><td class="num right" style="color:var(--green)">●●●●</td></tr>
          <tr><td>BMU 9–12</td><td class="num right" style="color:var(--green)">●●●●</td></tr>
          <tr><td>BMU 13</td><td class="num right" style="color:var(--green)">●</td></tr>
          <tr><td>BCU ↔ BMU CAN</td><td class="num right">125 kbps</td></tr>
          <tr><td>${t("dev.bmu.discon")}</td><td class="num right">0</td></tr>
        </table>
        <div class="muted mt-8" style="font-size:11px">Modbus reg: BMU1-16 Communication State (bitmap)</div>
      </div>
    </div>

    <div class="grid g-2 mt-16">
      <div class="card">
        <div class="card-head"><h3>${t("dev.pcs.title")}</h3></div>
        <table class="data">
          <thead><tr><th>${t("dev.pcs.thItem")}</th><th class="right">SYS-A</th><th class="right">SYS-B</th></tr></thead>
          <tbody>
            <tr><td>${t("dev.pcs.runMode")}</td><td class="right">PQ Mode</td><td class="right">PQ Mode</td></tr>
            <tr><td>${t("dev.pcs.outP")}</td><td class="num right">+118.2 kW</td><td class="num right">+97.4 kW</td></tr>
            <tr><td>${t("dev.pcs.outQ")}</td><td class="num right">-3.1 kVAR</td><td class="num right">-1.8 kVAR</td></tr>
            <tr><td>${t("dev.pcs.dcV")}</td><td class="num right">763.4 V</td><td class="num right">758.2 V</td></tr>
            <tr><td>${t("dev.pcs.dcI")}</td><td class="num right">155.3 A</td><td class="num right">128.9 A</td></tr>
            <tr><td>${t("dev.pcs.eff")}</td><td class="num right">96.8%</td><td class="num right">96.4%</td></tr>
            <tr><td>${t("dev.pcs.modTemp")}</td><td class="num right">42 °C</td><td class="num right">44 °C</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-head"><h3>${t("dev.bms.title")}</h3></div>
        <table class="data">
          <thead><tr><th>${t("dev.bms.thItem")}</th><th class="right">SYS-A</th><th class="right">SYS-B</th></tr></thead>
          <tbody>
            <tr><td>${t("dev.bms.modules")}</td><td class="num right">13</td><td class="num right">11</td></tr>
            <tr><td>${t("dev.bms.cellCount")}</td><td class="num right">208</td><td class="num right">176</td></tr>
            <tr><td>${t("dev.bms.maxMinV")}</td><td class="num right">3.42 / 3.35 V</td><td class="num right">3.44 / 3.36 V</td></tr>
            <tr><td>${t("dev.bms.maxMinT")}</td><td class="num right">30.6 / 28.9 °C</td><td class="num right">31.1 / 29.2 °C</td></tr>
            <tr><td>${t("dev.bms.soh")}</td><td class="num right">98.2%</td><td class="num right">98.6%</td></tr>
            <tr><td>${t("dev.bms.cycles")}</td><td class="num right">182</td><td class="num right">176</td></tr>
            <tr><td>${t("dev.bms.thru")}</td><td class="num right">44.2 MWh</td><td class="num right">34.8 MWh</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><h3>${t("dev.env.title")}</h3></div>
      <table class="data">
        <thead><tr><th>${t("dev.env.thDev")}</th><th>${t("dev.env.thCab")}</th><th>${t("dev.env.thStat")}</th><th class="right">${t("dev.env.thTemp")}</th><th class="right">${t("dev.env.thHum")}</th><th>${t("dev.env.thComm")}</th></tr></thead>
        <tbody>
          <tr><td>${t("dev.env.ac").replace("{n}", 1)}</td><td>SYS-A</td><td><span class="tag ok">${t("dev.env.acRunning")}</span></td><td class="num right">28.4°C</td><td class="num right">52%</td><td><span class="dot dot-ok"></span> ${t("dev.env.online")}</td></tr>
          <tr><td>${t("dev.env.ac").replace("{n}", 2)}</td><td>SYS-A</td><td><span class="tag ok">${t("dev.env.acRunning")}</span></td><td class="num right">28.9°C</td><td class="num right">53%</td><td><span class="dot dot-ok"></span> ${t("dev.env.online")}</td></tr>
          <tr><td>${t("dev.env.ac").replace("{n}", 3)}</td><td>SYS-B</td><td><span class="tag ok">${t("dev.env.acRunning")}</span></td><td class="num right">30.2°C</td><td class="num right">55%</td><td><span class="dot dot-ok"></span> ${t("dev.env.online")}</td></tr>
          <tr><td>${t("dev.env.fire")}</td><td>${t("dev.env.allCabinets")}</td><td><span class="tag ok">${t("dev.env.fireOk")}</span></td><td class="num right">-</td><td class="num right">-</td><td><span class="dot dot-ok"></span> ${t("dev.env.online")}</td></tr>
          <tr><td>${t("dev.env.door")}</td><td>${t("dev.env.allCabinets")}</td><td><span class="tag ok">${t("dev.env.doorClosed")}</span></td><td class="num right">-</td><td class="num right">-</td><td><span class="dot dot-ok"></span> ${t("dev.env.online")}</td></tr>
          <tr><td>${t("dev.env.ups")}</td><td>${t("dev.env.upsCab")}</td><td><span class="tag ok">${t("dev.env.mains")}</span></td><td class="num right">-</td><td class="num right">-</td><td><span class="dot dot-ok"></span> ${t("dev.env.online")}</td></tr>
        </tbody>
      </table>
    </div>
  `;

  // Render module-level temperature bars — honest representation of BMS data
  // HiThium V1.4 BMS only exposes per-module max/min/avg, NOT per-cell temperature.
  // 13 modules × (min, avg, max) → 39 real data points, not 208 fake ones.
  const modHost = $("#mod-temp");
  const N_MOD = 13;
  const modules = [];
  for (let m = 0; m < N_MOD; m++) {
    const baseT = 29.4 + Math.sin(m * 0.7 + 0.4) * 0.4;
    const spread = 0.9 + Math.abs(Math.cos(m * 1.3)) * 0.5;
    modules.push({
      id: m + 1,
      min: +(baseT - spread / 2 + Math.sin(m * 2.1) * 0.1).toFixed(1),
      avg: +(baseT + Math.sin(m * 2.1) * 0.08).toFixed(1),
      max: +(baseT + spread / 2 + Math.cos(m * 1.7) * 0.2).toFixed(1),
    });
  }
  // 一個發熱模組（液冷流道輕微堵塞示範）
  modules[10] = { id: 11, min: 30.4, avg: 32.6, max: 35.4 };

  const allMin = Math.min(...modules.map(m => m.min));
  const allMax = Math.max(...modules.map(m => m.max));
  const range = allMax - allMin;
  const colorOf = (t) => t >= 35 ? "#ef4444" : t >= 33 ? "#f59e0b" : "#10b981";

  let modHtml = '<div style="display:grid;gap:5px">';
  for (const m of modules) {
    const minPct = ((m.min - allMin) / range) * 100;
    const maxPct = ((m.max - allMin) / range) * 100;
    const avgPct = ((m.avg - allMin) / range) * 100;
    const col = colorOf(m.max);
    modHtml += `
      <div style="display:grid;grid-template-columns:90px 1fr 200px;gap:14px;align-items:center;font-size:12.5px">
        <div style="color:var(--text-muted);font-family:ui-monospace,monospace">Module #${String(m.id).padStart(2,'0')}</div>
        <div style="position:relative;height:20px;background:rgba(139,152,176,0.06);border-radius:3px">
          <div style="position:absolute;left:${minPct}%;width:${maxPct-minPct}%;top:8px;height:4px;background:${col};opacity:0.35;border-radius:2px"></div>
          <div style="position:absolute;left:${minPct}%;top:3px;width:2px;height:14px;background:${col};opacity:0.85"></div>
          <div style="position:absolute;left:${maxPct}%;top:3px;width:2px;height:14px;background:${col};opacity:0.85"></div>
          <div style="position:absolute;left:${avgPct}%;top:5px;width:10px;height:10px;background:${col};border-radius:50%;transform:translateX(-50%);box-shadow:0 0 0 2px #0f1729" title="平均 ${m.avg}°C"></div>
        </div>
        <div style="font-family:ui-monospace,monospace;font-size:11.5px;text-align:right">
          <span style="color:var(--text-muted)">${m.min.toFixed(1)}</span>
          <span style="opacity:0.4;margin:0 4px">─</span>
          <span style="color:${col};font-weight:700">${m.avg.toFixed(1)}</span>
          <span style="opacity:0.4;margin:0 4px">─</span>
          <span style="color:var(--text-muted)">${m.max.toFixed(1)}</span>
          <span style="color:var(--text-muted);margin-left:4px">°C</span>
        </div>
      </div>`;
  }
  modHtml += '</div>';
  modHtml += `
    <div style="display:grid;grid-template-columns:90px 1fr 200px;gap:14px;font-size:10.5px;color:var(--text-muted);margin-top:8px">
      <div></div>
      <div style="display:flex;justify-content:space-between"><span>${allMin.toFixed(1)}°C</span><span>${((allMin+allMax)/2).toFixed(1)}°C</span><span>${allMax.toFixed(1)}°C</span></div>
      <div style="text-align:right;font-size:10.5px">${t("dev.mod.axisHint")}</div>
    </div>
    <div class="row mt-12" style="padding:8px 12px;background:rgba(59,130,246,0.06);border-left:3px solid var(--blue);border-radius:6px;font-size:11.5px;line-height:1.6">
      <span>${t("dev.mod.source")}</span>
    </div>
  `;
  modHost.innerHTML = modHtml;
}

// ────────── BMS Pro · Cell Analytics ──────────
function renderDevicesAnalytics() {
  // Generate fake cell data deterministically (208 + 176 = 384 cells)
  const seedRand = (s) => { s = s % 2147483647; if (s <= 0) s += 2147483646; return () => (s = s * 16807 % 2147483647) / 2147483647; };
  const r = seedRand(42);

  const allCells = [];
  for (const sys of SITE.systems) {
    const n = sys.cells;
    // Different baseline per system → 兩個可區分的鐘形
    const baseV = sys.id === "SYS-A" ? 3.386 : 3.394;
    for (let i = 0; i < n; i++) {
      // Voltage: tight Gaussian (健康 LFP at rest σ ≈ 4 mV)
      const u1 = r(), u2 = r();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      let v = baseV + z * 0.004;                                        // σ = 4 mV
      // 少數 "weak" 電芯（早期衰退 -8 至 -12 mV）
      if (sys.id === "SYS-A" && [3, 47, 199].includes(i)) v -= 0.008 + r()*0.004;
      if (sys.id === "SYS-B" && [12, 67].includes(i))     v -= 0.009 + r()*0.003;
      const ir = 0.42 + r() * 0.08 + Math.max(0, baseV - v) * 4;       // mΩ
      const temp = 28 + r() * 3.5 + (sys.id === "SYS-B" ? 1.5 : 0);
      allCells.push({ sys: sys.id, idx: i+1, v: +v.toFixed(4), ir: +ir.toFixed(3), temp: +temp.toFixed(1) });
    }
  }

  const sysA = allCells.filter(c => c.sys === "SYS-A");
  const sysB = allCells.filter(c => c.sys === "SYS-B");
  const mean = arr => arr.reduce((a,b)=>a+b,0)/arr.length;
  const std  = arr => { const m = mean(arr); return Math.sqrt(arr.reduce((s,x)=>s+(x-m)**2,0)/arr.length); };
  const vMean = mean(allCells.map(c=>c.v));
  const vStd  = std(allCells.map(c=>c.v));
  const vMin = Math.min(...allCells.map(c=>c.v));
  const vMax = Math.max(...allCells.map(c=>c.v));
  const vRange = (vMax - vMin) * 1000; // mV
  const sortedWeak = [...allCells].sort((a,b)=> a.v - b.v).slice(0, 10);
  // Risk score (0-100, lower = better)
  const riskScore = Math.round(Math.min(100, vRange*0.6 + vStd*1500 + (sortedWeak[0].v < 3.34 ? 8 : 0)));

  const stdMv = vStd*1000;
  const stdTagText = stdMv<15 ? `<span style="color:var(--green)">${t("an.kpi.stdGood")}</span>` : stdMv<25 ? `<span style="color:var(--amber)">${t("an.kpi.stdOk")}</span>` : `<span style="color:var(--red)">${t("an.kpi.stdNeed")}</span>`;
  const riskTagText = riskScore<15 ? t("an.kpi.riskLow") : riskScore<35 ? t("an.kpi.riskMid") : t("an.kpi.riskHi");

  $("#dev-content").innerHTML = `
    <!-- KPI cards -->
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi green">
        <div class="kpi-label">${t("an.kpi.avgV")}</div>
        <div class="kpi-value">${vMean.toFixed(3)}<span class="unit">V</span></div>
        <div class="kpi-foot">${t("an.kpi.avgVFoot").replace("{n}", "384")}</div>
      </div>
      <div class="kpi blue">
        <div class="kpi-label">${t("an.kpi.std")}</div>
        <div class="kpi-value">${stdMv.toFixed(1)}<span class="unit">mV</span></div>
        <div class="kpi-foot">${t("an.kpi.stdFoot").replace("{tag}", stdTagText)}</div>
      </div>
      <div class="kpi amber">
        <div class="kpi-label">${t("an.kpi.dv")}</div>
        <div class="kpi-value">${vRange.toFixed(0)}<span class="unit">mV</span></div>
        <div class="kpi-foot">${t("an.kpi.dvFoot").replace("{max}", vMax.toFixed(3)).replace("{min}", vMin.toFixed(3))}</div>
      </div>
      <div class="kpi ${riskScore<15?'green':riskScore<35?'amber':'pink'}">
        <div class="kpi-label">${t("an.kpi.risk")}</div>
        <div class="kpi-value">${riskScore}<span class="unit">/100</span></div>
        <div class="kpi-foot">${riskTagText}</div>
      </div>
    </div>

    <!-- Voltage histogram + Top 10 weak -->
    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-head">
          <h3>${t("an.histo.title")}</h3>
          <div class="row">
            <span class="tag info">SYS-A · ${t("an.cellCount").replace("{n}", "208")}</span>
            <span class="tag" style="color:var(--ess-teal);background:rgba(20,184,166,0.12)">SYS-B · ${t("an.cellCount").replace("{n}", "176")}</span>
          </div>
        </div>
        <div class="chart-wrap tall"><canvas id="chartHisto"></canvas></div>
        <div class="muted" style="font-size:11.5px;margin-top:6px">${t("an.histo.foot")}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>${t("an.weak.title")}</h3>
          <span class="tag warn">${t("an.weak.attention")}</span>
        </div>
        <table class="data" style="font-size:12px">
          <thead><tr><th>#</th><th>${t("an.weak.thSys")}</th><th>${t("an.weak.thIdx")}</th><th class="right">${t("an.weak.thV")}</th><th class="right">${t("an.weak.thT")}</th><th class="right">${t("an.weak.thDev")}</th><th></th></tr></thead>
          <tbody>
            ${sortedWeak.map((c,i)=>{
              const dev = (c.v - vMean) * 1000;
              const sev = Math.abs(dev) > 30 ? "err" : Math.abs(dev) > 20 ? "warn" : "info";
              return `<tr>
                <td><strong>${i+1}</strong></td>
                <td>${c.sys}</td>
                <td>#${c.idx}</td>
                <td class="num right">${c.v.toFixed(3)} V</td>
                <td class="num right">${c.temp.toFixed(1)} °C</td>
                <td class="num right"><span class="tag ${sev}" style="font-size:10.5px">${dev.toFixed(0)} mV</span></td>
                <td><button class="btn btn-ghost" style="padding:2px 8px;font-size:10.5px">${t("an.weak.dispatch")}</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Thermal runaway prognostics — 6 indicator cards -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>${t("an.therm.title")}</h3>
        <span class="muted" style="font-size:12px">${t("an.therm.sub")}</span>
      </div>
      <div class="prog-grid">
        ${prognosticIndicator(t("an.ind.tempRise"), 0.12, 0.3, t("an.ind.unit.cmin"), "monotonic")}
        ${prognosticIndicator(t("an.ind.modDeltaT"), 4.8, 8, "°C", "balanced")}
        ${prognosticIndicator(t("an.ind.viCorr"), 0.94, 0.7, "ρ", "rising", true)}
        ${prognosticIndicator(t("an.ind.selfDis"), 0.8, 2.0, t("an.ind.unit.week"), "monotonic")}
        ${prognosticIndicator(t("an.ind.socDrift"), 1.2, 5, "%", "monotonic")}
        ${prognosticIndicator(t("an.ind.vCv"), 4.2, 10, "%", "monotonic")}
      </div>
      <div style="margin-top:14px;padding:10px 14px;background:rgba(16,185,129,0.05);border-left:3px solid var(--green);border-radius:6px;font-size:12.5px">
        ${t("an.therm.aiEval")}
      </div>
    </div>

    <!-- 7-day balance trend + ΔV heat map -->
    <div class="grid g-2">
      <div class="card">
        <div class="card-head"><h3>${t("an.spread.title")}</h3></div>
        <div class="chart-wrap"><canvas id="chartSpread"></canvas></div>
        <div class="muted" style="font-size:11.5px;margin-top:6px">${t("an.spread.foot")}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>${t("an.dv.title").replace("{n}", SITE.systems[0].cells)} <span class="muted" style="font-size:11px;font-weight:400">${t("an.dv.formula")}</span></h3>
          <div class="row" style="gap:4px">
            <span class="muted" style="font-size:11px">−25 mV</span>
            <div style="width:160px;height:8px;background:linear-gradient(90deg,#ef4444,#f59e0b,#10b981,#f59e0b,#ef4444);border-radius:4px"></div>
            <span class="muted" style="font-size:11px">+25 mV</span>
          </div>
        </div>
        <div class="heat" id="dvHeat"></div>
        <div class="muted" style="font-size:11.5px;margin-top:6px">${t("an.dv.foot")}</div>
      </div>
    </div>
  `;

  // Histogram — tight range to highlight bell-curve shape (健康 LFP)
  // Two systems each with its own peak (3.386V vs 3.394V)
  const bins = 24;
  const binStart = 3.37, binEnd = 3.41;
  const binW = (binEnd - binStart) / bins;
  const histA = Array(bins).fill(0);
  const histB = Array(bins).fill(0);
  for (const c of sysA) { const i = Math.min(bins-1, Math.max(0, Math.floor((c.v - binStart)/binW))); histA[i]++; }
  for (const c of sysB) { const i = Math.min(bins-1, Math.max(0, Math.floor((c.v - binStart)/binW))); histB[i]++; }
  const labels = Array.from({length:bins}, (_,i) => (binStart + i*binW).toFixed(3));

  addChart(new Chart($("#chartHisto"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "SYS-A", data: histA,
          borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,0.35)",
          fill: true, tension: 0.45, pointRadius: 0, borderWidth: 2 },
        { label: "SYS-B", data: histB,
          borderColor: "#14b8a6", backgroundColor: "rgba(20,184,166,0.35)",
          fill: true, tension: 0.45, pointRadius: 0, borderWidth: 2 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: t("an.histo.xLabel") }, ticks: { maxTicksLimit: 8 }, grid: { display: false } },
        y: { title: { display: true, text: t("an.histo.yLabel") }, grid: { color: "rgba(139,152,176,0.08)" } }
      }
    }
  }));

  // 7-day spread chart
  const days = [
    t("an.spread.day.nago").replace("{n}", 6),
    t("an.spread.day.nago").replace("{n}", 5),
    t("an.spread.day.nago").replace("{n}", 4),
    t("an.spread.day.nago").replace("{n}", 3),
    t("an.spread.day.nago").replace("{n}", 2),
    t("an.spread.day.yesterday"),
    t("an.spread.day.today"),
  ];
  const spreadData = [22.4, 18.6, 24.8, 19.2, 21.5, 17.3, +(vRange).toFixed(1)];
  addChart(new Chart($("#chartSpread"), {
    type: "line",
    data: {
      labels: days,
      datasets: [
        { label: "V Spread", data: spreadData, borderColor: "#00c2a8", backgroundColor: "rgba(0,194,168,0.18)", fill: true, tension: 0.35, pointRadius: 4, borderWidth: 2 },
        { label: t("an.spread.thresh"), data: days.map(()=>50), borderColor: "#ef4444", borderWidth: 1, borderDash: [4,3], pointRadius: 0, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { title: { display: true, text: "mV" }, grid: { color: "rgba(139,152,176,0.08)" } }
      }
    }
  }));

  // Render sparklines for prognostic indicators
  $$(".prog-spark").forEach(canvas => {
    const trend = canvas.dataset.trend;
    const seed = +(canvas.dataset.seed || 1);
    const sr = seedRand(seed * 7);
    const pts = [];
    for (let i = 0; i < 24; i++) {
      let v;
      if (trend === "monotonic") v = 0.3 + sr() * 0.15 + i * 0.005;
      else if (trend === "balanced") v = 0.5 + Math.sin(i/3) * 0.15 + sr()*0.08;
      else if (trend === "rising") v = 0.6 + i * 0.012 + sr() * 0.06;
      else v = 0.5 + sr()*0.2;
      pts.push(v);
    }
    addChart(new Chart(canvas, {
      type: "line",
      data: { labels: pts.map((_,i)=>i), datasets: [{ data: pts, borderColor: "#00c2a8", backgroundColor: "rgba(0,194,168,0.2)", fill: true, tension: 0.35, pointRadius: 0, borderWidth: 1.5 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false, min: 0 } }
      }
    }));
  });

  // ΔV heat map (208 cells SYS-A) — real BMS-derivable: Cell V minus Rack Avg V
  const dv = $("#dvHeat");
  const sysAMean = mean(sysA.map(c => c.v));
  const dvHtml = sysA.map(c => {
    const deltaMV = (c.v - sysAMean) * 1000;     // signed mV deviation
    const abs = Math.abs(deltaMV);
    // Color: 0 mV = green (140), 15 mV = amber (40), 25+ mV = red (0)
    let hue;
    if (abs < 5)       hue = 140;                // healthy
    else if (abs < 15) hue = 140 - (abs - 5) * 10;  // 140 → 40 (amber)
    else               hue = Math.max(0, 40 - (abs - 15) * 4);  // 40 → 0 (red)
    const sign = deltaMV >= 0 ? "+" : "";
    return `<div class="heat-cell" style="background:hsl(${hue},70%,55%)"
              title="Cell #${c.idx} · V=${c.v.toFixed(3)}V · ΔV=${sign}${deltaMV.toFixed(1)} mV">${sign}${deltaMV.toFixed(0)}</div>`;
  }).join("");
  dv.innerHTML = dvHtml;
}

function prognosticIndicator(label, value, threshold, unit, trend, higherIsBetter = false) {
  const ratio = value / threshold;
  const ok = higherIsBetter ? ratio >= 1 : ratio <= 0.6;
  const warn = higherIsBetter ? ratio >= 0.7 && ratio < 1 : ratio > 0.6 && ratio <= 0.85;
  const status = ok ? t("an.ind.statusOk") : warn ? t("an.ind.statusWatch") : t("an.ind.statusWarn");
  const color = ok ? "var(--green)" : warn ? "var(--amber)" : "var(--red)";
  const seed = label.charCodeAt(0) + label.charCodeAt(1);
  return `
    <div class="prog-card">
      <div class="prog-top">
        <span class="prog-label">${label}</span>
        <span class="tag ${ok?'ok':warn?'warn':'err'}" style="font-size:10.5px">${status}</span>
      </div>
      <div class="prog-val" style="color:${color}">${value} <span class="prog-unit">${unit}</span></div>
      <div class="prog-spark-wrap"><canvas class="prog-spark" data-trend="${trend}" data-seed="${seed}"></canvas></div>
      <div class="prog-foot muted">${t("an.ind.thresh")} ${higherIsBetter ? "≥" : "≤"} ${threshold} ${unit}</div>
    </div>
  `;
}

function renderSysCard(sys) {
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>${sys.id} · ${sys.pcsKW} kW / ${sys.batteryKWh} kWh</h3>
          <div class="muted" style="font-size:12px; margin-top:2px">${sys.vendor} · ${t("dev.sys.subtitle")}</div>
        </div>
        <span class="tag ok">${t("dev.sys.running")}</span>
      </div>
      <div class="grid g-3" style="gap:10px">
        <div>
          <div class="muted" style="font-size:12px">SoC</div>
          <div class="soc-gauge">
            <div class="val" style="color:var(--green)">${sys.soc}%</div>
          </div>
          <div class="pbar mt-8"><span style="width:${sys.soc}%"></span></div>
        </div>
        <div>
          <div class="muted" style="font-size:12px">${t("dev.sys.power")}</div>
          <div class="val" style="font-size:20px;font-weight:700;color:var(--ess-teal)">+${Math.round(sys.pcsKW*0.94)} <span style="font-size:12px;color:var(--text-muted)">kW</span></div>
          <div class="muted mt-8" style="font-size:11.5px">${t("dev.sys.disArb")}</div>
        </div>
        <div>
          <div class="muted" style="font-size:12px">${t("dev.sys.cellTemp")}</div>
          <div class="val" style="font-size:20px;font-weight:700">${sys.temp}<span style="font-size:12px;color:var(--text-muted)"> °C</span></div>
          <div class="muted mt-8" style="font-size:11.5px">${t("dev.sys.deltaNormal")}</div>
        </div>
      </div>
      <div class="chart-wrap short mt-16"><canvas id="sysch-${sys.id}"></canvas></div>
    </div>
  `;
}

// ────────── 4. Schedule ──────────
function viewSchedule() {
  const s = STRATEGIES[state.strategy];
  const plan = Array.from({length:24}, (_,h) => ({ h, ...planFor(state.strategy, h) }));
  const benefit = estimateBenefit(state.strategy);

  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${t("page.sch.title")}</h1>
        <p class="page-sub">${t("card.activeStrategy")}: <strong style="color:${s.color}">${t(`strat.${s.id}.full`)}</strong> · ${t(`strat.${s.id}.desc`)}</p>
      </div>
      <div class="page-actions">
        <button class="btn">${t("btn.today")}</button>
        <button class="btn btn-ghost">${t("btn.tomorrow")}</button>
        <button class="btn btn-primary">${t("btn.activate")}</button>
      </div>
    </div>

    ${state.strategy === "aiAdvisory" ? `
    <div class="card mb-16" style="border:1px solid rgba(139,92,246,0.4);background:linear-gradient(90deg,rgba(139,92,246,0.08),rgba(139,92,246,0.02))">
      <div class="row" style="gap:14px;flex-wrap:wrap">
        <div style="font-size:28px">🤖</div>
        <div style="flex:1;min-width:280px">
          <div style="font-size:14px;font-weight:700">AI 動態建議模式 · 已套用 3 處變更（高亮 🤖 標記）</div>
          <div class="muted" style="font-size:12px;margin-top:4px;line-height:1.6">
            與時間套利基線相比：
            <strong style="color:var(--purple)">17:00 預充 −50 kW</strong>（避免 19:00 SoC 不足）·
            <strong style="color:var(--purple)">19:00–20:00 加碼放電 +10 kW</strong>（削峰）<br>
            預估比基線多賺 <strong style="color:var(--green)">~$1,150 / 日</strong>。可逐格檢視、編輯、或回退到基線策略。
          </div>
        </div>
        <button class="btn" id="rollbackToBaseline">↩ 回退到時間套利基線</button>
      </div>
    </div>` : ''}

    <div class="card mb-16">
      <div class="card-head">
        <h3>運行策略</h3>
        <span class="muted" style="font-size:12px">點選即時切換</span>
      </div>
      <div class="chip-row mb-12" id="chipRow">
        ${Object.values(STRATEGIES).map(x => `
          <div class="chip ${state.strategy === x.id ? "active" : ""}" data-strategy="${x.id}" style="${state.strategy===x.id?`border-color:${x.color};color:${x.color};background:${x.color}1a`:""}">${x.full}</div>
        `).join("")}
      </div>
      <div class="strategy-info" style="background:${s.color}10;border-left:3px solid ${s.color};padding:10px 14px;border-radius:6px;margin-top:12px;font-size:12.5px">
        <span class="muted">收益模式：</span><strong>${s.benefit}</strong>
        <span class="muted">　約束條件：</span>${s.constraint}
      </div>
      <div class="grid g-3 mt-16">
        <div class="form-row">
          <label>目標 SoC 上限</label>
          <input class="inp" value="90%" />
        </div>
        <div class="form-row">
          <label>目標 SoC 下限</label>
          <input class="inp" value="15%" />
        </div>
        <div class="form-row">
          <label>每日循環上限</label>
          <input class="inp" value="1 次 / 日" />
        </div>
        <div class="form-row">
          <label>最大充電功率</label>
          <input class="inp" value="180 kW" />
        </div>
        <div class="form-row">
          <label>最大放電功率</label>
          <input class="inp" value="225 kW" />
        </div>
        <div class="form-row">
          <label>削峰目標</label>
          <input class="inp" value="2,300 kW" />
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-head">
        <h3>24 小時排程 (2026-04-25 · ${s.label})</h3>
        <div class="row">
          <span class="tag ok">◼ 充電</span>
          <span class="tag err">◼ 放電</span>
          <span class="tag mute">◼ 待機</span>
          ${Object.keys(state.scheduleOverride).length>0?`<span class="tag warn">已修改 ${Object.keys(state.scheduleOverride).length} 格</span>`:""}
        </div>
      </div>

      <!-- Edit toolbar -->
      <div class="edit-toolbar mb-12">
        <span class="muted" style="font-size:12px">編輯工具：</span>
        <button class="tool-btn ${state.editTool==='auto'?'active':''}" data-tool="auto"><span class="dot dot-idle"></span>策略預設</button>
        <button class="tool-btn ${state.editTool==='charge'?'active':''}" data-tool="charge" style="--c:#10b981"><span class="dot" style="background:#10b981"></span>充電</button>
        <button class="tool-btn ${state.editTool==='discharge'?'active':''}" data-tool="discharge" style="--c:#ef4444"><span class="dot" style="background:#ef4444"></span>放電</button>
        <button class="tool-btn ${state.editTool==='idle'?'active':''}" data-tool="idle"><span class="dot dot-idle"></span>待機</button>
        <span class="muted" style="font-size:11.5px;margin-left:8px">點擊套用 · 拖曳多格 · <strong>雙擊</strong>編輯精細 kW</span>
        <button class="btn btn-ghost" id="resetEdits" style="margin-left:auto;font-size:12px;padding:5px 12px" ${Object.keys(state.scheduleOverride).length===0?"disabled":""}>重置編輯</button>
      </div>

      <div class="sched-grid" id="sched"></div>
      <div class="hour-axis">${Array.from({length:24}, (_,i)=>`<span>${String(i).padStart(2,"0")}</span>`).join("")}</div>

      <div class="chart-wrap mt-16"><canvas id="schedChart"></canvas></div>
    </div>

    <div class="grid g-2 mt-16">
      <div class="card">
        <div class="card-head"><h3>時間電價 (NT$/度)</h3></div>
        <table class="data">
          <thead><tr><th>時段</th><th>適用時間</th><th class="right">夏月單價</th></tr></thead>
          <tbody>
            <tr><td><span class="tag err">尖峰</span></td><td>週一至五 16:00–22:00</td><td class="num right">8.05</td></tr>
            <tr><td><span class="tag warn">半尖峰</span></td><td>09:00–16:00 / 22:00–24:00</td><td class="num right">5.02</td></tr>
            <tr><td><span class="tag ok">離峰</span></td><td>00:00–09:00 / 假日</td><td class="num right">2.18</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>${s.label}今日效益試算</h3>
          <span class="tag" style="background:rgba(139,92,246,0.12);color:var(--purple);font-size:11px">η AI 動態</span>
        </div>
        <table class="data">
          <tr><td>充電電量</td><td class="num right">${fmt(benefit.chargeKWh)} kWh</td><td class="num right">支出 ${money(benefit.chargeCost)}</td></tr>
          <tr><td>放電電量 (含 ${effSurface(29.4, 0.42).toFixed(1)}% 動態效率)</td><td class="num right">${fmt(benefit.dischargeKWh)} kWh</td><td class="num right">收益 ${money(benefit.dischargeRev)}</td></tr>
          <tr><td>循環次數</td><td class="num right">${(benefit.dischargeKWh/476).toFixed(2)} 次</td><td class="num right">-</td></tr>
          <tr><td><strong>淨益</strong></td><td colspan="2" class="num right"><strong style="color:${benefit.net>=0?"var(--green)":"var(--red)"};font-size:16px">${money(benefit.net)}</strong></td></tr>
        </table>

        <!-- η AI 動態效率 surface -->
        <div class="mt-12" style="padding:10px 12px;background:rgba(139,92,246,0.06);border-left:3px solid var(--purple);border-radius:6px">
          <div class="row between" style="margin-bottom:6px">
            <strong style="font-size:12.5px">🤖 AI 動態效率模型</strong>
            <span class="muted" style="font-size:11px">採樣 1,420 次循環</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:11.5px;margin-bottom:8px">
            <div><span class="muted">電芯溫</span><strong style="color:var(--text);margin-left:4px">29.4°C</strong></div>
            <div><span class="muted">SoC</span><strong style="color:var(--text);margin-left:4px">${KPI.soc}%</strong></div>
            <div><span class="muted">C-rate</span><strong style="color:var(--text);margin-left:4px">0.42</strong></div>
          </div>
          <!-- mini efficiency surface heatmap (5 cols × 4 rows: temp 20/25/30/35/40 × C-rate 0.2/0.4/0.6/0.8) -->
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1px;font-size:8px;color:rgba(0,0,0,0.7);font-weight:600">
            ${[0.2, 0.4, 0.6, 0.8].flatMap(c => [20,25,30,35,40].map(t => {
              const e = effSurface(t, c);
              const isActive = (Math.abs(t - 29.4) < 3) && (Math.abs(c - 0.42) < 0.1);
              const hue = (e - 80) / 14 * 140;        // 80% → 0(red), 94% → 140(green)
              return `<div style="background:hsl(${hue},70%,50%);padding:3px 0;text-align:center;${isActive?'outline:2px solid #fff;z-index:2;position:relative;':''}" title="${t}°C @ ${c}C → ${e.toFixed(1)}%">${e.toFixed(0)}</div>`;
            })).join("")}
          </div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1px;font-size:9px;color:var(--muted);text-align:center;margin-top:2px">
            <div>20°C</div><div>25°C</div><div>30°C</div><div>35°C</div><div>40°C</div>
          </div>
          <div class="muted mt-8" style="font-size:11px">效率隨溫度 + C-rate 非線性變化；綠=高/紅=低；白框=當前工況</div>
        </div>

        <div class="muted mt-8" style="font-size:11.5px">※ 模擬試算，未含輔助服務 / 容量費收入</div>
      </div>
    </div>
  `;

  // Rollback button (only present in AI advisory mode)
  $("#rollbackToBaseline")?.addEventListener("click", () => {
    setStrategy("arbitrage");
  });

  // Wire chip click
  $("#chipRow").querySelectorAll(".chip").forEach(el => {
    el.addEventListener("click", () => setStrategy(el.dataset.strategy));
  });

  // Wire tool buttons
  $$(".tool-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.editTool = btn.dataset.tool;
      $$(".tool-btn").forEach(b => b.classList.toggle("active", b.dataset.tool === state.editTool));
    });
  });

  // Reset edits
  $("#resetEdits").addEventListener("click", () => {
    state.scheduleOverride = {};
    showToast("已清除自訂排程", "ok");
    router();
  });

  // 啟用排程
  $$(".page-actions .btn-primary").forEach(btn => {
    if (btn.textContent.trim() === "啟用排程") {
      btn.addEventListener("click", () => {
        const editCount = Object.keys(state.scheduleOverride).length;
        showToast(`已下傳排程到 PCS 控制器${editCount?` (含 ${editCount} 格自訂)`:""}`, "ok", 4000);
      });
    }
  });

  // Render schedule cells (event delegation handles clicks/drag)
  // When showing aiAdvisory, also compare each cell with arbitrage baseline
  // and add a 🤖 marker on cells that AI changed.
  const renderCells = () => {
    const cells = Array.from({length:24}, (_,h) => ({ h, ...planFor(state.strategy, h) }));
    const isAi = state.strategy === "aiAdvisory";
    $("#sched").innerHTML = cells.map(p => {
      const price = tariffOf(p.h).price;
      const edited = state.scheduleOverride[p.h] !== undefined;
      // AI diff: compare with arbitrage baseline (the "default" reference)
      let aiDiff = false, baseLabel = "";
      if (isAi) {
        const base = _planForStrategy("arbitrage", p.h);
        if (base.mode !== p.mode || base.kw !== p.kw) {
          aiDiff = true;
          baseLabel = ` · 基線: ${base.mode === "idle" ? "待機" : base.kw + " kW"}`;
        }
      }
      return `<div class="sched-cell ${p.mode} ${edited?'edited':''} ${aiDiff?'ai-changed':''}" data-h="${p.h}"
                   title="${p.h}:00 · ${p.mode} · ${p.kw} kW · 電價 NT$${price}${edited?' · 已修改':''}${baseLabel}">
        <span class="lbl">${p.label || ""}</span>
        ${edited ? '<span class="edit-mark"></span>' : ''}
        ${aiDiff ? '<span class="ai-mark">🤖</span>' : ''}
      </div>`;
    }).join("");
  };

  function applyTool(h) {
    if (state.editTool === "auto") {
      delete state.scheduleOverride[h];
    } else if (state.editTool === "charge") {
      state.scheduleOverride[h] = { mode: "charge", kw: -180, label: "充" };
    } else if (state.editTool === "discharge") {
      state.scheduleOverride[h] = { mode: "discharge", kw: 215, label: "放" };
    } else if (state.editTool === "idle") {
      state.scheduleOverride[h] = { mode: "idle", kw: 0, label: "" };
    }
    refreshScheduleView();
  }

  // Per-cell precision editor (double-click to open)
  function openCellEditor(h) {
    const current = planFor(state.strategy, h);
    const tar = tariffOf(h);
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div>
            <div class="modal-title">編輯 ${String(h).padStart(2,"0")}:00 – ${String(h+1).padStart(2,"0")}:00 排程</div>
            <div class="modal-sub">電價 <strong>NT$${tar.price.toFixed(2)}/度</strong> · ${tar.label}</div>
          </div>
          <button class="modal-close" id="cellClose" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="form-row mb-16">
            <label>運行模式</label>
            <div class="chip-row" id="cellModeRow">
              <div class="chip" data-mode="charge"><span class="dot" style="background:#10b981;margin-right:6px"></span>充電</div>
              <div class="chip" data-mode="discharge"><span class="dot" style="background:#ef4444;margin-right:6px"></span>放電</div>
              <div class="chip" data-mode="idle"><span class="dot dot-idle" style="margin-right:6px"></span>待機</div>
            </div>
          </div>
          <div class="form-row mb-16" id="cellKwGroup">
            <label>功率大小 <span class="muted" id="cellKwLabel">kW</span></label>
            <input type="range" class="kw-range" min="0" max="225" step="5" id="cellKwRange">
            <div class="kw-row">
              <input class="inp num" type="number" id="cellKwInput" min="0" max="225" step="5" style="width:100px">
              <span class="muted">kW</span>
              <span class="muted" style="margin-left:auto;font-size:11.5px">最大 225 kW (PCS 合計)</span>
            </div>
            <div class="kw-presets">
              <button class="btn-mini" data-kw="50">50</button>
              <button class="btn-mini" data-kw="100">100</button>
              <button class="btn-mini" data-kw="150">150</button>
              <button class="btn-mini" data-kw="180">180</button>
              <button class="btn-mini" data-kw="215">215</button>
              <button class="btn-mini" data-kw="225">225 (滿)</button>
            </div>
          </div>
          <div class="form-row">
            <label>標籤 (選填，最多 6 字)</label>
            <input class="inp" id="cellLabel" placeholder="例：充, 放, sReg" maxlength="6">
          </div>
          <div class="modal-hint">
            預估該小時${current.mode==="discharge"?"收益":current.mode==="charge"?"成本":"影響"} <strong id="cellEst">—</strong>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn" id="cellRevert">還原為策略預設</button>
          <div style="flex:1"></div>
          <button class="btn" id="cellCancel">取消</button>
          <button class="btn btn-primary" id="cellSave">儲存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let editMode = current.mode;
    const range = overlay.querySelector("#cellKwRange");
    const input = overlay.querySelector("#cellKwInput");
    const labelI = overlay.querySelector("#cellLabel");
    const kwGrp = overlay.querySelector("#cellKwGroup");
    const kwLbl = overlay.querySelector("#cellKwLabel");
    const estEl = overlay.querySelector("#cellEst");

    const setMode = (m) => {
      editMode = m;
      overlay.querySelectorAll("#cellModeRow .chip").forEach(c => {
        const a = c.dataset.mode === m;
        c.classList.toggle("active", a);
        c.style.borderColor = a && m==="charge" ? "#10b981" : a && m==="discharge" ? "#ef4444" : "";
        c.style.color       = a && m==="charge" ? "#10b981" : a && m==="discharge" ? "#ef4444" : "";
        c.style.background  = a && m==="charge" ? "rgba(16,185,129,0.1)" : a && m==="discharge" ? "rgba(239,68,68,0.1)" : "";
      });
      kwGrp.style.opacity = m === "idle" ? "0.4" : "1";
      kwGrp.style.pointerEvents = m === "idle" ? "none" : "auto";
      kwLbl.textContent = m === "charge" ? "(離峰充電 - 從電網吸收)" : m === "discharge" ? "(放電輸出 - 供應負載)" : "kW";
      updateEst();
    };
    const updateEst = () => {
      const kw = +input.value || 0;
      if (editMode === "idle" || kw === 0) { estEl.textContent = "—"; estEl.style.color = ""; return; }
      const v = kw * tar.price;
      if (editMode === "discharge") {
        estEl.textContent = `+${money(v * 0.918)} (含 91.8% 效率)`;
        estEl.style.color = "var(--green)";
      } else {
        estEl.textContent = `-${money(v)} (充電成本)`;
        estEl.style.color = "var(--red)";
      }
    };

    // Init values
    setMode(current.mode);
    const initKw = Math.abs(current.kw);
    range.value = initKw; input.value = initKw;
    labelI.value = current.label || "";

    // Bindings
    range.addEventListener("input", () => { input.value = range.value; updateEst(); });
    input.addEventListener("input", () => { range.value = Math.min(225, Math.max(0, +input.value || 0)); updateEst(); });
    overlay.querySelectorAll("#cellModeRow .chip").forEach(c => {
      c.addEventListener("click", () => setMode(c.dataset.mode));
    });
    overlay.querySelectorAll(".btn-mini").forEach(b => {
      b.addEventListener("click", () => { input.value = b.dataset.kw; range.value = b.dataset.kw; updateEst(); });
    });

    // Close
    const close = () => { overlay.remove(); document.removeEventListener("keydown", escHandler); };
    function escHandler(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", escHandler);
    overlay.querySelector("#cellClose").addEventListener("click", close);
    overlay.querySelector("#cellCancel").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    // Save
    overlay.querySelector("#cellSave").addEventListener("click", () => {
      const kw = Math.min(225, Math.max(0, +input.value || 0));
      const lbl = labelI.value.trim();
      if (editMode === "idle" || kw === 0) {
        state.scheduleOverride[h] = { mode: "idle", kw: 0, label: lbl || "" };
      } else if (editMode === "charge") {
        state.scheduleOverride[h] = { mode: "charge", kw: -kw, label: lbl || "充" };
      } else {
        state.scheduleOverride[h] = { mode: "discharge", kw: kw, label: lbl || "放" };
      }
      refreshScheduleView();
      const summary = editMode === "idle" ? "待機" : `${editMode === "charge" ? "充" : "放"} ${kw} kW`;
      showToast(`${String(h).padStart(2,"0")}:00 已更新：${summary}`, "ok");
      close();
    });

    // Revert
    overlay.querySelector("#cellRevert").addEventListener("click", () => {
      delete state.scheduleOverride[h];
      refreshScheduleView();
      showToast(`${String(h).padStart(2,"0")}:00 已還原為策略預設`, "info");
      close();
    });
  }

  function refreshScheduleView() {
    renderCells();
    // refresh chart data
    const chart = Chart.getChart("schedChart");
    if (chart) {
      const newPlan = Array.from({length:24}, (_,h) => planFor(state.strategy, h));
      chart.data.datasets[0].data = newPlan.map(p => p.kw);
      chart.data.datasets[0].backgroundColor = newPlan.map(p => p.mode==="charge" ? "rgba(16,185,129,0.5)" : p.mode==="discharge" ? "rgba(239,68,68,0.55)" : "rgba(139,152,176,0.2)");
      chart.data.datasets[0].borderColor = newPlan.map(p => p.mode==="charge" ? "#10b981" : p.mode==="discharge" ? "#ef4444" : "#8b98b0");
      chart.update("none");
    }
    // refresh benefit table
    const b = estimateBenefit(state.strategy);
    const tbl = document.querySelector(".grid.g-2 .card:last-child table.data");
    if (tbl) {
      tbl.innerHTML = `
        <tr><td>充電電量</td><td class="num right">${fmt(b.chargeKWh)} kWh</td><td class="num right">支出 ${money(b.chargeCost)}</td></tr>
        <tr><td>放電電量 (含 91.8% 效率)</td><td class="num right">${fmt(b.dischargeKWh)} kWh</td><td class="num right">收益 ${money(b.dischargeRev)}</td></tr>
        <tr><td>循環次數</td><td class="num right">${(b.dischargeKWh/476).toFixed(2)} 次</td><td class="num right">-</td></tr>
        <tr><td><strong>淨益</strong></td><td colspan="2" class="num right"><strong style="color:${b.net>=0?"var(--green)":"var(--red)"};font-size:16px">${money(b.net)}</strong></td></tr>
      `;
    }
    // refresh badge
    const editCount = Object.keys(state.scheduleOverride).length;
    const tagsRow = document.querySelector(".card-head .row");
    if (tagsRow) {
      tagsRow.querySelector(".tag.warn")?.remove();
      if (editCount > 0) tagsRow.insertAdjacentHTML("beforeend", `<span class="tag warn">已修改 ${editCount} 格</span>`);
    }
    const resetBtn = $("#resetEdits");
    if (resetBtn) resetBtn.disabled = editCount === 0;
  }

  renderCells();

  // ── Drag-select on schedule grid (mouse + touch) ──
  const grid = $("#sched");
  let dragging = false;
  let lastH = null;
  let dragStarted = false;

  const applyToCell = (cell) => {
    if (!cell || cell.dataset.h === undefined) return;
    const h = +cell.dataset.h;
    if (h === lastH) return;        // dedupe consecutive same-cell hits
    lastH = h;
    dragStarted = true;
    applyTool(h);
  };

  grid.addEventListener("mousedown", (e) => {
    const cell = e.target.closest(".sched-cell");
    if (!cell) return;
    e.preventDefault();
    dragging = true; lastH = null; dragStarted = false;
    applyToCell(cell);
  });
  grid.addEventListener("mouseover", (e) => {
    if (!dragging) return;
    applyToCell(e.target.closest(".sched-cell"));
  });

  // Double-click → open precision editor
  grid.addEventListener("dblclick", (e) => {
    const cell = e.target.closest(".sched-cell");
    if (!cell) return;
    e.preventDefault();
    openCellEditor(+cell.dataset.h);
  });
  document.addEventListener("mouseup", () => {
    if (dragStarted && state.editTool !== "auto") {
      const n = Object.keys(state.scheduleOverride).length;
      const tip = state.editTool === "charge" ? "充電" : state.editTool === "discharge" ? "放電" : "待機";
      showToast(`已套用 ${tip} (共 ${n} 格自訂)`, "info", 1800);
    }
    dragging = false; lastH = null; dragStarted = false;
  });

  // Touch drag (mobile)
  grid.addEventListener("touchstart", (e) => {
    const cell = e.target.closest(".sched-cell");
    if (!cell) return;
    e.preventDefault();
    dragging = true; lastH = null; dragStarted = false;
    applyToCell(cell);
  }, { passive: false });
  grid.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    e.preventDefault();
    const t = e.touches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    applyToCell(el?.closest(".sched-cell"));
  }, { passive: false });
  document.addEventListener("touchend", () => {
    dragging = false; lastH = null; dragStarted = false;
  });

  // schedule chart
  const labels = Array.from({length:24}, (_,i)=>`${String(i).padStart(2,"0")}:00`);
  addChart(new Chart($("#schedChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "排程功率 (kW)", data: plan.map(p=>p.kw),
          backgroundColor: plan.map(p => p.mode==="charge" ? "rgba(16,185,129,0.5)" : p.mode==="discharge" ? "rgba(239,68,68,0.55)" : "rgba(139,152,176,0.2)"),
          borderColor: plan.map(p => p.mode==="charge" ? "#10b981" : p.mode==="discharge" ? "#ef4444" : "#8b98b0"),
          borderWidth: 1
        },
        { label: "電價 (NT$/度)", data: labels.map((_,h)=>tariffOf(h).price),
          type: "line", yAxisID: "y1", borderColor: "#fbbf24", backgroundColor: "rgba(251,191,36,0.1)",
          tension: 0, pointRadius: 0, borderWidth: 1.5, stepped: true }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
      scales: {
        y: { title: { display: true, text: "kW" }, grid: { color: "rgba(139,152,176,0.08)" } },
        y1: { position: "right", title: { display: true, text: "NT$/度" }, grid: { display: false }, min: 0, max: 10 }
      }
    }
  }));
}

// ────────── 5. Tariff editor ──────────
function viewTariff() {
  // Working copy (mutated by edits in this view)
  if (!state.tariffDraft) state.tariffDraft = JSON.parse(JSON.stringify(TARIFF_PLAN));
  const tp = state.tariffDraft;
  const PERIOD_META = {
    P: { label: t("tar.period.P"), color: "#ef4444", bg: "rgba(239,68,68,0.55)"  },
    M: { label: t("tar.period.M"), color: "#f59e0b", bg: "rgba(245,158,11,0.45)" },
    O: { label: t("tar.period.O"), color: "#10b981", bg: "rgba(16,185,129,0.35)" },
  };
  const days = [1,2,3,4,5,6,7].map(n => t(`tar.day.${n}`));
  // Localized labels for basic charge categories (data layer keeps zh keys)
  const BASIC_LABEL = {
    routine:    t("tar.basic.routine"),
    midPeak:    t("tar.basic.midPeak"),
    satMidPeak: t("tar.basic.satMidPeak"),
    offPeak:    t("tar.basic.offPeak"),
  };

  // Compute monthly bill estimate from current grid + dailyBalance
  const bal = dailyBalance(state.strategy);
  const dailyByPeriod = { P: 0, M: 0, O: 0 };
  // Distribute the day's gridImport (kWh) across hours weighted by typical load curve
  const hrLoad = gen24h(state.strategy).reduce((acc, p) => {
    const hr = Math.floor(p.t);
    acc[hr] = (acc[hr] || 0) + Math.max(0, p.grid) * 0.25;
    return acc;
  }, {});
  for (let h = 0; h < 24; h++) {
    const t = tp.grid[0][h]; // weekday baseline
    dailyByPeriod[t] += hrLoad[h] || 0;
  }
  const monthlyByPeriod = {
    P: Math.round(dailyByPeriod.P * 22),
    M: Math.round(dailyByPeriod.M * 26),
    O: Math.round(dailyByPeriod.O * 30),
  };
  const energyCost =
    monthlyByPeriod.P * tp.prices.P +
    monthlyByPeriod.M * tp.prices.M +
    monthlyByPeriod.O * tp.prices.O;
  const peakDemand = 5131; // demo value
  const basicCost = peakDemand * tp.basicCharges.routine.ratePerKW;
  const totalCost = energyCost + basicCost;
  const overPct = ((peakDemand - SITE.contractKW) / SITE.contractKW * 100);
  const penalty = overPct > 0
    ? (overPct <= 10
        ? (peakDemand - SITE.contractKW) * tp.basicCharges.routine.ratePerKW * tp.overContractPenalty.withinMultiplier
        : SITE.contractKW * 0.1 * tp.basicCharges.routine.ratePerKW * tp.overContractPenalty.withinMultiplier
          + (peakDemand - SITE.contractKW * 1.1) * tp.basicCharges.routine.ratePerKW * tp.overContractPenalty.aboveMultiplier)
    : 0;

  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${t("page.tar.title")}</h1>
        <p class="page-sub">${t("page.tar.sub")}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" id="tariffReset">${t("tar.btn.reset")}</button>
        <button class="btn">${t("tar.btn.add")}</button>
        <button class="btn btn-primary" id="tariffSave">${t("tar.btn.save")}</button>
      </div>
    </div>

    <!-- 1. Plan selector -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>${t("tar.planSelect")}</h3>
        <span class="muted" style="font-size:11.5px">${t("tar.effectiveFrom").replace("{d}", tp.effectiveFrom)}</span>
      </div>
      <div class="row" style="gap:14px;flex-wrap:wrap">
        <select class="inp" style="min-width:280px">
          <option>${tp.name}</option>
          <option>${t("tar.option.tpc3w")}</option>
          <option>${t("tar.option.tpc2")}</option>
          <option>${t("tar.option.lv")}</option>
          <option>${t("tar.option.add")}</option>
        </select>
        <div class="row" style="gap:6px">
          <button class="btn btn-ghost" style="font-size:12px">${t("tar.copyCurrent")}</button>
          <button class="btn btn-ghost" style="font-size:12px">${t("tar.exportJson")}</button>
        </div>
      </div>
    </div>

    <!-- 2. 24h × 7day heat map -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>${t("tar.timeViz")}</h3>
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <span class="muted" style="font-size:11.5px">${t("tar.brush")}：</span>
          <button class="tariff-tool active" data-tool="P" style="--c:#ef4444"><span class="dot" style="background:#ef4444"></span>${t("tar.period.P")}</button>
          <button class="tariff-tool" data-tool="M" style="--c:#f59e0b"><span class="dot" style="background:#f59e0b"></span>${t("tar.period.M")}</button>
          <button class="tariff-tool" data-tool="O" style="--c:#10b981"><span class="dot" style="background:#10b981"></span>${t("tar.period.O")}</button>
          <button class="btn btn-ghost" id="tariffUndo" style="margin-left:12px;font-size:12px;padding:5px 12px" disabled>${t("tar.undo")}</button>
        </div>
      </div>
      <div class="tariff-grid-wrap">
        <div class="tariff-hour-axis">
          <div></div>${Array.from({length:24}, (_,h)=>`<div>${String(h).padStart(2,"0")}</div>`).join("")}
        </div>
        ${days.map((dn, di) => `
          <div class="tariff-row">
            <div class="tariff-day">${dn}</div>
            ${tp.grid[di].map((p, h) => `
              <div class="tariff-cell" data-day="${di}" data-hour="${h}"
                   style="background:${PERIOD_META[p].bg}" title="${dn} ${String(h).padStart(2,"0")}:00 · ${PERIOD_META[p].label}">${PERIOD_META[p].label[0]}</div>
            `).join("")}
          </div>
        `).join("")}
      </div>
      <div class="muted mt-12" style="font-size:11.5px">${t("tar.heatHint")}</div>
    </div>

    <!-- 3 & 4. Prices + basic charges -->
    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-head"><h3>${t("tar.flowPrice")}</h3></div>
        <table class="data">
          <tr><td><span class="tag err">${t("tar.period.P")}</span></td>
              <td><input class="inp tariff-price" data-key="P" type="number" step="0.01" value="${tp.prices.P}" style="width:100px"> NT$</td></tr>
          <tr><td><span class="tag warn">${t("tar.period.M")}</span></td>
              <td><input class="inp tariff-price" data-key="M" type="number" step="0.01" value="${tp.prices.M}" style="width:100px"> NT$</td></tr>
          <tr><td><span class="tag ok">${t("tar.period.O")}</span></td>
              <td><input class="inp tariff-price" data-key="O" type="number" step="0.01" value="${tp.prices.O}" style="width:100px"> NT$</td></tr>
        </table>
        <div class="muted mt-8" style="font-size:11.5px">${t("tar.peakSpread")}：NT$ ${(tp.prices.P - tp.prices.O).toFixed(2)}/${t("tar.kWh")}（${t("tar.arbHint")}）</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${t("tar.basicCharge")}</h3></div>
        <table class="data">
          ${Object.entries(tp.basicCharges).map(([k,b]) => `
            <tr>
              <td>${BASIC_LABEL[k] || b.label}</td>
              <td><input class="inp tariff-basic" data-key="${k}" type="number" step="0.1" value="${b.ratePerKW}" style="width:100px"> ${t("tar.unitNTPerKwMo")}</td>
            </tr>`).join("")}
        </table>
        <div class="muted mt-8" style="font-size:11.5px">${t("tar.overRule").replace("{a}", tp.overContractPenalty.withinMultiplier).replace("{b}", tp.overContractPenalty.aboveMultiplier)}</div>
      </div>
    </div>

    <!-- 5. Monthly estimate -->
    <div class="card">
      <div class="card-head">
        <h3>${t("tar.monthlyEst")}（${t("tar.byStrategy")} ${STRATEGIES[state.strategy].label}）</h3>
        <span class="tag ${overPct>0?"warn":"ok"}">${overPct>0?t("tar.overByPct").replace("{p}", overPct.toFixed(1)):t("tar.notOver")}</span>
      </div>
      <table class="data">
        <thead><tr><th>${t("tar.thItem")}</th><th class="right">${t("tar.thUsage")}</th><th class="right">${t("tar.thUnitPrice")}</th><th class="right">${t("tar.thSubtotal")}</th></tr></thead>
        <tbody>
          <tr><td><span class="tag err">${t("tar.period.P")}</span> ${t("tar.flowItem")}</td>
              <td class="num right">${fmt(monthlyByPeriod.P)} ${t("tar.kWh")}</td>
              <td class="num right">$${tp.prices.P.toFixed(2)}</td>
              <td class="num right">${money(monthlyByPeriod.P*tp.prices.P)}</td></tr>
          <tr><td><span class="tag warn">${t("tar.period.M")}</span> ${t("tar.flowItem")}</td>
              <td class="num right">${fmt(monthlyByPeriod.M)} ${t("tar.kWh")}</td>
              <td class="num right">$${tp.prices.M.toFixed(2)}</td>
              <td class="num right">${money(monthlyByPeriod.M*tp.prices.M)}</td></tr>
          <tr><td><span class="tag ok">${t("tar.period.O")}</span> ${t("tar.flowItem")}</td>
              <td class="num right">${fmt(monthlyByPeriod.O)} ${t("tar.kWh")}</td>
              <td class="num right">$${tp.prices.O.toFixed(2)}</td>
              <td class="num right">${money(monthlyByPeriod.O*tp.prices.O)}</td></tr>
          <tr><td>${t("tar.basicItem")}</td>
              <td class="num right">${fmt(peakDemand)} kW</td>
              <td class="num right">$${tp.basicCharges.routine.ratePerKW.toFixed(1)}</td>
              <td class="num right">${money(basicCost)}</td></tr>
          ${penalty > 0 ? `<tr style="background:rgba(239,68,68,0.05)">
            <td><span class="tag err">${t("tar.overPenalty")}</span></td>
            <td class="num right">${overPct.toFixed(1)}%</td>
            <td class="num right">${tp.overContractPenalty.withinMultiplier}${t("tar.basicTimes")}</td>
            <td class="num right" style="color:var(--red)">${money(penalty)}</td>
          </tr>` : ""}
          <tr style="background:rgba(0,194,168,0.06)">
            <td class="strong">${t("tar.totalMonthly")}</td>
            <td colspan="2" class="num right muted">${t("tar.includes").replace("{b}", money(basicCost)).replace("{e}", money(energyCost))}${penalty>0?` ${t("tar.plusPenalty").replace("{p}", money(penalty))}`:""}</td>
            <td class="num right strong" style="font-size:18px;color:var(--primary)">${money(totalCost+penalty)}</td>
          </tr>
        </tbody>
      </table>
      <div class="muted mt-8" style="font-size:11.5px">${t("tar.estFoot")}</div>
    </div>
  `;

  // ── Wire interactions ──
  let activeTool = 'P';
  $$(".tariff-tool").forEach(b => {
    b.addEventListener("click", () => {
      activeTool = b.dataset.tool;
      $$(".tariff-tool").forEach(x => x.classList.toggle("active", x === b));
    });
  });

  // Undo stack: each entry = { d, h, prev } describing one cell change
  const undoStack = [];
  const undoBtn = $("#tariffUndo");
  const updateUndoBtn = () => {
    undoBtn.disabled = undoStack.length === 0;
    undoBtn.textContent = undoStack.length > 0
      ? t("tar.undoN").replace("{n}", undoStack.length)
      : t("tar.undo");
  };
  let dragBatch = null;     // collect during one drag, push as single entry on mouseup
  let dragging = false;
  const cellHandler = (cell) => {
    if (!cell || cell.dataset.day === undefined) return;
    const d = +cell.dataset.day, h = +cell.dataset.hour;
    if (tp.grid[d][h] === activeTool) return;
    if (dragBatch) dragBatch.push({ d, h, prev: tp.grid[d][h] });
    else undoStack.push([{ d, h, prev: tp.grid[d][h] }]);
    tp.grid[d][h] = activeTool;
    cell.style.background = PERIOD_META[activeTool].bg;
    cell.textContent = PERIOD_META[activeTool].label[0];
    updateUndoBtn();
  };
  const grid = document.querySelector(".tariff-grid-wrap");
  grid.addEventListener("mousedown", e => {
    const c = e.target.closest(".tariff-cell"); if (!c) return;
    e.preventDefault(); dragging = true; dragBatch = []; cellHandler(c);
  });
  grid.addEventListener("mouseover", e => { if (dragging) cellHandler(e.target.closest(".tariff-cell")); });
  document.addEventListener("mouseup", () => {
    if (dragBatch && dragBatch.length > 0) undoStack.push(dragBatch);
    dragging = false; dragBatch = null;
    updateUndoBtn();
  });

  undoBtn.addEventListener("click", () => {
    const batch = undoStack.pop();
    if (!batch) return;
    // Restore each cell in reverse order
    for (const { d, h, prev } of batch.reverse()) {
      tp.grid[d][h] = prev;
      const cell = document.querySelector(`.tariff-cell[data-day="${d}"][data-hour="${h}"]`);
      if (cell) {
        cell.style.background = PERIOD_META[prev].bg;
        cell.textContent = PERIOD_META[prev].label[0];
      }
    }
    updateUndoBtn();
    showToast(t("tar.toast.undone").replace("{n}", batch.length), "info", 1500);
  });
  // Touch
  grid.addEventListener("touchstart", e => {
    const c = e.target.closest(".tariff-cell"); if (!c) return;
    e.preventDefault(); dragging = true; dragBatch = []; cellHandler(c);
  }, { passive: false });
  grid.addEventListener("touchmove", e => {
    if (!dragging) return; e.preventDefault();
    const t = e.touches[0]; const el = document.elementFromPoint(t.clientX, t.clientY);
    cellHandler(el?.closest(".tariff-cell"));
  }, { passive: false });
  document.addEventListener("touchend", () => {
    if (dragBatch && dragBatch.length > 0) undoStack.push(dragBatch);
    dragging = false; dragBatch = null;
    updateUndoBtn();
  });

  // Price inputs
  $$(".tariff-price").forEach(inp => {
    inp.addEventListener("change", () => {
      tp.prices[inp.dataset.key] = +inp.value || 0;
      // Sync to global TARIFF (so schedule/finance views pick up)
      TARIFF.peak.price    = tp.prices.P;
      TARIFF.midPeak.price = tp.prices.M;
      TARIFF.offPeak.price = tp.prices.O;
      showToast(t("tar.toast.priceUpd"), "ok", 2000);
    });
  });
  $$(".tariff-basic").forEach(inp => {
    inp.addEventListener("change", () => {
      tp.basicCharges[inp.dataset.key].ratePerKW = +inp.value || 0;
    });
  });

  $("#tariffReset").addEventListener("click", () => {
    state.tariffDraft = null;
    showToast(t("tar.toast.reset"), "info");
    router();
  });
  $("#tariffSave").addEventListener("click", () => {
    showToast(t("tar.toast.saved"), "ok", 4000);
  });
}

// ────────── 5. Finance ──────────
function viewFinance() {
  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${t("page.fin.title")}</h1>
        <p class="page-sub">${t("page.fin.sub")}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost">${t("btn.month")}</button>
        <button class="btn">${t("btn.year")}</button>
        <button class="btn btn-primary">${t("btn.exportExcel")}</button>
      </div>
    </div>

    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi green">
        <div class="kpi-label">年度總節費</div>
        <div class="kpi-value">${money(1541000)}</div>
        <div class="kpi-foot">vs 無儲能情境</div>
      </div>
      <div class="kpi blue">
        <div class="kpi-label">年度套利收益</div>
        <div class="kpi-value">${money(378000)}</div>
        <div class="kpi-foot">尖離峰價差</div>
      </div>
      <div class="kpi amber">
        <div class="kpi-label">契約降載節省</div>
        <div class="kpi-value">${money(1086000)}</div>
        <div class="kpi-foot">契約 ↓ 300 kW</div>
      </div>
      <div class="kpi purple">
        <div class="kpi-label">回本年限 (IRR 11.8%)</div>
        <div class="kpi-value">6.2<span class="unit">年</span></div>
        <div class="kpi-foot">系統壽命 15 年</div>
      </div>
    </div>

    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-head"><h3>月度節費組成</h3></div>
        <div class="chart-wrap tall"><canvas id="chartSavings"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>15 年累積現金流</h3></div>
        <div class="chart-wrap tall"><canvas id="chartCashflow"></canvas></div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><h3>月度電費明細 (2025/11 – 2026/04)</h3></div>
      <table class="data">
        <thead><tr>
          <th>月份</th><th class="right">基本電費節省</th><th class="right">超約罰款減少</th>
          <th class="right">尖離峰套利</th><th class="right">合計節省</th><th class="right">占比</th>
        </tr></thead>
        <tbody>
          ${MONTHLY.map(m => `
            <tr>
              <td>${m.mo}</td>
              <td class="num right">${money(m.base)}</td>
              <td class="num right">${money(m.penalty)}</td>
              <td class="num right">${money(m.arbitrage)}</td>
              <td class="num right strong" style="color:var(--green)">${money(m.total)}</td>
              <td class="num right">${((m.total/710000)*100).toFixed(1)}%</td>
            </tr>
          `).join("")}
          <tr style="background:rgba(0,194,168,0.05)">
            <td class="strong">合計</td>
            <td class="num right strong">${money(MONTHLY.reduce((s,x)=>s+x.base,0))}</td>
            <td class="num right strong">${money(MONTHLY.reduce((s,x)=>s+x.penalty,0))}</td>
            <td class="num right strong">${money(MONTHLY.reduce((s,x)=>s+x.arbitrage,0))}</td>
            <td class="num right strong" style="color:var(--green)">${money(MONTHLY.reduce((s,x)=>s+x.total,0))}</td>
            <td class="num right">-</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card mt-16">
      <div class="card-head"><h3>投資回報試算 (ROI / IRR)</h3></div>
      <div class="grid g-3">
        <div>
          <table class="data">
            <tr><td>系統總投入</td><td class="num right">${money(9520000)}</td></tr>
            <tr><td>SYS-A 125kW/261kWh</td><td class="num right">${money(5220000)}</td></tr>
            <tr><td>SYS-B 100kW/215kWh</td><td class="num right">${money(4300000)}</td></tr>
            <tr><td>EPC 統包</td><td class="num right">含</td></tr>
            <tr><td>保固年限</td><td class="num right">10 年</td></tr>
          </table>
        </div>
        <div>
          <table class="data">
            <tr><td>年節費預估</td><td class="num right" style="color:var(--green)">${money(1541000)}</td></tr>
            <tr><td>每年維運成本</td><td class="num right">${money(95000)}</td></tr>
            <tr><td>電池衰退率</td><td class="num right">2.5% / 年</td></tr>
            <tr><td>殘值率 (15 年)</td><td class="num right">8%</td></tr>
            <tr><td><strong>IRR</strong></td><td class="num right strong" style="color:var(--primary)">11.8%</td></tr>
          </table>
        </div>
        <div>
          <table class="data">
            <tr><td>靜態回本期</td><td class="num right">6.2 年</td></tr>
            <tr><td>淨現值 NPV (r=5%)</td><td class="num right" style="color:var(--green)">${money(6840000)}</td></tr>
            <tr><td>15 年累積淨收益</td><td class="num right">${money(12150000)}</td></tr>
            <tr><td>CO₂ 年減排</td><td class="num right">420 噸</td></tr>
            <tr><td>參與 sReg 額外收益</td><td class="num right">~${money(230000)}/年</td></tr>
          </table>
        </div>
      </div>
    </div>
  `;

  // savings chart
  addChart(new Chart($("#chartSavings"), {
    type: "bar",
    data: {
      labels: MONTHLY.map(m=>m.mo),
      datasets: [
        { label: "基本電費節省", data: MONTHLY.map(m=>m.base),     backgroundColor: "#3b82f6" },
        { label: "超約罰款減少", data: MONTHLY.map(m=>m.penalty),  backgroundColor: "#f59e0b" },
        { label: "尖離峰套利",   data: MONTHLY.map(m=>m.arbitrage),backgroundColor: "#10b981" },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, grid:{color:"rgba(139,152,176,0.08)"}, ticks: { callback: v => "$" + (v/1000) + "k" } }
      }
    }
  }));

  // cumulative cash flow
  const years = Array.from({length:16}, (_,i)=>"Y" + i);
  const capex = -9520000;
  const annualSaving = 1541000;
  const opex = 95000;
  const degrade = 0.975;
  let cum = capex; let s = annualSaving;
  const cumFlow = [capex];
  for (let y=1; y<=15; y++) {
    cum += (s - opex);
    cumFlow.push(cum);
    s *= degrade;
  }
  addChart(new Chart($("#chartCashflow"), {
    type: "line",
    data: {
      labels: years,
      datasets: [
        { label:"累積現金流", data: cumFlow, borderColor:"#00c2a8", backgroundColor:"rgba(0,194,168,0.15)", fill:true, tension:.25, pointRadius:3, borderWidth:2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display:false },
        tooltip: { callbacks: { label: c => `${c.label}: ${money(c.parsed.y)}` } }
      },
      scales: {
        y: { grid:{color:"rgba(139,152,176,0.08)"}, ticks: { callback: v => "$" + (v/1000000).toFixed(1) + "M" } }
      }
    }
  }));
}

// ────────── 6. Alarms ──────────
function viewAlarms() {
  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${t("page.alm.title")}</h1>
        <p class="page-sub">${t("page.alm.sub")}</p>
      </div>
      <div class="page-actions">
        <button class="btn">${t("alm.filter.all")}</button>
        <button class="btn btn-ghost">${t("alm.filter.err")}</button>
        <button class="btn btn-ghost">${t("alm.filter.warn")}</button>
        <button class="btn btn-ghost">${t("alm.filter.info")}</button>
      </div>
    </div>

    <div class="card mb-16" style="border-left:3px solid var(--amber);background:linear-gradient(90deg,rgba(245,158,11,0.06),transparent)">
      <div class="card-head" style="margin-bottom:8px">
        <h3>${t("alm.demo.title")}</h3>
        <span class="muted" style="font-size:11.5px">${t("alm.demo.sub")}</span>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="demoAlarmThermal">${t("alm.demo.btnThermal")}</button>
        <button class="btn btn-primary" id="demoAlarmFire" style="background:var(--red);border-color:var(--red);color:#fff">${t("alm.demo.btnFire")}</button>
        <button class="btn" id="demoAlarmContract">${t("alm.demo.btnContract")}</button>
      </div>
    </div>

    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="kpi-label">${t("alm.kpi.unhandled")}</div><div class="kpi-value">3</div><div class="kpi-foot">${t("alm.kpi.unhandledFoot")}</div></div>
      <div class="kpi green"><div class="kpi-label">${t("alm.kpi.handled")}</div><div class="kpi-value">12</div><div class="kpi-foot">${t("alm.kpi.handledFoot").replace("{a}", 9).replace("{b}", 3)}</div></div>
      <div class="kpi amber"><div class="kpi-label">${t("alm.kpi.warn")}</div><div class="kpi-value">2</div><div class="kpi-foot">${t("alm.kpi.warnFoot")}</div></div>
      <div class="kpi pink"><div class="kpi-label">${t("alm.kpi.err")}</div><div class="kpi-value">1</div><div class="kpi-foot">${t("alm.kpi.errFoot")}</div></div>
    </div>

    <div class="card mt-16 mb-16">
      <div class="card-head">
        <h3>${t("alm.led.title")}</h3>
        <div class="row" style="gap:8px">
          <span class="led-legend"><span class="led led-ok"></span>${t("alm.legend.ok")}</span>
          <span class="led-legend"><span class="led led-warn"></span>${t("alm.legend.warn")}</span>
          <span class="led-legend"><span class="led led-err"></span>${t("alm.legend.err")}</span>
          <span class="led-legend"><span class="led led-protect"></span>${t("alm.legend.protect")}</span>
        </div>
      </div>
      <div class="led-wall">
        ${ALARM_LIGHTS.map((a,i) => {
          const key = `alm.${String(i+1).padStart(3,"0")}`;
          return `<div class="led-cell led-${a.state}" title="${a.code} · ${a.state}">${t(key)}</div>`;
        }).join("")}
      </div>
      <div class="muted mt-8" style="font-size:11.5px">${ALARM_LIGHTS.length} ${t("alm.led.poll")}</div>
    </div>

    <div class="card mb-16">
      <div class="card-head"><h3>${t("alm.live.title")}</h3>
        <div class="row"><span class="muted" style="font-size:12px">${t("alm.live.refresh10s")}</span></div>
      </div>
      <table class="data">
        <thead><tr><th>${t("alm.live.thTime")}</th><th>${t("alm.live.thSev")}</th><th>${t("alm.live.thDev")}</th><th>${t("alm.live.thMsg")}</th><th>${t("alm.live.thDetail")}</th><th>${t("alm.live.thAct")}</th></tr></thead>
        <tbody>
          ${ALARMS.map(a=>`
            <tr>
              <td class="num">${a.ts}</td>
              <td><span class="tag ${a.sev}">${t(`sev.${a.sev}`)}</span></td>
              <td>${a.sys}</td>
              <td>${a.msg}</td>
              <td class="muted">${a.detail}</td>
              <td><button class="btn btn-ghost" style="padding:3px 10px;font-size:11.5px">${t("alm.live.confirm")}</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <!-- 🔗 Interlock rules editor -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>${t("alm.rules.title")}</h3>
        <div class="row" style="gap:6px">
          <button class="btn btn-ghost" style="font-size:12px">${t("alm.rules.import")}</button>
          <button class="btn" style="font-size:12px">${t("alm.rules.add")}</button>
        </div>
      </div>
      <table class="data">
        <thead><tr>
          <th>${t("alm.rules.thOn")}</th><th>${t("alm.rules.thCode")}</th><th>${t("alm.rules.thName")}</th><th>${t("alm.rules.thSev")}</th><th>${t("alm.rules.thThresh")}</th>
          <th>${t("alm.rules.thAuto")}</th><th class="right">${t("alm.rules.thDelay")}</th><th></th>
        </tr></thead>
        <tbody>
          ${ALARM_RULES.map((r,i) => `
            <tr>
              <td><input type="checkbox" ${r.enabled?'checked':''} class="rule-toggle" data-i="${i}"></td>
              <td><code style="font-size:11.5px;color:var(--text-muted)">${r.code}</code></td>
              <td>${r.name}</td>
              <td><span class="tag ${r.sev === 'critical' ? 'err' : r.sev === 'error' ? 'err' : r.sev === 'warning' ? 'warn' : 'info'}">${t(`alm.rules.sev.${r.sev}`)}</span></td>
              <td><input class="inp rule-thr" data-i="${i}" value="${r.threshold}" style="width:120px;font-size:12px;padding:4px 8px"></td>
              <td>
                <span class="action-tag act-${r.actType}">
                  ${ {shutdown:'🛑',derate:'🔻',reset:'🔁',notify:'🔔'}[r.actType] } ${r.action}
                </span>
              </td>
              <td class="num right"><input class="inp rule-delay" data-i="${i}" value="${r.delaySec}" type="number" style="width:60px;font-size:12px;padding:4px 8px;text-align:right"> ${t("alm.rules.sec")}</td>
              <td><button class="btn-mini rule-test" data-i="${i}" title="${t("alm.rules.testBtn")}">▶</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="muted mt-12" style="font-size:11.5px">${t("alm.rules.foot")}</div>
    </div>

    <!-- 📜 Action audit history -->
    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-head"><h3>${t("alm.audit.title")}</h3></div>
        <div class="grid g-3" style="gap:10px;margin-bottom:14px">
          <div class="stat" style="padding:14px"><div class="lbl">${t("alm.audit.totalExec")}</div><div class="val">${ALARM_HISTORY.totals.shutdown + ALARM_HISTORY.totals.derate + ALARM_HISTORY.totals.notify}</div></div>
          <div class="stat amber" style="padding:14px"><div class="lbl">${t("alm.audit.shutDerate")}</div><div class="val">${ALARM_HISTORY.totals.shutdown} / ${ALARM_HISTORY.totals.derate}</div></div>
          <div class="stat blue" style="padding:14px"><div class="lbl">${t("alm.audit.notify")}</div><div class="val">${ALARM_HISTORY.totals.notify}</div></div>
        </div>
        <table class="data" style="font-size:12.5px">
          <thead><tr><th>${t("alm.audit.thTime")}</th><th>${t("alm.audit.thRule")}</th><th>${t("alm.audit.thAct")}</th><th>${t("alm.audit.thActor")}</th><th>${t("alm.audit.thOutcome")}</th></tr></thead>
          <tbody>
            ${ALARM_HISTORY.recent.map(h => `
              <tr>
                <td class="num muted">${h.ts}</td>
                <td><code style="font-size:11px;color:var(--text-muted)">${h.code}</code></td>
                <td>${h.act}</td>
                <td class="muted">${h.actor}</td>
                <td><span class="tag ${h.outcome.includes('成功')||h.outcome.includes('恢復')?'ok':'warn'}">${h.outcome}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="row mt-12" style="padding:10px 12px;background:rgba(239,68,68,0.06);border-left:3px solid var(--red);border-radius:6px;gap:14px;font-size:12.5px">
          <div><span class="muted">${t("alm.audit.downtime")}：</span><strong>${ALARM_HISTORY.downtimeHours} ${t("alm.audit.hours")}</strong></div>
          <div><span class="muted">${t("alm.audit.lostKWh")}：</span><strong>${ALARM_HISTORY.lostKWh} kWh</strong></div>
          <div><span class="muted">${t("alm.audit.lostNTD")}：</span><strong style="color:var(--red)">${money(ALARM_HISTORY.lostNTD)}</strong></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${t("alm.top.title")}</h3></div>
        <table class="data" style="font-size:12.5px">
          <thead><tr><th>#</th><th>${t("alm.top.thAlarm")}</th><th class="right">${t("alm.top.thCount")}</th></tr></thead>
          <tbody>
            ${ALARM_HISTORY.topTriggers.map((tr,i) => `
              <tr>
                <td class="num muted">${i+1}</td>
                <td>
                  <code style="font-size:11px;color:var(--text-muted)">${tr.code}</code>
                  <div class="muted" style="font-size:11.5px;margin-top:2px">${tr.recommendation}</div>
                </td>
                <td class="num right"><strong>${tr.count}</strong></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="grid g-2">
      <div class="card">
        <div class="card-head"><h3>${t("alm.dist.title")}</h3></div>
        <div class="chart-wrap"><canvas id="alarmPie"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${t("alm.push.title")}</h3></div>
        <table class="data">
          <tr><td>Line Notify</td><td><span class="tag ok">${t("alm.push.enabled")}</span></td><td class="muted">${t("alm.push.lineGroups").replace("{n}", 2)}</td></tr>
          <tr><td>Email</td><td><span class="tag ok">${t("alm.push.enabled")}</span></td><td class="muted">${t("alm.push.emailRecv").replace("{n}", 3)}</td></tr>
          <tr><td>Webhook</td><td><span class="tag mute">${t("alm.push.disabled")}</span></td><td class="muted">-</td></tr>
          <tr><td>${t("comm.dev.openadr")}</td><td><span class="tag ok">${t("alm.push.enabled")}</span></td><td class="muted">${t("alm.push.openadrSReg")}</td></tr>
        </table>
        <div class="muted mt-16" style="font-size:12px">${t("alm.push.foot")}</div>
      </div>
    </div>
  `;

  addChart(new Chart($("#alarmPie"), {
    type: "doughnut",
    data: {
      labels: [t("alm.dist.cat.comm"), t("alm.dist.cat.thermal"), t("alm.dist.cat.bms"), t("alm.dist.cat.pcs"), t("alm.dist.cat.other")],
      datasets: [{
        data: [14, 8, 6, 3, 2],
        backgroundColor: ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b98b0"],
        borderColor: "#0f1729",
        borderWidth: 2,
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right" } } }
  }));

  // Wire demo trigger buttons
  $("#demoAlarmThermal")?.addEventListener("click", () => demoTriggerAlarm("thermal"));
  $("#demoAlarmFire")?.addEventListener("click",    () => demoTriggerAlarm("fire"));
  $("#demoAlarmContract")?.addEventListener("click",() => demoTriggerAlarm("contract"));

  // Rule editor handlers
  $$(".rule-toggle").forEach(cb => {
    cb.addEventListener("change", () => {
      const i = +cb.dataset.i;
      ALARM_RULES[i].enabled = cb.checked;
      const key = cb.checked ? "alm.toast.ruleEnabled" : "alm.toast.ruleDisabled";
      showToast(t(key).replace("{code}", ALARM_RULES[i].code), cb.checked?"ok":"warn", 2000);
    });
  });
  $$(".rule-thr").forEach(inp => {
    inp.addEventListener("change", () => {
      ALARM_RULES[+inp.dataset.i].threshold = inp.value;
      showToast(t("alm.toast.threshUpd"), "ok", 1500);
    });
  });
  $$(".rule-delay").forEach(inp => {
    inp.addEventListener("change", () => {
      ALARM_RULES[+inp.dataset.i].delaySec = +inp.value || 0;
    });
  });
  $$(".rule-test").forEach(btn => {
    btn.addEventListener("click", () => {
      const r = ALARM_RULES[+btn.dataset.i];
      if (!r.enabled) { showToast(t("alm.toast.disabledTest"), "warn"); return; }
      if (r.code === "cell.temp.high") return demoTriggerAlarm("thermal");
      if (r.code === "fire.smoke")     return demoTriggerAlarm("fire");
      if (r.code === "contract.over")  return demoTriggerAlarm("contract");
      showCriticalAlarm({
        code: r.code, severity: r.sev, device: t("alm.test.device"),
        message: r.name, detail: t("alm.test.ruleTrigger").replace("{threshold}", r.threshold),
        threshold: r.threshold, value: "(simulated)",
        action: r.action, actionType: r.actType,
        recommendation: t("alm.test.simBody"),
        countdownSec: Math.max(5, r.delaySec || 8),
      });
    });
  });
}

// ────────── 7. Settings ──────────
function viewSettings() {
  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${t("page.set.title")}</h1>
        <p class="page-sub">${t("page.set.sub")}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost">${t("btn.cancel")}</button>
        <button class="btn btn-primary">${t("btn.save")}</button>
      </div>
    </div>

    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-head"><h3>${t("set.site.title")}</h3></div>
        <div class="grid g-2e" style="gap:12px">
          <div class="form-row"><label>${t("set.site.name")}</label><input class="inp" value="${SITE.name}" /></div>
          <div class="form-row"><label>${t("set.site.addr")}</label><input class="inp" value="${SITE.address}" /></div>
          <div class="form-row"><label>${t("set.site.contract")}</label><input class="inp" value="${SITE.contractKW}" /></div>
          <div class="form-row"><label>${t("set.site.tariff")}</label><input class="inp" value="${SITE.tariff}" /></div>
          <div class="form-row"><label>${t("set.site.industry")}</label><input class="inp" value="${SITE.industry}" /></div>
          <div class="form-row"><label>${t("set.site.pv")}</label><input class="inp" value="${SITE.pvKWp}" /></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${t("set.spec.title")}</h3></div>
        <table class="data">
          <thead><tr><th>${t("set.spec.thSys")}</th><th class="right">${t("set.spec.thPcs")}</th><th class="right">${t("set.spec.thBat")}</th><th class="right">${t("set.spec.thSoc")}</th><th>${t("set.spec.thVendor")}</th></tr></thead>
          <tbody>
            ${SITE.systems.map(s=>`
              <tr>
                <td>${s.id}</td>
                <td class="num right">${s.pcsKW}</td>
                <td class="num right">${s.batteryKWh}</td>
                <td class="num right">${s.soc}%</td>
                <td>${s.vendor}</td>
              </tr>
            `).join("")}
            <tr style="background:rgba(0,194,168,0.05)">
              <td class="strong">${t("set.spec.total")}</td>
              <td class="num right strong">${SITE.systems.reduce((s,x)=>s+x.pcsKW,0)}</td>
              <td class="num right strong">${SITE.systems.reduce((s,x)=>s+x.batteryKWh,0)}</td>
              <td class="num right strong">${(SITE.systems.reduce((s,x)=>s+x.soc,0)/SITE.systems.length).toFixed(0)}%</td>
              <td>-</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Protocol map -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>${t("set.proto.title")}</h3>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <span class="tag" style="background:rgba(139,92,246,0.12);color:var(--purple)">◼ MQTT/TLS</span>
          <span class="tag" style="background:rgba(0,194,168,0.12);color:var(--primary)">◼ Modbus TCP</span>
          <span class="tag" style="background:rgba(245,158,11,0.12);color:var(--amber)">◼ Modbus RTU / DLT645</span>
          <span class="tag" style="background:rgba(236,72,153,0.12);color:var(--pink)">◼ CAN bus</span>
          <span class="tag" style="background:rgba(59,130,246,0.12);color:var(--blue)">◼ IEC 104</span>
        </div>
      </div>
      <div class="proto-map-wrap">
      <svg viewBox="0 0 1200 720" xmlns="http://www.w3.org/2000/svg" class="proto-map">
        <defs>
          <marker id="pa-purple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#8b5cf6"/>
          </marker>
          <marker id="pa-teal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#00c2a8"/>
          </marker>
          <marker id="pa-amber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#f59e0b"/>
          </marker>
          <marker id="pa-pink" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#ec4899"/>
          </marker>
          <marker id="pa-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#3b82f6"/>
          </marker>
        </defs>

        <!-- Cloud layer (= this EMS system) -->
        <g>
          <rect x="380" y="14" width="440" height="80" rx="14" fill="#0a1d20" stroke="#00c2a8" stroke-width="2"/>
          <text x="600" y="42" text-anchor="middle" fill="#00c2a8" font-size="15" font-weight="800">${t("set.proto.cloudTitle")}</text>
          <text x="600" y="62" text-anchor="middle" fill="#cbd5e1" font-size="11.5">${t("set.proto.cloudDesc")}</text>
          <text x="600" y="80" text-anchor="middle" fill="#94e0d2" font-size="10.5">${t("set.proto.topo")}</text>
        </g>

        <g>
          <rect x="900" y="30" width="220" height="48" rx="8" fill="#0a1830" stroke="#3b82f6" stroke-width="1.2"/>
          <text x="1010" y="50" text-anchor="middle" fill="#93c5fd" font-size="13" font-weight="600">${t("set.proto.tpcMkt")}</text>
          <text x="1010" y="68" text-anchor="middle" fill="#8b98b0" font-size="10.5">${t("set.proto.tpcMktSub")}</text>
        </g>

        <!-- MQTT line cloud↔站控 -->
        <line x1="540" y1="94" x2="540" y2="160" stroke="#8b5cf6" stroke-width="2" stroke-dasharray="6,3" marker-end="url(#pa-purple)">
          <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1.5s" repeatCount="indefinite"/>
        </line>
        <text x="552" y="118" fill="#a78bfa" font-size="11" font-weight="600">${t("set.proto.mqttUp")}</text>
        <text x="552" y="132" fill="#8b98b0" font-size="10">$ESS/{dev}/data · FULL/VARY</text>
        <line x1="660" y1="160" x2="660" y2="94" stroke="#8b5cf6" stroke-width="2" stroke-dasharray="6,3" marker-end="url(#pa-purple)">
          <animate attributeName="stroke-dashoffset" from="0" to="18" dur="1.5s" repeatCount="indefinite"/>
        </line>
        <text x="672" y="118" fill="#a78bfa" font-size="11" font-weight="600">${t("set.proto.mqttDown")}</text>
        <text x="672" y="132" fill="#8b98b0" font-size="10">$ESC/{gw}/rpcreq</text>

        <!-- IEC 104 line tpc→站控 -->
        <path d="M 1010 78 Q 1010 130, 750 175" stroke="#3b82f6" stroke-width="2" fill="none" stroke-dasharray="5,3" marker-end="url(#pa-blue)">
          <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.8s" repeatCount="indefinite"/>
        </path>
        <text x="900" y="130" fill="#60a5fa" font-size="11" font-weight="600">IEC 60870-5-104</text>

        <g>
          <rect x="450" y="160" width="300" height="74" rx="10" fill="#0a2024" stroke="#00c2a8" stroke-width="2"/>
          <text x="600" y="188" text-anchor="middle" fill="#00c2a8" font-size="15" font-weight="800">${t("set.proto.scu")}</text>
          <text x="600" y="208" text-anchor="middle" fill="#e6edf5" font-size="11.5">${t("set.proto.scuHw")}</text>
          <text x="600" y="224" text-anchor="middle" fill="#8b98b0" font-size="10.5">${t("set.proto.scuRole")}</text>
        </g>

        <line x1="450" y1="195" x2="280" y2="280" stroke="#f59e0b" stroke-width="2" marker-end="url(#pa-amber)">
          <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1.6s" repeatCount="indefinite"/>
        </line>
        <text x="280" y="240" fill="#fbbf24" font-size="11" font-weight="600">${t("set.proto.dlt645")}</text>
        <text x="280" y="254" fill="#8b98b0" font-size="10">${t("set.proto.dlt645Sub")}</text>

        <g>
          <rect x="100" y="280" width="220" height="68" rx="8" fill="#1a1505" stroke="#f59e0b" stroke-width="1.2"/>
          <text x="210" y="306" text-anchor="middle" fill="#fbbf24" font-size="13" font-weight="600">${t("set.proto.meter")}</text>
          <text x="210" y="324" text-anchor="middle" fill="#8b98b0" font-size="10.5">${t("set.proto.meterType")}</text>
          <text x="210" y="340" text-anchor="middle" fill="#8b98b0" font-size="10.5">${t("set.proto.meterFields")}</text>
        </g>

        <line x1="600" y1="234" x2="600" y2="290" stroke="#00c2a8" stroke-width="2" marker-end="url(#pa-teal)"/>
        <text x="612" y="270" fill="#00c2a8" font-size="11" font-weight="600">${t("set.proto.eth")}</text>

        <g>
          <rect x="490" y="290" width="220" height="42" rx="6" fill="#101a2e" stroke="#3b82f6" stroke-width="1.5"/>
          <text x="600" y="312" text-anchor="middle" fill="#93c5fd" font-size="12" font-weight="700">${t("set.proto.switch")}</text>
          <text x="600" y="326" text-anchor="middle" fill="#8b98b0" font-size="10">192.168.1.0/24</text>
        </g>

        <line x1="540" y1="332" x2="280" y2="400" stroke="#00c2a8" stroke-width="2" marker-end="url(#pa-teal)">
          <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.3s" repeatCount="indefinite"/>
        </line>
        <text x="320" y="370" fill="#00c2a8" font-size="11" font-weight="600">Modbus TCP</text>
        <text x="320" y="384" fill="#8b98b0" font-size="10">${t("set.proto.modbusTcp1")}</text>

        <line x1="660" y1="332" x2="920" y2="400" stroke="#00c2a8" stroke-width="2" marker-end="url(#pa-teal)">
          <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.4s" repeatCount="indefinite"/>
        </line>
        <text x="820" y="370" fill="#00c2a8" font-size="11" font-weight="600">Modbus TCP</text>
        <text x="820" y="384" fill="#8b98b0" font-size="10">${t("set.proto.modbusTcp2")}</text>

        <g>
          <rect x="80" y="400" width="400" height="296" rx="10" fill="#0a0e1e" stroke="#1b2740" stroke-width="1.5" stroke-dasharray="4,3"/>
          <text x="280" y="421" text-anchor="middle" fill="#cbd5e1" font-size="12" font-weight="700">${t("set.proto.cabinet").replace("{sys}", "SYS-A")}</text>

          <rect x="120" y="436" width="320" height="58" rx="8" fill="#0a2024" stroke="#00c2a8" stroke-width="1.5"/>
          <text x="280" y="458" text-anchor="middle" fill="#00c2a8" font-size="12" font-weight="700">${t("set.proto.bcu")}</text>
          <text x="280" y="476" text-anchor="middle" fill="#8b98b0" font-size="10.5">${t("set.proto.bcuHw")}</text>

          <!-- PCS -->
          <line x1="180" y1="494" x2="180" y2="530" stroke="#00c2a8" stroke-width="1.5" marker-end="url(#pa-teal)"/>
          <text x="125" y="514" fill="#00c2a8" font-size="10" font-weight="600">Modbus TCP</text>
          <rect x="120" y="530" width="120" height="44" rx="6" fill="#0f1729" stroke="#00c2a8" stroke-width="1"/>
          <text x="180" y="550" text-anchor="middle" fill="#e6edf5" font-size="11" font-weight="700">PCS</text>
          <text x="180" y="566" text-anchor="middle" fill="#8b98b0" font-size="9.5">125 kW · port 502</text>

          <line x1="380" y1="494" x2="380" y2="530" stroke="#ec4899" stroke-width="1.5" marker-end="url(#pa-pink)"/>
          <text x="392" y="514" fill="#f9a8d4" font-size="10" font-weight="600">CAN bus</text>
          <rect x="320" y="530" width="120" height="44" rx="6" fill="#1a0a14" stroke="#ec4899" stroke-width="1"/>
          <text x="380" y="550" text-anchor="middle" fill="#fbcfe8" font-size="11" font-weight="700">${t("set.proto.bcuCluster")}</text>
          <text x="380" y="566" text-anchor="middle" fill="#8b98b0" font-size="9.5">${t("set.proto.hvBox")}</text>

          <line x1="380" y1="574" x2="380" y2="600" stroke="#ec4899" stroke-width="1.5" marker-end="url(#pa-pink)"/>
          <text x="392" y="592" fill="#f9a8d4" font-size="9.5">CAN</text>
          <rect x="290" y="600" width="60" height="34" rx="5" fill="#1a0a14" stroke="#ec4899" stroke-width="0.8"/>
          <text x="320" y="619" text-anchor="middle" fill="#fbcfe8" font-size="10" font-weight="600">BMU 1</text>
          <rect x="354" y="600" width="60" height="34" rx="5" fill="#1a0a14" stroke="#ec4899" stroke-width="0.8"/>
          <text x="384" y="619" text-anchor="middle" fill="#fbcfe8" font-size="10" font-weight="600">BMU 2</text>
          <rect x="418" y="600" width="20" height="34" rx="5" fill="#1a0a14" stroke="#ec4899" stroke-width="0.5"/>
          <text x="428" y="623" text-anchor="middle" fill="#fbcfe8" font-size="9">···</text>
          <text x="380" y="654" text-anchor="middle" fill="#8b98b0" font-size="10">${t("set.proto.bmuPerPack")}</text>
          <text x="380" y="670" text-anchor="middle" fill="#8b98b0" font-size="9.5">${t("set.proto.bmuFunc")}</text>

          <rect x="120" y="595" width="120" height="44" rx="6" fill="#0f1729" stroke="#f59e0b" stroke-width="1"/>
          <text x="180" y="615" text-anchor="middle" fill="#fbbf24" font-size="10.5" font-weight="700">${t("set.proto.io")}</text>
          <text x="180" y="630" text-anchor="middle" fill="#8b98b0" font-size="9.5">${t("set.proto.ioFields")}</text>
          <line x1="180" y1="595" x2="180" y2="574" stroke="#f59e0b" stroke-width="1.5"/>
          <text x="125" y="588" fill="#fbbf24" font-size="9.5">DI/DO</text>
        </g>

        <g>
          <rect x="720" y="400" width="400" height="200" rx="10" fill="#0a0e1e" stroke="#1b2740" stroke-width="1.5" stroke-dasharray="4,3"/>
          <text x="920" y="421" text-anchor="middle" fill="#cbd5e1" font-size="12" font-weight="700">${t("set.proto.cabinet").replace("{sys}", "SYS-B")}</text>
          <rect x="760" y="436" width="320" height="58" rx="8" fill="#0a2024" stroke="#00c2a8" stroke-width="1.5"/>
          <text x="920" y="458" text-anchor="middle" fill="#00c2a8" font-size="12" font-weight="700">${t("set.proto.bcuMirror")}</text>
          <text x="920" y="476" text-anchor="middle" fill="#8b98b0" font-size="10.5">${t("set.proto.bcuMirrorSub")}</text>
          <line x1="820" y1="494" x2="820" y2="530" stroke="#00c2a8" stroke-width="1.5" marker-end="url(#pa-teal)"/>
          <rect x="760" y="530" width="120" height="44" rx="6" fill="#0f1729" stroke="#00c2a8" stroke-width="1"/>
          <text x="820" y="550" text-anchor="middle" fill="#e6edf5" font-size="11" font-weight="700">PCS</text>
          <text x="820" y="566" text-anchor="middle" fill="#8b98b0" font-size="9.5">125 kW</text>
          <line x1="1020" y1="494" x2="1020" y2="530" stroke="#ec4899" stroke-width="1.5" marker-end="url(#pa-pink)"/>
          <rect x="960" y="530" width="120" height="44" rx="6" fill="#1a0a14" stroke="#ec4899" stroke-width="1"/>
          <text x="1020" y="550" text-anchor="middle" fill="#fbcfe8" font-size="11" font-weight="700">BCU + BMU × 13</text>
          <text x="1020" y="566" text-anchor="middle" fill="#8b98b0" font-size="9.5">261 kWh LFP</text>
        </g>
      </svg>
      </div>
      <div class="proto-foot">
        ${t("set.proto.foot")}
      </div>
    </div>

    <div class="grid g-3 mb-16">
      <div class="card">
        <div class="card-head"><h3>${t("set.protocols.title")}</h3></div>
        <table class="data">
          <tr><td>${t("set.protocols.pcs")}</td><td><span class="tag info">Modbus TCP</span></td></tr>
          <tr><td>${t("set.protocols.bms")}</td><td><span class="tag info">Modbus RTU</span></td></tr>
          <tr><td>${t("set.protocols.meter")}</td><td><span class="tag info">Modbus TCP</span></td></tr>
          <tr><td>${t("set.protocols.hvac")}</td><td><span class="tag info">BACnet/IP</span></td></tr>
          <tr><td>${t("set.protocols.tpc")}</td><td><span class="tag info">IEC 61850</span></td></tr>
          <tr><td>${t("set.protocols.cloud")}</td><td><span class="tag info">MQTT (TLS)</span></td></tr>
        </table>
      </div>
      <div class="card">
        <div class="card-head"><h3>${t("set.security.title")}</h3></div>
        <table class="data">
          <tr><td>${t("set.security.iec62443")}</td><td><span class="tag ok">${t("set.security.compliant")}</span></td></tr>
          <tr><td>${t("set.security.x509")}</td><td><span class="tag ok">${t("set.security.enabled")}</span></td></tr>
          <tr><td>${t("set.security.rbac")}</td><td><span class="tag ok">${t("set.security.enabled")}</span></td></tr>
          <tr><td>${t("set.security.encInTransit")}</td><td><span class="tag ok">TLS 1.3</span></td></tr>
          <tr><td>${t("set.security.encAtRest")}</td><td><span class="tag ok">AES-256</span></td></tr>
          <tr><td>${t("set.security.audit")}</td><td>${t("set.security.years").replace("{n}", 3)}</td></tr>
        </table>
      </div>
      <div class="card">
        <div class="card-head"><h3>${t("set.users.title")}</h3></div>
        <table class="data">
          <thead><tr><th>${t("set.users.thRole")}</th><th class="right">${t("set.users.thCount")}</th></tr></thead>
          <tbody>
            <tr><td>${t("set.users.admin")}</td><td class="num right">2</td></tr>
            <tr><td>${t("set.users.eng")}</td><td class="num right">5</td></tr>
            <tr><td>${t("set.users.exec")}</td><td class="num right">3</td></tr>
            <tr><td>${t("set.users.guest")}</td><td class="num right">8</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ────────── 8. Battery Passport ──────────
// Real QR code generation via qrcode-generator (Reed-Solomon EC, scannable)
function makeQR(text) {
  if (typeof qrcode !== "function") return `<div style="font-size:11px;color:#888;padding:20px;text-align:center">QR 載入中...</div>`;
  const qr = qrcode(0, "M"); // type 0 = auto, error correction Medium
  qr.addData(text);
  qr.make();
  const N = qr.getModuleCount();
  let svg = `<svg viewBox="0 0 ${N+8} ${N+8}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;background:#fff;border-radius:6px">`;
  svg += `<rect width="${N+8}" height="${N+8}" fill="#fff"/>`;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    if (qr.isDark(y, x)) svg += `<rect x="${x+4}" y="${y+4}" width="1.05" height="1.05" fill="#000"/>`;
  svg += `</svg>`;
  return svg;
}

// ────────── Compliance: recall lookup + export bundle ──────────
function showRecallModal(p) {
  const dbs = [
    { name: "CPSC (US Consumer Product Safety)",  region: "美國",   delay: 250 },
    { name: "RAPEX (EU Safety Gate)",             region: "歐盟",   delay: 320 },
    { name: "SAMR (中國市場監督管理總局)",         region: "中國",   delay: 280 },
    { name: "TÜV 撤證公告",                        region: "全球",   delay: 200 },
    { name: "海辰 ESS 召回通報 (廠商)",            region: "全球",   delay: 180 },
  ];
  const now = new Date();
  const ts = now.toISOString().replace("T"," ").slice(0, 19);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-head">
        <div>
          <div class="modal-title">🔍 召回 / 撤證追溯</div>
          <div class="modal-sub">序號 <span style="font-family:ui-monospace,monospace">${p.sn}</span> · 型號 ${p.model}</div>
        </div>
        <button class="modal-close" aria-label="關閉">×</button>
      </div>
      <div style="padding:16px 18px">
        <div id="recall-progress" style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px">
          🛰 正在比對 5 個國際資料庫…
        </div>
        <div id="recall-list" style="display:grid;gap:8px;font-size:12.5px"></div>
        <div id="recall-result" style="margin-top:14px;display:none">
          <div style="padding:12px 14px;background:rgba(16,185,129,0.08);border-left:3px solid var(--green);border-radius:6px">
            <strong style="color:var(--green)">✓ 未列入任何召回 / 撤證名單</strong>
            <div class="muted" style="font-size:11.5px;margin-top:6px;line-height:1.6">
              查詢時間：${ts}<br>
              下次自動掃描：每日 03:00 (cron) · 命中時 5 分鐘內推 Email + Line<br>
              訂閱費用：US$ 200/年 (CPSC + RAPEX) · 其他免費
            </div>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector(".modal-close").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

  const list = overlay.querySelector("#recall-list");
  let idx = 0;
  dbs.forEach(db => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:rgba(139,152,176,0.05);border-radius:6px";
    row.innerHTML = `
      <div>
        <div><strong style="font-size:12.5px">${db.name}</strong> <span class="muted" style="font-size:10.5px">${db.region}</span></div>
      </div>
      <span class="tag mute" style="font-size:10.5px" data-db="${db.name}">查詢中…</span>`;
    list.appendChild(row);
  });

  // 依序模擬查詢回應
  let cumulative = 0;
  dbs.forEach((db, i) => {
    cumulative += db.delay;
    setTimeout(() => {
      const tag = list.querySelector(`[data-db="${CSS.escape(db.name)}"]`);
      if (tag) {
        tag.className = "tag ok";
        tag.style.fontSize = "10.5px";
        tag.textContent = "✓ 未列入";
      }
      if (i === dbs.length - 1) {
        overlay.querySelector("#recall-progress").innerHTML = "✓ 5 個資料庫全部完成 ·  耗時 1.23s";
        overlay.querySelector("#recall-result").style.display = "block";
      }
    }, cumulative);
  });
}

function exportComplianceBundle(p) {
  const today = new Date();
  const stamp = today.toISOString().slice(0,10).replace(/-/g,"");
  const fname = `${p.sn}_compliance_${stamp}.zip`;
  showToast(`📦 正在打包 ${p.certs.length} 張認證 + 序號清單 + 召回查詢報告…`, "info", 2000);
  setTimeout(() => {
    const totalKB = p.certs.length * 320 + 24;
    showToast(`✓ 已下載 ${fname} (${(totalKB/1024).toFixed(1)} MB · ${p.certs.length} PDFs + manifest.json + recall_check_${stamp}.txt)`, "ok", 6000);
  }, 1800);
}

// 認證更新 (close-loop renewal) modal
const CERT_RENEWAL_YEARS = {
  "UL 9540A": 5,
  "IEC 62619": 5,
  "UN 38.3": 2,
  "CNS 15364-2": 5,
  "EU 2023/1542": 1,
  "ISO 14064-1": 3,
};

function showCertRenewModal(sysId, certIdx) {
  const p = PASSPORTS[sysId];
  const cert = p.certs[certIdx];
  const yrs = CERT_RENEWAL_YEARS[cert.name] || 5;

  const today = new Date();
  const newIssued = today.toISOString().slice(0, 10);
  const newExpDate = new Date(today);
  newExpDate.setFullYear(newExpDate.getFullYear() + yrs);
  const newExpiry = newExpDate.toISOString().slice(0, 10);
  // 新證書編號：把舊編號最後一段（YY-NNNN）替換成今年序號
  const yy = String(today.getFullYear()).slice(-2);
  const serial = String(Math.floor(Math.random() * 9000) + 1000).padStart(5, "0");
  const newCertNo = cert.certNo.replace(/\d{2}-\d+$/, `${yy}-${serial}`);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:620px">
      <div class="modal-head">
        <div>
          <div class="modal-title">📤 更新證書 · ${cert.name}</div>
          <div class="modal-sub">${cert.scope} · ${cert.body} · 系統 ${sysId}</div>
        </div>
        <button class="modal-close" aria-label="關閉">×</button>
      </div>
      <div style="padding:16px 18px">
        <!-- Step 1: drop zone -->
        <div id="renew-step1">
          <div id="renew-drop" style="border:2px dashed var(--border);border-radius:10px;padding:28px 20px;text-align:center;cursor:pointer;transition:all .2s;background:rgba(139,152,176,0.03)">
            <div style="font-size:36px;margin-bottom:8px">📄</div>
            <div style="font-size:13.5px;font-weight:600;margin-bottom:4px">拖放新證書 PDF 至此</div>
            <div class="muted" style="font-size:11.5px">或點擊選擇檔案 · 支援 PDF / JPG / PNG · 最大 10 MB</div>
            <div class="muted" style="font-size:11px;margin-top:14px">系統將透過 OCR 自動讀取證書編號 / 發證日 / 有效期</div>
          </div>
          <div class="muted mt-12" style="font-size:11px;text-align:center">
            🔌 已連接：${cert.body} 認證機構 API（webhook 模式）· 若機構直接推送 PDF，可跳過此步驟
          </div>
        </div>

        <!-- Step 2: OCR diff (hidden initially) -->
        <div id="renew-step2" style="display:none">
          <div class="row" style="padding:8px 12px;background:rgba(139,92,246,0.08);border-left:3px solid var(--purple);border-radius:6px;margin-bottom:14px;font-size:12px">
            <span>🤖 OCR 已解析新證書 · 信心 98.4% · 請核對欄位</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 30px 1fr;gap:10px;font-size:12px">
            <div>
              <div class="muted" style="font-size:10.5px;margin-bottom:6px;letter-spacing:1px">⬅ 舊證書（即將覆蓋）</div>
              <div style="padding:10px 12px;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.2);border-radius:6px;line-height:1.7;font-family:ui-monospace,monospace;font-size:11px">
                <div><span class="muted">編號</span> ${cert.certNo}</div>
                <div><span class="muted">發證</span> ${cert.issued}</div>
                <div><span class="muted">到期</span> ${cert.expiry}</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--text-muted)">→</div>
            <div>
              <div style="font-size:10.5px;margin-bottom:6px;letter-spacing:1px;color:var(--green)">新證書 ➡</div>
              <div style="padding:10px 12px;background:rgba(16,185,129,0.05);border:1px solid rgba(16,185,129,0.3);border-radius:6px;line-height:1.7;font-family:ui-monospace,monospace;font-size:11px">
                <div><span class="muted">編號</span> ${newCertNo}</div>
                <div><span class="muted">發證</span> ${newIssued}</div>
                <div><span class="muted">到期</span> ${newExpiry} <span style="color:var(--green)">(+${yrs} 年)</span></div>
              </div>
            </div>
          </div>
          <div class="muted mt-12" style="font-size:11px;line-height:1.6">
            ⓘ 確認後系統將：<br>
            　① 覆蓋本卡片資料 + 倒數重置為 ${Math.floor((newExpDate - today) / 86400000)} 天<br>
            　② 寫入 audit log（誰、何時、舊→新對照），永久保留<br>
            　③ 取消 30 / 7 / 1 天的到期告警，重新依新到期日排程<br>
            　④ 推 Email + Line 給相關人員：「✓ ${cert.name} 已更新」
          </div>
          <div class="row mt-16" style="gap:8px;justify-content:flex-end">
            <button class="btn btn-ghost" id="renew-cancel" style="padding:6px 14px;font-size:12.5px">取消</button>
            <button class="btn btn-primary" id="renew-confirm" style="padding:6px 14px;font-size:12.5px">✓ 確認覆蓋</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector(".modal-close").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

  // 點 drop zone → 模擬 OCR 過程 → 切到 step 2
  overlay.querySelector("#renew-drop").addEventListener("click", () => {
    const drop = overlay.querySelector("#renew-drop");
    drop.style.borderColor = "var(--primary)";
    drop.innerHTML = `
      <div style="font-size:36px;margin-bottom:8px">⏳</div>
      <div style="font-size:13.5px;font-weight:600;margin-bottom:4px">解析中…</div>
      <div class="muted" style="font-size:11.5px">cert_${cert.name.replace(/\s/g,'_')}_renewed_${newIssued}.pdf · 1.7 MB</div>`;
    setTimeout(() => {
      overlay.querySelector("#renew-step1").style.display = "none";
      overlay.querySelector("#renew-step2").style.display = "block";
    }, 1200);
  });

  overlay.querySelector("#renew-cancel")?.addEventListener("click", close);
  overlay.querySelector("#renew-confirm")?.addEventListener("click", () => {
    // 真的覆蓋資料（in-memory mutation）
    p.certs[certIdx] = {
      ...cert,
      certNo: newCertNo,
      issued: newIssued,
      expiry: newExpiry,
    };
    const auditId = `${newIssued.replace(/-/g, "")}-${String(Math.floor(Math.random()*900)+100)}`;
    close();
    showToast(`✓ ${cert.name} 已更新 · 倒數重置 · audit log #${auditId} 已建立`, "ok", 5000);
    // 重新渲染整頁，倒數標籤會變成綠色
    setTimeout(() => router(), 300);
  });
}

function viewPassport() {
  const sysId = state.passportSys || "SYS-A";
  const p = PASSPORTS[sysId];
  const qrUrl = `https://ems.jjpower.com.tw/passport/${p.sn}`;

  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${t("page.pp.title")}</h1>
        <p class="page-sub">${t("page.pp.sub")}</p>
      </div>
      <div class="page-actions">
        <button class="btn ${sysId==='SYS-A'?'btn-primary':'btn-ghost'}" data-pp="SYS-A">SYS-A · 261 kWh</button>
        <button class="btn ${sysId==='SYS-B'?'btn-primary':'btn-ghost'}" data-pp="SYS-B">SYS-B · 215 kWh</button>
        <button class="btn">${t("btn.print")}</button>
        <button class="btn btn-primary">${t("btn.exportPDF")}</button>
      </div>
    </div>

    <!-- Hero card: QR + identity -->
    <div class="card mb-16" style="display:grid;grid-template-columns:200px 1fr auto;gap:24px;align-items:center">
      <div>
        <div style="width:160px;height:160px;background:#fff;border-radius:8px">${makeQR(qrUrl)}</div>
        <div class="muted" style="font-size:11px;text-align:center;margin-top:6px;word-break:break-all">${qrUrl}</div>
      </div>
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span class="tag" style="background:rgba(0,194,168,0.15);color:var(--primary);font-size:11px;padding:3px 10px">EU PASSPORT v1.0</span>
          <span class="tag ok">${t("pp.cert")}</span>
          <span class="muted" style="font-size:11.5px">${t("pp.lastUpdate")} 2026-04-15</span>
        </div>
        <h2 style="margin:0 0 4px;font-size:22px">${p.model}</h2>
        <div class="muted" style="font-size:12.5px;margin-bottom:14px">${t("pp.serial")} <strong style="color:var(--text);font-family:monospace">${p.sn}</strong></div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
          <div><div class="muted" style="font-size:11px">${t("pp.manufacturer")}</div><div style="font-size:13px;margin-top:2px">${p.manufacturer}</div></div>
          <div><div class="muted" style="font-size:11px">${t("pp.mfgDate")}</div><div style="font-size:13px;margin-top:2px">${p.mfgDate}</div></div>
          <div><div class="muted" style="font-size:11px">${t("pp.installDate")}</div><div style="font-size:13px;margin-top:2px">${p.installDate}</div></div>
          <div><div class="muted" style="font-size:11px">${t("pp.warrantyEnd")}</div><div style="font-size:13px;margin-top:2px">${p.warrantyEnd}</div></div>
        </div>
      </div>
      <div style="text-align:center">
        <div class="muted" style="font-size:11px;margin-bottom:4px">${t("pp.passportId")}</div>
        <div style="font-family:monospace;font-size:13px;color:var(--primary);font-weight:600">EU-PP-2026-${p.sn.slice(-4)}</div>
      </div>
    </div>

    <!-- 3 columns: Chemistry / Carbon / Performance -->
    <div class="grid g-3 mb-16">
      <div class="card">
        <div class="card-head"><h3>${t("pp.chemistry")}</h3><span class="tag info">LFP</span></div>
        <table class="data" style="margin-top:-4px">
          <tr><td>${t("pp.ch.type")}</td><td class="num right">${p.chemistry.type}</td></tr>
          <tr><td>${t("pp.ch.cathode")}</td><td class="num right">${p.chemistry.cathode}</td></tr>
          <tr><td>${t("pp.ch.anode")}</td><td class="num right">${p.chemistry.anode}</td></tr>
          <tr><td>${t("pp.ch.electrolyte")}</td><td class="num right">${p.chemistry.electrolyte}</td></tr>
          <tr><td>${t("pp.ch.separator")}</td><td class="num right">${p.chemistry.separator}</td></tr>
          <tr><td>${t("pp.ch.cellMaker")}</td><td class="num right">${p.chemistry.cellMaker}</td></tr>
          <tr><td>${t("pp.ch.cellModel")}</td><td class="num right">${p.chemistry.cellModel}</td></tr>
          <tr><td>${t("pp.ch.cellCount")}</td><td class="num right">${p.chemistry.cellCount}</td></tr>
          <tr><td>${t("pp.ch.cellSpec")}</td><td class="num right">${p.chemistry.cellNominal}</td></tr>
        </table>
      </div>

      <div class="card">
        <div class="card-head"><h3>${t("pp.carbon")}</h3><span class="tag ok">ISO 14064-1</span></div>
        <div style="text-align:center;padding:8px 0 12px">
          <div style="font-size:30px;font-weight:700;color:var(--green);font-variant-numeric:tabular-nums">${p.carbon.perKWh}</div>
          <div class="muted" style="font-size:12px">kg CO₂e / kWh</div>
          <div style="font-size:13px;margin-top:6px">${t("pp.carb.totalEmit")}：<strong>${(p.carbon.total/1000).toFixed(1)}</strong> ${t("pp.carb.tons")}</div>
        </div>
        <div class="chart-wrap" style="height:140px"><canvas id="chartCarbon"></canvas></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${t("pp.performance")}</h3><span class="tag ok">SOH ${p.performance.soh}%</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;font-size:12.5px;margin-bottom:10px">
          <div><div class="muted" style="font-size:11px">${t("pp.perf.rated")}</div><div class="num strong">${p.performance.ratedKWh} kWh</div></div>
          <div><div class="muted" style="font-size:11px">${t("pp.perf.actual")}</div><div class="num strong">${p.performance.actualKWh} kWh</div></div>
          <div><div class="muted" style="font-size:11px">${t("pp.perf.cycles")}</div><div class="num strong">${p.performance.cyclesUsed} / ${p.performance.cyclesRated}</div></div>
          <div><div class="muted" style="font-size:11px">${t("pp.perf.thru")}</div><div class="num strong">${p.performance.throughputMWh} MWh</div></div>
          <div><div class="muted" style="font-size:11px">${t("pp.perf.avgEff")}</div><div class="num strong">${p.performance.avgEff}%</div></div>
          <div><div class="muted" style="font-size:11px">${t("pp.perf.sohTrend")}</div><div class="num strong" style="color:var(--green)">${p.performance.sohTrend}${t("pp.perf.perMonth")}</div></div>
        </div>
        <div class="muted" style="font-size:11px;margin-bottom:4px">${t("pp.perf.cycleUsage")} ${(p.performance.cyclesUsed/p.performance.cyclesRated*100).toFixed(1)}%</div>
        <div class="pbar"><span style="width:${p.performance.cyclesUsed/p.performance.cyclesRated*100}%"></span></div>
      </div>
    </div>

    <!-- SOH trend with prediction + RUL KPIs -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>${t("pp.soh.title")}</h3>
        <div class="row" style="gap:6px">
          <span class="tag" style="background:rgba(139,92,246,0.12);color:var(--purple);font-size:11px">LSTM v2.3</span>
          <span class="muted" style="font-size:11.5px">${t("pp.soh.retrain")}</span>
        </div>
      </div>
      <div class="grid g-3" style="gap:12px;margin-bottom:14px">
        <div class="stat blue">
          <div class="lbl">${t("pp.soh.current")}</div>
          <div class="val">${p.performance.soh}<span class="u">%</span></div>
          <div class="sub">${t("pp.soh.monthly")} ${p.performance.sohTrend}%</div>
        </div>
        <div class="stat amber">
          <div class="lbl">${t("pp.soh.rul")}</div>
          <div class="val">14.2<span class="u">±1.8 ${t("pp.perf.perMonth").replace('%','').trim() || 'mo'}</span></div>
          <div class="sub">${t("pp.soh.toEol")}</div>
        </div>
        <div class="stat green">
          <div class="lbl">${t("pp.soh.eolDate")}</div>
          <div class="val" style="font-size:18px">2027-06</div>
          <div class="sub">${t("pp.soh.eolCi")}</div>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartSoh"></canvas></div>
      <div class="row mt-12" style="padding:10px 14px;background:rgba(139,92,246,0.06);border-left:3px solid var(--purple);border-radius:6px;font-size:12.5px;line-height:1.6">
        <span><strong>${t("pp.soh.aiObs")}</strong>：歷史 6 個月（藍實線）SOH 線性下降約 0.13%/月；模型偵測電芯內阻離散度 (σ) 開始上升 + 平均工作溫度 29.4°C 偏高，預測未來進入「加速衰退期」（紫虛線），約於 <strong>+14 月（2027-06）</strong> 觸及 EOL 80%（橘虛線）。紫色帶狀為 95% 信賴區間，越遠越寬代表不確定性增加。建議：① EOL 前 6 個月啟動 EPC 採購；② 14:00 高溫時段限制 C-rate 至 0.4C，模型估壽命可延長 ~8%。</span>
      </div>
    </div>

    <!-- Materials & Recycling -->
    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-head"><h3>${t("pp.materials")}</h3></div>
        <table class="data">
          <thead><tr><th>${t("pp.mat.thMat")}</th><th class="right">${t("pp.mat.thWeight")}</th><th class="right">${t("pp.mat.thRecyc")}</th><th>${t("pp.mat.thVerify")}</th></tr></thead>
          <tbody>
            ${p.materials.map(m=>`
              <tr>
                <td>${m.name}</td>
                <td class="num right">${m.percent}%</td>
                <td class="num right" style="color:${m.recycled>=30?'var(--green)':m.recycled>=10?'var(--amber)':'var(--text-muted)'}">${m.recycled}%</td>
                <td><span class="tag ${m.recycled>0?'ok':'mute'}">${m.recycled>0?t("pp.mat.verified"):'N/A'}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="muted mt-12" style="font-size:11.5px">${t("pp.mat.foot")}</div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${t("pp.recycling")}</h3></div>
        <div style="background:rgba(16,185,129,0.06);border-left:3px solid var(--green);padding:10px 14px;border-radius:6px;margin-bottom:12px">
          <div style="font-size:13px"><strong>${t("pp.rec.partner")}：</strong>${p.recycling.partner}</div>
          <div style="font-size:12px;margin-top:4px;color:var(--text-muted)">${t("pp.rec.contact")}：${p.recycling.contact} · ${t("pp.rec.standard")}：${p.recycling.standard}</div>
        </div>
        <table class="data">
          <tr><td>${t("pp.rec.recovery")}</td><td class="num right" style="color:var(--green)">${p.recycling.recoveryRate}%</td></tr>
          <tr><td>${t("pp.rec.destination")}</td><td class="num right">${p.recycling.destination}</td></tr>
          <tr><td>${t("pp.rec.eolEst")}</td><td class="num right">${p.secondLife.eolEstimate}</td></tr>
          <tr><td>${t("pp.rec.eolValue")}</td><td class="num right" style="color:var(--green)">${money(p.secondLife.residualValue)}</td></tr>
        </table>
        <div class="mt-12">
          <div class="muted" style="font-size:11.5px;margin-bottom:6px">${t("pp.rec.suggested")}：</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${p.secondLife.paths.map(x=>`<span class="tag info" style="font-size:11px">${x}</span>`).join("")}
          </div>
        </div>
      </div>
    </div>

    <!-- Certifications (with expiry countdown + recall lookup + export bundle) -->
    ${(() => {
      const today = new Date();
      const certsWithStatus = p.certs.map(c => {
        const exp = new Date(c.expiry);
        const days = Math.ceil((exp - today) / 86400000);
        const status = days <= 30 ? "red" : days <= 90 ? "amber" : "green";
        return { ...c, days, status };
      });
      const urgent = certsWithStatus.filter(c => c.status !== "green").length;
      const headTag = urgent === 0
        ? `<span class="tag ok">${p.certs.length} ${t("pp.cert.allValid")}</span>`
        : `<span class="tag warn">${urgent} ${t("pp.cert.urgent")} · ${t("pp.cert.totalOf")} ${p.certs.length}</span>`;
      return `
      <div class="card mb-16">
        <div class="card-head" style="flex-wrap:wrap;gap:8px">
          <h3>${t("pp.certs")}</h3>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${headTag}
            <button class="btn btn-ghost" id="ppRecallBtn" style="padding:5px 12px;font-size:12px">${t("pp.cert.recallBtn")}</button>
            <button class="btn btn-primary" id="ppExportBtn" style="padding:5px 12px;font-size:12px">${t("pp.cert.exportBtn")}</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
          ${certsWithStatus.map(c => {
            const colorVar = c.status === "red" ? "var(--red)" : c.status === "amber" ? "var(--amber)" : "var(--green)";
            const bgRgba   = c.status === "red" ? "rgba(239,68,68,0.06)" : c.status === "amber" ? "rgba(245,158,11,0.06)" : "rgba(16,185,129,0.05)";
            const dayLabel = c.days < 0
              ? t("pp.cert.expired").replace("{d}", -c.days)
              : c.days === 0 ? t("pp.cert.expireToday")
              : t("pp.cert.daysLeft").replace("{d}", c.days);
            const dayTag = c.status === "red" ? "err" : c.status === "amber" ? "warn" : "ok";
            return `
              <div style="padding:11px 13px;background:${bgRgba};border-left:3px solid ${colorVar};border-radius:6px">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                  <strong style="font-size:13px">${c.name}</strong>
                  <span class="tag ${dayTag}" style="font-size:10.5px;white-space:nowrap">${dayLabel}</span>
                </div>
                <div class="muted" style="font-size:11.5px;margin-top:4px">${c.scope} · ${c.body}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:10.5px">
                  <span style="color:var(--text-muted);font-family:ui-monospace,monospace">${c.certNo}</span>
                  <span style="display:flex;gap:10px">
                    <a href="${c.pdfUrl}" onclick="event.preventDefault();showToast('PDF preview not implemented · placeholder link (' + this.getAttribute('href') + ')','info',3500)" style="color:var(--primary);text-decoration:none">📄 PDF</a>
                    <button data-cert-renew="${certsWithStatus.indexOf(c)}" style="background:none;border:none;padding:0;color:${c.status === 'green' ? 'var(--text-muted)' : 'var(--amber)'};cursor:pointer;font-size:10.5px;font-family:inherit">${t("pp.cert.renewBtn")}</button>
                  </span>
                </div>
                <div class="muted" style="font-size:10.5px;margin-top:3px">${t("pp.cert.issued")} ${c.issued} · ${t("pp.cert.expiry")} ${c.expiry}</div>
              </div>
            `;
          }).join("")}
        </div>
        <div class="muted mt-12" style="font-size:11px">${t("pp.cert.footnote")}</div>
      </div>`;
    })()}

    <!-- Service event timeline -->
    <div class="card">
      <div class="card-head">
        <h3>${t("pp.timeline")}</h3>
        <span class="muted" style="font-size:11.5px;display:flex;align-items:center;gap:6px">
          <span style="background:rgba(16,185,129,0.12);color:var(--green);padding:2px 8px;border-radius:4px;font-size:10.5px;font-weight:600">${t("pp.immutable")}</span>
          <span style="font-size:11px">${t("pp.immutableSub")}</span>
        </span>
      </div>
      <div class="timeline">
        ${p.events.map((e,i)=>`
          <div class="tl-row">
            <div class="tl-dot ${i===0?'cur':''}"></div>
            <div class="tl-body">
              <div class="row between"><strong>${e.type}</strong><span class="muted" style="font-size:11.5px">${e.date}</span></div>
              <div class="muted" style="font-size:12px;margin-top:2px">${e.note}</div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  // System switch
  $$("[data-pp]").forEach(b => b.addEventListener("click", () => {
    state.passportSys = b.dataset.pp;
    router();
  }));

  // 召回追溯 modal
  $("#ppRecallBtn")?.addEventListener("click", () => showRecallModal(p));
  // 匯出合規包
  $("#ppExportBtn")?.addEventListener("click", () => exportComplianceBundle(p));
  // 各認證的「更新證書」按鈕
  $$("[data-cert-renew]").forEach(b => b.addEventListener("click", () => {
    showCertRenewModal(sysId, +b.dataset.certRenew);
  }));

  // Carbon donut
  addChart(new Chart($("#chartCarbon"), {
    type: "doughnut",
    data: {
      labels: p.carbon.breakdown.map(x=>x.stage),
      datasets: [{
        data: p.carbon.breakdown.map(x=>x.value),
        backgroundColor: ["#10b981","#3b82f6","#f59e0b","#8b5cf6","#ec4899"],
        borderColor: "#0f1729", borderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "55%",
      plugins: {
        legend: { position: "right", labels: { boxWidth: 10, font: { size: 10 } } },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmt(c.parsed)} kg (${(c.parsed/p.carbon.total*100).toFixed(1)}%)` } }
      }
    }
  }));

  // SOH timeline + prediction (6m history + 18m projection)
  // History: gentle linear decline (~0.13%/m typical LFP early life)
  // Prediction: accelerated late-life model — AI detects thermal stress / IR drift
  //   SOH(t) = base - 0.62t - 0.045t² → crosses 80% at t≈+14m (matches RUL KPI)
  const months = [];
  const histSoh = [];
  const predSoh = [];
  const ciHigh = [];
  const ciLow = [];
  const det = (i) => ((Math.sin(i * 7919.3) + 1) * 0.5 - 0.5) * 0.16; // deterministic noise ±0.08

  const baseSoh = p.performance.soh; // 98.2

  for (let m = -6; m <= 0; m++) {
    months.push(m === 0 ? "今日" : `${m}m`);
    histSoh.push(+(baseSoh + (-m) * 0.13 + det(m + 10)).toFixed(2));
    predSoh.push(null);
    ciHigh.push(null);
    ciLow.push(null);
  }
  for (let m = 1; m <= 18; m++) {
    months.push(`+${m}m`);
    histSoh.push(null);
    const pred = +(baseSoh - 0.62 * m - 0.045 * m * m).toFixed(2);
    predSoh.push(pred);
    const sigma = 0.45 * Math.sqrt(m); // CI 隨時間擴大
    ciHigh.push(+(pred + sigma * 1.96).toFixed(2));
    ciLow.push(+(pred - sigma * 1.96).toFixed(2));
  }
  // 縫合：歷史終點 = 預測起點 = CI 起點
  predSoh[6] = histSoh[6];
  ciHigh[6] = histSoh[6];
  ciLow[6] = histSoh[6];

  addChart(new Chart($("#chartSoh"), {
    type: "line",
    data: {
      labels: months,
      datasets: [
        // CI 帶（先畫於底層）：上界用 fill:'+1' 朝下界填色
        { label: "信賴區間 95%", data: ciHigh, borderColor: "transparent", backgroundColor: "rgba(139,92,246,0.14)", fill: "+1", pointRadius: 0, spanGaps: false, tension: .3 },
        { label: "_ciLow", data: ciLow, borderColor: "transparent", fill: false, pointRadius: 0, spanGaps: false, tension: .3 },
        // 歷史
        { label: "歷史 SOH (實測)", data: histSoh, borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,0.16)", fill: true, tension: .3, pointRadius: 0, borderWidth: 2.5, spanGaps: false },
        // AI 預測中位線
        { label: "AI 預測 (中位)", data: predSoh, borderColor: "#8b5cf6", backgroundColor: "transparent", fill: false, tension: .3, pointRadius: 0, borderWidth: 2.5, borderDash: [6, 4], spanGaps: false },
        // EOL 閾值
        { label: "EOL 80%", data: months.map(() => 80), borderColor: "#f59e0b", borderWidth: 1.5, borderDash: [3, 3], pointRadius: 0, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true, position: "top",
          labels: { boxWidth: 10, font: { size: 11 }, color: "#cbd5e1", filter: (it) => !it.text.startsWith("_") }
        },
        tooltip: { callbacks: { label: c => c.parsed.y == null ? "" : `${c.dataset.label}: ${c.parsed.y}%` } }
      },
      scales: {
        x: { grid: { color: "rgba(139,152,176,0.06)" }, ticks: { color: "#94a3b8", maxRotation: 0, autoSkip: true, maxTicksLimit: 13 } },
        y: { min: 72, max: 102, grid: { color: "rgba(139,152,176,0.08)" }, ticks: { color: "#94a3b8", callback: v => v + "%" } }
      }
    }
  }));
}

// ────────── Boot ──────────
document.addEventListener("DOMContentLoaded", () => {
  // Mode pill dropdown
  $("#mode-pill").addEventListener("click", (e) => {
    e.stopPropagation();
    const dd = $("#mode-dropdown");
    if (dd.classList.contains("open")) closeDropdown();
    else openDropdown();
  });
  document.addEventListener("click", (e) => {
    const dd = $("#mode-dropdown");
    if (dd.classList.contains("open") && !dd.contains(e.target)) closeDropdown();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDropdown(); });

  // Language pill dropdown
  const langPill = $("#lang-pill"), langDD = $("#lang-dropdown");
  if (langPill && langDD) {
    const fillLangDD = () => {
      langDD.innerHTML = Object.entries(LANGS).map(([id, l]) => `
        <div class="lang-opt ${state.lang===id?'active':''}" data-lang="${id}">
          <span class="lang-opt-code">${l.code}</span>
          <span class="lang-opt-name">${l.name}</span>
          <span class="lang-opt-cur">${FX[id].symbol||FX[id].suffix}${FX[id].code}</span>
          ${state.lang===id?'<span class="lang-opt-check">✓</span>':''}
        </div>
      `).join("") + `<div class="lang-fx-note muted">${t("lang.fxNote")}</div>`;
      langDD.querySelectorAll(".lang-opt").forEach(el => {
        el.addEventListener("click", () => {
          setLang(el.dataset.lang);
          langDD.classList.remove("open");
          langPill.setAttribute("aria-expanded", "false");
        });
      });
    };
    langPill.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = langDD.classList.toggle("open");
      langPill.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) fillLangDD();
    });
    document.addEventListener("click", (e) => {
      if (langDD.classList.contains("open") && !langDD.contains(e.target)) {
        langDD.classList.remove("open");
        langPill.setAttribute("aria-expanded", "false");
      }
    });
    // Initial code
    $("#lang-code").textContent = LANGS[state.lang].code;
    document.documentElement.lang = state.lang === "zh-TW" ? "zh-Hant" : state.lang;
  }

  applyI18nDom();
  renderModePill();
  renderTopbar();
  setInterval(renderTopbar, 5000);
  router();
});
