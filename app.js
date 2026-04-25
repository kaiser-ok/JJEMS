// ==========================
// J&J Power EMS – SPA router
// ==========================
const $  = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => [...el.querySelectorAll(q)];
const fmt = (n, d=0) => n == null ? "-" : n.toLocaleString("zh-TW", { maximumFractionDigits: d, minimumFractionDigits: d });
const money = n => "NT$ " + Math.round(n).toLocaleString("zh-TW");

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
  if (txt) txt.textContent = s.label + "模式";
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
        <div class="mode-opt-label">${s.full}</div>
        <div class="mode-opt-desc">${s.desc}</div>
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
  const essLabel = ess > 0 ? "儲能放電" : ess < 0 ? "儲能充電" : "儲能待機";
  $("#topbar-stats").innerHTML = `
    <div class="tstat"><span class="tlabel">市電</span><span class="tvalue">${fmt(grid)}</span><span class="tunit">kW</span></div>
    <div class="tstat"><span class="tlabel">PV</span><span class="tvalue" style="color:var(--pv-yellow)">${fmt(pv)}</span><span class="tunit">kW</span></div>
    <div class="tstat"><span class="tlabel">${essLabel}</span><span class="tvalue" style="color:var(--ess-teal)">${fmt(Math.abs(ess))}</span><span class="tunit">kW</span></div>
    <div class="tstat"><span class="tlabel">負載</span><span class="tvalue" style="color:var(--load-purple)">${fmt(load)}</span><span class="tunit">kW</span></div>
    <div class="tstat"><span class="tlabel">SoC</span><span class="tvalue" style="color:var(--green)">${soc.toFixed(0)}</span><span class="tunit">%</span></div>
    <div class="tstat"><span class="tlabel">今日預估節費</span><span class="tvalue" style="color:${benefit.net>=0?'var(--green)':'var(--red)'}">${money(benefit.net)}</span></div>
  `;
}

