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
            <span class="tag ${a.sev}">${ {ok:"完成",info:"資訊",warn:"警告",err:"錯誤"}[a.sev] }</span>
          </div>
        `).join("")}
      </div>
    </div>

    <!-- 🔮 AI 明日預測 (Layer 3 · 建議層) -->
    <div class="card mt-16" style="border-left:3px solid var(--purple)">
      <div class="card-head">
        <h3>🔮 明日預測 (AI · 建議層 · 不自動執行)</h3>
        <div class="row" style="gap:6px">
          <span class="tag" style="background:rgba(139,92,246,0.12);color:var(--purple);font-size:11px">LSTM v2.3</span>
          <span class="muted" style="font-size:11.5px">最後訓練 4 小時前</span>
        </div>
      </div>
      <div class="grid g-2" style="gap:14px">
        <div>
          <div class="muted mb-8" style="font-size:12px">明日負載 + PV 預測 (含 95% 信賴區間)</div>
          <div class="chart-wrap" style="height:200px"><canvas id="chartForecast"></canvas></div>
        </div>
        <div>
          <div class="muted mb-8" style="font-size:12px">AI 觀察 + 建議</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="padding:10px 14px;background:rgba(245,158,11,0.08);border-left:3px solid var(--amber);border-radius:6px;font-size:12.5px;line-height:1.6">
              <strong>⚠ 預測異常 · 19:00 負載突增</strong><br>
              <span class="muted">預估尖峰需量達 <strong style="color:var(--text)">2,640 kW</strong>，超出契約 5.6%。建議提早充電並備援放電。</span>
            </div>
            <div style="padding:10px 14px;background:rgba(59,130,246,0.08);border-left:3px solid var(--blue);border-radius:6px;font-size:12.5px;line-height:1.6">
              <strong>☁ 明日 PV 偏低</strong><br>
              <span class="muted">雲量 70%，PV 預估 <strong style="color:var(--text)">1,320 kWh</strong>（一般日 2,180）。少 860 kWh 缺口。</span>
            </div>
            <div style="padding:10px 14px;background:rgba(0,194,168,0.1);border-left:3px solid var(--primary);border-radius:6px;font-size:12.5px;line-height:1.6">
              <strong>💡 建議排程調整</strong>
              <ul style="margin:6px 0 0 18px;padding:0;line-height:1.8;color:var(--text-muted)">
                <li>17:00 提早補充電 +50 kW (避免 19:00 SoC 不足)</li>
                <li>19:00–20:00 多放電 +50 kW (削峰)</li>
                <li>00:00–05:00 維持 180 kW 主充 (離峰補足)</li>
              </ul>
            </div>
            <div class="row mt-8" style="gap:8px">
              <button class="btn btn-primary" style="font-size:12.5px;padding:6px 14px" id="applyAiAdvice">套用建議到排程</button>
              <button class="btn" style="font-size:12px;padding:6px 12px" id="dismissForecast">忽略</button>
              <span class="muted" style="font-size:11px;margin-left:auto">⓵ AI 不會自動執行 — 需人工確認</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 🎬 Compact alarm-action demo strip -->
    <div class="demo-strip" id="demoStrip">
      <div class="demo-strip-icon">🎬</div>
      <div class="demo-strip-text">
        <strong>Demo · 告警停機連動</strong>
        <span class="muted" style="font-size:11.5px">點下方按鈕模擬即時告警，看 EMS 全螢幕接管流程</span>
      </div>
      <div class="demo-strip-buttons">
        <button class="btn-mini" id="dashDemoThermal" title="電芯過熱 → 停機">🌡 過熱停機</button>
        <button class="btn-mini" id="dashDemoFire" style="border-color:var(--red);color:var(--red)" title="煙感 → 消防">🔥 煙感消防</button>
        <button class="btn-mini" id="dashDemoContract" title="超約 → 削峰">⚡ 超約削峰</button>
        <a href="#/alarms" class="muted" style="font-size:11px;text-decoration:none">編輯規則 →</a>
      </div>
    </div>
  `;

  drawFlowMini();
  drawChart24h();
  drawChartSoc();
  drawForecastChart();

  $("#dashDemoThermal")?.addEventListener("click", () => demoTriggerAlarm("thermal"));
  $("#dismissForecast")?.addEventListener("click", () => showToast("AI 預測已忽略，明天重新評估", "info"));
  $("#applyAiAdvice")?.addEventListener("click", () => {
    state.strategy = "aiAdvisory";
    state.scheduleOverride = {};        // clear manual edits so the AI baseline is clean
    renderModePill();
    showToast("已套用 AI 動態建議，請至排程頁檢視差異", "ok", 3500);
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
      <a class="page-tab ${active==='diagram'?'active':''}" href="#/sld">⎔ 單線圖</a>
      <a class="page-tab ${active==='protection'?'active':''}" href="#/protection">🛡 電氣保護</a>
      <a class="page-tab ${active==='comm'?'active':''}" href="#/comm">📡 通訊狀態</a>
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
          <text x="440" y="20" fill="#fbbf24" font-size="9.5" font-weight="700" letter-spacing="1">⚡ 台電所有</text>
          <!-- Customer infrastructure zone (transformer + LV BUS area, middle band) -->
          <rect x="6" y="200" width="1068" height="60" rx="6" fill="rgba(59,130,246,0.04)" stroke="rgba(59,130,246,0.25)" stroke-dasharray="4,3"/>
          <text x="1064" y="215" text-anchor="end" fill="#3b82f6" font-size="9.5" font-weight="700" letter-spacing="1">🏭 客戶 / 廠區設備</text>
          <!-- J&J product zone (PV + cabinets, bottom + left source) -->
          <rect x="60" y="6" width="200" height="190" rx="6" fill="rgba(0,194,168,0.04)" stroke="rgba(0,194,168,0.3)" stroke-dasharray="4,3"/>
          <rect x="280" y="270" width="340" height="180" rx="6" fill="rgba(0,194,168,0.04)" stroke="rgba(0,194,168,0.3)" stroke-dasharray="4,3"/>
          <text x="612" y="445" text-anchor="end" fill="#00c2a8" font-size="9.5" font-weight="700" letter-spacing="1">🟢 J&amp;J Power · Zpower-AC-261L × 2</text>
        </g>

        <!-- TPC Grid -->
        <g>
          <rect x="460" y="20" width="160" height="58" rx="8" fill="#14213d" stroke="#fbbf24" stroke-width="1.5"/>
          <text x="540" y="42" text-anchor="middle" fill="#fbbf24" font-size="13" font-weight="700">台電 22.8kV</text>
          <text x="540" y="60" text-anchor="middle" fill="#cbd5e1" font-size="11">高壓三段式 · 契約 2,500 kW</text>
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
          <text x="555" y="156" fill="#e6edf5" font-size="11" font-weight="600">主變壓器</text>
          <text x="555" y="172" fill="#8b98b0" font-size="10">2500 kVA · 22.8kV/480V</text>
        </g>

        <!-- LV bus -->
        <line x1="100" y1="232" x2="980" y2="232" stroke="#3b82f6" stroke-width="3"/>
        <line x1="540" y1="190" x2="540" y2="232" stroke="#3b82f6" stroke-width="2"/>
        <text x="100" y="248" fill="#3b82f6" font-size="11" font-weight="600">LV BUS 480V</text>

        <!-- PV (上方來源) — 直接 DC 接入 SYS-A 寬版光儲一體機內建 MPPT -->
        <g>
          <rect x="80" y="20" width="180" height="58" rx="8" fill="#1a1505" stroke="#facc15" stroke-width="1.5"/>
          <text x="170" y="42" text-anchor="middle" fill="#facc15" font-size="13" font-weight="700">☀ 太陽能 (DC)</text>
          <text x="170" y="60" text-anchor="middle" fill="#e6edf5" font-size="14" font-weight="700">308 kW</text>
          <text x="170" y="72" text-anchor="middle" fill="#8b98b0" font-size="10">400 kWp · 直接進 SYS-A MPPT</text>

          <!-- DC line going down to SYS-A 's MPPT input -->
          <path d="M 170 78 L 170 260 L 360 260 L 360 280" stroke="#facc15" stroke-width="2" fill="none" stroke-dasharray="5,3" marker-end="url(#arrYellow)">
            <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.3s" repeatCount="indefinite"/>
          </path>
          <text x="180" y="180" fill="#facc15" font-size="11" font-weight="600">↓ DC 直連</text>
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
          <text x="360" y="263" text-anchor="middle" fill="#14b8a6" font-size="11" font-weight="600">↑ 放 118 kW</text>
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
          <text x="540" y="263" text-anchor="middle" fill="#14b8a6" font-size="11" font-weight="600">↑ 放 97 kW</text>
        </g>

        <!-- Load feeders -->
        <g>
          <line x1="740" y1="232" x2="740" y2="300" stroke="#a78bfa" stroke-width="2" marker-end="url(#arrPurple)">
            <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.5s" repeatCount="indefinite"/>
          </line>
          <rect x="680" y="300" width="120" height="78" rx="8" fill="#170e2a" stroke="#a78bfa" stroke-width="1.5"/>
          <text x="740" y="324" text-anchor="middle" fill="#a78bfa" font-size="13" font-weight="700">⚙ 生產負載</text>
          <text x="740" y="345" text-anchor="middle" fill="#e6edf5" font-size="16" font-weight="700">1,735 kW</text>
          <text x="740" y="365" text-anchor="middle" fill="#8b98b0" font-size="10">一廠/二廠/辦公大樓</text>
        </g>
        <g>
          <line x1="900" y1="232" x2="900" y2="300" stroke="#a78bfa" stroke-width="2" marker-end="url(#arrPurple)">
            <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.6s" repeatCount="indefinite"/>
          </line>
          <rect x="840" y="300" width="120" height="78" rx="8" fill="#170e2a" stroke="#a78bfa" stroke-width="1.5"/>
          <text x="900" y="324" text-anchor="middle" fill="#a78bfa" font-size="13" font-weight="700">HVAC/空壓</text>
          <text x="900" y="345" text-anchor="middle" fill="#e6edf5" font-size="16" font-weight="700">385 kW</text>
          <text x="900" y="365" text-anchor="middle" fill="#8b98b0" font-size="10">公用系統</text>
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
          <text fill="#8b98b0" font-size="11" font-weight="600">圖例</text>
          <g transform="translate(0, 14)">
            <rect x="0" y="0" width="12" height="3" fill="#fbbf24"/>
            <text x="20" y="4" fill="#cbd5e1" font-size="11">台電 22.8kV</text>
          </g>
          <g transform="translate(110, 14)">
            <rect x="0" y="0" width="12" height="3" fill="#3b82f6"/>
            <text x="20" y="4" fill="#cbd5e1" font-size="11">低壓 480V</text>
          </g>
          <g transform="translate(210, 14)">
            <rect x="0" y="0" width="12" height="3" fill="#14b8a6"/>
            <text x="20" y="4" fill="#cbd5e1" font-size="11">儲能饋線</text>
          </g>
          <g transform="translate(310, 14)">
            <rect x="0" y="0" width="12" height="3" fill="#facc15"/>
            <text x="20" y="4" fill="#cbd5e1" font-size="11">太陽能</text>
          </g>
          <g transform="translate(400, 14)">
            <rect x="0" y="0" width="12" height="3" fill="#a78bfa"/>
            <text x="20" y="4" fill="#cbd5e1" font-size="11">負載饋線</text>
          </g>
          <g transform="translate(500, 14)">
            <circle cx="6" cy="2" r="5" fill="#10b981"/>
            <text x="20" y="6" fill="#cbd5e1" font-size="11">斷路器 閉</text>
          </g>
        </g>
      </svg>
    </div>

    <div id="sld-mode-content"></div>

    <!-- 接觸器 / DIO 控制面板 -->
    <div class="grid g-2 mt-16">
      <div class="card">
        <div class="card-head">
          <h3>⚡ 接觸器 / 隔離開關狀態</h3>
          <span class="tag ok">遠端</span>
        </div>
        <div class="contactor-grid">
          <div class="contactor-card closed">
            <div class="ct-label">主隔離開關</div>
            <div class="ct-state">閉合</div>
            <div class="ct-icon">━●━</div>
            <div class="ct-meta">22.8kV 主迴路</div>
          </div>
          <div class="contactor-card closed">
            <div class="ct-label">總正接觸器 (K+)</div>
            <div class="ct-state">閉合</div>
            <div class="ct-icon">━●━</div>
            <div class="ct-meta">SYS-A · DC+</div>
          </div>
          <div class="contactor-card closed">
            <div class="ct-label">總負接觸器 (K−)</div>
            <div class="ct-state">閉合</div>
            <div class="ct-icon">━●━</div>
            <div class="ct-meta">SYS-A · DC−</div>
          </div>
          <div class="contactor-card open">
            <div class="ct-label">預充接觸器</div>
            <div class="ct-state">斷開</div>
            <div class="ct-icon">━ ●━</div>
            <div class="ct-meta">預充已完成</div>
          </div>
          <div class="contactor-card closed">
            <div class="ct-label">總正接觸器 (K+)</div>
            <div class="ct-state">閉合</div>
            <div class="ct-icon">━●━</div>
            <div class="ct-meta">SYS-B · DC+</div>
          </div>
          <div class="contactor-card closed">
            <div class="ct-label">總負接觸器 (K−)</div>
            <div class="ct-state">閉合</div>
            <div class="ct-icon">━●━</div>
            <div class="ct-meta">SYS-B · DC−</div>
          </div>
        </div>
        <div class="muted mt-12" style="font-size:11.5px">⚠ 強制開關需主管權限 + 雙人覆核;設備工程模式可進入「協能上位機」處理</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>📡 DIO 數位輸入/輸出狀態</h3>
          <span class="muted" style="font-size:11.5px">8 DI · 8 DO</span>
        </div>
        <div class="dio-grid">
          ${[
            { tag: "DI1", label: "急停按鈕",     on: false },
            { tag: "DI2", label: "門禁感測 #1",  on: false },
            { tag: "DI3", label: "門禁感測 #2",  on: false },
            { tag: "DI4", label: "煙霧偵測",     on: false },
            { tag: "DI5", label: "水浸偵測",     on: false },
            { tag: "DI6", label: "外部聯防訊號", on: true  },
            { tag: "DI7", label: "MSD 開關",     on: true  },
            { tag: "DI8", label: "備用",         on: false },
            { tag: "DO1", label: "故障燈號",     on: false },
            { tag: "DO2", label: "蜂鳴器",       on: false },
            { tag: "DO3", label: "AC 啟動",      on: true  },
            { tag: "DO4", label: "VESDA 排風",   on: false },
            { tag: "DO5", label: "預充控制",     on: false },
            { tag: "DO6", label: "保護動作",     on: false },
            { tag: "DO7", label: "備用",         on: false },
            { tag: "DO8", label: "備用",         on: false },
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
        <div class="card-head"><h3>📊 電力品質</h3><span class="tag ok">關口表即時</span></div>
        <table class="data">
          <tr><td>R 相</td><td class="num">489.2 V</td></tr>
          <tr><td>S 相</td><td class="num">487.8 V</td></tr>
          <tr><td>T 相</td><td class="num">488.4 V</td></tr>
          <tr><td>頻率</td><td class="num">60.02 Hz</td></tr>
          <tr><td>功率因數</td><td class="num">0.96</td></tr>
          <tr><td>THD-V</td><td class="num">2.1%</td></tr>
        </table>
        <div class="muted mt-8" style="font-size:11px">資料源：DLT645 / Modbus RTU 關口表</div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>🌡 主變壓器監測</h3>
          <span class="tag mute">選配</span>
        </div>
        <table class="data" style="opacity:0.7">
          <tr><td>油溫</td><td class="num">— °C</td></tr>
          <tr><td>繞組溫度</td><td class="num">— °C</td></tr>
          <tr><td>有載分接頭</td><td class="num">— / 5</td></tr>
          <tr><td>當前負載率</td><td class="num">— %</td></tr>
          <tr><td>瓦斯繼電器</td><td class="num">—</td></tr>
        </table>
        <div class="row mt-8" style="padding:8px 10px;background:rgba(245,158,11,0.06);border-left:3px solid var(--amber);border-radius:6px;font-size:11.5px;line-height:1.5">
          <span><strong>需 IED 整合</strong>：主變壓器屬<u>客戶廠區設備</u>，此區欄位需另配溫控變送器、有載分接頭控制器或智慧電驛 (SIPROTEC/MICOM/SEL) 經 Modbus / IEC 61850 上送 EMS。</span>
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>🛡 保護電驛</h3>
          <span class="tag mute">選配 IED</span>
        </div>
        <table class="data" style="opacity:0.7">
          <tr><td>50/51 過流</td><td><span class="tag mute">需 IED</span></td></tr>
          <tr><td>27/59 欠過壓</td><td><span class="tag mute">需 IED</span></td></tr>
          <tr><td>81 頻率</td><td><span class="tag mute">需 IED</span></td></tr>
          <tr><td>87T 差動</td><td><span class="tag mute">需 IED</span></td></tr>
          <tr><td>Buchholz</td><td><span class="tag mute">需 IED</span></td></tr>
        </table>
        <a href="#/protection" class="btn btn-ghost mt-8" style="font-size:12px;width:100%;text-align:center;padding:6px">→ 查看完整電氣保護頁</a>
      </div>
    </div>`;
}

// ────────── 2b. Protection (separate route, dedicated page) ──────────
function viewProtection() {
  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">電氣保護</h1>
        <p class="page-sub">保護電驛配置 · 短路電流 · 跳脫紀錄 · 接地監測 · IDMT 配合曲線</p>
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
          <div class="card-head"><h3>🛡 保護電驛配置</h3><span class="tag ok">8/8 正常</span></div>
          <table class="data" style="font-size:12.5px">
            <thead><tr><th>ANSI</th><th>名稱</th><th class="right">設定值</th><th>狀態</th></tr></thead>
            <tbody>
              <tr><td><code>50/51</code></td><td>過流 / 瞬時過流</td><td class="num right">450A · 0.3s</td><td><span class="tag ok">正常</span></td></tr>
              <tr><td><code>50G/51G</code></td><td>接地過流</td><td class="num right">80A inst · 0.5In td=1s</td><td><span class="tag ok">正常</span></td></tr>
              <tr><td><code>27/59</code></td><td>欠/過壓</td><td class="num right">±10/15% × Vn</td><td><span class="tag ok">正常</span></td></tr>
              <tr><td><code>81U/81O</code></td><td>低/高頻率</td><td class="num right">59.5 / 60.5 Hz</td><td><span class="tag ok">正常</span></td></tr>
              <tr><td><code>87T</code></td><td>變壓器差動</td><td class="num right">0.3In · slope 30%</td><td><span class="tag ok">正常</span></td></tr>
              <tr><td><code>25</code></td><td>同步檢查</td><td class="num right">±10° / ±0.2 Hz</td><td><span class="tag ok">啟用</span></td></tr>
              <tr><td><code>49</code></td><td>熱模擬</td><td class="num right">τ = 30 min</td><td><span class="tag ok">正常</span></td></tr>
              <tr><td><code>Buchholz</code></td><td>瓦斯/油流</td><td class="num right">第一段警/第二段跳</td><td><span class="tag ok">正常</span></td></tr>
            </tbody>
          </table>
          <div class="muted mt-8" style="font-size:11px">符合 IEC 60255 · CT 600/5A · VT 22.8kV/110V</div>
        </div>

        <div class="card">
          <div class="card-head"><h3>⚡ 短路電流容量</h3><span class="tag ok">設計餘裕充足</span></div>
          <table class="data">
            <tr><td>22.8kV 高壓側 Isc</td><td class="num right">12.4 kA</td></tr>
            <tr><td>480V 低壓側 Isc</td><td class="num right">32.5 kA</td></tr>
            <tr><td>主 ACB 切斷容量 (Icu)</td><td class="num right">≥ 50 kA</td><td><span class="tag ok">充裕</span></td></tr>
            <tr><td>PCS DC 側熔斷器</td><td class="num right">200A · 1000VDC</td></tr>
            <tr><td>變壓器阻抗</td><td class="num right">6.0%</td></tr>
            <tr><td>系統接地方式</td><td class="num right">高阻接地 (NGR 50Ω)</td></tr>
          </table>
          <div class="muted mt-8" style="font-size:11px">依 IEEE 141 / 242 計算 · 上次校核 2025-12-08</div>
        </div>

        <div class="card">
          <div class="card-head"><h3>📜 最近 30 日跳脫紀錄</h3><span class="tag warn">2 次</span></div>
          <table class="data" style="font-size:12.5px">
            <thead><tr><th>時間</th><th>裝置</th><th>動作</th><th>原因</th></tr></thead>
            <tbody>
              <tr>
                <td class="num muted">04/11 14:23</td>
                <td>VCB-SYS-A</td>
                <td><span class="tag warn">51 過流</span></td>
                <td class="muted">PCS 啟動湧流，自動重合閘成功</td>
              </tr>
              <tr>
                <td class="num muted">04/03 09:08</td>
                <td>主 ACB</td>
                <td><span class="tag info">25 同步</span></td>
                <td class="muted">並網切換，正常動作</td>
              </tr>
              <tr>
                <td class="num muted">03/17 02:55</td>
                <td>VCB-SYS-B</td>
                <td><span class="tag warn">81U 低頻</span></td>
                <td class="muted">59.45 Hz 約 0.6s，符合 LVRT 規範</td>
              </tr>
            </tbody>
          </table>
          <div class="row mt-12" style="padding:8px 12px;background:rgba(0,194,168,0.06);border-left:3px solid var(--primary);border-radius:6px;font-size:12px">
            <span><strong>選擇性協調</strong>：上下游時間級差 ≥ 0.3s · IDMT 配合曲線已校核</span>
          </div>
        </div>
      </div>

      <div class="grid g-2 mt-16">
        <div class="card">
          <div class="card-head"><h3>🌍 接地與絕緣監測 (即時)</h3><span class="tag ok">健康</span></div>
          <table class="data">
            <tr><td>系統對地絕緣</td><td class="num right" style="color:var(--green)">1,650 kΩ</td></tr>
            <tr><td>正極對地</td><td class="num right">3,420 kΩ</td></tr>
            <tr><td>負極對地</td><td class="num right">3,180 kΩ</td></tr>
            <tr><td>絕緣告警閾值</td><td class="num right">≥ 500 kΩ</td></tr>
            <tr><td>漏電流 (CBCT)</td><td class="num right">2.4 mA</td></tr>
            <tr><td>NGR 接地電阻</td><td class="num right">50 Ω · 健康</td></tr>
          </table>
          <div class="muted mt-8" style="font-size:11px">採集週期：每 5 秒 · 來源 BMS Modbus reg [Insulation/Pos/Neg]</div>
        </div>

        <div class="card">
          <div class="card-head"><h3>📈 過流時間配合曲線 (示意)</h3><span class="tag info">IEC 標準</span></div>
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

            <!-- Upstream curve (slower) -->
            <path d="M 60 30 Q 100 60, 160 90 T 320 145" stroke="#3b82f6" stroke-width="2" fill="none"/>
            <text x="200" y="78" fill="#3b82f6" font-size="10" font-weight="600">主 ACB (上游)</text>

            <!-- Downstream curve (faster) -->
            <path d="M 60 60 Q 100 90, 160 115 T 320 158" stroke="#facc15" stroke-width="2" fill="none"/>
            <text x="200" y="135" fill="#facc15" font-size="10" font-weight="600">VCB (下游)</text>

            <!-- Coordination margin band -->
            <path d="M 100 70 L 100 92 M 200 92 L 200 122 M 300 137 L 300 155" stroke="#10b981" stroke-width="1" stroke-dasharray="2,2"/>
            <text x="240" y="50" fill="#10b981" font-size="9">↕ 協調級差 ≥ 0.3s</text>
          </svg>
          <div class="muted mt-8" style="font-size:11px">確保下游故障時下游先動作；上游給予時間餘裕。</div>
        </div>
      </div>`;
  }
}

// ────────── 2c. Communications (separate route, dedicated page) ──────────
function viewComm() {
  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">通訊狀態</h1>
        <p class="page-sub">設備連線健康度 · 鏈路統計 · 故障歷史 · 多協議監測</p>
      </div>
    </div>
    ${sldTabBar("comm")}
    <div id="comm-content"></div>`;
  renderCommContent($("#comm-content"));
}

function renderCommContent(host) {
  {
    const links = [
      { dev:"PCS-A",        proto:"Modbus TCP",   addr:"192.168.1.11:502",     latency:"12 ms",  loss:"0.0%", lastSeen:"剛才", status:"ok" },
      { dev:"PCS-B",        proto:"Modbus TCP",   addr:"192.168.1.12:502",     latency:"14 ms",  loss:"0.0%", lastSeen:"剛才", status:"ok" },
      { dev:"BCU-A",        proto:"Modbus TCP",   addr:"192.168.1.21:502",     latency:"9 ms",   loss:"0.0%", lastSeen:"剛才", status:"ok" },
      { dev:"BCU-B",        proto:"Modbus TCP",   addr:"192.168.1.22:502",     latency:"11 ms",  loss:"0.1%", lastSeen:"剛才", status:"ok" },
      { dev:"BMU 1-13 (A)", proto:"CAN bus",      addr:"125 kbps",             latency:"2 ms",   loss:"0.0%", lastSeen:"剛才", status:"ok" },
      { dev:"BMU 1-11 (B)", proto:"CAN bus",      addr:"125 kbps",             latency:"2 ms",   loss:"0.0%", lastSeen:"剛才", status:"ok" },
      { dev:"關口表 (主)",  proto:"DLT645/RS485", addr:"COM1, addr=01",         latency:"82 ms",  loss:"0.3%", lastSeen:"3 秒前", status:"ok" },
      { dev:"儲能表",       proto:"Modbus RTU",   addr:"COM2, addr=02",         latency:"75 ms",  loss:"0.2%", lastSeen:"3 秒前", status:"ok" },
      { dev:"PV Inverter",  proto:"Modbus TCP",   addr:"192.168.1.31:502",     latency:"18 ms",  loss:"0.0%", lastSeen:"剛才", status:"ok" },
      { dev:"HVAC AC-1",    proto:"BACnet/IP",    addr:"192.168.1.41:47808",   latency:"28 ms",  loss:"0.0%", lastSeen:"剛才", status:"ok" },
      { dev:"HVAC AC-2",    proto:"BACnet/IP",    addr:"192.168.1.42:47808",   latency:"31 ms",  loss:"0.0%", lastSeen:"剛才", status:"ok" },
      { dev:"HVAC AC-3",    proto:"BACnet/IP",    addr:"192.168.1.43:47808",   latency:"245 ms", loss:"4.2%", lastSeen:"12 秒前", status:"warn" },
      { dev:"消防 VESDA",   proto:"DI/Relay",     addr:"DI 4",                  latency:"-",      loss:"-",    lastSeen:"剛才", status:"ok" },
      { dev:"門禁",         proto:"DI/Relay",     addr:"DI 2-3",                latency:"-",      loss:"-",    lastSeen:"剛才", status:"ok" },
      { dev:"台電 OpenADR", proto:"IEC 61850",    addr:"adr.taipower.com.tw",   latency:"180 ms", loss:"0.5%", lastSeen:"30 秒前", status:"ok" },
      { dev:"雲端 MQTT",    proto:"MQTT/TLS",     addr:"$ESS/site/data:8883",   latency:"145 ms", loss:"0.2%", lastSeen:"剛才", status:"ok" },
    ];
    const okN = links.filter(l => l.status === "ok").length;
    const warnN = links.filter(l => l.status === "warn").length;

    host.innerHTML = `
      <!-- Data path: EMS → SCU → BCU → BMS/PCS -->
      <div class="card mt-16">
        <div class="card-head">
          <h3>🔀 資料路徑 · EMS 透過站控分層取得電池資料</h3>
          <span class="muted" style="font-size:11.5px">EMS 不直連 PCS / BMS，所有電池資料經由站控收斂上送</span>
        </div>
        <svg viewBox="0 0 1080 270" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
          <defs>
            <marker id="arrDP" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill="#94a3b8"/>
            </marker>
          </defs>

          <!-- Tier 1: J&J EMS -->
          <g>
            <rect x="380" y="10" width="320" height="48" rx="8" fill="#0a2924" stroke="#00c2a8" stroke-width="1.5"/>
            <text x="540" y="32" text-anchor="middle" fill="#00c2a8" font-size="13" font-weight="700">J&amp;J Power EMS</text>
            <text x="540" y="48" text-anchor="middle" fill="#cbd5e1" font-size="10.5">Web UI · 策略 · TimescaleDB · AI Copilot</text>
          </g>

          <!-- Arrow EMS → SCU -->
          <line x1="540" y1="58" x2="540" y2="92" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrDP)"/>
          <text x="556" y="74" fill="#3b82f6" font-size="10.5" font-weight="600">MQTT / TLS</text>
          <text x="556" y="86" fill="#8b98b0" font-size="9.5">↑ $ESS/{dev}/data 1-5s · ↓ $ESC/{gw}/rpcreq</text>

          <!-- Tier 2: SCU -->
          <g>
            <rect x="320" y="92" width="440" height="48" rx="8" fill="#101a2e" stroke="#3b82f6" stroke-width="1.5"/>
            <text x="540" y="114" text-anchor="middle" fill="#3b82f6" font-size="13" font-weight="700">站控 SCU (Station Control Unit)</text>
            <text x="540" y="130" text-anchor="middle" fill="#cbd5e1" font-size="10.5">Modbus master · MQTT client · 多櫃聚合 · 周邊整合 · 本地策略執行</text>
          </g>

          <!-- 3 branches from SCU -->
          <!-- Branch 1: SCU → BCU -->
          <line x1="430" y1="140" x2="200" y2="178" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrDP)"/>
          <text x="240" y="158" fill="#14b8a6" font-size="10.5" font-weight="600">Modbus TCP @ 1s</text>
          <text x="240" y="170" fill="#8b98b0" font-size="9.5">poll cabinet state (107 欄)</text>

          <!-- Branch 2: SCU → meters -->
          <line x1="540" y1="140" x2="540" y2="178" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrDP)"/>
          <text x="552" y="158" fill="#fbbf24" font-size="10.5" font-weight="600">Modbus RTU @ 5s</text>
          <text x="552" y="170" fill="#8b98b0" font-size="9.5">DLT645 · RS485</text>

          <!-- Branch 3: SCU → HVAC/DI -->
          <line x1="650" y1="140" x2="880" y2="178" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrDP)"/>
          <text x="780" y="158" fill="#a78bfa" font-size="10.5" font-weight="600">BACnet/IP · DI/O</text>
          <text x="780" y="170" fill="#8b98b0" font-size="9.5">HVAC / 消防 / 門禁</text>

          <!-- Tier 3a: BCU -->
          <g>
            <rect x="60" y="180" width="280" height="44" rx="8" fill="#0a2320" stroke="#14b8a6" stroke-width="1.5"/>
            <text x="200" y="201" text-anchor="middle" fill="#14b8a6" font-size="12.5" font-weight="700">櫃控 BCU × N</text>
            <text x="200" y="215" text-anchor="middle" fill="#8b98b0" font-size="10">單櫃整合 · alarm 聚合 · 接 BMS + PCS</text>
          </g>

          <!-- Tier 3b: Meters -->
          <g>
            <rect x="430" y="180" width="220" height="44" rx="8" fill="#1a1505" stroke="#fbbf24" stroke-width="1.5"/>
            <text x="540" y="201" text-anchor="middle" fill="#fbbf24" font-size="12.5" font-weight="700">關口表 / 儲能表</text>
            <text x="540" y="215" text-anchor="middle" fill="#8b98b0" font-size="10">kWh · kW · V · I · 功率因數</text>
          </g>

          <!-- Tier 3c: Peripheral -->
          <g>
            <rect x="740" y="180" width="280" height="44" rx="8" fill="#170e2a" stroke="#a78bfa" stroke-width="1.5"/>
            <text x="880" y="201" text-anchor="middle" fill="#a78bfa" font-size="12.5" font-weight="700">HVAC · 消防 · 門禁</text>
            <text x="880" y="215" text-anchor="middle" fill="#8b98b0" font-size="10">空調溫度 · 煙感 · UPS · 接觸器</text>
          </g>

          <!-- BCU breakdown branches -->
          <line x1="130" y1="224" x2="105" y2="246" stroke="#94a3b8" stroke-width="1.2" marker-end="url(#arrDP)"/>
          <line x1="270" y1="224" x2="295" y2="246" stroke="#94a3b8" stroke-width="1.2" marker-end="url(#arrDP)"/>

          <!-- Tier 4: BMS / PCS (under BCU) -->
          <g>
            <rect x="20" y="246" width="170" height="20" rx="4" fill="rgba(16,185,129,0.08)" stroke="#10b981" stroke-width="1"/>
            <text x="105" y="260" text-anchor="middle" fill="#10b981" font-size="10.5" font-weight="700">BMS (BAU+BMU+CMU)</text>
          </g>
          <g>
            <rect x="210" y="246" width="170" height="20" rx="4" fill="rgba(20,184,166,0.08)" stroke="#14b8a6" stroke-width="1"/>
            <text x="295" y="260" text-anchor="middle" fill="#14b8a6" font-size="10.5" font-weight="700">PCS (功率轉換)</text>
          </g>
          <text x="105" y="240" text-anchor="middle" fill="#8b98b0" font-size="9">CAN @ 100ms · cell V/T · SOC/SOH</text>
          <text x="295" y="240" text-anchor="middle" fill="#8b98b0" font-size="9">CAN @ 50ms · P/Q/狀態</text>
        </svg>
        <div class="grid g-3 mt-12" style="font-size:11.5px;line-height:1.6">
          <div style="padding:8px 12px;background:rgba(0,194,168,0.06);border-left:3px solid var(--primary);border-radius:6px">
            <strong>EMS 端拿到</strong>：107 欄位即時、SOC/SOH、模組 max/min/avg V·T、PCS P/Q、告警旗標
          </div>
          <div style="padding:8px 12px;background:rgba(59,130,246,0.06);border-left:3px solid var(--blue);border-radius:6px">
            <strong>RPC 按需查</strong>：per-cell V (260)、平衡狀態、單模組詳細統計、歷史快照
          </div>
          <div style="padding:8px 12px;background:rgba(245,158,11,0.06);border-left:3px solid var(--amber);border-radius:6px">
            <strong>EMS 端衍生</strong>：SOH 預測、RUL、ΔV heatmap、效率推算、異常分數（AI 模型）
          </div>
        </div>
      </div>

      <!-- KPI summary -->
      <div class="kpi-grid mt-16" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpi green">
          <div class="kpi-label">線上設備</div>
          <div class="kpi-value">${okN}<span class="unit">/${links.length}</span></div>
          <div class="kpi-foot">99.4% 整體可用率</div>
        </div>
        <div class="kpi blue">
          <div class="kpi-label">平均延遲</div>
          <div class="kpi-value">42<span class="unit">ms</span></div>
          <div class="kpi-foot">本地 LAN ~12ms · 雲 ~145ms</div>
        </div>
        <div class="kpi amber">
          <div class="kpi-label">需關注</div>
          <div class="kpi-value">${warnN}</div>
          <div class="kpi-foot">HVAC AC-3 BACnet 抖動</div>
        </div>
        <div class="kpi purple">
          <div class="kpi-label">24h 自動重連</div>
          <div class="kpi-value">3<span class="unit">次</span></div>
          <div class="kpi-foot">100% 復原成功</div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head">
          <h3>📡 裝置連線一覽 (${links.length} 設備)</h3>
          <span class="muted" style="font-size:11.5px">每 5 秒輪詢</span>
        </div>
        <table class="data" style="font-size:12.5px">
          <thead><tr><th>設備</th><th>協議</th><th>位址</th><th class="right">延遲</th><th class="right">封包遺失</th><th class="right">最後通訊</th><th>狀態</th></tr></thead>
          <tbody>
            ${links.map(l => `
              <tr ${l.status==='warn'?'style="background:rgba(245,158,11,0.04)"':''}>
                <td><strong>${l.dev}</strong></td>
                <td><span class="tag info" style="font-size:11px">${l.proto}</span></td>
                <td class="muted" style="font-family:ui-monospace,monospace;font-size:11px">${l.addr}</td>
                <td class="num right">${l.latency}</td>
                <td class="num right">${l.loss}</td>
                <td class="num right muted">${l.lastSeen}</td>
                <td><span class="tag ${l.status}">${l.status==='ok'?'● 線上':'▲ 異常'}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="grid g-2 mt-16">
        <div class="card">
          <div class="card-head"><h3>📶 通訊鏈路健康度 (24h)</h3></div>
          <table class="data">
            <thead><tr><th>鏈路</th><th class="right">可用率</th><th class="right">avg 延遲</th><th class="right">重送</th></tr></thead>
            <tbody>
              <tr><td>Modbus TCP (PCS/BCU)</td><td class="num right" style="color:var(--green)">99.98%</td><td class="num right">12 ms</td><td class="num right">2</td></tr>
              <tr><td>CAN bus (BMU)</td><td class="num right" style="color:var(--green)">100.00%</td><td class="num right">2 ms</td><td class="num right">0</td></tr>
              <tr><td>Modbus RTU (Meter)</td><td class="num right" style="color:var(--green)">99.7%</td><td class="num right">80 ms</td><td class="num right">7</td></tr>
              <tr><td>BACnet/IP (HVAC)</td><td class="num right" style="color:var(--amber)">95.8%</td><td class="num right">102 ms</td><td class="num right">38</td></tr>
              <tr><td>MQTT/TLS (Cloud)</td><td class="num right" style="color:var(--green)">99.2%</td><td class="num right">145 ms</td><td class="num right">5</td></tr>
              <tr><td>OpenADR (TPC)</td><td class="num right" style="color:var(--green)">99.5%</td><td class="num right">180 ms</td><td class="num right">3</td></tr>
            </tbody>
          </table>
          <div class="muted mt-8" style="font-size:11px">所有鏈路均符合 SLA · BACnet 異常已開維運單 #2026-018</div>
        </div>

        <div class="card">
          <div class="card-head"><h3>📜 通訊故障歷史 (近 7 日)</h3></div>
          <table class="data" style="font-size:12.5px">
            <thead><tr><th>時間</th><th>設備</th><th>事件</th><th>恢復</th></tr></thead>
            <tbody>
              <tr><td class="num muted">今 03:15</td><td>HVAC AC-3</td><td><span class="tag warn">BACnet 超時</span></td><td><span class="tag ok">12 秒</span></td></tr>
              <tr><td class="num muted">昨 18:02</td><td>PCS-A</td><td><span class="tag err">Modbus 心跳掉</span></td><td><span class="tag ok">15 秒</span></td></tr>
              <tr><td class="num muted">04/22 09:30</td><td>關口表</td><td><span class="tag warn">RS485 CRC 錯</span></td><td><span class="tag ok">即時</span></td></tr>
              <tr><td class="num muted">04/19 14:48</td><td>雲端 MQTT</td><td><span class="tag warn">TLS 握手延遲</span></td><td><span class="tag ok">2 秒</span></td></tr>
              <tr><td class="num muted">04/19 04:12</td><td>HVAC AC-3</td><td><span class="tag warn">BACnet 超時</span></td><td><span class="tag ok">8 秒</span></td></tr>
            </tbody>
          </table>
          <div class="row mt-12" style="padding:8px 12px;background:rgba(245,158,11,0.06);border-left:3px solid var(--amber);border-radius:6px;font-size:12px">
            <span><strong>診斷建議</strong>：HVAC AC-3 連續 5 日內出現 BACnet 異常，建議檢查網路 switch port 與設備電源。</span>
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
        <h3>SYS-A 模組溫度分佈 · 13 模組 <span class="muted" style="font-size:11px;font-weight:400">BMS 即時上送 max / min / avg</span></h3>
        <div class="row" style="gap:6px;font-size:11px;color:var(--muted)">
          <span><span style="display:inline-block;width:10px;height:10px;background:#10b981;border-radius:50%;vertical-align:-1px"></span> &lt; 33°C</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#f59e0b;border-radius:50%;vertical-align:-1px"></span> 33-35°C</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:50%;vertical-align:-1px"></span> ≥ 35°C</span>
        </div>
      </div>
      <div id="mod-temp"></div>
    </div>

    <div class="grid g-3 mb-16">
      <div class="card">
        <div class="card-head"><h3>絕緣監測</h3><span class="tag ok">正常</span></div>
        <table class="data">
          <tr><td>正極對地</td><td class="num right">3,420 kΩ</td></tr>
          <tr><td>負極對地</td><td class="num right">3,180 kΩ</td></tr>
          <tr><td>總絕緣值</td><td class="num right">1,650 kΩ</td></tr>
          <tr><td>絕緣告警閾值</td><td class="num right">≥ 500 kΩ</td></tr>
          <tr><td>採集週期</td><td class="num right">5 秒</td></tr>
        </table>
        <div class="muted mt-8" style="font-size:11px">Modbus reg: Rack Insulation Value / Pos / Neg</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>電芯不平衡監測</h3><span class="tag warn">關注</span></div>
        <table class="data">
          <tr><td>最高電壓 cell</td><td class="num right">#142 · 3.418 V</td></tr>
          <tr><td>最低電壓 cell</td><td class="num right">#057 · 3.352 V</td></tr>
          <tr><td>壓差 ΔV</td><td class="num right">66 mV</td></tr>
          <tr><td>不平衡告警閾值</td><td class="num right">≥ 80 mV</td></tr>
          <tr><td>主動均衡</td><td><span class="tag ok">運作中</span></td></tr>
        </table>
        <div class="muted mt-8" style="font-size:11px">Modbus reg: Max/Min Cell Voltage + Cell ID</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>BMU 通訊狀態</h3><span class="tag ok">13/13 線上</span></div>
        <table class="data" style="font-size:12px">
          <tr><td>BMU 1–4</td><td class="num right" style="color:var(--green)">●●●●</td></tr>
          <tr><td>BMU 5–8</td><td class="num right" style="color:var(--green)">●●●●</td></tr>
          <tr><td>BMU 9–12</td><td class="num right" style="color:var(--green)">●●●●</td></tr>
          <tr><td>BMU 13</td><td class="num right" style="color:var(--green)">●</td></tr>
          <tr><td>BCU ↔ BMU CAN</td><td class="num right">125 kbps</td></tr>
          <tr><td>掉線次數 (24h)</td><td class="num right">0</td></tr>
        </table>
        <div class="muted mt-8" style="font-size:11px">Modbus reg: BMU1-16 Communication State (bitmap)</div>
      </div>
    </div>

    <div class="grid g-2 mt-16">
      <div class="card">
        <div class="card-head"><h3>PCS 參數即時</h3></div>
        <table class="data">
          <thead><tr><th>參數</th><th class="right">SYS-A</th><th class="right">SYS-B</th></tr></thead>
          <tbody>
            <tr><td>運行模式</td><td class="right">PQ Mode</td><td class="right">PQ Mode</td></tr>
            <tr><td>輸出 P</td><td class="num right">+118.2 kW</td><td class="num right">+97.4 kW</td></tr>
            <tr><td>輸出 Q</td><td class="num right">-3.1 kVAR</td><td class="num right">-1.8 kVAR</td></tr>
            <tr><td>DC 電壓</td><td class="num right">763.4 V</td><td class="num right">758.2 V</td></tr>
            <tr><td>DC 電流</td><td class="num right">155.3 A</td><td class="num right">128.9 A</td></tr>
            <tr><td>效率</td><td class="num right">96.8%</td><td class="num right">96.4%</td></tr>
            <tr><td>模組溫度</td><td class="num right">42 °C</td><td class="num right">44 °C</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-head"><h3>BMS 電芯統計</h3></div>
        <table class="data">
          <thead><tr><th>項目</th><th class="right">SYS-A</th><th class="right">SYS-B</th></tr></thead>
          <tbody>
            <tr><td>模組串數</td><td class="num right">13</td><td class="num right">11</td></tr>
            <tr><td>總電芯數</td><td class="num right">208</td><td class="num right">176</td></tr>
            <tr><td>最高/最低電壓</td><td class="num right">3.42 / 3.35 V</td><td class="num right">3.44 / 3.36 V</td></tr>
            <tr><td>最高/最低溫度</td><td class="num right">30.6 / 28.9 °C</td><td class="num right">31.1 / 29.2 °C</td></tr>
            <tr><td>SOH</td><td class="num right">98.2%</td><td class="num right">98.6%</td></tr>
            <tr><td>累積循環</td><td class="num right">182</td><td class="num right">176</td></tr>
            <tr><td>累積吞吐</td><td class="num right">44.2 MWh</td><td class="num right">34.8 MWh</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><h3>環控系統 (HVAC / Fire / Door)</h3></div>
      <table class="data">
        <thead><tr><th>設備</th><th>機櫃</th><th>狀態</th><th class="right">溫度</th><th class="right">濕度</th><th>通訊</th></tr></thead>
        <tbody>
          <tr><td>空調機 AC-1</td><td>SYS-A</td><td><span class="tag ok">運轉中</span></td><td class="num right">28.4°C</td><td class="num right">52%</td><td><span class="dot dot-ok"></span> 線上</td></tr>
          <tr><td>空調機 AC-2</td><td>SYS-A</td><td><span class="tag ok">運轉中</span></td><td class="num right">28.9°C</td><td class="num right">53%</td><td><span class="dot dot-ok"></span> 線上</td></tr>
          <tr><td>空調機 AC-3</td><td>SYS-B</td><td><span class="tag ok">運轉中</span></td><td class="num right">30.2°C</td><td class="num right">55%</td><td><span class="dot dot-ok"></span> 線上</td></tr>
          <tr><td>消防 VESDA</td><td>All</td><td><span class="tag ok">正常</span></td><td class="num right">-</td><td class="num right">-</td><td><span class="dot dot-ok"></span> 線上</td></tr>
          <tr><td>門禁</td><td>All</td><td><span class="tag ok">關閉</span></td><td class="num right">-</td><td class="num right">-</td><td><span class="dot dot-ok"></span> 線上</td></tr>
          <tr><td>UPS</td><td>EMS 機櫃</td><td><span class="tag ok">市電</span></td><td class="num right">-</td><td class="num right">-</td><td><span class="dot dot-ok"></span> 線上</td></tr>
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
      <div style="text-align:right;font-size:10.5px">min ─ avg ─ max</div>
    </div>
    <div class="row mt-12" style="padding:8px 12px;background:rgba(59,130,246,0.06);border-left:3px solid var(--blue);border-radius:6px;font-size:11.5px;line-height:1.6">
      <span><strong>📡 資料來源</strong>：BMS 即時上送（Modbus reg <code style="font-size:10.5px">Module N Max/Min/Avg Cell Temperature</code>，1s 週期）。海辰 V1.4 規格揭露至模組級；per-cell 溫度需透過 RPC 查詢（回應 ~2s · 一次 16 顆）。</span>
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

  $("#dev-content").innerHTML = `
    <!-- KPI cards -->
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi green">
        <div class="kpi-label">平均電芯電壓</div>
        <div class="kpi-value">${vMean.toFixed(3)}<span class="unit">V</span></div>
        <div class="kpi-foot">384 cells · LFP 標稱 3.2 V</div>
      </div>
      <div class="kpi blue">
        <div class="kpi-label">電壓標準差 (均衡度)</div>
        <div class="kpi-value">${(vStd*1000).toFixed(1)}<span class="unit">mV</span></div>
        <div class="kpi-foot">${vStd*1000<15?'<span style="color:var(--green)">優良</span>':vStd*1000<25?'<span style="color:var(--amber)">尚可</span>':'<span style="color:var(--red)">需均衡</span>'} · 閾值 25 mV</div>
      </div>
      <div class="kpi amber">
        <div class="kpi-label">最大 V 偏差</div>
        <div class="kpi-value">${vRange.toFixed(0)}<span class="unit">mV</span></div>
        <div class="kpi-foot">${(vMax).toFixed(3)} − ${(vMin).toFixed(3)} V · 閾值 50 mV</div>
      </div>
      <div class="kpi ${riskScore<15?'green':riskScore<35?'amber':'pink'}">
        <div class="kpi-label">熱失控風險分數 (AI)</div>
        <div class="kpi-value">${riskScore}<span class="unit">/100</span></div>
        <div class="kpi-foot">${riskScore<15?'低風險':riskScore<35?'中度關注':'立即檢測'}</div>
      </div>
    </div>

    <!-- Voltage histogram + Top 10 weak -->
    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-head">
          <h3>電芯電壓分佈直方圖</h3>
          <div class="row">
            <span class="tag info">SYS-A · 208 cells</span>
            <span class="tag" style="color:var(--ess-teal);background:rgba(20,184,166,0.12)">SYS-B · 176 cells</span>
          </div>
        </div>
        <div class="chart-wrap tall"><canvas id="chartHisto"></canvas></div>
        <div class="muted" style="font-size:11.5px;margin-top:6px">理想為窄鐘形分佈;偏移或拖尾代表電芯不一致或衰退</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Top 10 弱電芯排行</h3>
          <span class="tag warn">需重點關注</span>
        </div>
        <table class="data" style="font-size:12px">
          <thead><tr><th>#</th><th>系統</th><th>編號</th><th class="right">電壓</th><th class="right">溫度</th><th class="right">偏差</th><th></th></tr></thead>
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
                <td><button class="btn btn-ghost" style="padding:2px 8px;font-size:10.5px">派工</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Thermal runaway prognostics — 6 indicator cards -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>🔥 熱失控早期指標 (Prognostics)</h3>
        <span class="muted" style="font-size:12px">物理模型 + ML 推論 · 每 5 秒更新</span>
      </div>
      <div class="prog-grid">
        ${prognosticIndicator("溫度上升斜率", 0.12, 0.3, "°C/min", "monotonic")}
        ${prognosticIndicator("模組間最大溫差", 4.8, 8, "°C", "balanced")}
        ${prognosticIndicator("V/I 相關性", 0.94, 0.7, "ρ", "rising", true)}
        ${prognosticIndicator("自放電率", 0.8, 2.0, "%/週", "monotonic")}
        ${prognosticIndicator("SoC 估算漂移", 1.2, 5, "%", "monotonic")}
        ${prognosticIndicator("電壓變異係數", 4.2, 10, "%", "monotonic")}
      </div>
      <div style="margin-top:14px;padding:10px 14px;background:rgba(16,185,129,0.05);border-left:3px solid var(--green);border-radius:6px;font-size:12.5px">
        <strong>AI 評估：</strong>所有指標皆在安全區間，未觀察到熱失控前兆訊號。預估到下次例行檢測 (2026-07-15) 之間出現異常的機率為 <strong style="color:var(--green)">2.1%</strong>。
      </div>
    </div>

    <!-- 7-day balance trend + IR heat map -->
    <div class="grid g-2">
      <div class="card">
        <div class="card-head"><h3>近 7 日電壓離散度趨勢</h3></div>
        <div class="chart-wrap"><canvas id="chartSpread"></canvas></div>
        <div class="muted" style="font-size:11.5px;margin-top:6px">每日由主動均衡程序壓低離散度;若持續上升代表均衡電路或弱電芯問題</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>電芯電壓偏差熱力圖 · ${SITE.systems[0].cells} cells <span class="muted" style="font-size:11px;font-weight:400">ΔV = Cell V − Avg</span></h3>
          <div class="row" style="gap:4px">
            <span class="muted" style="font-size:11px">−25 mV</span>
            <div style="width:160px;height:8px;background:linear-gradient(90deg,#ef4444,#f59e0b,#10b981,#f59e0b,#ef4444);border-radius:4px"></div>
            <span class="muted" style="font-size:11px">+25 mV</span>
          </div>
        </div>
        <div class="heat" id="dvHeat"></div>
        <div class="muted" style="font-size:11.5px;margin-top:6px">綠色 = 與平均值接近（健康）；黃/紅色 = 偏離 ±15 mV 以上的弱電芯。資料源：BMS Modbus reg [Cell Voltage 1‥512] 減 [Rack Avg Voltage]</div>
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
        x: { title: { display: true, text: "電壓 (V)" }, ticks: { maxTicksLimit: 8 }, grid: { display: false } },
        y: { title: { display: true, text: "電芯數" }, grid: { color: "rgba(139,152,176,0.08)" } }
      }
    }
  }));

  // 7-day spread chart
  const days = ["6 日前","5 日前","4 日前","3 日前","2 日前","昨日","今日"];
  const spreadData = [22.4, 18.6, 24.8, 19.2, 21.5, 17.3, +(vRange).toFixed(1)];
  addChart(new Chart($("#chartSpread"), {
    type: "line",
    data: {
      labels: days,
      datasets: [
        { label: "V Spread", data: spreadData, borderColor: "#00c2a8", backgroundColor: "rgba(0,194,168,0.18)", fill: true, tension: 0.35, pointRadius: 4, borderWidth: 2 },
        { label: "閾值", data: days.map(()=>50), borderColor: "#ef4444", borderWidth: 1, borderDash: [4,3], pointRadius: 0, fill: false }
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
  const status = ok ? "正常" : warn ? "監視" : "警示";
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
      <div class="prog-foot muted">閾值 ${higherIsBetter ? "≥" : "≤"} ${threshold} ${unit}</div>
    </div>
  `;
}

function renderSysCard(sys) {
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>${sys.id} · ${sys.pcsKW} kW / ${sys.batteryKWh} kWh</h3>
          <div class="muted" style="font-size:12px; margin-top:2px">${sys.vendor} · 液冷 · 磷酸鐵鋰</div>
        </div>
        <span class="tag ok">● 運轉中</span>
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
          <div class="muted" style="font-size:12px">當前功率</div>
          <div class="val" style="font-size:20px;font-weight:700;color:var(--ess-teal)">+${Math.round(sys.pcsKW*0.94)} <span style="font-size:12px;color:var(--text-muted)">kW</span></div>
          <div class="muted mt-8" style="font-size:11.5px">放電模式 · 套利</div>
        </div>
        <div>
          <div class="muted" style="font-size:12px">電芯溫度</div>
          <div class="val" style="font-size:20px;font-weight:700">${sys.temp}<span style="font-size:12px;color:var(--text-muted)"> °C</span></div>
          <div class="muted mt-8" style="font-size:11.5px">Δ 1.8°C · 正常</div>
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
    P: { label: "尖峰",   color: "#ef4444", bg: "rgba(239,68,68,0.55)"  },
    M: { label: "半尖峰", color: "#f59e0b", bg: "rgba(245,158,11,0.45)" },
    O: { label: "離峰",   color: "#10b981", bg: "rgba(16,185,129,0.35)" },
  };
  const days = ["週一","週二","週三","週四","週五","週六","週日"];

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
        <h1 class="page-title">電價方案</h1>
        <p class="page-sub">編輯時段、單價、契約配置 — 所有計算（排程、財務頁）即時連動</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" id="tariffReset">恢復預設</button>
        <button class="btn">新增方案</button>
        <button class="btn btn-primary" id="tariffSave">儲存變更</button>
      </div>
    </div>

    <!-- 1. Plan selector -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>📋 方案選擇</h3>
        <span class="muted" style="font-size:11.5px">生效期 ${tp.effectiveFrom} 起</span>
      </div>
      <div class="row" style="gap:14px;flex-wrap:wrap">
        <select class="inp" style="min-width:280px">
          <option>${tp.name}</option>
          <option>高壓三段式時間電價 (非夏月)</option>
          <option>高壓二段式時間電價</option>
          <option>低壓電力</option>
          <option>+ 新增自訂方案…</option>
        </select>
        <div class="row" style="gap:6px">
          <button class="btn btn-ghost" style="font-size:12px">複製當前</button>
          <button class="btn btn-ghost" style="font-size:12px">匯出 JSON</button>
        </div>
      </div>
    </div>

    <!-- 2. 24h × 7day heat map -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>🗓 時段視覺化 (24h × 7day)</h3>
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <span class="muted" style="font-size:11.5px">畫筆：</span>
          <button class="tariff-tool active" data-tool="P" style="--c:#ef4444"><span class="dot" style="background:#ef4444"></span>尖峰</button>
          <button class="tariff-tool" data-tool="M" style="--c:#f59e0b"><span class="dot" style="background:#f59e0b"></span>半尖峰</button>
          <button class="tariff-tool" data-tool="O" style="--c:#10b981"><span class="dot" style="background:#10b981"></span>離峰</button>
          <button class="btn btn-ghost" id="tariffUndo" style="margin-left:12px;font-size:12px;padding:5px 12px" disabled>↶ 復原</button>
        </div>
      </div>
      <div class="tariff-grid-wrap">
        <div class="tariff-hour-axis">
          <div></div>${Array.from({length:24}, (_,h)=>`<div>${String(h).padStart(2,"0")}</div>`).join("")}
        </div>
        ${days.map((dn, di) => `
          <div class="tariff-row">
            <div class="tariff-day">${dn}</div>
            ${tp.grid[di].map((t, h) => `
              <div class="tariff-cell" data-day="${di}" data-hour="${h}"
                   style="background:${PERIOD_META[t].bg}" title="${dn} ${String(h).padStart(2,"0")}:00 · ${PERIOD_META[t].label}">${PERIOD_META[t].label[0]}</div>
            `).join("")}
          </div>
        `).join("")}
      </div>
      <div class="muted mt-12" style="font-size:11.5px">點擊或拖曳格子套用畫筆。常見用法：複製週一規則到週二–週五，或把週六改半尖峰。</div>
    </div>

    <!-- 3 & 4. Prices + basic charges -->
    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-head"><h3>💰 流動電費 (NT$/度)</h3></div>
        <table class="data">
          <tr><td><span class="tag err">尖峰</span></td>
              <td><input class="inp tariff-price" data-key="P" type="number" step="0.01" value="${tp.prices.P}" style="width:100px"> NT$</td></tr>
          <tr><td><span class="tag warn">半尖峰</span></td>
              <td><input class="inp tariff-price" data-key="M" type="number" step="0.01" value="${tp.prices.M}" style="width:100px"> NT$</td></tr>
          <tr><td><span class="tag ok">離峰</span></td>
              <td><input class="inp tariff-price" data-key="O" type="number" step="0.01" value="${tp.prices.O}" style="width:100px"> NT$</td></tr>
        </table>
        <div class="muted mt-8" style="font-size:11.5px">當前尖離峰價差：NT$ ${(tp.prices.P - tp.prices.O).toFixed(2)}/度（套利空間）</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>📐 基本電費 (契約容量)</h3></div>
        <table class="data">
          ${Object.entries(tp.basicCharges).map(([k,b]) => `
            <tr>
              <td>${b.label}</td>
              <td><input class="inp tariff-basic" data-key="${k}" type="number" step="0.1" value="${b.ratePerKW}" style="width:100px"> 元/kW · 月</td>
            </tr>`).join("")}
        </table>
        <div class="muted mt-8" style="font-size:11.5px">超約附加費規則：≤10% × ${tp.overContractPenalty.withinMultiplier} 倍、>10% × ${tp.overContractPenalty.aboveMultiplier} 倍</div>
      </div>
    </div>

    <!-- 5. Monthly estimate -->
    <div class="card">
      <div class="card-head">
        <h3>🧮 本月電費試算（依當前策略 ${STRATEGIES[state.strategy].label}）</h3>
        <span class="tag ${overPct>0?"warn":"ok"}">${overPct>0?`超約 ${overPct.toFixed(1)}%`:"未超約"}</span>
      </div>
      <table class="data">
        <thead><tr><th>項目</th><th class="right">用量</th><th class="right">單價</th><th class="right">小計</th></tr></thead>
        <tbody>
          <tr><td><span class="tag err">尖峰</span> 流動電費</td>
              <td class="num right">${fmt(monthlyByPeriod.P)} 度</td>
              <td class="num right">$${tp.prices.P.toFixed(2)}</td>
              <td class="num right">${money(monthlyByPeriod.P*tp.prices.P)}</td></tr>
          <tr><td><span class="tag warn">半尖峰</span> 流動電費</td>
              <td class="num right">${fmt(monthlyByPeriod.M)} 度</td>
              <td class="num right">$${tp.prices.M.toFixed(2)}</td>
              <td class="num right">${money(monthlyByPeriod.M*tp.prices.M)}</td></tr>
          <tr><td><span class="tag ok">離峰</span> 流動電費</td>
              <td class="num right">${fmt(monthlyByPeriod.O)} 度</td>
              <td class="num right">$${tp.prices.O.toFixed(2)}</td>
              <td class="num right">${money(monthlyByPeriod.O*tp.prices.O)}</td></tr>
          <tr><td>基本電費 (經常契約)</td>
              <td class="num right">${fmt(peakDemand)} kW</td>
              <td class="num right">$${tp.basicCharges.routine.ratePerKW.toFixed(1)}</td>
              <td class="num right">${money(basicCost)}</td></tr>
          ${penalty > 0 ? `<tr style="background:rgba(239,68,68,0.05)">
            <td><span class="tag err">超約罰款</span></td>
            <td class="num right">${overPct.toFixed(1)}%</td>
            <td class="num right">${tp.overContractPenalty.withinMultiplier}× 基本</td>
            <td class="num right" style="color:var(--red)">${money(penalty)}</td>
          </tr>` : ""}
          <tr style="background:rgba(0,194,168,0.06)">
            <td class="strong">本月總電費</td>
            <td colspan="2" class="num right muted">含基本 ${money(basicCost)} + 流動 ${money(energyCost)} ${penalty>0?`+ 罰款 ${money(penalty)}`:""}</td>
            <td class="num right strong" style="font-size:18px;color:var(--primary)">${money(totalCost+penalty)}</td>
          </tr>
        </tbody>
      </table>
      <div class="muted mt-8" style="font-size:11.5px">※ 試算依當前策略 24h 模擬曲線推估，實際以台電帳單為準。</div>
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
    undoBtn.textContent = undoStack.length > 0 ? `↶ 復原 (${undoStack.length})` : "↶ 復原";
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
    showToast(`已復原 ${batch.length} 格`, "info", 1500);
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
      showToast("流動電費已更新（影響排程試算）", "ok", 2000);
    });
  });
  $$(".tariff-basic").forEach(inp => {
    inp.addEventListener("change", () => {
      tp.basicCharges[inp.dataset.key].ratePerKW = +inp.value || 0;
    });
  });

  $("#tariffReset").addEventListener("click", () => {
    state.tariffDraft = null;
    showToast("已恢復預設電價方案", "info");
    router();
  });
  $("#tariffSave").addEventListener("click", () => {
    showToast("✓ 電價方案已儲存（生效於下個結算週期）", "ok", 4000);
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
        <button class="btn">全部</button>
        <button class="btn btn-ghost">錯誤</button>
        <button class="btn btn-ghost">警告</button>
        <button class="btn btn-ghost">資訊</button>
      </div>
    </div>

    <div class="card mb-16" style="border-left:3px solid var(--amber);background:linear-gradient(90deg,rgba(245,158,11,0.06),transparent)">
      <div class="card-head" style="margin-bottom:8px">
        <h3>🎬 Demo · 觸發告警停機連動</h3>
        <span class="muted" style="font-size:11.5px">點下方按鈕模擬即時告警，看 EMS 自動接管的全螢幕流程</span>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="demoAlarmThermal">🌡 模擬電芯過熱（停機）</button>
        <button class="btn btn-primary" id="demoAlarmFire" style="background:var(--red);border-color:var(--red);color:#fff">🔥 模擬煙感觸發（消防）</button>
        <button class="btn" id="demoAlarmContract">⚡ 模擬契約超約（降載）</button>
      </div>
    </div>

    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="kpi-label">未處理</div><div class="kpi-value">3</div><div class="kpi-foot">需關注</div></div>
      <div class="kpi green"><div class="kpi-label">今日已處理</div><div class="kpi-value">12</div><div class="kpi-foot">自動恢復 9 / 手動 3</div></div>
      <div class="kpi amber"><div class="kpi-label">警告</div><div class="kpi-value">2</div><div class="kpi-foot">熱控、通訊</div></div>
      <div class="kpi pink"><div class="kpi-label">錯誤</div><div class="kpi-value">1</div><div class="kpi-foot">PCS 通訊歷史</div></div>
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
      <div class="card-head"><h3>即時告警</h3>
        <div class="row"><span class="muted" style="font-size:12px">每 10 秒刷新</span></div>
      </div>
      <table class="data">
        <thead><tr><th>時間</th><th>等級</th><th>設備</th><th>訊息</th><th>詳情</th><th>動作</th></tr></thead>
        <tbody>
          ${ALARMS.map(a=>`
            <tr>
              <td class="num">${a.ts}</td>
              <td><span class="tag ${a.sev}">${ {ok:"完成",info:"資訊",warn:"警告",err:"錯誤"}[a.sev] }</span></td>
              <td>${a.sys}</td>
              <td>${a.msg}</td>
              <td class="muted">${a.detail}</td>
              <td><button class="btn btn-ghost" style="padding:3px 10px;font-size:11.5px">確認</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <!-- 🔗 Interlock rules editor -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>🔗 告警 → 自動動作 規則</h3>
        <div class="row" style="gap:6px">
          <button class="btn btn-ghost" style="font-size:12px">匯入模板</button>
          <button class="btn" style="font-size:12px">+ 新增規則</button>
        </div>
      </div>
      <table class="data">
        <thead><tr>
          <th>啟</th><th>告警代碼</th><th>名稱</th><th>嚴重度</th><th>觸發閾值</th>
          <th>自動動作</th><th class="right">延遲</th><th></th>
        </tr></thead>
        <tbody>
          ${ALARM_RULES.map((r,i) => `
            <tr>
              <td><input type="checkbox" ${r.enabled?'checked':''} class="rule-toggle" data-i="${i}"></td>
              <td><code style="font-size:11.5px;color:var(--text-muted)">${r.code}</code></td>
              <td>${r.name}</td>
              <td><span class="tag ${r.sev === 'critical' ? 'err' : r.sev === 'error' ? 'err' : r.sev === 'warning' ? 'warn' : 'info'}">${ {critical:'重大',error:'錯誤',warning:'警告',info:'資訊'}[r.sev] }</span></td>
              <td><input class="inp rule-thr" data-i="${i}" value="${r.threshold}" style="width:120px;font-size:12px;padding:4px 8px"></td>
              <td>
                <span class="action-tag act-${r.actType}">
                  ${ {shutdown:'🛑',derate:'🔻',reset:'🔁',notify:'🔔'}[r.actType] } ${r.action}
                </span>
              </td>
              <td class="num right"><input class="inp rule-delay" data-i="${i}" value="${r.delaySec}" type="number" style="width:60px;font-size:12px;padding:4px 8px;text-align:right"> 秒</td>
              <td><button class="btn-mini rule-test" data-i="${i}" title="觸發測試">▶</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="muted mt-12" style="font-size:11.5px">勾選 = 啟用 · 直接編輯閾值與延遲秒數 · 點 ▶ 立即模擬觸發看連動效果。</div>
    </div>

    <!-- 📜 Action audit history -->
    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-head"><h3>📜 自動動作執行歷史 (近 30 日)</h3></div>
        <div class="grid g-3" style="gap:10px;margin-bottom:14px">
          <div class="stat" style="padding:14px"><div class="lbl">總執行次數</div><div class="val">${ALARM_HISTORY.totals.shutdown + ALARM_HISTORY.totals.derate + ALARM_HISTORY.totals.notify}</div></div>
          <div class="stat amber" style="padding:14px"><div class="lbl">停機 / 降載</div><div class="val">${ALARM_HISTORY.totals.shutdown} / ${ALARM_HISTORY.totals.derate}</div></div>
          <div class="stat blue" style="padding:14px"><div class="lbl">通知</div><div class="val">${ALARM_HISTORY.totals.notify}</div></div>
        </div>
        <table class="data" style="font-size:12.5px">
          <thead><tr><th>時間</th><th>規則</th><th>動作</th><th>觸發者</th><th>結果</th></tr></thead>
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
          <div><span class="muted">停機影響：</span><strong>${ALARM_HISTORY.downtimeHours} 小時</strong></div>
          <div><span class="muted">損失放電：</span><strong>${ALARM_HISTORY.lostKWh} kWh</strong></div>
          <div><span class="muted">機會成本：</span><strong style="color:var(--red)">${money(ALARM_HISTORY.lostNTD)}</strong></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>🏆 最常觸發告警 Top 5</h3></div>
        <table class="data" style="font-size:12.5px">
          <thead><tr><th>#</th><th>告警</th><th class="right">次數</th></tr></thead>
          <tbody>
            ${ALARM_HISTORY.topTriggers.map((t,i) => `
              <tr>
                <td class="num muted">${i+1}</td>
                <td>
                  <code style="font-size:11px;color:var(--text-muted)">${t.code}</code>
                  <div class="muted" style="font-size:11.5px;margin-top:2px">${t.recommendation}</div>
                </td>
                <td class="num right"><strong>${t.count}</strong></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="grid g-2">
      <div class="card">
        <div class="card-head"><h3>告警分佈 (近 7 日)</h3></div>
        <div class="chart-wrap"><canvas id="alarmPie"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>推播通知設定</h3></div>
        <table class="data">
          <tr><td>Line Notify</td><td><span class="tag ok">啟用</span></td><td class="muted">2 個群組</td></tr>
          <tr><td>Email</td><td><span class="tag ok">啟用</span></td><td class="muted">3 位收件人</td></tr>
          <tr><td>Webhook</td><td><span class="tag mute">未啟用</span></td><td class="muted">-</td></tr>
          <tr><td>台電 OpenADR</td><td><span class="tag ok">啟用</span></td><td class="muted">sReg 需量反應</td></tr>
        </table>
        <div class="muted mt-16" style="font-size:12px">錯誤等級以上每 5 分鐘重送，直到確認。</div>
      </div>
    </div>
  `;

  addChart(new Chart($("#alarmPie"), {
    type: "doughnut",
    data: {
      labels: ["通訊", "熱控", "BMS 均衡", "PCS 保護", "其他"],
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
      showToast(`規則 ${ALARM_RULES[i].code} 已${cb.checked?"啟用":"停用"}`, cb.checked?"ok":"warn", 2000);
    });
  });
  $$(".rule-thr").forEach(inp => {
    inp.addEventListener("change", () => {
      ALARM_RULES[+inp.dataset.i].threshold = inp.value;
      showToast("閾值已更新", "ok", 1500);
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
      if (!r.enabled) { showToast("規則停用中，無法測試", "warn"); return; }
      // Map specific rules to demo presets, otherwise generic
      if (r.code === "cell.temp.high") return demoTriggerAlarm("thermal");
      if (r.code === "fire.smoke")     return demoTriggerAlarm("fire");
      if (r.code === "contract.over")  return demoTriggerAlarm("contract");
      showCriticalAlarm({
        code: r.code, severity: r.sev, device: "測試設備",
        message: r.name, detail: `規則測試 — 模擬 ${r.threshold} 觸發`,
        threshold: r.threshold, value: "(模擬)",
        action: r.action, actionType: r.actType,
        recommendation: "此為規則測試，實際運行時將自動執行該動作。",
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
        <div class="card-head"><h3>站點基本資料</h3></div>
        <div class="grid g-2e" style="gap:12px">
          <div class="form-row"><label>站點名稱</label><input class="inp" value="${SITE.name}" /></div>
          <div class="form-row"><label>地址</label><input class="inp" value="${SITE.address}" /></div>
          <div class="form-row"><label>契約容量 (kW)</label><input class="inp" value="${SITE.contractKW}" /></div>
          <div class="form-row"><label>電價方案</label><input class="inp" value="${SITE.tariff}" /></div>
          <div class="form-row"><label>產業別</label><input class="inp" value="${SITE.industry}" /></div>
          <div class="form-row"><label>太陽能裝置 (kWp)</label><input class="inp" value="${SITE.pvKWp}" /></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>儲能系統規格</h3></div>
        <table class="data">
          <thead><tr><th>系統</th><th class="right">PCS (kW)</th><th class="right">電池 (kWh)</th><th class="right">SoC</th><th>廠牌</th></tr></thead>
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
              <td class="strong">合計</td>
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
        <h3>通訊協議地圖</h3>
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
          <text x="600" y="42" text-anchor="middle" fill="#00c2a8" font-size="15" font-weight="800">☁  J&amp;J Power EMS Cloud  ← 即本系統</text>
          <text x="600" y="62" text-anchor="middle" fill="#cbd5e1" font-size="11.5">Web UI · 多租戶 · TimescaleDB · 策略引擎 · AI Copilot · 告警引擎</text>
          <text x="600" y="80" text-anchor="middle" fill="#94e0d2" font-size="10.5">三拓撲：A 邊緣單站 / B 純 IP 多站 / C 雲地架構</text>
        </g>

        <!-- TPC trading platform (right of cloud) -->
        <g>
          <rect x="900" y="30" width="220" height="48" rx="8" fill="#0a1830" stroke="#3b82f6" stroke-width="1.2"/>
          <text x="1010" y="50" text-anchor="middle" fill="#93c5fd" font-size="13" font-weight="600">⚡ 台電交易平台</text>
          <text x="1010" y="68" text-anchor="middle" fill="#8b98b0" font-size="10.5">sReg / dReg / 即時備轉</text>
        </g>

        <!-- MQTT line cloud↔站控 -->
        <line x1="540" y1="94" x2="540" y2="160" stroke="#8b5cf6" stroke-width="2" stroke-dasharray="6,3" marker-end="url(#pa-purple)">
          <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1.5s" repeatCount="indefinite"/>
        </line>
        <text x="552" y="118" fill="#a78bfa" font-size="11" font-weight="600">↑ MQTT 上行 (QoS 1)</text>
        <text x="552" y="132" fill="#8b98b0" font-size="10">$ESS/{設備}/data · FULL/VARY</text>
        <line x1="660" y1="160" x2="660" y2="94" stroke="#8b5cf6" stroke-width="2" stroke-dasharray="6,3" marker-end="url(#pa-purple)">
          <animate attributeName="stroke-dashoffset" from="0" to="18" dur="1.5s" repeatCount="indefinite"/>
        </line>
        <text x="672" y="118" fill="#a78bfa" font-size="11" font-weight="600">↓ RPC 下行 (QoS 1)</text>
        <text x="672" y="132" fill="#8b98b0" font-size="10">$ESC/{網關}/rpcreq</text>

        <!-- IEC 104 line tpc→站控 -->
        <path d="M 1010 78 Q 1010 130, 750 175" stroke="#3b82f6" stroke-width="2" fill="none" stroke-dasharray="5,3" marker-end="url(#pa-blue)">
          <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.8s" repeatCount="indefinite"/>
        </path>
        <text x="900" y="130" fill="#60a5fa" font-size="11" font-weight="600">IEC 60870-5-104</text>

        <!-- Site controller -->
        <g>
          <rect x="450" y="160" width="300" height="74" rx="10" fill="#0a2024" stroke="#00c2a8" stroke-width="2"/>
          <text x="600" y="188" text-anchor="middle" fill="#00c2a8" font-size="15" font-weight="800">站控一體機 (Site Controller)</text>
          <text x="600" y="208" text-anchor="middle" fill="#e6edf5" font-size="11.5">HiEMS-SCU-V2-2 · BCM2711 · Linux</text>
          <text x="600" y="224" text-anchor="middle" fill="#8b98b0" font-size="10.5">每案場 1 台 · 策略引擎 · 雲端代理 · OTA</text>
        </g>

        <!-- Site → meter (RS485) -->
        <line x1="450" y1="195" x2="280" y2="280" stroke="#f59e0b" stroke-width="2" marker-end="url(#pa-amber)">
          <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1.6s" repeatCount="indefinite"/>
        </line>
        <text x="280" y="240" fill="#fbbf24" font-size="11" font-weight="600">DLT645 / Modbus RTU</text>
        <text x="280" y="254" fill="#8b98b0" font-size="10">RS485 · 9600 baud · 光纖 (option)</text>

        <!-- Meters -->
        <g>
          <rect x="100" y="280" width="220" height="68" rx="8" fill="#1a1505" stroke="#f59e0b" stroke-width="1.2"/>
          <text x="210" y="306" text-anchor="middle" fill="#fbbf24" font-size="13" font-weight="600">📊 關口表 / 儲能表</text>
          <text x="210" y="324" text-anchor="middle" fill="#8b98b0" font-size="10.5">三相多功能電錶</text>
          <text x="210" y="340" text-anchor="middle" fill="#8b98b0" font-size="10.5">P / Q / V / I / kWh / 功率因數</text>
        </g>

        <!-- Site → switch (Ethernet) -->
        <line x1="600" y1="234" x2="600" y2="290" stroke="#00c2a8" stroke-width="2" marker-end="url(#pa-teal)"/>
        <text x="612" y="270" fill="#00c2a8" font-size="11" font-weight="600">Ethernet (1 GbE)</text>

        <!-- Switch -->
        <g>
          <rect x="490" y="290" width="220" height="42" rx="6" fill="#101a2e" stroke="#3b82f6" stroke-width="1.5"/>
          <text x="600" y="312" text-anchor="middle" fill="#93c5fd" font-size="12" font-weight="700">⇆ 工業 Switch (8-port, IP30)</text>
          <text x="600" y="326" text-anchor="middle" fill="#8b98b0" font-size="10">192.168.1.0/24</text>
        </g>

        <!-- Switch → Cabinet 1 -->
        <line x1="540" y1="332" x2="280" y2="400" stroke="#00c2a8" stroke-width="2" marker-end="url(#pa-teal)">
          <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.3s" repeatCount="indefinite"/>
        </line>
        <text x="320" y="370" fill="#00c2a8" font-size="11" font-weight="600">Modbus TCP</text>
        <text x="320" y="384" fill="#8b98b0" font-size="10">port 502 · Unit 1</text>

        <!-- Switch → Cabinet 2 -->
        <line x1="660" y1="332" x2="920" y2="400" stroke="#00c2a8" stroke-width="2" marker-end="url(#pa-teal)">
          <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.4s" repeatCount="indefinite"/>
        </line>
        <text x="820" y="370" fill="#00c2a8" font-size="11" font-weight="600">Modbus TCP</text>
        <text x="820" y="384" fill="#8b98b0" font-size="10">port 502 · Unit 2</text>

        <!-- Cabinet 1 outline -->
        <g>
          <rect x="80" y="400" width="400" height="296" rx="10" fill="#0a0e1e" stroke="#1b2740" stroke-width="1.5" stroke-dasharray="4,3"/>
          <text x="280" y="421" text-anchor="middle" fill="#cbd5e1" font-size="12" font-weight="700">SYS-A 儲能櫃 (Zpower-AC-261L)</text>

          <!-- 櫃控 -->
          <rect x="120" y="436" width="320" height="58" rx="8" fill="#0a2024" stroke="#00c2a8" stroke-width="1.5"/>
          <text x="280" y="458" text-anchor="middle" fill="#00c2a8" font-size="12" font-weight="700">櫃控一體機 (Cabinet Controller)</text>
          <text x="280" y="476" text-anchor="middle" fill="#8b98b0" font-size="10.5">CM4 · 每櫃 1 台 · 隨櫃標配</text>

          <!-- PCS -->
          <line x1="180" y1="494" x2="180" y2="530" stroke="#00c2a8" stroke-width="1.5" marker-end="url(#pa-teal)"/>
          <text x="125" y="514" fill="#00c2a8" font-size="10" font-weight="600">Modbus TCP</text>
          <rect x="120" y="530" width="120" height="44" rx="6" fill="#0f1729" stroke="#00c2a8" stroke-width="1"/>
          <text x="180" y="550" text-anchor="middle" fill="#e6edf5" font-size="11" font-weight="700">PCS</text>
          <text x="180" y="566" text-anchor="middle" fill="#8b98b0" font-size="9.5">125 kW · port 502</text>

          <!-- BCU -->
          <line x1="380" y1="494" x2="380" y2="530" stroke="#ec4899" stroke-width="1.5" marker-end="url(#pa-pink)"/>
          <text x="392" y="514" fill="#f9a8d4" font-size="10" font-weight="600">CAN bus</text>
          <rect x="320" y="530" width="120" height="44" rx="6" fill="#1a0a14" stroke="#ec4899" stroke-width="1"/>
          <text x="380" y="550" text-anchor="middle" fill="#fbcfe8" font-size="11" font-weight="700">BCU (簇控)</text>
          <text x="380" y="566" text-anchor="middle" fill="#8b98b0" font-size="9.5">高壓箱</text>

          <!-- BCU → BMUs -->
          <line x1="380" y1="574" x2="380" y2="600" stroke="#ec4899" stroke-width="1.5" marker-end="url(#pa-pink)"/>
          <text x="392" y="592" fill="#f9a8d4" font-size="9.5">CAN</text>
          <rect x="290" y="600" width="60" height="34" rx="5" fill="#1a0a14" stroke="#ec4899" stroke-width="0.8"/>
          <text x="320" y="619" text-anchor="middle" fill="#fbcfe8" font-size="10" font-weight="600">BMU 1</text>
          <rect x="354" y="600" width="60" height="34" rx="5" fill="#1a0a14" stroke="#ec4899" stroke-width="0.8"/>
          <text x="384" y="619" text-anchor="middle" fill="#fbcfe8" font-size="10" font-weight="600">BMU 2</text>
          <rect x="418" y="600" width="20" height="34" rx="5" fill="#1a0a14" stroke="#ec4899" stroke-width="0.5"/>
          <text x="428" y="623" text-anchor="middle" fill="#fbcfe8" font-size="9">···</text>
          <text x="380" y="654" text-anchor="middle" fill="#8b98b0" font-size="10">每 Pack 1 個 BMU · 共 13 串</text>
          <text x="380" y="670" text-anchor="middle" fill="#8b98b0" font-size="9.5">電芯電壓 / 溫度 / 均衡</text>

          <!-- I/O 設備 -->
          <rect x="120" y="595" width="120" height="44" rx="6" fill="#0f1729" stroke="#f59e0b" stroke-width="1"/>
          <text x="180" y="615" text-anchor="middle" fill="#fbbf24" font-size="10.5" font-weight="700">消防 / 液冷 / 門禁</text>
          <text x="180" y="630" text-anchor="middle" fill="#8b98b0" font-size="9.5">DI/DO 8 路 + RS485</text>
          <line x1="180" y1="595" x2="180" y2="574" stroke="#f59e0b" stroke-width="1.5"/>
          <text x="125" y="588" fill="#fbbf24" font-size="9.5">DI/DO</text>
        </g>

        <!-- Cabinet 2 outline (mirror) -->
        <g>
          <rect x="720" y="400" width="400" height="200" rx="10" fill="#0a0e1e" stroke="#1b2740" stroke-width="1.5" stroke-dasharray="4,3"/>
          <text x="920" y="421" text-anchor="middle" fill="#cbd5e1" font-size="12" font-weight="700">SYS-B 儲能櫃 (Zpower-AC-261L)</text>
          <rect x="760" y="436" width="320" height="58" rx="8" fill="#0a2024" stroke="#00c2a8" stroke-width="1.5"/>
          <text x="920" y="458" text-anchor="middle" fill="#00c2a8" font-size="12" font-weight="700">櫃控一體機</text>
          <text x="920" y="476" text-anchor="middle" fill="#8b98b0" font-size="10.5">同 SYS-A 架構</text>
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
        <strong>讀法</strong>：上層走 MQTT 跨網（雲端通訊）、中層走 Modbus TCP 走本地 LAN（站控 ↔ 櫃控 ↔ PCS）、櫃內走 CAN（電芯保護即時性 &lt; 10ms）、電錶走 DLT645 / Modbus RTU（傳統 RS485 介面）。
      </div>
    </div>

    <div class="grid g-3 mb-16">
      <div class="card">
        <div class="card-head"><h3>通訊協定</h3></div>
        <table class="data">
          <tr><td>PCS</td><td><span class="tag info">Modbus TCP</span></td></tr>
          <tr><td>BMS</td><td><span class="tag info">Modbus RTU</span></td></tr>
          <tr><td>電錶</td><td><span class="tag info">Modbus TCP</span></td></tr>
          <tr><td>HVAC</td><td><span class="tag info">BACnet/IP</span></td></tr>
          <tr><td>台電交易平台</td><td><span class="tag info">IEC 61850</span></td></tr>
          <tr><td>雲平台上傳</td><td><span class="tag info">MQTT (TLS)</span></td></tr>
        </table>
      </div>
      <div class="card">
        <div class="card-head"><h3>資訊安全</h3></div>
        <table class="data">
          <tr><td>IEC 62443 認證</td><td><span class="tag ok">符合</span></td></tr>
          <tr><td>X.509 雙向認證</td><td><span class="tag ok">啟用</span></td></tr>
          <tr><td>角色存取控制 (RBAC)</td><td><span class="tag ok">啟用</span></td></tr>
          <tr><td>資料加密傳輸</td><td><span class="tag ok">TLS 1.3</span></td></tr>
          <tr><td>資料加密儲存</td><td><span class="tag ok">AES-256</span></td></tr>
          <tr><td>稽核日誌保留</td><td>3 年</td></tr>
        </table>
      </div>
      <div class="card">
        <div class="card-head"><h3>使用者權限</h3></div>
        <table class="data">
          <thead><tr><th>角色</th><th class="right">人數</th></tr></thead>
          <tbody>
            <tr><td>系統管理員</td><td class="num right">2</td></tr>
            <tr><td>維運工程師</td><td class="num right">5</td></tr>
            <tr><td>經營主管</td><td class="num right">3</td></tr>
            <tr><td>唯讀訪客</td><td class="num right">8</td></tr>
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
          <span class="tag ok">✓ 已認證</span>
          <span class="muted" style="font-size:11.5px">最後更新 2026-04-15</span>
        </div>
        <h2 style="margin:0 0 4px;font-size:22px">${p.model}</h2>
        <div class="muted" style="font-size:12.5px;margin-bottom:14px">序號 <strong style="color:var(--text);font-family:monospace">${p.sn}</strong></div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
          <div><div class="muted" style="font-size:11px">製造商</div><div style="font-size:13px;margin-top:2px">${p.manufacturer}</div></div>
          <div><div class="muted" style="font-size:11px">出廠日期</div><div style="font-size:13px;margin-top:2px">${p.mfgDate}</div></div>
          <div><div class="muted" style="font-size:11px">安裝日期</div><div style="font-size:13px;margin-top:2px">${p.installDate}</div></div>
          <div><div class="muted" style="font-size:11px">保固至</div><div style="font-size:13px;margin-top:2px">${p.warrantyEnd}</div></div>
        </div>
      </div>
      <div style="text-align:center">
        <div class="muted" style="font-size:11px;margin-bottom:4px">護照 ID</div>
        <div style="font-family:monospace;font-size:13px;color:var(--primary);font-weight:600">EU-PP-2026-${p.sn.slice(-4)}</div>
      </div>
    </div>

    <!-- 3 columns: Chemistry / Carbon / Performance -->
    <div class="grid g-3 mb-16">
      <div class="card">
        <div class="card-head"><h3>⚗ 化學組成</h3><span class="tag info">LFP</span></div>
        <table class="data" style="margin-top:-4px">
          <tr><td>化學類型</td><td class="num right">${p.chemistry.type}</td></tr>
          <tr><td>正極材料</td><td class="num right">${p.chemistry.cathode}</td></tr>
          <tr><td>負極材料</td><td class="num right">${p.chemistry.anode}</td></tr>
          <tr><td>電解液</td><td class="num right">${p.chemistry.electrolyte}</td></tr>
          <tr><td>隔膜</td><td class="num right">${p.chemistry.separator}</td></tr>
          <tr><td>電芯廠</td><td class="num right">${p.chemistry.cellMaker}</td></tr>
          <tr><td>電芯型號</td><td class="num right">${p.chemistry.cellModel}</td></tr>
          <tr><td>電芯數量</td><td class="num right">${p.chemistry.cellCount}</td></tr>
          <tr><td>單顆規格</td><td class="num right">${p.chemistry.cellNominal}</td></tr>
        </table>
      </div>

      <div class="card">
        <div class="card-head"><h3>🌱 碳足跡</h3><span class="tag ok">ISO 14064-1</span></div>
        <div style="text-align:center;padding:8px 0 12px">
          <div style="font-size:30px;font-weight:700;color:var(--green);font-variant-numeric:tabular-nums">${p.carbon.perKWh}</div>
          <div class="muted" style="font-size:12px">kg CO₂e / kWh</div>
          <div style="font-size:13px;margin-top:6px">總排放：<strong>${(p.carbon.total/1000).toFixed(1)}</strong> 噸 CO₂e</div>
        </div>
        <div class="chart-wrap" style="height:140px"><canvas id="chartCarbon"></canvas></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>📈 性能履歷</h3><span class="tag ok">SOH ${p.performance.soh}%</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;font-size:12.5px;margin-bottom:10px">
          <div><div class="muted" style="font-size:11px">額定容量</div><div class="num strong">${p.performance.ratedKWh} kWh</div></div>
          <div><div class="muted" style="font-size:11px">實測容量</div><div class="num strong">${p.performance.actualKWh} kWh</div></div>
          <div><div class="muted" style="font-size:11px">累積循環</div><div class="num strong">${p.performance.cyclesUsed} / ${p.performance.cyclesRated}</div></div>
          <div><div class="muted" style="font-size:11px">累積吞吐</div><div class="num strong">${p.performance.throughputMWh} MWh</div></div>
          <div><div class="muted" style="font-size:11px">平均效率</div><div class="num strong">${p.performance.avgEff}%</div></div>
          <div><div class="muted" style="font-size:11px">SOH 衰退率</div><div class="num strong" style="color:var(--green)">${p.performance.sohTrend}%/月</div></div>
        </div>
        <div class="muted" style="font-size:11px;margin-bottom:4px">循環使用率 ${(p.performance.cyclesUsed/p.performance.cyclesRated*100).toFixed(1)}%</div>
        <div class="pbar"><span style="width:${p.performance.cyclesUsed/p.performance.cyclesRated*100}%"></span></div>
      </div>
    </div>

    <!-- SOH trend with prediction + RUL KPIs -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>📈 SOH 時序與 RUL 預測 (24 個月)</h3>
        <div class="row" style="gap:6px">
          <span class="tag" style="background:rgba(139,92,246,0.12);color:var(--purple);font-size:11px">LSTM v2.3</span>
          <span class="muted" style="font-size:11.5px">每月重訓 · 信賴區間 95%</span>
        </div>
      </div>
      <div class="grid g-3" style="gap:12px;margin-bottom:14px">
        <div class="stat blue">
          <div class="lbl">當前 SOH</div>
          <div class="val">${p.performance.soh}<span class="u">%</span></div>
          <div class="sub">月衰退 ${p.performance.sohTrend}%</div>
        </div>
        <div class="stat amber">
          <div class="lbl">預估剩餘壽命 (RUL)</div>
          <div class="val">14.2<span class="u">±1.8 月</span></div>
          <div class="sub">至 SOH 80% (EOL)</div>
        </div>
        <div class="stat green">
          <div class="lbl">預估 EOL 日期</div>
          <div class="val" style="font-size:18px">2027-06</div>
          <div class="sub">含信賴區間 ±2 月</div>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartSoh"></canvas></div>
      <div class="row mt-12" style="padding:10px 14px;background:rgba(139,92,246,0.06);border-left:3px solid var(--purple);border-radius:6px;font-size:12.5px;line-height:1.6">
        <span><strong>🤖 AI 觀察</strong>：歷史 6 個月（藍實線）SOH 線性下降約 0.13%/月；模型偵測電芯內阻離散度 (σ) 開始上升 + 平均工作溫度 29.4°C 偏高，預測未來進入「加速衰退期」（紫虛線），約於 <strong>+14 月（2027-06）</strong> 觸及 EOL 80%（橘虛線）。紫色帶狀為 95% 信賴區間，越遠越寬代表不確定性增加。建議：① EOL 前 6 個月啟動 EPC 採購；② 14:00 高溫時段限制 C-rate 至 0.4C，模型估壽命可延長 ~8%。</span>
      </div>
    </div>

    <!-- Materials & Recycling -->
    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-head"><h3>📦 材料組成與再生比例</h3></div>
        <table class="data">
          <thead><tr><th>材料</th><th class="right">重量比</th><th class="right">再生料</th><th>來源驗證</th></tr></thead>
          <tbody>
            ${p.materials.map(m=>`
              <tr>
                <td>${m.name}</td>
                <td class="num right">${m.percent}%</td>
                <td class="num right" style="color:${m.recycled>=30?'var(--green)':m.recycled>=10?'var(--amber)':'var(--text-muted)'}">${m.recycled}%</td>
                <td><span class="tag ${m.recycled>0?'ok':'mute'}">${m.recycled>0?'已驗證':'N/A'}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="muted mt-12" style="font-size:11.5px">※ 依 EU 2023/1542 §8 揭露要求；2027 年起鋰再生料須 ≥ 6%、鈷 ≥ 16%</div>
      </div>

      <div class="card">
        <div class="card-head"><h3>♻ 回收路徑與二次利用</h3></div>
        <div style="background:rgba(16,185,129,0.06);border-left:3px solid var(--green);padding:10px 14px;border-radius:6px;margin-bottom:12px">
          <div style="font-size:13px"><strong>回收夥伴：</strong>${p.recycling.partner}</div>
          <div style="font-size:12px;margin-top:4px;color:var(--text-muted)">聯繫：${p.recycling.contact} · 標準：${p.recycling.standard}</div>
        </div>
        <table class="data">
          <tr><td>材料回收率</td><td class="num right" style="color:var(--green)">${p.recycling.recoveryRate}%</td></tr>
          <tr><td>處理流向</td><td class="num right">${p.recycling.destination}</td></tr>
          <tr><td>EOL 預估</td><td class="num right">${p.secondLife.eolEstimate}</td></tr>
          <tr><td>EOL 殘值</td><td class="num right" style="color:var(--green)">${money(p.secondLife.residualValue)}</td></tr>
        </table>
        <div class="mt-12">
          <div class="muted" style="font-size:11.5px;margin-bottom:6px">建議二次利用路徑：</div>
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
        ? `<span class="tag ok">${p.certs.length} 項全部有效</span>`
        : `<span class="tag warn">${urgent} 項需復驗 · 共 ${p.certs.length} 項</span>`;
      return `
      <div class="card mb-16">
        <div class="card-head" style="flex-wrap:wrap;gap:8px">
          <h3>🏛 合規認證</h3>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${headTag}
            <button class="btn btn-ghost" id="ppRecallBtn" style="padding:5px 12px;font-size:12px">🔍 召回追溯</button>
            <button class="btn btn-primary" id="ppExportBtn" style="padding:5px 12px;font-size:12px">📦 匯出合規包</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
          ${certsWithStatus.map(c => {
            const colorVar = c.status === "red" ? "var(--red)" : c.status === "amber" ? "var(--amber)" : "var(--green)";
            const bgRgba   = c.status === "red" ? "rgba(239,68,68,0.06)" : c.status === "amber" ? "rgba(245,158,11,0.06)" : "rgba(16,185,129,0.05)";
            const dayLabel = c.days < 0
              ? `已過期 ${-c.days} 天`
              : c.days === 0 ? "今日到期"
              : `剩 ${c.days} 天`;
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
                  <a href="${c.pdfUrl}" onclick="event.preventDefault();showToast('PDF 預覽尚未實作 · 連結為佔位 (' + this.getAttribute('href') + ')','info',3500)" style="color:var(--primary);text-decoration:none">📄 PDF</a>
                </div>
                <div class="muted" style="font-size:10.5px;margin-top:3px">發證 ${c.issued} · 到期 ${c.expiry}</div>
              </div>
            `;
          }).join("")}
        </div>
        <div class="muted mt-12" style="font-size:11px">※ 到期前 90 天 黃燈 · 30 天 紅燈 · 系統會於 30/7/1 天時自動推 Email + Line 給維運主管</div>
      </div>`;
    })()}

    <!-- Service event timeline -->
    <div class="card">
      <div class="card-head">
        <h3>🕒 維運事件時間軸</h3>
        <span class="muted" style="font-size:11.5px;display:flex;align-items:center;gap:6px" title="目前以 PostgreSQL + 數位簽章 + TÜV 第三方稽核達成「不可篡改」要求（與 CATL 路線一致）；公鏈錨定 (Polygon hash + IPFS) 規劃 2027 上線">
          <span style="background:rgba(16,185,129,0.12);color:var(--green);padding:2px 8px;border-radius:4px;font-size:10.5px;font-weight:600">🔒 不可篡改</span>
          <span style="font-size:11px">DB + 簽章 + 第三方稽核 · 公鏈錨定 2027</span>
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
