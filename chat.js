// ==========================
// Energy Copilot — AI Chat
// Mock LLM with rule-based intent matching to simulate 8 benefit areas
// ==========================
(function() {
  const fab    = document.getElementById("chat-fab");
  const panel  = document.getElementById("chat-panel");
  const close  = document.getElementById("chat-close");
  const body   = document.getElementById("chat-body");
  const sugg   = document.getElementById("chat-suggest");
  const form   = document.getElementById("chat-form");
  const input  = document.getElementById("chat-input");

  // ────────── Intents ──────────
  // Each intent: { test: RegExp, answer: (query) => html }
  const INTENTS = [
    // 1. 自然語言查詢 — 節費
    {
      test: /節費|省多少|節約|收益|賺|省錢|效益/,
      answer: () => {
        const b = estimateBenefit(state.strategy);
        const s = STRATEGIES[state.strategy];
        return `
          <p>今日在 <strong style="color:${s.color}">${s.full}</strong> 下的預估節費：</p>
          <div class="chat-card">
            <div class="chat-stat"><span>淨益</span><span class="v" style="color:${b.net>=0?'var(--green)':'var(--red)'}">${money(b.net)}</span></div>
            <div class="chat-stat"><span>放電收益</span><span class="v">${fmt(b.dischargeKWh)} kWh · ${money(b.dischargeRev)}</span></div>
            <div class="chat-stat"><span>充電成本</span><span class="v">−${money(b.chargeCost)}</span></div>
          </div>
          <p>較昨日 <span style="color:var(--green)">+8.2%</span>，本月累計預估可達 <strong>${money(b.net * 22)}</strong>。</p>
          <p class="muted" style="font-size:12px">※ 未含 sReg 容量費 / AFC 輔助服務費。</p>
        `;
      }
    },

    // 1. SoC / 電量狀態
    {
      test: /SoC|電量|剩多少|剩餘電量|充電狀態/i,
      answer: () => {
        const series = genSoc(state.strategy);
        const avg = (series.reduce((a,b)=>a+b,0)/series.length).toFixed(0);
        const now = series[Math.min(95, new Date().getHours()*4)].toFixed(0);
        return `
          <p>儲能系統 SoC 即時狀態：</p>
          <div class="chat-card">
            ${SITE.systems.map(s => `
              <div class="chat-stat"><span>${s.id} (${s.batteryKWh} kWh)</span><span class="v" style="color:var(--green)">${s.soc}%</span></div>
            `).join("")}
            <div class="chat-stat" style="border-top:1px solid var(--border-soft);padding-top:8px;margin-top:4px">
              <span>當前平均 SoC</span><span class="v">${now}%</span>
            </div>
            <div class="chat-stat">
              <span>今日平均</span><span class="v">${avg}%</span>
            </div>
          </div>
          <p>目前處於 <strong>健康運轉區間</strong>（15%–90% 限制內），可持續執行今日排程。</p>
        `;
      }
    },

    // 3. 告警診斷
    {
      test: /告警|警告|警報|異常|alarm|故障/i,
      answer: () => {
        const open = ALARMS.filter(a => ["warn","err"].includes(a.sev));
        return `
          <p>目前 <strong>${open.length}</strong> 筆未處理告警：</p>
          <div class="chat-card">
            ${open.map(a => `
              <div class="chat-alarm">
                <span class="chat-tag ${a.sev}">${a.sev==="err"?"錯誤":"警告"}</span>
                <div>
                  <div style="font-weight:600">${a.msg}</div>
                  <div class="muted" style="font-size:11.5px">${a.sys} · ${a.ts}</div>
                </div>
              </div>
            `).join("")}
          </div>
          <p><strong>AI 建議處置：</strong></p>
          <ol style="margin:6px 0 4px;padding-left:20px;font-size:13px">
            <li>電池模組#3 溫差 4.8°C — 檢查 SYS-B AC-3 空調出風溫度，過去 30 天類似事件 3 次，均與空調濾網阻塞有關。</li>
            <li>契約超約預警 — 建議立即切換到 <a class="chat-link" data-action="switch" data-strategy="peakShave">削峰填谷模式</a> 壓低需量。</li>
          </ol>
        `;
      }
    },

    // 3. 溫度
    {
      test: /溫度|cell temp|熱|電芯/,
      answer: () => `
        <p>電芯溫度即時狀態：</p>
        <div class="chat-card">
          <div class="chat-stat"><span>SYS-A 平均</span><span class="v">29.4 °C</span></div>
          <div class="chat-stat"><span>SYS-A 最高</span><span class="v">30.6 °C (模組 #7)</span></div>
          <div class="chat-stat"><span>SYS-B 平均</span><span class="v">31.1 °C</span></div>
          <div class="chat-stat"><span>SYS-B 最高</span><span class="v" style="color:var(--amber)">32.8 °C (模組 #3)</span></div>
          <div class="chat-stat"><span>系統最大溫差</span><span class="v">4.8 °C</span></div>
        </div>
        <p>SYS-B 模組 #3 溫度偏高但仍在<strong style="color:var(--green)">安全範圍</strong>（閾值 45°C）。</p>
        <p class="muted" style="font-size:12px">預測：若持續放電 2 小時，溫度可能達 35°C。建議每 15 分鐘檢視，或啟動空調加強模式。</p>
      `
    },

    // 2. 策略推薦
    {
      test: /建議|推薦|用哪個|該選|最佳|最適/,
      answer: () => `
        <p><strong>AI 策略建議</strong>（依即時狀態 + 氣象 + 電價分析）：</p>
        <div class="chat-card">
          <div class="chat-stat"><span>目前策略</span><span class="v">${STRATEGIES[state.strategy].label}</span></div>
          <div class="chat-stat"><span>明日氣溫</span><span class="v">28 – 33°C · 晴</span></div>
          <div class="chat-stat"><span>明日 PV 預測</span><span class="v">2,820 kWh · 優</span></div>
          <div class="chat-stat"><span>負載預測</span><span class="v">17,200 kWh (+2%)</span></div>
          <div class="chat-stat"><span>尖峰電價</span><span class="v">NT$ 8.05/度 (夏月)</span></div>
        </div>
        <p style="padding:10px 12px;background:rgba(0,194,168,0.1);border-left:3px solid var(--primary);border-radius:4px">
          <strong>推薦切換至「時間套利」模式</strong><br>
          <span class="muted" style="font-size:12px">理由：明日尖峰價差 NT$ 5.87/度、PV 可補充午間充電、負載平穩，預估可獲 <strong style="color:var(--green)">+6,200/日</strong></span>
        </p>
        <div style="display:flex;gap:6px;margin-top:10px">
          <a class="chat-link btn" data-action="switch" data-strategy="arbitrage">採用建議</a>
          <a class="chat-link btn btn-ghost" data-action="compare">比較全部策略</a>
        </div>
      `
    },

    // 2. 切換策略（執行動作）
    {
      test: /切換|改成|換到|設為/,
      answer: (q) => {
        const map = [
          { kw: /套利|arbitrage/i,  id: "arbitrage" },
          { kw: /削峰|填谷|peak/i,  id: "peakShave" },
          { kw: /需量|sReg|反應/i,  id: "sReg" },
          { kw: /調頻|AFC|dReg|頻率/i, id: "afc" },
          { kw: /光儲|自用|PV/i,    id: "pvSelf" },
          { kw: /手動|manual/i,     id: "manual" },
        ];
        const hit = map.find(m => m.kw.test(q));
        if (!hit) return `<p>想切換到哪個策略？可選：</p>
          <div class="chip-mini-row">
            ${Object.values(STRATEGIES).map(s => `<a class="chat-link chip-mini" data-action="switch" data-strategy="${s.id}" style="border-color:${s.color};color:${s.color}">${s.label}</a>`).join("")}
          </div>`;
        // Actually execute
        setTimeout(() => setStrategy(hit.id), 800);
        const s = STRATEGIES[hit.id];
        return `<p>✓ 正在為您切換至 <strong style="color:${s.color}">${s.full}</strong>…</p>
                <p class="muted" style="font-size:12px">${s.desc}<br>預計 1 秒內下傳到 PCS，頁面將同步更新。</p>`;
      }
    },

    // 4. 月報 / 報表
    {
      test: /月報|報表|報告|匯出|ESG|碳/,
      answer: () => `
        <p>已為您彙整 <strong>4 月月報</strong>：</p>
        <div class="chat-card">
          <div class="chat-stat"><span>期間</span><span class="v">2026-04-01 ~ 04-25</span></div>
          <div class="chat-stat"><span>累計節費</span><span class="v" style="color:var(--green)">${money(128420)}</span></div>
          <div class="chat-stat"><span>尖離峰套利</span><span class="v">${money(36820)}</span></div>
          <div class="chat-stat"><span>基本電費節省</span><span class="v">${money(85700)}</span></div>
          <div class="chat-stat"><span>超約罰款減少</span><span class="v">${money(5900)}</span></div>
          <div class="chat-stat"><span>CO₂ 減排</span><span class="v">27.8 噸</span></div>
          <div class="chat-stat"><span>充放電循環</span><span class="v">24 次</span></div>
          <div class="chat-stat"><span>系統可用率</span><span class="v">99.4%</span></div>
        </div>
        <p>是否產出 PDF 傳送至您信箱？</p>
        <div style="display:flex;gap:6px">
          <a class="chat-link btn">產出 PDF</a>
          <a class="chat-link btn btn-ghost">加入 ESG 季報</a>
        </div>
      `
    },

    // 5. SOH / 健康 / 預測
    {
      test: /SOH|健康|壽命|衰退|預測|維護/,
      answer: () => `
        <p><strong>電池健康預測分析</strong>（基於近 90 天時序資料）：</p>
        <div class="chat-card">
          <div class="chat-stat"><span>SYS-A SOH</span><span class="v">98.2% <span class="muted">↓ 0.3%/月</span></span></div>
          <div class="chat-stat"><span>SYS-B SOH</span><span class="v">98.6% <span class="muted">↓ 0.2%/月</span></span></div>
          <div class="chat-stat"><span>SYS-A 累積循環</span><span class="v">182 次 / 6,000 次</span></div>
          <div class="chat-stat"><span>預估壽命</span><span class="v" style="color:var(--green)">13.8 年</span></div>
        </div>
        <p style="padding:10px 12px;background:rgba(245,158,11,0.08);border-left:3px solid var(--amber);border-radius:4px">
          ⚠ <strong>SYS-A 模組 #5 衰退斜率在過去 14 天變陡</strong>（-0.08% → -0.15%）。建議排定第三季現場校驗，避免保固期內 SOH &lt; 80% 風險。
        </p>
      `
    },

    // 7. 法規
    {
      test: /IEC|ISO|法規|認證|合規|62443|61850|50001|27001/i,
      answer: (q) => {
        const kb = {
          62443: { title: "IEC 62443 (工業控制系統資安)", body: "規範工業自動化與控制系統 (IACS) 的資安要求。本系統符合 4-1 (產品開發流程) 與 4-2 (元件技術要求)，包含 X.509 雙向認證、TLS 1.3、RBAC 角色存取控制。" },
          61850: { title: "IEC 61850 (變電站通訊)", body: "變電站自動化標準通訊協定。本系統透過此協定連接台電電力交易平台，支援 GOOSE 與 MMS。" },
          50001: { title: "ISO 50001 (能源管理)", body: "能源管理系統標準。包含 PDCA 循環、能源基線建立、績效指標、內部稽核。本系統報表系統已符合。" },
          27001: { title: "ISO 27001 (資訊安全)", body: "資訊安全管理系統標準。本平台雲端儲存符合要求，稽核日誌保留 3 年。" },
        };
        const num = (q.match(/(\d{4,5})/) || [])[1];
        if (num && kb[num]) {
          return `<p><strong>${kb[num].title}</strong></p><p>${kb[num].body}</p>
                  <p class="muted" style="font-size:12px">📎 參考：IEC 官方標準文件 · 本系統合規聲明書</p>`;
        }
        return `
          <p>本系統目前符合的標準：</p>
          <div class="chat-card">
            <div class="chat-stat"><span>IEC 62443-4-1/4-2</span><span class="v" style="color:var(--green)">✓</span></div>
            <div class="chat-stat"><span>IEC 61850</span><span class="v" style="color:var(--green)">✓</span></div>
            <div class="chat-stat"><span>ISO 50001</span><span class="v" style="color:var(--green)">✓</span></div>
            <div class="chat-stat"><span>ISO 27001</span><span class="v" style="color:var(--green)">✓</span></div>
            <div class="chat-stat"><span>UL 9540A (儲能安全)</span><span class="v" style="color:var(--green)">✓</span></div>
            <div class="chat-stat"><span>台電 sReg 合格供應商</span><span class="v" style="color:var(--green)">✓</span></div>
          </div>
          <p class="muted" style="font-size:12px">想了解特定標準細節？輸入「IEC 62443 是什麼」即可。</p>
        `;
      }
    },

    // 6. 多角色
    {
      test: /主管|維運|角色|權限|role|誰看得到/,
      answer: () => `
        <p>本系統支援 4 種角色，同一問題會依身份回覆不同深度：</p>
        <div class="chat-card">
          <div class="chat-stat"><span>系統管理員</span><span class="v">全權限 · 可控制 · 2 人</span></div>
          <div class="chat-stat"><span>維運工程師</span><span class="v">可調度 · 可確認告警 · 5 人</span></div>
          <div class="chat-stat"><span>經營主管</span><span class="v">財務/效益儀表 · 3 人</span></div>
          <div class="chat-stat"><span>唯讀訪客</span><span class="v">限公開資訊 · 8 人</span></div>
        </div>
        <p>例如您問「今日節費多少？」：經營主管看到總額 + ROI；工程師還會看到 cycle count 與各 PCS 效率。</p>
      `
    },

    // 8. 跨站點對標
    {
      test: /比較|對標|其他站|多站|benchmark/,
      answer: () => `
        <p>目前僅 <strong>高雄路竹廠</strong> 一站上線。規劃中的第二站：</p>
        <div class="chat-card">
          <div class="chat-stat"><span>桃園廠（規劃中）</span><span class="v">125 kW / 261 kWh</span></div>
          <div class="chat-stat"><span>預定上線</span><span class="v">2026-Q3</span></div>
        </div>
        <p>多站上線後，我可以為您比較 PR、節費效率、SOH 衰退速率、維運事件頻率，找出最佳實務並跨站複製。</p>
      `
    },

    // 明日 / 預測
    {
      test: /明日|明天|下週|預測|預報|未來/,
      answer: () => `
        <p><strong>明日運行預測</strong> (2026-04-26)：</p>
        <div class="chat-card">
          <div class="chat-stat"><span>天氣</span><span class="v">晴 28–33°C</span></div>
          <div class="chat-stat"><span>PV 預估發電</span><span class="v" style="color:var(--pv-yellow)">2,820 kWh</span></div>
          <div class="chat-stat"><span>廠區預估負載</span><span class="v">17,200 kWh</span></div>
          <div class="chat-stat"><span>市電購入</span><span class="v">14,380 kWh</span></div>
          <div class="chat-stat"><span>儲能預計循環</span><span class="v">1.08 次</span></div>
          <div class="chat-stat"><span>預估節費</span><span class="v" style="color:var(--green)">${money(6850)}</span></div>
        </div>
        <p class="muted" style="font-size:12px">預測模型：LightGBM + 歷史 180 天 + 中央氣象署氣溫 / 日射量</p>
      `
    },

    // 系統資料
    {
      test: /系統規格|容量|PCS|幾 kW|幾 kWh/i,
      answer: () => `
        <p>J&amp;J Power EMS · ${SITE.name}</p>
        <div class="chat-card">
          <div class="chat-stat"><span>SYS-A</span><span class="v">125 kW / 261 kWh</span></div>
          <div class="chat-stat"><span>SYS-B</span><span class="v">100 kW / 215 kWh</span></div>
          <div class="chat-stat"><span>合計</span><span class="v">225 kW / 476 kWh</span></div>
          <div class="chat-stat"><span>太陽能</span><span class="v">400 kWp</span></div>
          <div class="chat-stat"><span>契約容量</span><span class="v">2,500 kW</span></div>
          <div class="chat-stat"><span>電池化學</span><span class="v">磷酸鐵鋰 (LFP) · 液冷</span></div>
        </div>
      `
    },

    // Help
    {
      test: /help|功能|能做什麼|幫助|幫忙|你會/i,
      answer: () => `
        <p>我是 Energy Copilot，可以協助：</p>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
          <div class="chat-feat"><span>📊</span>即時查詢節費、SoC、溫度、告警</div>
          <div class="chat-feat"><span>🧠</span>依氣象/電價推薦最佳運行策略</div>
          <div class="chat-feat"><span>🔧</span>告警智能診斷與處置建議</div>
          <div class="chat-feat"><span>⚡</span>一句話切換策略（例：「切換到削峰」）</div>
          <div class="chat-feat"><span>📄</span>自動產出月報 / ESG 報表</div>
          <div class="chat-feat"><span>🔮</span>電池 SOH 預測與預防性維護</div>
          <div class="chat-feat"><span>📚</span>法規標準查詢 (IEC/ISO)</div>
          <div class="chat-feat"><span>🏭</span>多站點效能對標</div>
        </div>
      `
    },

    // Greetings
    {
      test: /你好|哈囉|hi|hello|嗨|早安|午安|晚安/i,
      answer: () => `
        <p>您好 👋 我是 <strong>Energy Copilot</strong>，J&amp;J Power EMS 的 AI 助手。</p>
        <p>當前站點 <strong>${SITE.name}</strong> 運行正常，${STRATEGIES[state.strategy].label}模式執行中。有什麼可以為您服務？</p>
      `
    },
  ];

  function matchIntent(q) {
    for (const it of INTENTS) if (it.test.test(q)) return it.answer(q);
    return fallback(q);
  }

  function fallback(q) {
    return `
      <p>抱歉，這題我還沒學會 🤔 在 Phase 1 MVP 階段，我能協助：</p>
      <div class="chip-mini-row">
        ${["今日節費","SoC 狀態","有什麼告警","策略建議","切換到削峰","明日預測","產月報","我會哪些"]
          .map(t => `<a class="chat-link chip-mini" data-send="${t}">${t}</a>`).join("")}
      </div>
      <p class="muted" style="font-size:11.5px;margin-top:8px">未來接入 Claude API + RAG 知識庫後，所有 EMS 相關問題都能對話處理。</p>
    `;
  }

  // ────────── UI ──────────
  let opened = false;
  const toggle = () => {
    opened = !opened;
    panel.classList.toggle("open", opened);
    fab.classList.toggle("hidden", opened);
    if (opened && body.children.length === 0) greet();
    if (opened) setTimeout(() => input.focus(), 200);
  };

  fab.addEventListener("click", toggle);
  close.addEventListener("click", toggle);

  function greet() {
    addBot(`
      <p>您好 👋 我是 <strong>Energy Copilot</strong>，J&amp;J Power EMS 的 AI 助手。</p>
      <p>想快速開始？點下方任一按鈕 👇</p>
    `);
  }

  function addUser(text) {
    body.insertAdjacentHTML("beforeend", `<div class="chat-msg user"><div class="bubble">${escapeHtml(text)}</div></div>`);
    scrollBottom();
  }

  function addBot(html) {
    const wrap = document.createElement("div");
    wrap.className = "chat-msg bot";
    wrap.innerHTML = `<div class="bot-avatar">🤖</div><div class="bubble">${html}</div>`;
    body.appendChild(wrap);
    scrollBottom();
    // Wire any action links inside
    wrap.querySelectorAll("[data-action]").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const act = a.dataset.action;
        if (act === "switch" && a.dataset.strategy) {
          setStrategy(a.dataset.strategy);
          addBot(`✓ 已切換至 <strong>${STRATEGIES[a.dataset.strategy].full}</strong>`);
        } else if (act === "compare") {
          compareStrategies();
        }
      });
    });
    wrap.querySelectorAll("[data-send]").forEach(a => {
      a.addEventListener("click", (e) => { e.preventDefault(); handleInput(a.dataset.send); });
    });
    return wrap;
  }

  function showTyping() {
    body.insertAdjacentHTML("beforeend", `
      <div class="chat-msg bot typing" id="typing">
        <div class="bot-avatar">🤖</div>
        <div class="bubble"><span class="dots"><i></i><i></i><i></i></span></div>
      </div>
    `);
    scrollBottom();
  }
  function hideTyping() { document.getElementById("typing")?.remove(); }
  function scrollBottom() { requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; }); }
  function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

  // Strategy comparison table
  function compareStrategies() {
    const rows = Object.values(STRATEGIES).map(s => {
      const prev = state.strategy;
      state.strategy = s.id;
      const b = estimateBenefit(s.id);
      state.strategy = prev;
      return { s, b };
    });
    addBot(`
      <p>六大策略今日預估淨益比較：</p>
      <table class="chat-tbl">
        <tr><th>策略</th><th class="right">淨益</th><th class="right">循環</th></tr>
        ${rows.map(({s,b}) => `
          <tr>
            <td><span class="dot" style="background:${s.color};display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px"></span>${s.label}</td>
            <td class="right" style="color:${b.net>=0?'var(--green)':'var(--red)'}">${money(b.net)}</td>
            <td class="right muted">${(b.dischargeKWh/476).toFixed(2)}</td>
          </tr>
        `).join("")}
      </table>
      <p class="muted" style="font-size:12px">※ 未含 sReg / AFC 輔助服務市場收益</p>
    `);
  }

  // ────────── Input handling ──────────
  function handleInput(text) {
    const q = text.trim();
    if (!q) return;
    addUser(q);
    input.value = "";
    showTyping();
    const delay = 500 + Math.random() * 500;
    setTimeout(() => {
      hideTyping();
      addBot(matchIntent(q));
    }, delay);
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); handleInput(input.value); });

  // ────────── Suggestion chips ──────────
  const chips = [
    "今日節費多少？",
    "SoC 狀態",
    "有什麼告警？",
    "建議用哪個策略",
    "切換到削峰填谷",
    "明日預測",
    "產月報",
    "電芯溫度正常嗎？",
    "IEC 62443 是什麼",
    "你會什麼",
  ];
  sugg.innerHTML = chips.map(c => `<button class="chat-chip" type="button">${c}</button>`).join("");
  sugg.querySelectorAll(".chat-chip").forEach(b => b.addEventListener("click", () => handleInput(b.textContent)));
})();