// ────────── Routing ──────────
state.passportSys = "SYS-A";
const routes = {
  dashboard: viewDashboard,
  sld: viewSLD,
  devices: viewDevices,
  passport: viewPassport,
  schedule: viewSchedule,
  finance: viewFinance,
  alarms: viewAlarms,
  settings: viewSettings,
};
function router() {
  const hash = (location.hash || "#/dashboard").replace("#/", "");
  const route = routes[hash] ? hash : "dashboard";
  killCharts();
  $$(".nav-item, .bnav-item").forEach(el => el.classList.toggle("active", el.dataset.route === route));
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
        <h1 class="page-title">首頁總覽</h1>
        <p class="page-sub">${SITE.name} · 即時監控與效益概要</p>
      </div>
      <div class="page-actions">
        <button class="btn">今日</button>
        <button class="btn btn-ghost">本月</button>
        <button class="btn btn-ghost">本年</button>
        <button class="btn btn-primary">匯出報表</button>
      </div>
    </div>

    <!-- Active strategy banner -->
    <div class="card mb-16" style="border-left:4px solid ${s.color};padding:14px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div style="flex:0 0 auto">
        <div class="muted" style="font-size:11.5px">當前運行策略</div>
        <div style="font-size:16px;font-weight:700;color:${s.color};margin-top:2px">${s.full}</div>
      </div>
      <div style="flex:1;min-width:180px;border-left:1px solid var(--border-soft);padding-left:14px">
        <div class="muted" style="font-size:11.5px">收益模式</div>
        <div style="font-size:13px;margin-top:2px">${s.benefit}</div>
      </div>
      <div style="flex:1;min-width:180px;border-left:1px solid var(--border-soft);padding-left:14px">
        <div class="muted" style="font-size:11.5px">約束</div>
        <div style="font-size:13px;margin-top:2px">${s.constraint}</div>
      </div>
      <a href="#/schedule" class="btn">調整策略 →</a>
    </div>

    <!-- KPI Cards -->
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">今日電費</div>
        <div class="kpi-value">${money(bal.gridImport * 5.0)}</div>
        <div class="kpi-foot">市電 ${fmt(bal.gridImport)} kWh × 加權均價</div>
      </div>
      <div class="kpi green">
        <div class="kpi-label">今日預估節費</div>
        <div class="kpi-value" style="color:${benefit.net>=0?'var(--green)':'var(--red)'}">${money(benefit.net)}</div>
        <div class="kpi-foot">${s.label} · ${cycles} 循環</div>
      </div>
      <div class="kpi blue">
        <div class="kpi-label">本月累計節費</div>
        <div class="kpi-value">${money(monthSavings)}</div>
        <div class="kpi-foot">達成率 <span class="strong">${Math.min(100, Math.round(monthSavings/156000*100))}%</span> / ${money(156000)}</div>
      </div>
      <div class="kpi amber">
        <div class="kpi-label">儲能平均 SoC</div>
        <div class="kpi-value">${avgSoc}<span class="unit">%</span></div>
        <div class="kpi-foot">效率 <span class="strong">${KPI.cycleEff}%</span> · ${cycles} 循環/日</div>
      </div>
      <div class="kpi purple">
        <div class="kpi-label">最大放電功率</div>
        <div class="kpi-value">${peakShaved}<span class="unit">kW</span></div>
        <div class="kpi-foot">${state.strategy==='peakShave'?'削峰填谷':state.strategy==='afc'?'AFC 雙向':state.strategy==='manual'?'手動指令':'依策略放電'}</div>
      </div>
      <div class="kpi pink">
        <div class="kpi-label">最高電芯溫度</div>
        <div class="kpi-value">${KPI.maxCellTemp}<span class="unit">°C</span></div>
        <div class="kpi-foot">SYS-B 電池櫃 · 正常範圍</div>
      </div>
    </div>

    <!-- Power flow mini map -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>即時能源流向</h3>
        <span class="tag info">每 5 秒更新</span>
      </div>
      <div class="flow-mini" id="flowmini"></div>
    </div>

    <!-- Main charts -->
    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-head">
          <h3>24 小時功率趨勢</h3>
          <div class="row">
            <span class="tag mute">◼ 市電</span>
            <span class="tag" style="color:var(--pv-yellow);background:rgba(250,204,21,0.1)">◼ 太陽能</span>
            <span class="tag" style="color:var(--ess-teal);background:rgba(20,184,166,0.1)">◼ 儲能</span>
            <span class="tag" style="color:var(--load-purple);background:rgba(167,139,250,0.1)">◼ 負載</span>
          </div>
        </div>
        <div class="chart-wrap tall"><canvas id="chart24h"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>儲能 SoC 曲線</h3>
          <span class="tag ok">健康</span>
        </div>
        <div class="chart-wrap tall"><canvas id="chartSoc"></canvas></div>
      </div>
    </div>

    <div class="grid g-3">
      <div class="card">
        <div class="card-head"><h3>今日能量平衡</h3><span class="tag" style="background:${s.color}1a;color:${s.color}">${s.label}</span></div>
        <table class="data" style="margin:-4px 0">
          <tbody>
            <tr><td>市電購入</td><td class="num">${fmt(bal.gridImport)} kWh</td></tr>
            <tr><td>太陽能發電</td><td class="num">${fmt(bal.pv)} kWh</td></tr>
            <tr><td>儲能放電</td><td class="num">${fmt(bal.discharge)} kWh</td></tr>
            <tr><td>儲能充電</td><td class="num">${fmt(bal.charge)} kWh</td></tr>
            <tr><td>總負載</td><td class="num strong">${fmt(bal.load)} kWh</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-head"><h3>台電即時訊息</h3></div>
        <div class="row mb-12"><span class="dot dot-ok"></span><span>正常供電</span><span class="muted" style="margin-left:auto">0 事件</span></div>
        <div class="row mb-12"><span class="dot dot-idle"></span><span>備轉通知</span><span class="muted" style="margin-left:auto">未接收</span></div>
        <div class="row mb-12"><span class="dot dot-idle"></span><span>需量反應</span><span class="muted" style="margin-left:auto">7 日內無</span></div>
        <div class="muted mt-16" style="font-size:12px">資料來源：台電公司 openAPI</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>近期告警</h3><a href="#/alarms" class="muted" style="font-size:12px">全部 →</a></div>
        ${ALARMS.slice(0,4).map(a => `
          <div class="alarm-row" style="padding:8px 0">
            <span class="alarm-ts">${a.ts}</span>
            <div class="alarm-msg">${a.msg}<span class="sub">${a.sys}</span></div>
            <span class="tag ${a.sev}">${ {ok:"完成",info:"資訊",warn:"警告",err:"錯誤"}[a.sev] }</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  drawFlowMini();
  drawChart24h();
  drawChartSoc();
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

// ────────── 2. Single-line diagram ──────────
function viewSLD() {
  const v = $("#view");
  v.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">案場單線圖</h1>
        <p class="page-sub">設備級配線與即時電力流向</p>
      </div>
      <div class="page-actions">
        <button class="btn">單線圖</button>
        <button class="btn btn-ghost">電氣保護</button>
        <button class="btn btn-ghost">通訊狀態</button>
      </div>
    </div>

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
        </defs>

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
        <text x="100" y="222" fill="#3b82f6" font-size="11" font-weight="600">LV BUS 480V</text>

        <!-- PV -->
        <g>
          <line x1="180" y1="232" x2="180" y2="300" stroke="#facc15" stroke-width="2" marker-end="url(#arrYellow)">
            <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.3s" repeatCount="indefinite"/>
          </line>
          <rect x="120" y="300" width="120" height="78" rx="8" fill="#1a1505" stroke="#facc15" stroke-width="1.5"/>
          <text x="180" y="324" text-anchor="middle" fill="#facc15" font-size="13" font-weight="700">☀ 太陽能</text>
          <text x="180" y="345" text-anchor="middle" fill="#e6edf5" font-size="16" font-weight="700">308 kW</text>
          <text x="180" y="365" text-anchor="middle" fill="#8b98b0" font-size="10">400 kWp · 發電中</text>
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
          <rect x="300" y="352" width="120" height="66" rx="6" fill="#0a2320" stroke="#14b8a6" stroke-width="1.5"/>
          <text x="360" y="372" text-anchor="middle" fill="#14b8a6" font-size="12" font-weight="700">SYS-A 電池櫃</text>
          <text x="360" y="390" text-anchor="middle" fill="#e6edf5" font-size="13" font-weight="700">261 kWh</text>
          <text x="360" y="408" text-anchor="middle" fill="#10b981" font-size="11">SoC 65% · 29.4°C</text>
          <text x="360" y="265" text-anchor="middle" fill="#14b8a6" font-size="11" font-weight="600">↑ 放 118 kW</text>
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
          <rect x="480" y="352" width="120" height="66" rx="6" fill="#0a2320" stroke="#14b8a6" stroke-width="1.5"/>
          <text x="540" y="372" text-anchor="middle" fill="#14b8a6" font-size="12" font-weight="700">SYS-B 電池櫃</text>
          <text x="540" y="390" text-anchor="middle" fill="#e6edf5" font-size="13" font-weight="700">215 kWh</text>
          <text x="540" y="408" text-anchor="middle" fill="#10b981" font-size="11">SoC 72% · 31.1°C</text>
          <text x="540" y="265" text-anchor="middle" fill="#14b8a6" font-size="11" font-weight="600">↑ 放 97 kW</text>
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

    <div class="grid g-3 mt-16">
      <div class="card">
        <div class="card-head"><h3>主變壓器</h3><span class="tag ok">正常</span></div>
        <table class="data">
          <tr><td>油溫</td><td class="num">52 °C</td></tr>
          <tr><td>繞組溫度</td><td class="num">68 °C</td></tr>
          <tr><td>有載分接頭</td><td class="num">Tap 3 / 5</td></tr>
          <tr><td>當前負載率</td><td class="num">70.4%</td></tr>
        </table>
      </div>
      <div class="card">
        <div class="card-head"><h3>電壓品質</h3><span class="tag ok">合格</span></div>
        <table class="data">
          <tr><td>R 相</td><td class="num">489.2 V</td></tr>
          <tr><td>S 相</td><td class="num">487.8 V</td></tr>
          <tr><td>T 相</td><td class="num">488.4 V</td></tr>
          <tr><td>頻率</td><td class="num">60.02 Hz</td></tr>
          <tr><td>功率因數</td><td class="num">0.96</td></tr>
        </table>
      </div>
      <div class="card">
        <div class="card-head"><h3>保護電驛</h3><span class="tag ok">全部正常</span></div>
        <table class="data">
          <tr><td>50/51 過流</td><td><span class="tag ok">正常</span></td></tr>
          <tr><td>27/59 欠過壓</td><td><span class="tag ok">正常</span></td></tr>
          <tr><td>81 頻率</td><td><span class="tag ok">正常</span></td></tr>
          <tr><td>87T 差動</td><td><span class="tag ok">正常</span></td></tr>
          <tr><td>Buchholz</td><td><span class="tag ok">正常</span></td></tr>
        </table>
      </div>
    </div>

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
}

// ────────── 3. Device monitoring ──────────
function viewDevices() {
  const tab = state.devicesTab || "monitor";
  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">設備監控</h1>
        <p class="page-sub">PCS · BMS · 電池模組 · 環控 · 進階電芯分析</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary">下載日誌</button>
      </div>
    </div>

    <div class="tabs-strip mb-16">
      <button class="tab ${tab==='monitor'?'active':''}" data-tab="monitor">📟 即時監控</button>
      <button class="tab ${tab==='analytics'?'active':''}" data-tab="analytics">🔬 電芯分析 <span class="tab-pro">BMS Pro</span></button>
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
        <h3>SYS-A 電芯溫度熱力圖 · 208 cells</h3>
        <div class="row" style="gap:4px">
          <span class="muted" style="font-size:11px">28°C</span>
          <div style="width:120px;height:8px;background:linear-gradient(90deg,#3b82f6,#10b981,#f59e0b,#ef4444);border-radius:4px"></div>
          <span class="muted" style="font-size:11px">42°C</span>
        </div>
      </div>
      <div class="heat" id="heat"></div>
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

  // Render heatmap
  const heat = $("#heat");
  let html = "";
  for (let i = 0; i < 208; i++) {
    const t = 28 + Math.random() * 4 + (i % 16 < 3 ? 1.2 : 0) + (i > 180 ? 1.5 : 0);
    const hue = 220 - (t - 28) * 40; // 28°→220(blue), 42°→-340(red)
    const h = Math.max(0, hue);
    html += `<div class="heat-cell" style="background:hsl(${h},70%,60%)" title="Cell #${i+1}: ${t.toFixed(1)}°C">${t.toFixed(1)}</div>`;
  }
  heat.innerHTML = html;
}

// ────────── BMS Pro · Cell Analytics ──────────
function renderDevicesAnalytics() {
  // Generate fake cell data deterministically (208 + 176 = 384 cells)
  const seedRand = (s) => { s = s % 2147483647; if (s <= 0) s += 2147483646; return () => (s = s * 16807 % 2147483647) / 2147483647; };
  const r = seedRand(42);

  const allCells = [];
  for (const sys of SITE.systems) {
    const n = sys.cells;
    const baseV = 3.388;
    for (let i = 0; i < n; i++) {
      // Voltage with normal distribution
      const u1 = r(), u2 = r();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      let v = baseV + z * 0.012;
      // A few "weak" cells deliberately offset
      if (sys.id === "SYS-A" && [3, 47, 92, 156, 199].includes(i)) v -= 0.02 + r()*0.015;
      if (sys.id === "SYS-B" && [12, 67, 134].includes(i)) v -= 0.025 + r()*0.01;
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
          <thead><tr><th>#</th><th>系統</th><th>編號</th><th class="right">電壓</th><th class="right">內阻</th><th class="right">偏差</th><th></th></tr></thead>
          <tbody>
            ${sortedWeak.map((c,i)=>{
              const dev = (c.v - vMean) * 1000;
              const sev = Math.abs(dev) > 30 ? "err" : Math.abs(dev) > 20 ? "warn" : "info";
              return `<tr>
                <td><strong>${i+1}</strong></td>
                <td>${c.sys}</td>
                <td>#${c.idx}</td>
                <td class="num right">${c.v.toFixed(3)} V</td>
                <td class="num right">${c.ir.toFixed(2)} mΩ</td>
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
        ${prognosticIndicator("內阻變異係數", 4.2, 10, "%", "monotonic")}
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
          <h3>內阻分佈熱力圖 · ${SITE.systems[0].cells} cells</h3>
          <div class="row" style="gap:4px">
            <span class="muted" style="font-size:11px">0.40 mΩ</span>
            <div style="width:120px;height:8px;background:linear-gradient(90deg,#10b981,#facc15,#ef4444);border-radius:4px"></div>
            <span class="muted" style="font-size:11px">0.65 mΩ</span>
          </div>
        </div>
        <div class="heat" id="irHeat"></div>
        <div class="muted" style="font-size:11.5px;margin-top:6px">內阻偏高的電芯（紅）可能是衰退或接觸不良前兆</div>
      </div>
    </div>
  `;

  // Histogram
  const bins = 30;
  const binStart = 3.32, binEnd = 3.45;
  const binW = (binEnd - binStart) / bins;
  const histA = Array(bins).fill(0);
  const histB = Array(bins).fill(0);
  for (const c of sysA) { const i = Math.min(bins-1, Math.max(0, Math.floor((c.v - binStart)/binW))); histA[i]++; }
  for (const c of sysB) { const i = Math.min(bins-1, Math.max(0, Math.floor((c.v - binStart)/binW))); histB[i]++; }
  const labels = Array.from({length:bins}, (_,i) => (binStart + i*binW).toFixed(3));

  addChart(new Chart($("#chartHisto"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "SYS-A", data: histA, backgroundColor: "rgba(59,130,246,0.6)", borderColor: "#3b82f6", borderWidth: 1 },
        { label: "SYS-B", data: histB, backgroundColor: "rgba(20,184,166,0.6)", borderColor: "#14b8a6", borderWidth: 1 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { stacked: false, title: { display: true, text: "電壓 (V)" }, ticks: { maxTicksLimit: 10 }, grid: { display: false } },
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

  // IR heat map (208 cells SYS-A)
  const ir = $("#irHeat");
  const irHtml = sysA.map(c => {
    const v = c.ir;
    // 0.40 → green hue=140, 0.65 → red hue=0
    const t = Math.min(1, Math.max(0, (v - 0.40) / 0.25));
    const hue = 140 - t * 140;
    return `<div class="heat-cell" style="background:hsl(${hue},75%,60%)" title="Cell #${c.idx}: ${v.toFixed(2)} mΩ">${v.toFixed(2)}</div>`;
  }).join("");
  ir.innerHTML = irHtml;
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
        <h1 class="page-title">排程與策略</h1>
        <p class="page-sub">當前策略：<strong style="color:${s.color}">${s.full}</strong> · ${s.desc}</p>
      </div>
      <div class="page-actions">
        <button class="btn">今日</button>
        <button class="btn btn-ghost">明日</button>
        <button class="btn btn-primary">啟用排程</button>
      </div>
    </div>

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
        <div class="card-head"><h3>${s.label}今日效益試算</h3></div>
        <table class="data">
          <tr><td>充電電量</td><td class="num right">${fmt(benefit.chargeKWh)} kWh</td><td class="num right">支出 ${money(benefit.chargeCost)}</td></tr>
          <tr><td>放電電量 (含 91.8% 效率)</td><td class="num right">${fmt(benefit.dischargeKWh)} kWh</td><td class="num right">收益 ${money(benefit.dischargeRev)}</td></tr>
          <tr><td>循環次數</td><td class="num right">${(benefit.dischargeKWh/476).toFixed(2)} 次</td><td class="num right">-</td></tr>
          <tr><td><strong>淨益</strong></td><td colspan="2" class="num right"><strong style="color:${benefit.net>=0?"var(--green)":"var(--red)"};font-size:16px">${money(benefit.net)}</strong></td></tr>
        </table>
        <div class="muted mt-8" style="font-size:11.5px">※ 模擬試算，未含輔助服務 / 容量費收入</div>
      </div>
    </div>
  `;

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
  const renderCells = () => {
    const cells = Array.from({length:24}, (_,h) => ({ h, ...planFor(state.strategy, h) }));
    $("#sched").innerHTML = cells.map(p => {
      const price = tariffOf(p.h).price;
      const edited = state.scheduleOverride[p.h] !== undefined;
      return `<div class="sched-cell ${p.mode} ${edited?'edited':''}" data-h="${p.h}" title="${p.h}:00 · ${p.mode} · ${p.kw} kW · 電價 NT$${price}${edited?' · 已修改':''}">
        <span class="lbl">${p.label || ""}</span>
        ${edited ? '<span class="edit-mark"></span>' : ''}
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

// ────────── 5. Finance ──────────
function viewFinance() {
  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">財務效益分析</h1>
        <p class="page-sub">月度節費組成、IRR 與投報試算</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost">月報</button>
        <button class="btn">年報</button>
        <button class="btn btn-primary">匯出 Excel</button>
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
        <h1 class="page-title">告警與事件</h1>
        <p class="page-sub">全站設備即時告警 / 歷史事件 / 通訊軟體推播</p>
      </div>
      <div class="page-actions">
        <button class="btn">全部</button>
        <button class="btn btn-ghost">錯誤</button>
        <button class="btn btn-ghost">警告</button>
        <button class="btn btn-ghost">資訊</button>
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
        <h3>🚨 系統故障燈牆 (BMS Direct)</h3>
        <div class="row" style="gap:8px">
          <span class="led-legend"><span class="led led-ok"></span>正常</span>
          <span class="led-legend"><span class="led led-warn"></span>預警</span>
          <span class="led-legend"><span class="led led-err"></span>告警</span>
          <span class="led-legend"><span class="led led-protect"></span>保護</span>
        </div>
      </div>
      <div class="led-wall">
        ${ALARM_LIGHTS.map(a => `<div class="led-cell led-${a.state}" title="${a.code} · ${a.state}">${a.label}</div>`).join("")}
      </div>
      <div class="muted mt-8" style="font-size:11.5px">${ALARM_LIGHTS.length} 項全站故障點 · 直接讀取 BMS BCU 暫存器 · 每秒輪詢</div>
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
}

// ────────── 7. Settings ──────────
function viewSettings() {
  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">系統設定</h1>
        <p class="page-sub">站點資訊、電價方案、設備規格、通訊協定</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost">取消</button>
        <button class="btn btn-primary">儲存變更</button>
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

function viewPassport() {
  const sysId = state.passportSys || "SYS-A";
  const p = PASSPORTS[sysId];
  const qrUrl = `https://ems.jjpower.com.tw/passport/${p.sn}`;

  $("#view").innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">電池數位護照</h1>
        <p class="page-sub">符合 EU 2023/1542 電池法規 · 完整生命週期履歷</p>
      </div>
      <div class="page-actions">
        <button class="btn ${sysId==='SYS-A'?'btn-primary':'btn-ghost'}" data-pp="SYS-A">SYS-A · 261 kWh</button>
        <button class="btn ${sysId==='SYS-B'?'btn-primary':'btn-ghost'}" data-pp="SYS-B">SYS-B · 215 kWh</button>
        <button class="btn">列印</button>
        <button class="btn btn-primary">下載 PDF</button>
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

    <!-- SOH trend with prediction -->
    <div class="card mb-16">
      <div class="card-head">
        <h3>SOH 時序與 ML 預測 (24 個月)</h3>
        <div class="row">
          <span class="tag info">◼ 歷史</span>
          <span class="tag" style="color:var(--purple);background:rgba(139,92,246,0.12)">◼ AI 預測</span>
          <span class="tag warn">--- EOL 80% 閾值</span>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartSoh"></canvas></div>
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

    <!-- Certifications -->
    <div class="card mb-16">
      <div class="card-head"><h3>🏛 合規認證</h3><span class="tag ok">${p.certs.length} 項全數通過</span></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
        ${p.certs.map(c=>`
          <div style="padding:10px 12px;background:rgba(16,185,129,0.05);border-left:3px solid var(--green);border-radius:6px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong style="font-size:13px">${c.name}</strong>
              <span class="tag ok">${c.status}</span>
            </div>
            <div class="muted" style="font-size:11.5px;margin-top:4px">${c.scope}</div>
            <div class="muted" style="font-size:11px;margin-top:2px">${c.date}</div>
          </div>
        `).join("")}
      </div>
    </div>

    <!-- Service event timeline -->
    <div class="card">
      <div class="card-head"><h3>🕒 維運事件時間軸</h3><span class="muted" style="font-size:11.5px">區塊鏈不可篡改紀錄</span></div>
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

  // SOH timeline + prediction
  const months = [];
  const histSoh = [];
  const predSoh = [];
  // 16 months history (start at 100%, decline by ~0.18%/month)
  for (let m = -16; m <= 0; m++) {
    months.push(m === 0 ? "今" : `${m}m`);
    histSoh.push(+(100 + m * Math.abs(p.performance.sohTrend) + (Math.random()-0.5)*0.15).toFixed(2));
    predSoh.push(null);
  }
  // 8 months prediction
  for (let m = 1; m <= 8; m++) {
    months.push(`+${m}m`);
    histSoh.push(null);
    const last = predSoh[predSoh.length-1] ?? histSoh[16];
    predSoh.push(+(p.performance.soh - m * Math.abs(p.performance.sohTrend)).toFixed(2));
  }
  // Connect last hist to first pred
  predSoh[16] = histSoh[16];

  addChart(new Chart($("#chartSoh"), {
    type: "line",
    data: {
      labels: months,
      datasets: [
        { label: "歷史 SOH", data: histSoh, borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,0.15)", fill:true, tension:.3, pointRadius:0, borderWidth:2, spanGaps:false },
        { label: "AI 預測", data: predSoh, borderColor: "#8b5cf6", backgroundColor: "rgba(139,92,246,0.1)", fill:true, tension:.3, pointRadius:0, borderWidth:2, borderDash:[5,4], spanGaps:false },
        { label: "EOL 80%", data: months.map(()=>80), borderColor: "#f59e0b", borderWidth: 1.5, borderDash:[3,3], pointRadius:0, fill:false }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: c => c.parsed.y == null ? "" : `${c.dataset.label}: ${c.parsed.y}%` } }
      },
      scales: {
        x: { grid: { color: "rgba(139,152,176,0.06)" } },
        y: { min: 75, max: 102, grid: { color: "rgba(139,152,176,0.08)" }, ticks: { callback: v => v + "%" } }
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

  renderModePill();
  renderTopbar();
  setInterval(renderTopbar, 5000);
  router();
});
