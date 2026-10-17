"use strict";
// SPIDERWEB front end - PAPER ONLY. Polls /api/state.json every 2s, draws everything on canvas.
const DUMMY = document.createElement("div");
const $ = id => document.getElementById(id) || DUMMY;   // removed elements fall back to a detached div
const C = {g:"#39ff14", p:"#ff2bd6", c:"#19e6ff", y:"#ffcc00", grey:"#7d8590", ext:"#8a7dff", fly:"#ff9d00", v:"#c58cff"};
const BOTS = {
  scanner:{name:"SCANNER", desc:"Finds new + trending memecoins on DexScreener and Binance"},
  rugcheck:{name:"RUG-CHECK", desc:"Rejects thin liquidity, brand-new pools, dumps, no socials"},
  momentum:{name:"MOMENTUM", desc:"Votes yes when price is trending up"},
  sniper:{name:"SNIPER", desc:"Votes yes on fresh pools / breakouts with buyers in control"},
  risk:{name:"RISK", desc:"Veto: edge must beat 2x fees+slippage; runs every exit"},
  degen:{name:"DEGEN $100", desc:"Self-learning side bot with its own $100 and lives"},
  learner:{name:"LEARNER", desc:"Practises on brand-new Solana coins and learns after every trade"},
  axiom:{name:"AXIOM SIM", desc:"Paper trades 'as if on Axiom': Pulse lanes, Axiom fees + tips, quick-buy presets"},
  runner:{name:"MILLY RUNNER", desc:"Snipes coins ripping past $300k mcap, takes profit at $1.1M, learns which setups run"},
};
// PUBLIC = read-only GitHub Pages mirror: state comes from a pushed snapshot, prices are fetched live in the browser.
const PUBLIC = !/^(127\.0\.0\.1|localhost)$/.test(location.hostname);
const CEX = ["DOGE","SHIB","PEPE","BONK","WIF","FLOKI","TRUMP","PENGU","BOME","NEIRO"];
let browserFeedOk = 0, LIVEPX = {};
let SHOWEXT = false;
let S = null, CANDLES = {}, lastOk = 0, focusIdx = 0, focusSym = null, lastFocusSwitch = 0;
const shown = {};

// ---------- formatting ----------
const usd = (v, d=2) => v == null ? "—" : (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-GB", {minimumFractionDigits:d, maximumFractionDigits:d});
const sgn = (v, d=2) => v == null ? "—" : (v >= 0 ? "+" : "-") + "$" + Math.abs(v).toLocaleString("en-GB", {minimumFractionDigits:d, maximumFractionDigits:d});
const pct = (v, d=2) => v == null ? "—" : (v >= 0 ? "+" : "") + (v*100).toFixed(d) + "%";
const px = v => v == null ? "—" : v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v >= 0.01 ? v.toFixed(5) : v.toPrecision(4);
const cls = v => v > 0 ? "pos" : v < 0 ? "neg" : "";
const ldn = (t, sec=true) => new Date(t*1000).toLocaleTimeString("en-GB", {timeZone:"Europe/London", hour:"2-digit", minute:"2-digit", second: sec ? "2-digit" : undefined});
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

// animated number with green/red flash
function setNum(id, value, fmt, colorize=true){
  const el = $(id); if (!el) return;
  const prev = shown[id];
  if (prev == null || value == null){ shown[id] = value; el.textContent = fmt(value); if (colorize) el.className = "num " + cls(value); return; }
  if (Math.abs(value - prev) > 1e-9){
    el.classList.remove("flash-up","flash-dn"); void el.offsetWidth;
    el.classList.add(value > prev ? "flash-up" : "flash-dn");
    const t0 = performance.now(), from = prev;
    const step = now => { const k = Math.min((now - t0)/700, 1); el.textContent = fmt(from + (value - from)*(1 - Math.pow(1-k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  shown[id] = value;
  if (colorize){ el.classList.toggle("pos", value > 0); el.classList.toggle("neg", value < 0); }
}

function canvasCtx(cv){
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(r.width*dpr) || cv.height !== Math.round(r.height*dpr)){ cv.width = Math.round(r.width*dpr); cv.height = Math.round(r.height*dpr); }
  const x = cv.getContext("2d"); x.setTransform(dpr,0,0,dpr,0,0); return [x, r.width, r.height];
}

// ---------- polling ----------
async function poll(){
  try{
    const r = await fetch("api/state.json?" + Date.now(), {cache:"no-store"}); S = await r.json(); lastOk = Date.now();
    if (PUBLIC) Object.assign(S.prices, LIVEPX);
    render();
  }catch(e){ /* keep last state; pills will show stale */ }
}
async function pollCandles(){
  if (PUBLIC){ await pollBrowserPrices(); return; }
  try{ CANDLES = await (await fetch("api/candles.json?" + Date.now())).json(); }catch(e){}
}
// Public mirror: live 1m candles straight from Binance's public mirror (CORS: *), snapshot as fallback.
let snapLoaded = false, pxRound = 0;
async function pollBrowserPrices(){
  if (!snapLoaded){ try{ CANDLES = await (await fetch("api/candles.json?" + Date.now(), {cache:"no-store"})).json(); snapLoaded = true; }catch(e){} }
  const syms = Object.keys(CANDLES).length ? Object.keys(CANDLES) : CEX;
  const want = pxRound++ % 6 === 0 ? syms : [focusSym || syms[0]];
  await Promise.all(want.map(async s => {
    try{
      const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${s}USDT&interval=1m&limit=120`);
      if (!r.ok) return;
      const rows = (await r.json()).map(k => [k[0]/1000, +k[1], +k[2], +k[3], +k[4], +k[7]]);
      CANDLES[s] = rows.slice(-90); LIVEPX[s] = rows[rows.length-1][4]; browserFeedOk = Date.now()/1000;
      if (S){ S.prices[s] = LIVEPX[s]; if (rows.length > 61) S.chg1h[s] = rows[rows.length-1][4]/rows[rows.length-61][4] - 1; }
    }catch(e){}
  }));
  if (S) renderTickers();
}

function render(){
  const s = S;
  try{ renderTeamKpis(s); }catch(e){ console.error(e); }
  [renderHero, renderBots, renderTape, renderHeads, renderScreen, renderVote, renderDegen, renderStats, renderPositions, renderLog, renderTickers, renderLearner, renderHonest, renderAxiom, renderThresholds]
    .forEach(f => { try{ f(); }catch(e){ console.error(f.name, e); } });     // one broken panel can't blank the page
  try{ renderCostline(s); }catch(e){}
}
function renderTeamKpis(s){
  const eq = s.equity, total = eq - s.start_balance, today = eq - s.day_open;
  setNum("kEq", eq, v => usd(v), false);
  $("kEqD").innerHTML = `<span class="${cls(total)}">${pct(total/s.start_balance)}</span> · cash ${usd(s.cash, 0)}`;
  setNum("kToday", today, v => sgn(v));
  setNum("kTotal", total, v => sgn(v));
  setNum("kFees", s.fees, v => "-" + usd(v).replace("-",""), false);
  $("kSlip").textContent = `+${usd(s.slippage, 0)} slippage`;
}
function renderCostline(s){
  const k = s.costs;
  $("costline").textContent = k.terminal_fee != null ? `Binance ${(k.cex_fee*100).toFixed(2)}% fee + ${(k.cex_slip*100).toFixed(2)}% slippage per side. Solana DEX: ${(k.terminal_fee*100).toFixed(2)}% terminal fee + pool fee (${(k.pump_pool_fee*100).toFixed(2)}% on small pump coins) + price impact + ${k.prio_sol} SOL priority per side (SOL $${Math.round(k.sol_px)}). $${k.dex_size} in a $25k pool ≈ ${(k.dex_rt_example*100).toFixed(1)}% round trip. DEGEN perps: 0.05% taker per side on the notional + 0.02% slippage, liquidation at 0.5% maintenance margin.` : "";
}

// ---------- HERO + headline numbers ----------
const ldnDate = t => new Date(t*1000).toLocaleDateString("en-GB", {timeZone:"Europe/London"});
function allOpen(){ return S.positions.length + (S.learner ? S.learner.positions.length : 0) + (S.axiom ? S.axiom.positions.length : 0) + (S.runner ? S.runner.positions.length : 0) + (S.degen.pos ? 1 : 0); }
function renderHero(){
  const L = S.learner, A = S.axiom, D = S.degen, Q = S.runner;
  const bal = S.equity + (L ? L.equity : 0) + (A ? A.equity : 0) + (Q ? Q.equity : 0) + D.equity, start = S.start_balance + (L ? L.bank : 0) + (A ? A.bank : 0) + (Q ? Q.bank : 0) + 100;
  const td = ldnDate(S.server_time), isT = t => t && ldnDate(t) === td;
  let today = S.equity - S.day_open;
  if (L) today += L.trades.filter(t => isT(t.closed)).reduce((a, t) => a + t.pnl, 0);
  if (A) today += A.trades.filter(t => isT(t.closed)).reduce((a, t) => a + t.pnl, 0);
  if (Q) today += Q.trades.filter(t => isT(t.closed)).reduce((a, t) => a + t.pnl, 0);
  today += (D.history || []).filter(h => isT(h.t)).reduce((a, h) => a + h.pnl, 0);
  setNum("hBal", bal, v => usd(v), false);
  $("hBalD").innerHTML = `<span class="${cls(bal - start)}">${sgn(bal - start, 0)} (${pct((bal - start)/start, 1)})</span> vs ${usd(start, 0)}`;
  $("hBal").title = `team ${usd(S.equity, 0)} of $10,000 · LEARNER ${usd(L ? L.equity : 0, 0)} of $1,000 · AXIOM SIM ${usd(A ? A.equity : 0, 0)} of $1,000 · DEGEN ${usd(D.equity, 0)} of $100`;
  setNum("hToday", today, v => sgn(v, 0));
  $("hLive").textContent = allOpen();
}
function renderHeads(){
  const L = S.learner, A = S.axiom, D = S.degen;
  const h = (id, v, txt) => { const e = $(id); e.className = "hl " + cls(v); e.textContent = txt; };
  h("sTeam", S.equity - S.start_balance, `${usd(S.equity, 0)} · ${sgn(S.equity - S.start_balance, 0)}`);
  if (A) h("sAx", A.equity - A.bank, `${sgn(A.equity - A.bank, 0)} · ${A.n} trades`);
  if (L) h("sL", L.equity - L.bank, `${sgn(L.equity - L.bank, 0)} · ${L.n} trades`);
  h("sD", D.equity - 100, D.pos ? `${usd(D.equity)} · x${D.pos.lev} ${D.pos.side}` : `${usd(D.equity)} · ${"♥".repeat(D.lives)}`);
}

function pills(){
  const ageS = S ? (Date.now()/1000 - S.server_time) : 999;
  const eng = $("pEngine");
  const engOn = S && ageS < (PUBLIC ? 300 : 20);
  const fa = PUBLIC ? browserFeedOk : S ? Math.max(S.feed_ok.binance, S.feed_ok.dexscreener) : 0, feedOn = S && Date.now()/1000 - fa < 60;
  eng.className = "pill " + (engOn && feedOn ? "on" : "off"); eng.innerHTML = `<i></i>${engOn ? (feedOn ? "LIVE" : "STALE") : (PUBLIC ? "PAUSED" : "OFFLINE")}`;
  if (S){ const b = Math.round(Date.now()/1000 - (PUBLIC ? browserFeedOk : S.feed_ok.binance));
    const t = `${PUBLIC ? "public snapshot" : "engine"} updated ${Math.max(0, Math.round(ageS))}s ago · prices ${b}s ago`; eng.title = t; $("updated").textContent = t; }
}

// ---------- screener list (continuous scroll) ----------
let scrY = 0, scrRows = "";
function renderScreen(){
  const rows = S.screen.slice().reverse().map(r =>
    `<div class="row" data-cap="${esc(r.verdict === "PASS" ? r.sym + " passed ✓" : r.verdict === "FAIL" ? r.sym + " rejected" : "checking " + r.sym)}" data-tone="${r.verdict === "PASS" ? "pass" : r.verdict === "FAIL" ? "fail" : "hold"}" data-hot="${r.t}"><span class="sym">${esc(r.sym)}</span><span class="why">${esc(r.reason)}</span><span class="badge b-${r.verdict}">${r.verdict}</span></div>`).join("");
  if (rows !== scrRows){ scrRows = rows; $("screen").innerHTML = rows + rows; }
}
function scrollScreen(dt){
  const el = $("screen"); const h = el.scrollHeight/2; if (!h) return;
  scrY = (scrY + dt*0.022) % h; el.style.transform = `translateY(${-scrY}px)`;
}

// ---------- vote ----------
function renderVote(){
  const live = S.votes[S.votes.length-1], lp = S.last_pass;
  const v = lp && (S.server_time - lp.t) < 3600 ? lp : live;
  if (!v) return;
  const yes = Object.values(v.votes).filter(x => x[0]==="yes").length;
  $("vote").innerHTML = `<div class="vhead"><span>${v.verdict==="PASS"?"LAST BUY VOTE":"LATEST VOTE"} · <b style="color:${C.p}">${esc(v.sym)}</b> · ${ldn(v.t)}</span>
   <span><b>${yes}/${Object.keys(v.votes).length} YES</b> → <span class="badge b-${v.verdict}">${v.verdict === "PASS" ? "BUY (paper)" : v.verdict}</span></span></div>
   ${live && live !== v ? `<div style="color:${C.grey};font-size:10px;margin-bottom:6px">now voting on ${esc(live.sym)} → ${live.verdict}</div>` : ""}<div class="chips">${Object.entries(v.votes).map(([b,[d,why]]) => `<div class="chip v-${d}"><b>${BOTS[b].name}: ${d==="abstain"?"—":d.toUpperCase()}</b><span title="${esc(why)}">${esc(why)}</span></div>`).join("")}</div>`;
}

// ---------- bots ----------
function botState(b){
  const x = S.bots[b];
  if (b === "learner"){ const L = S.learner; if (!L) return "scan"; return L.positions.length ? "trade" : !L.n ? "scan" : L.pnl >= 0 ? "win" : "loss"; }
  if (b === "axiom"){ const A = S.axiom; if (!A) return "scan"; return A.positions.length ? "trade" : !A.n ? "scan" : A.pnl >= 0 ? "win" : "loss"; }
  if (b === "runner"){ const Q = S.runner; if (!Q) return "scan"; return Q.positions.length ? "trade" : !Q.n ? "scan" : Q.pnl >= 0 ? "win" : "loss"; }
  if (b === "degen"){ const d = S.degen; return d.open ? "trade" : (d.equity > 100 ? "win" : d.equity < 100 ? "loss" : "scan"); }
  if (x.open) return "trade";
  if (x.trades === 0) return "scan";
  return x.pnl >= 0 ? "win" : "loss";
}
function renderDegen(){
  const d = S.degen, hearts = "♥".repeat(d.lives) + "♡".repeat(Math.max(0, 3 - d.lives)), p = d.pos;
  const arms = Object.entries(d.arms).map(([k,a]) => `<div class="st"><label>${k}</label><div class="${cls(a.avg)}">${a.n ? pct(a.avg, 1) : "—"}</div><small>${a.n} trades</small></div>`).join("");
  const hist = (d.history || []).slice(0, 8).map(h => `<div class="tl"><span class="tt">${ldn(h.t,false)}</span><span class="side ${h.why === "LIQUIDATED" ? "LIQ" : h.side || ""}">${h.why === "LIQUIDATED" ? "LIQ" : h.side || ""}</span><span class="ts">${esc(h.sym)}${h.explore ? TST : ""}${h.lev ? ` <i>x${h.lev} · ${h.arm}</i>` : ""}</span><span class="tv ${cls(h.pnl)}">${sgn(h.pnl)}</span></div>`).join("");
  const posH = p ? `<div class="dpos ${p.dist < 0.004 ? "hot" : ""}"><div class="dp1"><b>${esc(p.sym)}</b><span class="lev">${p.side} x${p.lev}</span><span class="${cls(p.upnl)}">${sgn(p.upnl)}</span></div>
      <div class="dp2"><span><i>margin</i> ${usd(p.margin)}</span><span><i>size</i> ${usd(p.notional, 0)}</span><span><i>entry</i> ${px(p.entry)}</span><span><i>mark</i> ${px(p.mark)}</span><span><i>liq</i> <b class="neg">${px(p.liq)}</b></span></div>
      <div class="dist"><span>to liquidation</span><div class="dbar"><i style="width:${Math.max(2, Math.min(100, p.dist / (1/p.lev) * 100))}%"></i></div><b>${(p.dist*100).toFixed(2)}%</b></div></div>`
    : `<div class="empty">Waiting for a setup.</div>`;
  $("degen").innerHTML = `<div class="kpis"><div class="kpi"><label>Balance <b class="i" tabindex="0" data-tip="Paper perps on Binance memecoin prices, 20-50x, ~75% of its balance as margin. 0.05% taker fee per side on the full position. A liquidation loses the margin and a life; it respawns with $100.">i</b></label><div class="num ${cls(d.equity-100)}">${usd(d.equity)}</div></div>
    <div class="kpi"><label>Lives</label><div class="lives">${hearts}</div><div class="delta">${d.liqs} liquidated · ${d.busts} busts</div></div>
    <div class="kpi"><label>Win rate</label><div class="num">${d.trades ? Math.round(100*d.wins/d.trades) + "%" : "—"}</div><div class="delta">${d.trades} trades</div></div></div>
    ${posH}<h3>PLAYBOOKS <b class="i" tabindex="0" data-tip="Average return on margin per playbook. It picks the best one more often (20% exploring).">i</b></h3><div class="stats">${arms}</div>${hist ? `<h3>RECENT</h3><div class="tape compact">${hist}</div>` : ""}`;
}
const TST = ' <i class="tst">test</i>';   // small tag on forced / exploration test trades
function renderTape(){
  const t = [], LN = {new:"new", final:"final", migrated:"migr."};
  S.trades.forEach(r => { t.push({t:r.closed, side:"SELL", sym:r.sym, pnl:r.pnl, bot:"TEAM", tip:r.lead + " · " + r.why, test:!!r.test});
                          t.push({t:r.opened, side:"BUY", sym:r.sym, usd:r.cost, bot:"TEAM", tip:r.lead, test:!!r.test}); });
  S.positions.forEach(p => t.push({t:p.opened, side:"BUY", sym:p.sym, usd:p.cost, bot:"TEAM", tip:p.lead + " · open", test:!!p.test}));
  S.events.filter(e => e.kind === "tape" && e.bot === "degen").forEach(e => t.push({t:e.t, side:e.side === "BUY" ? (e.dir || "BUY") : "CLOSE", sym:e.sym, usd:e.side === "BUY" ? e.usd : null, pnl:e.side === "BUY" ? null : e.pnl, bot:"DEGEN", note:(e.note || "").replace(/ test$/, ""), liq:(e.note || "").startsWith("LIQ"), test:!!e.test}));
  if (S.learner){ S.learner.trades.forEach(r => { const tq = r.mode === "test" || r.explore; t.push({t:r.closed, side:"SELL", sym:r.sym, pnl:r.pnl, bot:"LEARN", tip:r.exit_why, test:tq});
                                                  t.push({t:r.opened, side:"BUY", sym:r.sym, usd:r.cost, bot:"LEARN", test:tq}); });
                  S.learner.positions.forEach(p => t.push({t:p.opened, side:"BUY", sym:p.sym, usd:p.cost, bot:"LEARN", tip:"open", test:p.mode === "test" || p.explore})); }
  if (S.axiom){ S.axiom.trades.forEach(r => { const tq = r.mode === "test" || r.explore; t.push({t:r.closed, side:"SELL", sym:r.sym, pnl:r.pnl, bot:"AXIOM", tip:LN[r.lane] + " · " + r.exit_why + " · " + costTxt(r.costs), test:tq});
                                              t.push({t:r.opened, side:"BUY", sym:r.sym, usd:r.cost, bot:"AXIOM", tip:LN[r.lane] + " · " + r.sol_amt + " SOL", test:tq}); });
    S.axiom.positions.forEach(p => t.push({t:p.opened, side:"BUY", sym:p.sym, usd:p.cost, bot:"AXIOM", tip:LN[p.lane] + " · open", test:!!p.explore})); }
  t.sort((a,b) => b.t - a.t);
  if (!t.length){ $("tape").innerHTML = `<div class="empty">No trades yet.</div>`; return; }
  $("tape").innerHTML = t.slice(0, 8).map(e => { const v = e.pnl != null ? e.pnl : null;
    const cap = e.liq ? "liquidated!" : v != null ? `${e.sym} ${sgn(v, 0)}` : `bought ${e.sym}`;
    return `<div class="tl" title="${esc(e.tip || e.note || "")}" data-cap="${esc(cap.slice(0, 22))}" data-tone="${e.liq ? "fail" : v == null ? "info" : v > 0 ? "win" : "risk"}" data-hot="${e.t}">
      <span class="tt">${ldn(e.t, false)}</span><span class="tb b-${e.bot}">${e.bot}</span><span class="side ${e.side}">${e.liq ? "LIQ" : e.side}</span><span class="ts">${esc(e.sym)}${e.test ? TST : ""}${e.note && !e.liq ? ` <i>${esc(e.note)}</i>` : e.liq ? ` <i class="neg">${esc(e.note)}</i>` : ""}</span><span class="tv ${cls(v)}">${v != null ? sgn(v) : usd(e.usd, 0)}</span></div>`; }).join("");
}
function renderStats(){
  const s = S, n = s.trade_count, none = '<small>after first closed trade</small>';
  const items = [
    ["Return", `<span class="${cls(s.equity-s.start_balance)}">${pct((s.equity-s.start_balance)/s.start_balance)}</span>`],
    ["Win rate", s.win_rate == null ? none : `${(s.win_rate*100).toFixed(0)}% <small>of ${n}</small>`],
    ["Profit factor", s.profit_factor == null ? (n ? "<small>no losses yet</small>" : none) : s.profit_factor.toFixed(2) + " <small>won $ / lost $</small>"],
    ["Max drawdown", `<span class="${s.maxdd>0?"neg":""}">${(s.maxdd*100).toFixed(2)}%</span> <small>from peak</small>`],
    ["Best trade", s.best == null ? none : `<span class="${cls(s.best)}">${sgn(s.best)}</span>`],
    ["Worst trade", s.worst == null ? none : `<span class="${cls(s.worst)}">${sgn(s.worst)}</span>`],
    ["Fees paid", `<span class="neg">-${usd(s.fees).replace("-","")}</span> <small>+ ${usd(s.slippage)} slippage</small>`],
    ["Trades closed", n ? n : "<small>none yet</small>"],
    ["Avg hold", s.avg_hold_min == null ? none : `${s.avg_hold_min.toFixed(1)} min`],
  ];
  $("stats").innerHTML = items.map(([l,v]) => `<div class="st"><label>${l}</label><div>${v}</div></div>`).join("");
}
function renderPositions(){
  if (!S.positions.length){ $("positions").innerHTML = `<div class="empty">No open positions — the team is waiting for a coin that passes the vote.</div>`; return; }
  $("positions").innerHTML = S.positions.map(p => `<div class="tl" title="in ${px(p.entry)} → ${px(p.last)} · TP ${px(p.tp)} / SL ${px(p.sl)}" style="grid-template-columns:38px minmax(0,1fr) auto auto"><span class="tt">${ldn(p.opened,false)}</span><span class="ts">${esc(p.sym)} <i>${p.lead}</i></span><span class="tt">${usd(p.cost,0)}</span><span class="tv ${cls(p.upnl)}">${sgn(p.upnl)}</span></div>`).join("");
}
function renderLog(){
  const el = $("log"), atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
  el.innerHTML = S.log.map(l => `<div class="ln ${l.level}"><span class="t">${ldn(l.t)}</span> <span class="bb">[${l.bot}]</span> ${esc(l.msg)}</div>`).join("");
  if (atBottom) el.scrollTop = el.scrollHeight;
}
function renderTickers(){
  const syms = Object.keys(S.prices);
  $("tickers").innerHTML = syms.map(s => `<span class="tk ${s===focusSym?"act":""}" data-s="${s}">${s} ${px(S.prices[s])} <span class="${cls(S.chg1h[s])}">${S.chg1h[s]!=null?pct(S.chg1h[s],1):""}</span></span>`).join("");
}
$("tickers").addEventListener("click", e => { const t = e.target.closest(".tk"); if (t){ focusSym = t.dataset.s; lastFocusSwitch = Date.now() + 20000; } });

// ---------- equity chart ----------
function drawEquity(){
  if (!S) return;
  const [x, w, h] = canvasCtx($("eqChart")); x.clearRect(0,0,w,h);
  const pts = S.equity_curve.slice(); pts.push([S.server_time, S.equity]);
  const T = "#2ee6a6", vh = 26, top = 10, bot = h - vh - 16;
  x.strokeStyle = "#161b2a"; x.lineWidth = 1;
  for (let i=0;i<=4;i++){ const yy = top + (bot-top)*i/4; x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy); x.stroke(); }
  if (pts.length < 2){ x.fillStyle = C.grey; x.font = "11px monospace"; x.fillText("equity curve starts after the first minute", 10, h/2); return; }
  let lo = Math.min(...pts.map(p=>p[1]), S.start_balance), hi = Math.max(...pts.map(p=>p[1]), S.start_balance);
  const pad = Math.max((hi-lo)*0.15, 2); lo -= pad; hi += pad;
  const t0 = pts[0][0], t1 = pts[pts.length-1][0];
  const X = t => 50 + (w-60)*(t1===t0 ? 1 : (t-t0)/(t1-t0)), Y = v => top + (bot-top)*(1-(v-lo)/(hi-lo));
  // volume bars: closed trades per time bucket (all bots), green = net win, pink = net loss
  const nb = Math.max(20, Math.floor((w-60)/9)), bk = Array.from({length:nb}, () => [0, 0]);
  const add = (t, pnl) => { if (t < t0 || t > t1) return; const i = Math.min(nb-1, Math.floor((t-t0)/((t1-t0)||1)*nb)); bk[i][0]++; bk[i][1] += pnl; };
  S.trades.forEach(r => add(r.closed, r.pnl)); if (S.learner) S.learner.trades.forEach(r => add(r.closed, r.pnl)); if (S.axiom) S.axiom.trades.forEach(r => add(r.closed, r.pnl));
  const bm = Math.max(1, ...bk.map(b => b[0])), bw = (w-60)/nb;
  bk.forEach((b,i) => { if (!b[0]) return; const hh = 3 + (vh-3)*b[0]/bm; x.fillStyle = b[1] >= 0 ? "#2ee6a666" : "#ff2bd666"; x.fillRect(50 + i*bw + 1, h - 14 - hh, Math.max(1, bw - 2), hh); });
  x.fillStyle = "#6b7590"; x.font = "10px monospace";
  [hi-pad, (hi+lo)/2, lo+pad].forEach(v => x.fillText("$"+Math.round(v).toLocaleString(), 0, Y(v)+3));
  x.fillText(ldn(t0,false)+" LDN", 50, h-2); x.textAlign = "right"; x.fillText(ldn(t1,false), w-4, h-2); x.textAlign = "left";
  x.setLineDash([4,4]); x.strokeStyle = "#3a4258"; x.beginPath(); x.moveTo(50, Y(S.start_balance)); x.lineTo(w, Y(S.start_balance)); x.stroke(); x.setLineDash([]);
  // smooth line (quadratic through midpoints), soft gradient fill
  const P = pts.map(p => [X(p[0]), Y(p[1])]);
  const path = () => { x.beginPath(); x.moveTo(P[0][0], P[0][1]); for (let i=1;i<P.length-1;i++){ const mx = (P[i][0]+P[i+1][0])/2, my = (P[i][1]+P[i+1][1])/2; x.quadraticCurveTo(P[i][0], P[i][1], mx, my); } x.lineTo(P[P.length-1][0], P[P.length-1][1]); };
  const g = x.createLinearGradient(0, top, 0, bot); g.addColorStop(0, "#2ee6a640"); g.addColorStop(1, "#2ee6a600");
  path(); x.lineTo(P[P.length-1][0], bot); x.lineTo(P[0][0], bot); x.closePath(); x.fillStyle = g; x.fill();
  path(); x.strokeStyle = T; x.lineWidth = 2; x.stroke();
  const lx = P[P.length-1][0], ly = P[P.length-1][1];
  glow(x, lx, ly, "#2ee6a6", 14, 0.8); x.fillStyle = "#eafff7"; x.beginPath(); x.arc(lx, ly, 2.6, 0, 7); x.fill();
  // big readout
  x.textAlign = "right"; x.fillStyle = "#6b7590"; x.font = "10px monospace"; x.fillText("BALANCE", w - 6, top + 10);
  x.fillStyle = S.equity >= S.start_balance ? "#2ee6a6" : "#ff2bd6"; x.font = `bold ${w < 500 ? 18 : 24}px ui-monospace,monospace`; x.fillText(usd(S.equity), w - 6, top + (w < 500 ? 30 : 36)); x.textAlign = "left";
}

// ---------- candles ----------
function emaArr(a, n){ const k = 2/(n+1); let e = null; return a.map(v => e = e == null ? v : v*k + e*(1-k)); }
function drawCandles(){
  const syms = Object.keys(CANDLES); if (!syms.length) return;
  if (!focusSym || Date.now() - lastFocusSwitch > 12000){
    if (Date.now() - lastFocusSwitch > 12000){ focusIdx = (focusIdx + 1) % syms.length; focusSym = syms[focusIdx]; lastFocusSwitch = Date.now(); }
  }
  const c = (CANDLES[focusSym] || []).slice(-70); if (!c.length) return;
  $("pairName").textContent = focusSym + "/USDT"; $("pairLabel").textContent = "// " + focusSym + "/USDT · live Binance 1m";
  const last = c[c.length-1][4], first = c[0][4];
  $("pairPx").textContent = "$" + px(last);
  const ch = last/first - 1; $("pairChg").textContent = pct(ch) + " 70m"; $("pairChg").className = "chg " + cls(ch);
  const [x, w, h] = canvasCtx($("candles")); x.clearRect(0,0,w,h);
  const vh = h*0.2, ph = h - vh - 14;
  const lo = Math.min(...c.map(k=>k[3])), hi = Math.max(...c.map(k=>k[2])), vmax = Math.max(...c.map(k=>k[5]), 1e-9);
  const bw = (w-54)/c.length, Y = v => 6 + (ph-12)*(1-(v-lo)/((hi-lo)||1));
  x.strokeStyle = "#140a14"; for (let i=1;i<5;i++){ x.beginPath(); x.moveTo(0,ph*i/5); x.lineTo(w,ph*i/5); x.stroke(); }
  c.forEach((k,i) => {
    const cx = i*bw + bw/2, up = k[4] >= k[1], col = up ? C.g : C.p;
    x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 1;
    x.beginPath(); x.moveTo(cx, Y(k[2])); x.lineTo(cx, Y(k[3])); x.stroke();
    const y1 = Y(Math.max(k[1],k[4])), y2 = Y(Math.min(k[1],k[4]));
    x.globalAlpha = up ? 0.9 : 0.85; x.fillRect(cx - bw*0.35, y1, bw*0.7, Math.max(1, y2-y1));
    x.globalAlpha = 0.35; const vv = (k[5]/vmax)*vh; x.fillRect(cx - bw*0.35, h - 12 - vv, bw*0.7, vv); x.globalAlpha = 1;
  });
  const cl = c.map(k=>k[4]);
  [[emaArr(cl,9), C.c], [emaArr(cl,21), C.y]].forEach(([e,col]) => { x.strokeStyle = col; x.lineWidth = 1.3; x.beginPath(); e.forEach((v,i)=> i ? x.lineTo(i*bw+bw/2, Y(v)) : x.moveTo(bw/2, Y(v))); x.stroke(); });
  x.setLineDash([3,3]); x.strokeStyle = "#ffffff66"; x.beginPath(); x.moveTo(0, Y(last)); x.lineTo(w-52, Y(last)); x.stroke(); x.setLineDash([]);
  x.fillStyle = C.p; x.fillRect(w-52, Y(last)-8, 52, 16); x.fillStyle = "#000"; x.font = "bold 10px monospace"; x.fillText(px(last), w-50, Y(last)+4);
  x.fillStyle = C.grey; x.font = "10px monospace"; x.fillText(px(hi), w-50, 12); x.fillText(px(lo), w-50, ph-4);
  x.fillText(ldn(c[0][0],false), 2, h-1); x.textAlign="right"; x.fillText(ldn(c[c.length-1][0],false)+" LDN", w-56, h-1); x.textAlign="left";
  x.fillStyle = C.c; x.fillText("EMA9", 4, 12); x.fillStyle = C.y; x.fillText("EMA21", 40, 12);
}

// ---------- timeline strip ----------

// ---------- SPIDER WEB v2 (crisp cyan/pink net, orbs, pill labels, caught prey, travelling light) ----------
const WC = {cy:"#00E5FF", pk:"#FF1493", win:"#00FF41", loss:"#FF2BD6", risk:"#FF8C00", red:"#FF003C", vi:"#9d8cff", ax:"#ff7a2f"};
const WEB = {pulses:[], bursts:[], seen:0, target:null, tUntil:0, layer:null, key:"", hits:[], sp:{s:0, v:0, ang:-Math.PI/2, feet:null}, dew:[]};
const SPRITES = {};
function glowSprite(col, r){
  const k = col + r; if (SPRITES[k]) return SPRITES[k];
  const c = document.createElement("canvas"); c.width = c.height = r*2; const g = c.getContext("2d");
  const gr = g.createRadialGradient(r, r, 0, r, r, r); gr.addColorStop(0, col + "ff"); gr.addColorStop(0.18, col + "aa"); gr.addColorStop(0.45, col + "33"); gr.addColorStop(1, col + "00");
  g.fillStyle = gr; g.fillRect(0, 0, r*2, r*2); return SPRITES[k] = c;
}
function glow(x, px_, py_, col, r, a=1){ const s = glowSprite(col, r); x.globalAlpha = a; x.drawImage(s, px_ - r, py_ - r); x.globalAlpha = 1; }
function winRate(id){
  if (id === "learner") return S.learner && S.learner.n ? S.learner.wins / S.learner.n : null;
  if (id === "axiom") return S.axiom && S.axiom.n ? S.axiom.wins / S.axiom.n : null;
  if (id === "runner") return S.runner && S.runner.n ? S.runner.wins / S.runner.n : null;
  if (id === "degen") return S.degen.trades ? S.degen.wins / S.degen.trades : null;
  const b = S.bots[id]; return b && b.trades ? b.wins / b.trades : null;
}
function botMoney(id){
  if (id === "trends"){ const T = S.trends, t = T && T.terms && T.terms[0]; return {txt: t ? t.term : "—", v: null, word: true}; }
  if (id === "degen") return {txt: sgn(S.degen.equity - 100), v: S.degen.equity - 100};
  if (id === "learner"){ const L = S.learner, d = L.equity - L.bank; return {txt: sgn(d), v: d}; }
  if (id === "axiom"){ const A = S.axiom; if (!A) return {txt:"—", v:null}; const d = A.equity - A.bank; return {txt: sgn(d), v: d}; }
  if (id === "runner"){ const Q = S.runner; if (!Q) return {txt:"—", v:null}; const d = Q.equity - Q.bank; return {txt: sgn(d), v: d}; }
  const b = S.bots[id], t = b.pnl + b.upnl;
  return b.trades || b.open ? {txt: sgn(t), v: t} : {txt: "$0", v: null};
}
function botPositions(id){
  if (id === "learner") return (S.learner ? S.learner.positions : []).map(p => ({sym:p.sym, upnl:p.upnl, cost:p.cost}));
  if (id === "axiom") return (S.axiom ? S.axiom.positions : []).map(p => ({sym:p.sym, upnl:p.upnl, cost:p.cost}));
  if (id === "runner") return (S.runner ? S.runner.positions : []).map(p => ({sym:p.sym, upnl:p.upnl, cost:p.cost}));
  if (id === "degen") return S.degen.pos ? [{sym:S.degen.pos.sym + " x" + S.degen.pos.lev, upnl:S.degen.pos.upnl, cost:S.degen.pos.margin}] : [];
  return S.positions.filter(p => p.lead === id).map(p => ({sym:p.sym, upnl:p.upnl, cost:p.cost}));
}
function layoutNodes(w, h){
  const mob = w < 520, R = Math.min(w, h)/2 - (mob ? 26 : 34), cx = w/2, cy = h/2, nodes = [];
  const team = ["scanner","rugcheck","momentum","sniper","risk"], D = Math.PI/180;
  team.forEach((b,i) => nodes.push({id:b, kind:"team", a:(-90 + i*72)*D, r:R*0.52}));
  nodes.push({id:"degen", kind:"team", a:-54*D, r:R*0.86});
  if (S.learner) nodes.push({id:"learner", kind:"team", a:-126*D, r:R*0.86});
  if (S.axiom) nodes.push({id:"axiom", kind:"team", a:18*D, r:R*0.86});
  if (S.runner) nodes.push({id:"runner", kind:"team", a:90*D, r:R*0.86});
  if (S.bots && S.bots.trends) nodes.push({id:"trends", kind:"team", a:162*D, r:R*0.86});   // TRENDS bot
  const ex = SHOWEXT ? (S.ext || []) : [];
  ex.forEach((e,i) => { const a = (ex.length > 1 ? 72 + i*(78/(ex.length-1)) : 100)*D; nodes.push({id:"ext"+i, kind:"ext", a, r:R*0.93, e}); });
  nodes.forEach(n => { n.x = cx + Math.cos(n.a)*n.r; n.y = cy + Math.sin(n.a)*n.r; n.rad = n.kind === "ext" ? 6 : (mob ? 10 : 12); });
  return {nodes, R, cx, cy, mob};
}
function buildLayer(w, h, L){
  const dpr = window.devicePixelRatio || 1, c = document.createElement("canvas"); c.width = w*dpr; c.height = h*dpr;
  const x = c.getContext("2d"); x.scale(dpr, dpr);
  const {cx, cy, R} = L, D = Math.PI/180;
  // background: navy vignette
  const bg = x.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w,h)*0.7); bg.addColorStop(0, "#0f1424"); bg.addColorStop(0.55, "#0b0e18"); bg.addColorStop(1, "#06070c");
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  // far layer: faint blurred second web (depth)
  x.save(); x.filter = "blur(1.5px)"; x.globalAlpha = 0.22; x.strokeStyle = WC.vi; x.lineWidth = 0.7;
  const fx = cx + R*0.55, fy = cy - R*0.5;
  for (let i=0;i<12;i++){ const a = i*30*D; x.beginPath(); x.moveTo(fx, fy); x.lineTo(fx + Math.cos(a)*R*0.9, fy + Math.sin(a)*R*0.9); x.stroke(); }
  for (let j=1;j<6;j++){ x.beginPath(); for (let i=0;i<=12;i++){ const a = i*30*D, r = R*0.15*j; const X = fx + Math.cos(a)*r, Y = fy + Math.sin(a)*r; i ? x.lineTo(X, Y) : x.moveTo(X, Y); } x.stroke(); }
  x.restore();
  // spokes: one per node + fillers so no gap > 26 deg
  let angs = L.nodes.map(n => ((n.a % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI)).sort((a,b) => a-b);
  angs = angs.filter((a,i) => !i || a - angs[i-1] > 6*D);
  const sp = [];
  for (let i=0;i<angs.length;i++){ const a = angs[i], b = i < angs.length-1 ? angs[i+1] : angs[0] + 2*Math.PI; sp.push(a);
    const n = Math.floor((b - a)/(26*D)); for (let k=1;k<=n;k++) sp.push(a + (b-a)*k/(n+1)); }
  sp.sort((a,b) => a-b); WEB.spokes = sp;
  const Rmax = Math.hypot(w, h)/2;
  x.lineCap = "round";
  sp.forEach((a,i) => { const len = Rmax*(0.98 + 0.04*Math.sin(i*7.3));
    const g = x.createLinearGradient(cx, cy, cx + Math.cos(a)*len, cy + Math.sin(a)*len); g.addColorStop(0, "#00E5FF88"); g.addColorStop(0.6, "#00E5FF40"); g.addColorStop(1, "#00E5FF05");
    x.strokeStyle = g; x.lineWidth = 0.9; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a)*len, cy + Math.sin(a)*len); x.stroke(); });
  // spiral capture thread: r grows a little at each spoke crossing; segments sag toward the hub
  const r0 = R*0.14, turns = L.mob ? 8 : 10, step = (R*1.02 - r0)/(turns*sp.length);
  let r = r0, prev = null; WEB.dew = [];
  for (let t=0; t<turns*sp.length; t++){
    const a = sp[t % sp.length] + 2*Math.PI*Math.floor(t/sp.length), X = cx + Math.cos(a)*r, Y = cy + Math.sin(a)*r;
    if (prev){ const am = (a + prev.a)/2, rm = (r + prev.r)/2 * (0.955 - 0.01*Math.sin(t)), qx = cx + Math.cos(am)*rm, qy = cy + Math.sin(am)*rm;
      const al = Math.max(0.12, 0.55 - 0.35*(r/R)); x.strokeStyle = (t % 9 === 0 ? "#FF1493" : "#00E5FF") + Math.round(al*255).toString(16).padStart(2,"0");
      x.lineWidth = 0.75; x.beginPath(); x.moveTo(prev.X, prev.Y); x.quadraticCurveTo(qx, qy, X, Y); x.stroke();
      if (t % 5 === 2) WEB.dew.push({x:(prev.X + 2*qx + X)/4, y:(prev.Y + 2*qy + Y)/4, ph:t*1.7, pk:t % 3 === 0}); }
    prev = {a, r, X, Y}; r += step;
  }
  // joints: small dots where the spiral meets spokes (crawler-net look)
  for (let j=0;j<sp.length;j++) for (let k=1;k<turns;k+=2){ const rr = r0 + step*(k*sp.length + j); if (rr > R) continue;
    x.fillStyle = k % 4 === 1 ? "#00E5FFaa" : "#FF149377"; x.beginPath(); x.arc(cx + Math.cos(sp[j])*rr, cy + Math.sin(sp[j])*rr, 1.1, 0, 7); x.fill(); }
  // hub mesh
  x.strokeStyle = "#00E5FF55"; x.lineWidth = 0.7;
  for (let k=0;k<3;k++){ x.beginPath(); sp.forEach((a,i) => { const rr = r0*(0.35 + 0.22*k) * (1 + 0.15*Math.sin(i*3 + k)); const X = cx + Math.cos(a)*rr, Y = cy + Math.sin(a)*rr; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); x.closePath(); x.stroke(); }
  return c;
}
function spawnPulses(){
  if (!S) return;
  S.pulses.forEach(p => {
    if (p.t <= WEB.seen) return;
    const k = p.kind, col = k === "scan" ? WC.cy : k === "trade" ? "#ffffff" : k === "win" ? WC.win : k === "learn" ? WC.vi : k === "liq" ? WC.red : WC.loss;
    if (k === "liq") WEB.liqUntil = performance.now() + 8000;
    if (k === "learn"){ WEB.bursts.push({bot:p.bot, t0:performance.now()}); return; }
    WEB.pulses.push({bot:p.bot, col, t0:performance.now(), dur: k === "scan" ? 1500 : 1900, out: k !== "scan", big: k !== "scan"});
    if (k !== "scan"){ WEB.target = p.bot; WEB.tUntil = performance.now() + 6000; }
  });
  WEB.seen = Math.max(WEB.seen, ...S.pulses.map(p => p.t), 0);
}
function rectsHit(a, b){ return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function pill(x, X, Y, w, h, col, fill="#0b0e18ee"){ x.fillStyle = fill; x.strokeStyle = col; x.lineWidth = 1; x.beginPath(); x.roundRect ? x.roundRect(X, Y, w, h, h/2) : x.rect(X, Y, w, h); x.fill(); x.stroke(); }
function drawSpider(x, L, ts){
  const sp = WEB.sp, now = performance.now();
  const tn = WEB.target && now < WEB.tUntil ? L.nodes.find(n => n.id === WEB.target) : null;
  const goal = tn ? 0.72 : 0;
  if (tn) sp.ang = tn.a;
  sp.v += (goal - sp.s)*0.012; sp.v *= 0.86; sp.s += sp.v;              // spring along the spoke
  const dist = sp.s * (tn ? tn.r : L.R*0.5), ang = sp.ang;
  const bx = L.cx + Math.cos(ang)*dist + Math.sin(ts/700)*1.2, by = L.cy + Math.sin(ang)*dist + Math.cos(ts/830)*1.2;
  const fwd = ang, n = 8, sc = L.mob ? 1.05 : 1.3;
  if (!sp.feet) sp.feet = Array.from({length:n}, () => ({x:bx, y:by}));
  for (let i=0;i<n;i++){
    const side = i < 4 ? -1 : 1, k = i % 4, la = fwd + side*(0.55 + k*0.62);
    const ix = bx + Math.cos(la)*30*sc, iy = by + Math.sin(la)*30*sc, f = sp.feet[i];
    if (Math.hypot(ix - f.x, iy - f.y) > 11*sc || f.x === bx){ f.tx = ix; f.ty = iy; }
    if (f.tx != null){ f.x += (f.tx - f.x)*0.35; f.y += (f.ty - f.y)*0.35; }
    const hx = bx + Math.cos(la)*5*sc, hy = by + Math.sin(la)*5*sc;
    const mx = (hx + f.x)/2, my = (hy + f.y)/2, nx = -(f.y - hy), ny = f.x - hx, nl = Math.hypot(nx, ny) || 1, bend = 9*sc*side*(k < 2 ? 1 : -1);
    const kx = mx + nx/nl*bend + Math.sin(ts/160 + i)*0.8, ky = my + ny/nl*bend;
    x.strokeStyle = "#00E5FF"; x.lineWidth = 1.7; x.beginPath(); x.moveTo(hx, hy); x.lineTo(kx, ky); x.stroke(); x.lineWidth = 1.1; x.strokeStyle = "#9ff6ff"; x.beginPath(); x.moveTo(kx, ky); x.lineTo(f.x, f.y); x.stroke();
    x.fillStyle = WC.pk; x.beginPath(); x.arc(kx, ky, 1.6, 0, 7); x.fill(); x.fillStyle = "#e9fdff"; x.beginPath(); x.arc(f.x, f.y, 1.3, 0, 7); x.fill();
  }
  glow(x, bx, by, WC.pk, 26*sc, 0.55);
  x.save(); x.translate(bx, by); x.rotate(fwd + Math.PI/2);
  const g = x.createRadialGradient(0, 4*sc, 1, 0, 6*sc, 11*sc); g.addColorStop(0, "#ff7cc8"); g.addColorStop(1, "#7a0a4a");
  x.fillStyle = g; x.beginPath(); x.ellipse(0, 7*sc, 6.5*sc, 9*sc, 0, 0, 7); x.fill();
  x.fillStyle = "#1a2236"; x.strokeStyle = WC.cy; x.lineWidth = 1; x.beginPath(); x.ellipse(0, -4*sc, 4.5*sc, 5*sc, 0, 0, 7); x.fill(); x.stroke();
  x.fillStyle = WC.cy; x.beginPath(); x.arc(-1.6*sc, -6*sc, 1, 0, 7); x.arc(1.6*sc, -6*sc, 1, 0, 7); x.fill();
  x.strokeStyle = "#ffffff55"; x.beginPath(); x.moveTo(0, 2*sc); x.lineTo(0, 13*sc); x.stroke();
  x.restore();
}
function drawWeb(ts){
  if (!S) return;
  const cv = $("web"), [x, w, h] = canvasCtx(cv), L = layoutNodes(w, h);
  const key = w + "x" + h + ":" + L.nodes.map(n => n.id).join(",");
  if (WEB.key !== key){ WEB.layer = buildLayer(w, h, L); WEB.key = key; }
  // gentle breathing sway of the whole web (cheap: transform the cached layer)
  const br = 1 + 0.004*Math.sin(ts/1600), sw = Math.sin(ts/2300)*0.004;
  x.save(); x.translate(L.cx, L.cy); x.rotate(sw); x.scale(br, br); x.translate(-L.cx, -L.cy); x.drawImage(WEB.layer, 0, 0, w, h); x.restore();
  // dew drops catching the light
  WEB.dew.forEach(d => { const a = 0.25 + 0.5*Math.max(0, Math.sin(ts/900 + d.ph)); x.fillStyle = d.pk ? `rgba(255,120,200,${a})` : `rgba(200,250,255,${a})`; x.beginPath(); x.arc(d.x, d.y, 1.2, 0, 7); x.fill(); });
  // pulses: light travelling along the silk with a fading trail
  const now = performance.now();
  WEB.pulses = WEB.pulses.filter(p => now - p.t0 < p.dur);
  if (WEB.pulses.length < 6 && Math.random() < 0.02){ const ids = L.nodes.filter(n => n.kind === "team"); const n = ids[Math.floor(Math.random()*ids.length)]; WEB.pulses.push({bot:n.id, col:WC.cy, t0:now, dur:2400, out:Math.random() < .5, amb:true}); }
  WEB.pulses.forEach(p => {
    const n = L.nodes.find(q => q.id === p.bot); if (!n) return;
    for (let j=0;j<8;j++){ let k = (now - p.t0)/p.dur - j*0.025; if (k < 0) continue; if (!p.out) k = 1 - k;
      const X = L.cx + (n.x - L.cx)*k, Y = L.cy + (n.y - L.cy)*k, a = (1 - j/8)*(p.amb ? 0.35 : 1);
      if (!j) glow(x, X, Y, p.col, p.big ? 16 : 9, a);
      x.fillStyle = p.col; x.globalAlpha = a; x.beginPath(); x.arc(X, Y, (p.big ? 2.6 : 1.6)*(1 - j/10), 0, 7); x.fill(); x.globalAlpha = 1; }
  });
  // brain-update bursts (learner / axiom bandit)
  WEB.bursts = WEB.bursts.filter(b => now - b.t0 < 2200);
  WEB.bursts.forEach(b => { const n = L.nodes.find(q => q.id === b.bot); if (!n) return; const k = (now - b.t0)/2200;
    x.strokeStyle = WC.vi; x.globalAlpha = 1 - k; x.lineWidth = 1.5; x.beginPath(); x.arc(n.x, n.y, n.rad + 4 + k*36, 0, 7); x.stroke(); x.globalAlpha = 1; });
  // caught prey: open positions wrapped on the thread near their bot (top 3 per bot + "+n")
  WEB.hits = []; const placed = [{x:0, y:0, w:L.mob ? 190 : 260, h:16}];
  L.nodes.forEach(n => { placed.push({x:n.x - n.rad - 3, y:n.y - n.rad - 3, w:2*n.rad + 6, h:2*n.rad + 6}); });
  const preyChips = [];
  L.nodes.filter(n => n.kind === "team").forEach(n => {
    const ps = botPositions(n.id).sort((a,b) => Math.abs(b.upnl) - Math.abs(a.upnl)), top = ps.slice(0, 3);
    top.forEach((p,i) => { const t = 1 - (n.rad + 12 + i*14)/n.r, off = (i % 2 ? 1 : -1)*4;
      const X = L.cx + (n.x - L.cx)*t + Math.sin(n.a)*off, Y = L.cy + (n.y - L.cy)*t - Math.cos(n.a)*off, col = p.upnl >= 0 ? WC.win : WC.loss;
      glow(x, X, Y, col, 10, 0.5);
      x.fillStyle = "#dfe8f0"; x.beginPath(); x.ellipse(X, Y, 3.6, 4.8, n.a, 0, 7); x.fill();
      x.strokeStyle = "#7f8aa0"; x.lineWidth = 0.6; x.beginPath(); x.moveTo(X - 3, Y - 2); x.lineTo(X + 3, Y + 1); x.moveTo(X - 3, Y + 1); x.lineTo(X + 3, Y - 2); x.stroke();
      x.strokeStyle = col; x.lineWidth = 1; x.beginPath(); x.ellipse(X, Y, 4.6, 5.8, n.a, 0, 7); x.stroke();
      WEB.hits.push({x:X, y:Y, r:10, kind:"prey", p, bot:n.id}); placed.push({x:X - 6, y:Y - 6, w:12, h:12});
      if (i === top.length - 1 && ps.length > 3) preyChips.push({X, Y, n:ps.length - 3, a:n.a}); });
  });
  // nodes: glowing orbs, halo, win-rate ring, initial inside
  x.textAlign = "center"; x.textBaseline = "middle";
  L.nodes.forEach(n => {
    let col; if (n.kind === "ext"){ col = WC.vi; } else { const st = botState(n.id); col = {scan:WC.cy, trade:"#ffd84a", win:WC.win, loss:WC.loss}[st]; if (n.id === "axiom" && st === "scan") col = WC.ax; if (n.id === "learner" && st === "scan") col = WC.vi; if (n.id === "degen" && performance.now() < (WEB.liqUntil || 0)) col = Math.floor(ts/180) % 2 ? WC.red : "#ffffff"; }
    n.col = col; const pul = 1 + 0.06*Math.sin(ts/500 + n.a*3), R0 = n.rad*pul;
    glow(x, n.x, n.y, col, Math.round(R0*3.2), n.kind === "ext" ? 0.35 : 0.75);
    const g = x.createRadialGradient(n.x - R0*0.35, n.y - R0*0.4, R0*0.1, n.x, n.y, R0);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.25, col); g.addColorStop(1, n.kind === "ext" ? "#1b1640" : "#081018");
    x.globalAlpha = n.kind === "ext" ? 0.7 : 1; x.fillStyle = g; x.beginPath(); x.arc(n.x, n.y, R0, 0, 7); x.fill(); x.globalAlpha = 1;
    if (n.kind !== "ext"){
      x.strokeStyle = "#ffffff22"; x.lineWidth = 2; x.beginPath(); x.arc(n.x, n.y, R0 + 4, 0, 7); x.stroke();
      const wr = winRate(n.id); if (wr != null){ x.strokeStyle = WC.win; x.beginPath(); x.arc(n.x, n.y, R0 + 4, -Math.PI/2, -Math.PI/2 + wr*2*Math.PI); x.stroke();
        x.strokeStyle = WC.loss; x.beginPath(); x.arc(n.x, n.y, R0 + 4, -Math.PI/2 + wr*2*Math.PI, 1.5*Math.PI); x.stroke(); }
      x.fillStyle = "#06080e"; x.font = `bold ${L.mob ? 9 : 10}px ui-sans-serif,system-ui,sans-serif`; x.fillText(n.id === "axiom" ? "AX" : n.id === "runner" ? "1M" : n.id === "degen" ? "$" : BOTS[n.id].name[0], n.x, n.y + 0.5);
    }
    WEB.hits.push({x:n.x, y:n.y, r:n.rad + 12, kind:"node", n});
  });
  preyChips.forEach(c => { const t = `+${c.n}`; x.font = "bold 9px monospace"; const tw = x.measureText(t).width + 8, X = c.X - Math.sin(c.a)*12 - tw/2, Y = c.Y + Math.cos(c.a)*12 - 6;
    pill(x, X, Y, tw, 12, "#ffffff55"); x.fillStyle = "#cfd8e6"; x.fillText(t, X + tw/2, Y + 6.5); placed.push({x:X, y:Y, w:tw, h:12}); });
  // labels: pill chips with greedy collision avoidance + leader lines
  const order = L.nodes.slice().sort((a,b) => (a.kind === "ext") - (b.kind === "ext"));
  order.forEach(n => {
    const name = n.kind === "ext" ? n.e.name : BOTS[n.id].name, m = n.kind === "ext" ? {txt:sgn(n.e.pnl), v:n.e.pnl} : botMoney(n.id);
    const fs = n.kind === "ext" ? 9 : (L.mob ? 9.5 : 11);
    x.font = `bold ${fs}px ui-sans-serif,system-ui,sans-serif`; const w1 = x.measureText(name).width; x.font = `${fs}px monospace`; const w2 = x.measureText(m.txt).width;
    const pw = w1 + w2 + 22, ph = fs + 9, d = n.rad + 8, out = Math.atan2(n.y - L.cy, n.x - L.cx);
    const cands = [[Math.cos(out)*d, Math.sin(out)*d], [0, d + ph/2], [0, -d - ph/2], [d + pw/2, 0], [-d - pw/2, 0], [d, d + ph/2], [-d, d + ph/2], [d, -d - ph/2], [-d, -d - ph/2],
                   [-pw/3, d + ph/2], [pw/3, d + ph/2], [-pw/3, -d - ph/2], [pw/3, -d - ph/2],
                   [Math.cos(out)*(d + 22), Math.sin(out)*(d + 22)], [0, d + ph + 14], [0, -d - ph - 14], [-pw/3, d + ph + 14], [pw/3, d + ph + 14], [0, d + 2*ph + 16], [-pw/3, d + 2*ph + 16], [0, -d - 2*ph - 16]];
    let best = null, mode = 0;
    for (const pass of [0, 1, 2]){
      const W = pass === 0 ? pw : pass === 1 ? Math.max(w1, w2) + 16 : w1 + 14, H = pass === 1 ? 2*fs + 10 : ph;
      for (let i=0;i<cands.length;i++){ let [dx, dy] = cands[i]; if (i === 0){ dx += Math.cos(out) >= 0 ? W/2 - 4 : -W/2 + 4; dy += Math.sin(out) >= 0 ? H/2 - 2 : -H/2 + 2; }
        if (pass === 1 && Math.abs(dy) > 0) dy += Math.sign(dy)*(H - ph)/2;
        const r = {x:n.x + dx - W/2, y:n.y + dy - H/2, w:W, h:H};
        if (r.x < 2 || r.y < 2 || r.x + r.w > w - 2 || r.y + r.h > h - 2) continue;
        if (placed.some(q => rectsHit(r, q))) continue;
        best = {r, i}; break; }
      if (best){ mode = pass; break; }
      if (n.kind === "ext") break;
    }
    if (!best) return;                                  // no room: tap the node to see it
    const r = best.r; placed.push(r);
    if (best.i >= 13){ x.strokeStyle = n.col + "88"; x.lineWidth = 1; x.beginPath(); x.moveTo(n.x, n.y); x.lineTo(r.x + r.w/2, r.y + (r.y > n.y ? 0 : r.h)); x.stroke(); }
    if (mode === 1){ x.fillStyle = "#0b0e18ee"; x.strokeStyle = n.col + "aa"; x.lineWidth = 1; x.beginPath(); x.roundRect ? x.roundRect(r.x, r.y, r.w, r.h, 7) : x.rect(r.x, r.y, r.w, r.h); x.fill(); x.stroke(); }
    else pill(x, r.x, r.y, r.w, r.h, n.kind === "ext" ? "#9d8cff55" : n.col + "aa");
    x.textAlign = mode === 1 ? "center" : "left"; x.font = `bold ${fs}px ui-sans-serif,system-ui,sans-serif`; x.fillStyle = n.kind === "ext" ? "#b9b0ff" : "#eef3ff";
    if (mode === 1){ x.fillText(name, r.x + r.w/2, r.y + fs/2 + 5); x.font = `${fs}px monospace`; x.fillStyle = m.v == null ? C.grey : m.v >= 0 ? WC.win : WC.loss; x.fillText(m.txt, r.x + r.w/2, r.y + fs*1.5 + 6); }
    else { x.fillText(name, r.x + 8, r.y + ph/2 + 0.5);
      if (mode === 0){ x.font = `${fs}px monospace`; x.fillStyle = m.v == null ? C.grey : m.v >= 0 ? WC.win : WC.loss; x.fillText(m.txt, r.x + 14 + w1, r.y + ph/2 + 0.5); } }
    x.textAlign = "center";
  });
  x.textAlign = "left"; x.textBaseline = "alphabetic";
  drawSpider(x, L, ts);
}
// tap a node or a caught coin -> card
$("web").addEventListener("click", e => {
  const r = $("web").getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top, card = $("webCard");
  const hit = WEB.hits.slice().reverse().find(hh => Math.hypot(hh.x - X, hh.y - Y) < hh.r);
  if (!hit){ card.hidden = true; return; }
  let html;
  if (hit.kind === "prey") html = `<b>${esc(hit.p.sym)}</b><span>caught by ${BOTS[hit.bot].name}${hit.p.cost ? " · " + usd(hit.p.cost, 0) : ""}</span><span class="${cls(hit.p.upnl)}">${sgn(hit.p.upnl)} open P&amp;L</span>`;
  else if (hit.n.kind === "ext") html = `<b>${esc(hit.n.e.name)}</b><span>TradeLab paper project (read-only)</span><span class="${cls(hit.n.e.pnl)}">${sgn(hit.n.e.pnl)} · equity ${usd(hit.n.e.equity, 0)}</span>`;
  else { const id = hit.n.id, m = botMoney(id), wr = winRate(id), ps = botPositions(id);
    const dp = id === "degen" && S.degen.pos; html = `<b>${BOTS[id].name}</b>${dp ? `<span>${dp.side} x${dp.lev} · liq ${px(dp.liq)} (${(dp.dist*100).toFixed(2)}% away)</span>` : ""}<span class="${cls(m.v)}">${m.txt}</span><span>${wr == null ? "no closed trades yet" : Math.round(wr*100) + "% wins"} · ${ps.length} open${ps.length ? ": " + ps.slice(0, 6).map(p => esc(p.sym)).join(", ") : ""}</span>`; }
  card.innerHTML = html; card.hidden = false;
  card.style.left = Math.max(4, Math.min(r.width - 214, X - 105)) + "px"; card.style.top = Math.max(4, Y + 16 > r.height - 90 ? Y - 96 : Y + 16) + "px";
});

// ---------- CRAWLER: a cyan/pink net-spider that roams the whole page and latches onto what is happening ----------
const CR = {cv:null, x:null, w:0, h:0, b:{x:200, y:120, vx:0, vy:0}, legs:[], core:[], tgt:null, tone:"idle", cap:"", until:0, next:0, last:performance.now(), mob:false};
function crInit(){
  const cv = document.createElement("canvas"); cv.id = "crawl"; document.body.appendChild(cv);
  const cap = document.createElement("div"); cap.id = "crawlCap"; document.body.appendChild(cap);
  CR.cv = cv; CR.capEl = cap; CR.mob = innerWidth < 600;
  const n = CR.mob ? 6 : 9;
  CR.legs = Array.from({length:n}, (_, i) => ({x:CR.b.x, y:CR.b.y, vx:0, vy:0, a:{fx:0.5, fy:0.5, dx:0, dy:0}, lat:false, t:0, i}));
  CR.core = Array.from({length:CR.mob ? 6 : 10}, (_, i) => ({a:i*2.4, r:3 + (i % 3)*3.2, s:0.6 + (i % 4)*0.3}));
  crResize(); addEventListener("resize", crResize);
}
function crResize(){ const dpr = Math.min(window.devicePixelRatio || 1, 2); CR.w = innerWidth; CR.h = innerHeight; CR.cv.width = CR.w*dpr; CR.cv.height = CR.h*dpr; CR.x = CR.cv.getContext("2d"); CR.x.setTransform(dpr, 0, 0, dpr, 0, 0); CR.mob = innerWidth < 600; }
function crVisible(el){
  const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return null;
  if (r.bottom < 40 || r.top > innerHeight - 40 || r.right < 0 || r.left > innerWidth) return null;
  const c = el.parentElement && el.parentElement.closest(".scroller,.coins,.ltape,.tape,.term");
  if (c){ const q = c.getBoundingClientRect(), cy = (r.top + r.bottom)/2; if (cy < q.top + 4 || cy > q.bottom - 4) return null; }
  return r;
}
const TONE = {pass:"#00FF41", win:"#00FF41", fail:"#FF003C", risk:"#FF8C00", info:"#00E5FF", idle:"#00E5FF", hold:"#FF1493"};
function crPick(){
  const els = [...document.querySelectorAll("[data-cap]")].map(el => ({el, r:crVisible(el)})).filter(o => o.r);
  if (!els.length) return null;
  const hot = els.filter(o => +o.el.dataset.hot > Date.now()/1000 - 90);
  const pool = hot.length && Math.random() < 0.7 ? hot : els;
  const cur = CR.tgt && CR.tgt.el;
  const cands = pool.length > 1 ? pool.filter(o => o.el !== cur) : pool;
  return cands[Math.floor(Math.random()*cands.length)];
}
function crRetarget(){
  const o = crPick(); const t = performance.now();
  if (!o){ CR.tgt = null; CR.tone = "idle"; CR.cap = ""; CR.until = t + 2500; return; }
  CR.tgt = o; CR.tone = o.el.dataset.tone || "info"; CR.cap = o.el.dataset.cap; CR.until = t + 3200 + Math.random()*2200;
  // latch-and-pull: legs release one by one and dart to points on the new target (rest grab nearby surroundings)
  CR.legs.forEach((L, i) => { L.t = t + i*55 + Math.random()*40; L.pending = i < Math.ceil(CR.legs.length*0.55)
    ? {fx:[0, 1, 1, 0, 0.5, 0.5][i % 6] + (Math.random() - .5)*0.15, fy:[0, 0, 1, 1, 0, 1][i % 6] + (Math.random() - .5)*0.2, dx:0, dy:0, el:o.el}
    : {fx:Math.random(), fy:Math.random() < .5 ? 0 : 1, dx:(Math.random() - .5)*220, dy:(Math.random() < .5 ? -1 : 1)*(40 + Math.random()*90), el:o.el}; L.lat = false; });
}
function crAnchor(a){
  if (!a || !a.el) return null; const r = a.el.getBoundingClientRect();
  return {x:r.left + r.width*Math.max(0, Math.min(1, a.fx)) + a.dx, y:r.top + r.height*Math.max(0, Math.min(1, a.fy)) + a.dy};
}
function crFrame(ts){
  if (!CR.x || document.hidden) return;
  const t = performance.now(), dt = Math.min(48, t - CR.last)/16.7; CR.last = t;
  if (t > CR.until) crRetarget();
  const x = CR.x; x.clearRect(0, 0, CR.w, CR.h);
  // anchors -> body goal = centroid of latched anchors, pulled toward the target's corner
  let gx = 0, gy = 0, n = 0;
  CR.legs.forEach(L => { if (L.pending && t >= L.t){ L.a = L.pending; L.pending = null; L.lat = true; L.vx += (Math.random() - .5)*14; L.vy += (Math.random() - .5)*14; }
    const p = crAnchor(L.a); L.ax = p ? p.x : CR.b.x + Math.cos(L.i*0.7 + ts/900)*60; L.ay = p ? p.y : CR.b.y + Math.sin(L.i*0.7 + ts/900)*50;
    if (L.lat){ gx += L.ax; gy += L.ay; n++; } });
  let tx = n ? gx/n : CR.w*0.5, ty = n ? gy/n : 120;
  if (CR.tgt){ const r = CR.tgt.el.getBoundingClientRect(); tx = tx*0.4 + (r.left + r.width*0.78)*0.6; ty = ty*0.4 + (r.top - 6)*0.6; }
  if (!CR.tgt){ tx += Math.sin(ts/400)*30; ty += Math.cos(ts/330)*12; }
  tx = Math.max(30, Math.min(CR.w - 30, tx)); ty = Math.max(50, Math.min(CR.h - 30, ty));
  // spring physics: stiff legs (dart), softer body (pull), plus twitch impulses
  const B = CR.b; B.vx += (tx - B.x)*0.045*dt; B.vy += (ty - B.y)*0.045*dt; B.vx *= Math.pow(0.82, dt); B.vy *= Math.pow(0.82, dt);
  if (Math.random() < 0.08){ B.vx += (Math.random() - .5)*3; B.vy += (Math.random() - .5)*3; }
  B.x += B.vx*dt; B.y += B.vy*dt;
  CR.legs.forEach(L => { const fx = L.lat ? L.ax : B.x + Math.cos(L.i*2.1)*26, fy = L.lat ? L.ay : B.y + Math.sin(L.i*2.1)*22;
    L.vx += (fx - L.x)*0.22*dt; L.vy += (fy - L.y)*0.22*dt; L.vx *= Math.pow(0.68, dt); L.vy *= Math.pow(0.68, dt); L.x += L.vx*dt; L.y += L.vy*dt;
    if (L.lat && Math.random() < 0.004*dt){ L.pending = {...L.a, fx:L.a.fx + (Math.random() - .5)*0.1}; L.t = t + 30; L.lat = false; } });   // trailing leg releases + snaps back
  const col = TONE[CR.tone] || TONE.info, alt = CR.tone === "fail" || CR.tone === "risk" ? "#FF8C00" : CR.tone === "pass" || CR.tone === "win" ? "#b6ffc8" : "#FF1493";
  // laser to risky targets
  if (CR.tgt && (CR.tone === "fail" || CR.tone === "risk")){ const r = CR.tgt.el.getBoundingClientRect(); x.setLineDash([4, 4]); x.strokeStyle = "#FF003Caa"; x.lineWidth = 1; x.beginPath(); x.moveTo(B.x, B.y); x.lineTo(r.left + r.width/2, r.top + r.height/2); x.stroke(); x.setLineDash([]); }
  // legs: body -> knee -> foot, opacity fading with length
  CR.legs.forEach((L, i) => { const dx = L.x - B.x, dy = L.y - B.y, len = Math.hypot(dx, dy) || 1, kx = B.x + dx*0.45 - dy/len*14*(i % 2 ? 1 : -1), ky = B.y + dy*0.45 + dx/len*14*(i % 2 ? 1 : -1) - 6;
    const a = Math.max(0.25, 1 - len/420); x.globalAlpha = a; x.strokeStyle = i % 3 === 0 ? alt : col; x.lineWidth = CR.mob ? 1 : 1.3;
    x.beginPath(); x.moveTo(B.x, B.y); x.lineTo(kx, ky); x.lineTo(L.x, L.y); x.stroke(); x.globalAlpha = 1;
    glow(x, kx, ky, alt, 7, 0.7 * a); glow(x, L.x, L.y, col, L.lat ? 10 : 6, a); x.fillStyle = "#ffffff"; x.beginPath(); x.arc(L.x, L.y, 1.6, 0, 7); x.fill(); });
  // body: dense twitchy cluster of glowing nodes
  glow(x, B.x, B.y, col, 30, 0.45);
  const pts = CR.core.map((c, i) => ({x:B.x + Math.cos(c.a + ts/1000*c.s)*c.r + (Math.random() - .5)*0.8, y:B.y + Math.sin(c.a*1.3 + ts/1000*c.s)*c.r*0.8 + (Math.random() - .5)*0.8}));
  x.strokeStyle = col + "aa"; x.lineWidth = 0.8; x.beginPath(); pts.forEach((p, i) => { const q = pts[(i + 3) % pts.length]; x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); }); x.stroke();
  pts.forEach((p, i) => { glow(x, p.x, p.y, i % 2 ? alt : col, 6, 0.9); x.fillStyle = "#ffffff"; x.beginPath(); x.arc(p.x, p.y, i % 3 ? 1.2 : 1.8, 0, 7); x.fill(); });
  // caption chip
  const ce = CR.capEl;
  if (CR.cap){ const capT = CR.cap.length > 24 ? CR.cap.slice(0, 23) + "…" : CR.cap; if (ce.textContent !== capT) ce.textContent = capT; ce.style.borderColor = col; ce.style.color = col === TONE.info ? "#bff6ff" : col; ce.style.opacity = 1;
    const cw = ce.offsetWidth, ch = ce.offsetHeight; let cxp = B.x + 18, cyp = B.y - ch - 16; if (cxp + cw > CR.w - 6) cxp = B.x - cw - 18; if (cyp < 44) cyp = B.y + 22;
    ce.style.transform = `translate(${Math.round(Math.max(6, cxp))}px,${Math.round(cyp)}px)`; } else ce.style.opacity = 0;
}

// ---------- AGENT CARDS (one per bot) ----------
const ROLE = {scanner:"finding what moves", rugcheck:"is it a rug?", momentum:"is it trending?", sniper:"fresh + buyers lead", risk:"does it beat the costs?",
  learner:"learns after every trade", degen:"$100, three lives", axiom:"trades as if on Axiom", runner:"$300k to $1.1M runners"};
const ICON = {scanner:["S","#ff2d6f"], rugcheck:["R","#ff1493"], momentum:["M","#00e5ff"], sniper:["N","#ffd84a"], risk:["K","#ff8c00"], learner:["L","#9d8cff"], degen:["$","#00ff41"], axiom:["A","#ff7a2f"], runner:["1M","#00ffd0"]};
function lastSay(bot){ for (let i = S.log.length - 1; i >= 0; i--){ const l = S.log[i]; if (l.bot === bot && l.level !== "warn") return l; } return null; }
function renderBots(){
  const ids = ["scanner","rugcheck","momentum","sniper","risk","learner","degen","axiom","runner","trends"].filter(b => b !== "learner" || S.learner).filter(b => b !== "axiom" || S.axiom).filter(b => b !== "runner" || S.runner).filter(b => b !== "trends" || (S.bots && S.bots.trends));
  const liqT = (S.pulses.filter(p => p.bot === "degen" && p.kind === "liq").pop() || {}).t || 0, liqNow = S.server_time - liqT < 90;
  $("agents").innerHTML = ids.map(id => {
    const m = botMoney(id), wr = winRate(id), st = botState(id);
    const base = id === "degen" ? 100 : id === "learner" ? S.learner.bank : id === "axiom" ? S.axiom.bank : id === "runner" ? S.runner.bank : S.start_balance, pc = m.v != null ? m.v / base : 0;
    let chip = st === "trade" ? "IN TRADE" : st === "scan" ? "SCANNING" : pct(pc, Math.abs(pc) < 0.1 ? 1 : 0), col = {scan:"#00E5FF", trade:"#ffd84a", win:"#00FF41", loss:"#FF2BD6"}[st];
    if (id === "degen" && S.degen.pos) chip = `x${S.degen.pos.lev} ${S.degen.pos.side}`;
    if (id === "trends"){ const T = S.trends || {}; chip = `${(T.matches || []).filter(m => m.score >= (T.vote_at || 0.6)).length} ON TREND`; col = "#ffe14a"; }
    if (id === "degen" && liqNow){ chip = "LIQUIDATED"; col = "#FF003C"; }
    const [ic, icol] = ICON[id], hot = (S.pulses.filter(p => p.bot === id && p.kind !== "scan").pop() || {}).t || 0;
    const tone = chip === "LIQUIDATED" ? "fail" : st === "win" ? "win" : st === "loss" ? "risk" : "info";
    const cap = `${BOTS[id].name} ${chip === "IN TRADE" ? "in a trade" : chip === "SCANNING" ? "scanning" : chip}`;
    return `<div class="agc${chip === "LIQUIDATED" ? " liq" : ""}" id="ag-${id}" style="--ac:${icol}" data-cap="${esc(cap)}" data-tone="${tone}" data-hot="${hot}" title="${esc(BOTS[id].desc)}">
      <div class="agh"><span class="agi">${ic}</span><b class="agn">${BOTS[id].name}</b></div>
      <div class="agr2"><span class="agm ${m.word ? "word" : ""} ${m.v == null ? "" : cls(m.v)}">${m.txt}</span><span class="ags" style="color:${col};border-color:${col}55">${chip}</span></div>
      <div class="agw"><div class="agbar"><i style="width:${wr == null ? 0 : Math.round(wr*100)}%"></i></div><span>${wr == null ? "—" : Math.round(wr*100) + "%"}</span></div></div>`;
  }).join("");
}

// ---------- THRESHOLDS (live filter rules, code style) ----------
function renderThresholds(){
  const L = S.learner || {gate_why:{}}, A = S.axiom || {why:{}, cost:{}}, g = L.gate_why || {}, w = A.why || {};
  const sum = (o, f) => Object.entries(o).filter(([k]) => f(k)).reduce((a, [, v]) => a + v, 0);
  const copy = sum(g, k => k.startsWith("copycat") || k.startsWith("look-alike")) + sum(w, k => k.startsWith("copycat"));
  const vol = sum(g, k => k.startsWith("volume under")) + sum(w, k => k.startsWith("5m volume"));
  const pool = sum(g, k => k.startsWith("pool under"));
  const cost = sum(g, k => k.startsWith("too costly")) + sum(w, k => k.startsWith("cost") || k.startsWith("round-trip"));
  const safe = sum(g, k => /mint|freeze|top 10|one wallet|insider|creator|RugCheck|holder|tax|hook/i.test(k)) + sum(w, k => k.startsWith("safety"));
  const rug = sum(g, k => k.startsWith("rug risk"));
  const E = (A.brain && A.brain.exit) || A.exit || {tp:0.35, sl:0.2, tmax:900};
  const rows = [
    ["HARD", "# every bot"],
    ["copycat_ticker", "first_only", copy, "copycat blocked"],
    ["min_volume_5m_usd", "100", vol, "volume too low"],
    ["min_pool_usd", "20_000", pool, "pool too small"],
    ["max_round_trip", "0.06 / 0.08 axiom", cost, "cost too high"],
    ["safety_gate", "mint=None freeze=None", safe, "safety gate"],
    ["rug_guard", "learned", rug, "rug guard"],
    ["daily_loss_limit", "None", null, "no loss limit"],
    ["AXIOM", "# per side"],
    ["axiom_fee", (A.cost.axiom_fee || 0.0095).toString(), null, "Axiom fee"],
    ["priority + tip", `${A.cost.prio_sol} + ${A.cost.tip_sol} SOL`, null, "tips per side"],
    ["exit (learned)", `tp=${E.tp} sl=${E.sl} t=${Math.round(E.tmax/60)}m`, null, "exit levels"],
    ["DEGEN", "# paper perps"],
    ["leverage", "20-50x", null, "high leverage"],
    ["margin", "~75% of balance", null, "big bets"],
  ];
  const LF = (A.filters || {active:[], removed:[]});
  const lf = `<div class="th lf"><b>LEARNED FILTERS</b> <i># AXIOM SIM adds these itself · ${LF.shadows_done || 0} shadow trades</i></div>` +
    (LF.active.length ? LF.active.map(a => `<div class="tr lf" data-cap="learned filter" data-tone="fail" title="${esc(`justified by ${Math.round(a.why_n)} trades that made ${sgn(a.why_pnl, 0)}: ${a.why_syms.join(", ")}`)}"><span class="k">${esc(a.label)}</span><span class="v">${a.shadow_n ? `${a.shadow_w}/${a.shadow_n} shadows won` : "learned"}</span><span class="c">added ${ldn(a.added, false)} · blocked <b>${a.blocked}</b> · ${a.shadow_n ? (a.saved >= 0 ? "saved " + usd(a.saved, 0) : "cost " + usd(-a.saved, 0)) : "tracking"} <u>✓</u></span></div>`).join("")
      : `<div class="tr lf"><span class="k">none yet</span><span class="v"></span><span class="c">needs 3+ losing trades with a shared feature</span></div>`) +
    LF.removed.slice(0, 2).map(r => `<div class="tr lf off"><span class="k">${esc(r.label)}</span><span class="v">removed ${ldn(r.t, false)}</span><span class="c">${esc(r.why)}</span></div>`).join("");
  $("thr").innerHTML = lf + rows.map(r => r.length === 2 ? `<div class="th"><b>${r[0]}</b> <i>${r[1]}</i></div>`
    : `<div class="tr" data-cap="${esc(r[3])}" data-tone="${r[2] ? "fail" : "info"}"><span class="k">${r[0]}</span><span class="v">${esc(r[1])}</span><span class="c">${r[2] != null ? `<b>${r[2].toLocaleString()}</b> blocked` : ""} <u>✓</u></span></div>`).join("");
}


// ---------- HONEST REPORT CARD (sample size, error bars, costs, scored-vs-random, early-vs-late) ----------
function ciRow(label, g, kind, tip){
  if (!g || !g.n) return `<div class="cr"><span class="cl">${label}</span><span class="cbar"></span><span class="cv" style="color:${C.grey}">no trades yet</span></div>`;
  const lo = kind === "wr" ? g.wr_lo : g.avg_lo, hi = kind === "wr" ? g.wr_hi : g.avg_hi, v = kind === "wr" ? g.wr : g.avg;
  const A = kind === "wr" ? 0 : -0.5, B = kind === "wr" ? 1 : 0.7, X = x => Math.max(0, Math.min(100, (x - A) / (B - A) * 100));
  const zero = kind === "wr" ? S.learner.need : 0, col = v > zero ? C.g : C.p;
  const l = lo == null ? v : lo, r = hi == null ? v : hi;
  const txt = kind === "wr" ? `${Math.round(v*100)}% <small>(${Math.round(l*100)}–${Math.round(r*100)}%)</small>` : `${pct(v,1)} <small>(${pct(l,0)} to ${pct(r,0)})</small>`;
  return `<div class="cr"><span class="cl">${label} <small>${g.n} trades</small></span><span class="cbar"><u style="left:${X(zero)}%"></u><i style="left:${X(l)}%;width:${Math.max(1, X(r)-X(l))}%;background:${col}55;border-color:${col}"></i><b style="left:${X(v)}%;background:${col};box-shadow:0 0 6px ${col}"></b></span><span class="cv" style="color:${col}">${txt}</span></div>`;
}
function renderHonest(){
  const L = S.learner, H = L && L.honest, el = $("lHonest"); if (!el) return;
  if (!H || !H.n){ el.innerHTML = ""; return; }
  const pr = Math.min(100, 100*H.n/H.need_n);
  el.innerHTML = `<div class="hv ${H.verdict_kind}"><b>HONEST CHECK <span class="i" tabindex="0" data-tip="${esc(H.learning_note + " Bars are 95% ranges; a bar over the dashed line can't be told apart from luck. Costs took " + (H.gross_usd > 0 ? Math.round(100*H.cost_usd/H.gross_usd) + "% of the raw gains." : "$" + Math.round(H.cost_usd) + "."))}">i</span></b>${esc(H.verdict.split(". ")[0])}.
      <div class="prog"><i style="width:${pr}%"></i></div></div>
    <div class="hgrid"><div>${ciRow("Win rate", H, "wr")}${ciRow("Avg / trade", H, "avg")}</div><div>${ciRow("Score-picked", H.score, "avg")}${ciRow("Random test", H.test, "avg")}</div></div>`;
}

// ---------- LEARNING panel ----------
const FEATW = {age:"coin age", liq:"pool size", buy_share:"buyers vs sellers", buyers:"different buyers", accel:"volume speeding up",
  mom:"5-min price move", socials:"has socials", boost:"paid boost", graduated:"graduated", top10:"top-10 holder %", night:"London night"};
let lTapeHtml = "", lRugHtml = "";
function renderLearner(){
  const L = S.learner; if (!L) return;
  const d = L.equity - L.bank;
  setNum("lEq", L.equity, v => usd(v), false);
  $("lEqD").innerHTML = `<span class="${cls(d)}">${sgn(d)}</span>`;
  $("lWr").textContent = L.n ? `${Math.round(100*L.wins/L.n)}%` : "—";
  $("lWrD").textContent = `${L.n} closed · need ${Math.round(L.need*100)}%`;
  if (L.avg_ret == null){ $("lEv").textContent = "—"; $("lEv").className = "num"; } else { $("lEv").textContent = pct(L.avg_ret, 1); $("lEv").className = "num " + cls(L.avg_ret); }
  $("lEvD").textContent = `fees ${usd(L.fees, 0)}`;
  $("lUp").textContent = L.updates;
  const k = L.counters;
  $("lUpD").textContent = `${(k.skipped + k.avoided).toLocaleString()} passed on`;
  $("lStatus").textContent = L.status;
  const rules = L.rules.slice(0, 6).map(r => `<div class="rule ${r.kind}"><b>${r.kind === "avoid" ? "AVOIDS" : "LIKES"}</b>${esc(r.text.replace(/^(now avoids|likes) /, ""))}</div>`);
  if (!rules.length) rules.push(`<div class="rule info"><b>LEARNING</b>no rules yet</div>`);
  if (L.rules.length > 6) rules.push(`<div class="hn" title="${esc(L.rules.slice(6).map(r => r.text).join("\n"))}">+${L.rules.length - 6} more rules</div>`);
  rules.push(`<div class="rule info"><b>EXIT</b>+${L.exit.tp*100}% / −${L.exit.sl*100}% / ${L.exit.tmax/60} min</div>`);
  $("lRules").innerHTML = rules.join("");
  const R = L.rug;
  if (R){ const rh = `<div class="mks"><span class="mk r">rugs ${R.rugs} of ${R.n}</span><span class="mk">blocked ${R.blocked}</span><span class="mk">base rate ${Math.round(R.base*100)}%</span></div>` +
      (R.rules.map(r => `<div class="rule rug"><b>RUG</b>${esc(r.text.replace(/^rug guard: /, ""))}</div>`).join("") || `<div class="rule info"><b>RUG</b>no rug pattern yet</div>`) +
      R.notes.slice(0, 3).map(n => `<div class="pm r"><span>${ldn(n.t, false)}</span>${esc(n.msg)}</div>`).join("");
    if (rh !== lRugHtml){ lRugHtml = rh; $("lRug").innerHTML = rh; } }
  const ws = Object.entries(L.w).sort((a,b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
  const mx = Math.max(0.3, ...ws.map(w => Math.abs(w[1])));
  $("lWeights").innerHTML = ws.map(([f, w]) => { const half = Math.abs(w)/mx*50, col = w >= 0 ? C.g : C.p;
      return `<div class="wb"><span>${FEATW[f] || f}</span><span class="bar"><i style="background:${col};${w >= 0 ? `left:50%;width:${half}%` : `left:${50-half}%;width:${half}%`}"></i></span><span>${w >= 0 ? "+" : ""}${w.toFixed(2)}</span></div>`; }).join("");
  const g = Object.entries(L.gate_why).sort((a,b) => b[1]-a[1]).slice(0, 5), gmax = Math.max(1, ...g.map(x => x[1]));
  $("lGate").innerHTML = g.map(([why, n]) => `<div class="g"><span>${esc(why)}</span><span class="neg">${n}</span><div class="gbar"><i style="width:${100*n/gmax}%"></i></div></div>`).join("") || `<div class="empty">—</div>`;
  const rows = [];
  L.positions.forEach(p => rows.push({t:p.opened, side:"BUY", sym:p.sym, up:p.upnl, tip:p.why, test:p.mode === "test", open:true}));
  L.trades.forEach(r => rows.push({t:r.closed, side:"SELL", sym:r.sym, pnl:r.pnl, tip:r.exit_why + " · " + r.why + (r.learned ? " · learned: " + r.learned : ""), test:r.mode === "test" || r.explore}));
  rows.sort((a,b) => b.t - a.t);
  const html = rows.length ? rows.slice(0, 12).map(e => `<div class="tl" title="${esc(e.tip || "")}"><span class="tt">${ldn(e.t, false)}</span><span class="side ${e.side}">${e.side}</span><span class="ts">${esc(e.sym)}${e.test ? TST : ""}${e.open ? " <i>open</i>" : ""}</span><span class="tv ${cls(e.open ? e.up : e.pnl)}">${sgn(e.open ? e.up : e.pnl)}</span></div>`).join("")
    : `<div class="empty">No trades yet.</div>`;
  if (html !== lTapeHtml){ lTapeHtml = html; $("lTape").innerHTML = html; }
}
function drawCurve(){
  if (!S || !S.learner) return;
  const cv = $("lCurve"); if (!cv) return;
  const [x, w, h] = canvasCtx(cv); x.clearRect(0,0,w,h);
  const pts = S.learner.curve, L0 = 40, R0 = w - 44, T0 = 10, B0 = h - 18;
  x.strokeStyle = "#140f1f"; x.lineWidth = 1; for (let i=0;i<=4;i++){ const yy = T0 + (B0-T0)*i/4; x.beginPath(); x.moveTo(L0,yy); x.lineTo(R0,yy); x.stroke(); }
  x.fillStyle = C.grey; x.font = "10px monospace";
  if (pts.length < 2){ x.fillText(pts.length ? "1 trade closed: the curve starts at trade 2" : "the curve starts after the first closed trades", L0, h/2); return; }
  const n0 = pts[0].n, n1 = pts[pts.length-1].n, X = n => L0 + (R0-L0)*(n1===n0 ? 1 : (n-n0)/(n1-n0));
  const evs = pts.map(p => p.ev), lo = Math.min(-0.2, ...evs), hi = Math.max(0.2, ...evs);
  const Yw = v => T0 + (B0-T0)*(1-v), Ye = v => T0 + (B0-T0)*(1-(v-lo)/(hi-lo));
  x.setLineDash([4,4]); x.strokeStyle = "#666"; x.beginPath(); x.moveTo(L0, Ye(0)); x.lineTo(R0, Ye(0)); x.stroke();
  x.strokeStyle = "#39ff1466"; const be = S.learner.need; x.beginPath(); x.moveTo(L0, Yw(be)); x.lineTo(R0, Yw(be)); x.stroke(); x.setLineDash([]);
  [[p => Yw(p.wr), C.g], [p => Ye(p.ev), C.c]].forEach(([Y, col]) => { x.strokeStyle = col; x.lineWidth = 2; x.shadowColor = col; x.shadowBlur = 8; x.beginPath();
    pts.forEach((p,i) => i ? x.lineTo(X(p.n), Y(p)) : x.moveTo(X(p.n), Y(p))); x.stroke(); x.shadowBlur = 0; });
  x.fillStyle = C.g; x.textAlign = "right"; ["100%","50%","0%"].forEach((t,i) => x.fillText(t, L0-4, Yw(1 - i/2)+3));
  x.textAlign = "left"; x.fillStyle = C.c; [hi, 0, lo].forEach(v => x.fillText((v>0?"+":"") + (v*100).toFixed(0) + "%", R0+4, Ye(v)+3));
  x.fillStyle = C.grey; x.fillText(`trade #${n0}`, L0, h-3); x.textAlign = "right"; x.fillText(`#${n1}`, R0, h-3); x.textAlign = "left";
  const lp = pts[pts.length-1]; x.fillStyle = C.c; x.beginPath(); x.arc(X(lp.n), Ye(lp.ev), 3 + 1.5*Math.sin(Date.now()/200), 0, 7); x.fill();
}

// ---------- AXIOM PULSE (sim) ----------
const k$ = v => v == null ? "—" : v >= 1e6 ? "$" + (v/1e6).toFixed(1) + "M" : v >= 1e3 ? "$" + (v/1e3).toFixed(v >= 1e4 ? 0 : 1) + "k" : "$" + Math.round(v);
const agoS = s => s == null ? "—" : s < 60 ? Math.round(s) + "s" : s < 3600 ? Math.round(s/60) + "m" : s < 172800 ? (s/3600).toFixed(1) + "h" : Math.round(s/86400) + "d";
const costTxt = c => c ? `Axiom fee ${usd(c.axiom)} · tip ${usd(c.tip)} · impact ${usd(c.impact)} · pool ${usd(c.pool)}` : "";
let aTapeHtml = "", aLaneHtml = "";
function renderAxiom(){
  const A = S.axiom; if (!A) return;
  const B = A.brain || {}, d = A.equity - A.bank, fe = A.fees || {}, ftot = (fe.axiom||0) + (fe.tip||0) + (fe.pool||0) + (fe.impact||0);
  setNum("aEq", A.equity, v => usd(v), false);
  $("aEqD").innerHTML = `<span class="${cls(d)}">${sgn(d)}</span>`;
  $("aWr").textContent = A.n ? `${Math.round(100*A.wins/A.n)}%` : "—";
  $("aWrD").textContent = `${A.n} closed`;
  $("aFees").textContent = ftot ? "-" + usd(ftot, 0) : "$0";
  $("aFeesD").textContent = "";
  const up = A.positions.reduce((a,p) => a + p.upnl, 0);
  $("aOpen").textContent = A.positions.length;
  $("aOpenD").innerHTML = A.positions.length ? `<span class="${cls(up)}">${sgn(up)}</span>` : "";
  $("aStatus").textContent = `${A.status.split(" · ")[0]} · SOL $${A.sol_px.toFixed(0)}`;
  const c = A.cost, fx = (c.prio_sol + c.tip_sol) * A.sol_px;
  $("aCostTip").dataset.tip = `Per side: ${(c.axiom_fee*100).toFixed(2)}% Axiom fee + ${c.prio_sol} SOL priority + ${c.tip_sol} SOL tip (${usd(fx)}) + pool fee + price impact. Skips coins over ${(c.max_rt*100).toFixed(0)}% round trip. So far: Axiom ${usd(fe.axiom||0)} · tips ${usd(fe.tip||0)} · pool ${usd(fe.pool||0)} · impact ${usd(fe.impact||0)}.`;
  $("aPresets").innerHTML = A.presets.map(p => `<div class="preset ${p.sol === A.last_preset ? "on" : ""}" title="all-in round trip ≈ ${(p.rt_25k*100).toFixed(1)}% in a $25k curve pool"><b>${p.sol} SOL</b><span>${usd(p.usd, 0)}</span></div>`).join("");
  const order = ["new","final","migrated"];
  const html = order.map(k => { const L = A.lanes[k];
    const stats = L.n ? `<b class="${cls(L.pnl)}">${sgn(L.pnl, 0)}</b> <span>${L.n} · ${Math.round(100*L.wins/L.n)}%</span>` : `<span>no trades</span>`;
    const coins = L.board.length ? L.board.slice(0, 5).map(r => { const why = r.why || "";
      const cap = r.verdict === "PASS" ? r.sym + " passes ✓" : why.startsWith("copycat") ? "copycat blocked" : why.startsWith("cost") ? "cost too high" : why.startsWith("5m volume") ? "volume too low" : r.verdict === "FAIL" ? r.sym + " fails" : "watching " + r.sym;
      return `<div class="cn ${r.verdict}" title="${esc(why)}" data-cap="${esc(cap)}" data-tone="${r.verdict === "PASS" ? "pass" : r.verdict === "FAIL" ? (why.startsWith("cost") ? "risk" : "fail") : "hold"}"><span class="s">${esc(r.sym)}</span><span class="ag">${agoS(r.age)}</span><span class="m">${k$(r.mc)}</span><span class="m">${k$(r.liq)}</span><span class="badge b-${r.verdict}">${r.verdict}</span></div>`; }).join("")
      : `<div class="empty">empty</div>`;
    return `<div class="lane"><div class="lhd"><b>${L.name}</b>${stats}</div><div class="coins">${coins}</div></div>`; }).join("");
  if (html !== aLaneHtml){ aLaneHtml = html; $("aLanes").innerHTML = html; }
  // WHAT IT LEARNED
  const E = B.exit || A.exit, ex = `TP +${Math.round(E.tp*100)}% · SL −${Math.round(E.sl*100)}% · ${Math.round(E.tmax/60)} min`;
  const rules = (B.rules || []).slice(0, 5).map(r => `<div class="rule ${r.kind}"><b>${r.kind === "avoid" ? "AVOIDS" : r.kind === "like" ? "LIKES" : "RUG"}</b>${esc(r.text.replace(/^(avoids|likes|now avoids) /, ""))}</div>`).join("") || `<div class="rule info"><b>LEARNING</b>no rules yet</div>`;
  const pm = (B.postmortems || []).slice(0, 4).map(p => `<div class="pm ${p.kind === "win" ? "w" : p.kind === "rug" ? "r" : ""}"><span>${ldn(p.t, false)}</span>${esc(p.msg)}</div>`).join("") || `<div class="empty">No closed trades yet.</div>`;
  const eh = (B.exit_hist || []).slice(0, 3).map(e => `<div class="pm"><span>${ldn(e.t, false)}</span>${esc(e.msg)}</div>`).join("");
  const mk = B.mistakes || {}, mks = Object.entries(mk).filter(([, n]) => n).map(([k, n]) => `<span class="mk ${k === "win" ? "w" : k === "rug" ? "r" : ""}">${esc(k)} <b>${n}</b></span>`).join("");
  const lh = `<div class="lgrid2"><div>${rules}</div><div><div class="exits"><span>EXITS</span><b>${ex}</b></div>${eh || `<div class="hn">No exit changes yet (needs 3+ exits of a kind).</div>`}
      <div class="chartbox lc sm"><canvas id="aCurve"></canvas></div></div></div>
    <div class="mks">${mks}</div><h4>FILTERS IT ADDED</h4>${((A.filters || {}).active || []).map(a => `<div class="rule lf"><b>FILTER</b>${esc(a.label)} <span class="dim">· added ${ldn(a.added, false)} · blocked ${a.blocked}${a.shadow_n ? " · " + (a.saved >= 0 ? "saved " : "cost ") + usd(Math.abs(a.saved), 0) : ""}</span></div>`).join("") || `<div class="hn">None: basics only (max 2, from 5+ trades).</div>`}${((A.filters || {}).log || []).slice(0, 2).map(l => `<div class="pm"><span>${ldn(l.t, false)}</span>${esc(l.msg)}</div>`).join("")}<h4>POST-MORTEMS</h4>${pm}`;
  if (lh !== aLearnHtml){ aLearnHtml = lh; $("aLearn").innerHTML = lh; }
  const ps = B.passed || {}, w = Object.entries(A.why).sort((a, b) => b[1] - a[1]).slice(0, 5), wm = Math.max(1, ...w.map(x => x[1]));
  $("aWhy").innerHTML = `<div class="mks">${Object.entries(ps).map(([k, n]) => `<span class="mk">${esc(k)} <b>${n.toLocaleString()}</b></span>`).join("")}</div>` +
    w.map(([why, n]) => `<div class="g"><span>${esc(why)}</span><span class="neg">${n.toLocaleString()}</span><div class="gbar"><i style="width:${100*n/wm}%"></i></div></div>`).join("");
  const LN = {new:"NEW", final:"FINAL", migrated:"MIGR"}, rows = [];
  A.positions.forEach(p => rows.push({t:p.opened, side:"BUY", sym:p.sym, usd:p.cost, sol:p.sol_amt, lane:p.lane, up:p.upnl, open:true, tip:p.why + " · " + costTxt(p.buy_cost), test:!!p.explore}));
  A.trades.forEach(r => rows.push({t:r.closed, side:"SELL", sym:r.sym, sol:r.sol_amt, lane:r.lane, pnl:r.pnl, tip:r.exit_why + " · " + costTxt(r.costs) + (r.learned ? " · " + r.learned : ""), test:r.mode === "test" || !!r.explore}));
  rows.sort((a,b) => b.t - a.t);
  const th = rows.length ? rows.slice(0, 12).map(e => `<div class="tl" title="${esc(e.tip || "")}"><span class="tt">${ldn(e.t, false)}</span><span class="tb">${LN[e.lane]}</span><span class="side ${e.side}">${e.side}</span><span class="ts">${esc(e.sym)}${e.test ? TST : ""} <i>${e.sol} SOL${e.open ? " · open" : ""}</i></span><span class="tv ${cls(e.open ? e.up : e.pnl)}">${sgn(e.open ? e.up : e.pnl)}</span></div>`).join("")
    : `<div class="empty">No trades yet.</div>`;
  if (th !== aTapeHtml){ aTapeHtml = th; $("aTape").innerHTML = th; }
}
let aLearnHtml = "";
function drawMiniCurve(cv, pts, need){
  if (!cv || !cv.getBoundingClientRect().width) return;
  const [x, w, h] = canvasCtx(cv); x.clearRect(0, 0, w, h);
  x.fillStyle = C.grey; x.font = "10px monospace";
  if (!pts || pts.length < 2){ x.fillText("curve starts after 2 trades", 6, h/2); return; }
  const n0 = pts[0].n, n1 = pts[pts.length-1].n, X = n => 30 + (w - 60)*(n1 === n0 ? 1 : (n - n0)/(n1 - n0));
  const cs = pts.map(p => p.cum != null ? p.cum : p.ev), lo = Math.min(0, ...cs), hi = Math.max(0, ...cs), Y = v => 8 + (h - 22)*(1 - (v - lo)/((hi - lo) || 1)), Yw = v => 8 + (h - 22)*(1 - v);
  x.setLineDash([3, 3]); x.strokeStyle = "#3a4258"; x.beginPath(); x.moveTo(30, Y(0)); x.lineTo(w - 30, Y(0)); x.stroke(); x.setLineDash([]);
  x.strokeStyle = "#00FF4199"; x.lineWidth = 1.2; x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(X(p.n), Yw(p.wr)) : x.moveTo(X(p.n), Yw(p.wr))); x.stroke();
  x.strokeStyle = C.c; x.lineWidth = 2; x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(X(p.n), Y(cs[i])) : x.moveTo(X(p.n), Y(cs[i]))); x.stroke();
  x.fillStyle = C.c; x.textAlign = "right"; x.fillText(sgn(cs[cs.length-1], 0), w - 2, Y(cs[cs.length-1]) + 3); x.textAlign = "left";
  x.fillStyle = C.grey; x.fillText(`#${n0}`, 30, h - 2); x.textAlign = "right"; x.fillText(`#${n1} · cyan $ cum · green win rate`, w - 30, h - 2); x.textAlign = "left";
}

// ---------- mascot ----------
$("extTog").addEventListener("click", () => { SHOWEXT = !SHOWEXT; $("extTog").classList.toggle("on", SHOWEXT); WEB.key = ""; });

// ---------- loop ----------
let lastTs = performance.now();
function frame(ts){
  const dt = ts - lastTs; lastTs = ts;
  if (!document.hidden){ try{ spawnPulses(); if (webVisible()) drawWeb(ts); if (S && $("p-team").open){ drawEquity(); scrollScreen(dt); } if (S && $("p-learn").open) drawCurve(); if (S && S.axiom && $("p-axiom").open) drawMiniCurve($("aCurve"), S.axiom.brain && S.axiom.brain.curve); crFrame(ts); }catch(e){ console.error(e); } }
  requestAnimationFrame(frame);
}
if (PUBLIC){ const pb = document.createElement("span"); pb.className = "pill auto"; pb.textContent = "PUBLIC READ-ONLY MIRROR"; document.querySelector(".pills").appendChild(pb); }
setInterval(poll, PUBLIC ? 15000 : 2000); setInterval(pollCandles, 5000); setInterval(() => { pills(); try{ drawCandles(); }catch(e){} }, 1000);
function webVisible(){ const r = $("web").getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }
try{ crInit(); }catch(e){ console.error(e); }
poll(); pollCandles().then(drawCandles); pills(); requestAnimationFrame(frame);

// ---------- MENU + TRADES PAGE (#/trades) ----------
const TB = {all:"All", team:"Team", learner:"Learner", axiom:"Axiom", runner:"Milly", degen:"Degen"};
const TC = {team:"#ff2d6f", learner:"#c58cff", axiom:"#ff7a2f", runner:"#00ffd0", degen:"#00ff41"};
const TX = {rows:[], bot:"all", q:"", sort:"new", n:60, t:0};
function route(){
  const tr = location.hash.indexOf("#/trades") === 0;
  $("pgDash").hidden = tr; $("pgTrades").hidden = !tr;
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.pg === (tr ? "trades" : "dash")));
  document.body.classList.remove("navopen"); $("navBtn").setAttribute("aria-expanded", "false");
  if (tr){ scrollTo(0, 0); loadTrades(); } else { WEB.key = ""; }
}
async function loadTrades(){
  try{ const r = await fetch("api/trades.json?" + Date.now(), {cache:"no-store"}); TX.rows = (await r.json()).trades || []; TX.t = Date.now(); renderTrades(); }catch(e){ console.error(e); }
}
const holdS = r => r.opened && r.closed ? r.closed - r.opened : null;
const durS = s => s == null ? "—" : s < 3600 ? Math.round(s/60) + "m" : s < 86400 ? (s/3600).toFixed(1) + "h" : (s/86400).toFixed(1) + "d";
function streaks(rows){ let w = 0, l = 0, bw = 0, bl = 0;
  rows.slice().sort((a, b) => a.closed - b.closed).forEach(r => { if (r.pnl > 0){ w++; l = 0; } else { l++; w = 0; } bw = Math.max(bw, w); bl = Math.max(bl, l); });
  return [bw, bl]; }
function maxBy(rows, f){ let b = null; rows.forEach(r => { const v = f(r); if (v != null && (b == null || v > f(b))) b = r; }); return b; }
function renderTrades(){
  const all = TX.rows, q = TX.q.trim().toLowerCase();
  const cnt = {all:all.length}; all.forEach(r => cnt[r.bot] = (cnt[r.bot] || 0) + 1);
  $("tChips").innerHTML = Object.keys(TB).map(b => `<button type="button" class="tchip ${TX.bot === b ? "on" : ""}" data-b="${b}" style="--tc:${TC[b] || "#00e5ff"}">${TB[b]} <b>${cnt[b] || 0}</b></button>`).join("");
  const sel = all.filter(r => TX.bot === "all" || r.bot === TX.bot);
  // max stat cards (for the selected bot, or overall)
  const best = maxBy(sel, r => r.pnl), worst = maxBy(sel, r => -r.pnl), big = maxBy(sel, r => r.size), fee = maxBy(sel, r => r.fees), hold = maxBy(sel, holdS);
  const [sw, sl] = streaks(sel), tot = sel.reduce((a, r) => a + r.pnl, 0), wins = sel.filter(r => r.pnl > 0).length;
  const card = (l, v, s, c = "") => `<div class="tsc"><label>${l}</label><b class="${c}">${v}</b><span>${s || ""}</span></div>`;
  const nm = r => r ? esc(r.sym) + " · " + TB[r.bot] : "";
  $("tStats").innerHTML = card("Total P&L", sgn(tot, 0), `${sel.length} trades · ${sel.length ? Math.round(100*wins/sel.length) : 0}% wins`, cls(tot)) +
    card("Best trade", best ? sgn(best.pnl) : "—", nm(best), "pos") + card("Worst trade", worst ? sgn(worst.pnl) : "—", nm(worst), "neg") +
    card("Win streak", sw, "in a row", "pos") + card("Loss streak", sl, "in a row", "neg") +
    card("Largest position", big ? usd(big.size, 0) : "—", nm(big)) + card("Most fees", fee ? usd(fee.fees) : "—", nm(fee)) +
    card("Longest hold", hold ? durS(holdS(hold)) : "—", nm(hold));
  let rows = sel.filter(r => !q || (r.sym + " " + r.why + " " + r.bot + " " + (r.lead || "")).toLowerCase().indexOf(q) >= 0);
  const S_ = {new:r => -r.closed, old:r => r.closed, pnl:r => -r.pnl, pnll:r => r.pnl, ret:r => -(r.ret || 0), size:r => -(r.size || 0), fees:r => -(r.fees || 0), hold:r => -(holdS(r) || 0)}[TX.sort];
  rows.sort((a, b) => S_(a) - S_(b));
  $("tCount").textContent = rows.length === sel.length ? `${sel.length} closed` : `${rows.length} of ${sel.length}`;
  $("tList").innerHTML = rows.slice(0, TX.n).map(r => { const d = new Date(r.closed*1000);
    const day = d.toLocaleDateString("en-GB", {timeZone:"Europe/London", day:"2-digit", month:"short"});
    return `<div class="trow" style="--tc:${TC[r.bot]}"><span class="t1">${day} ${ldn(r.closed, false)}</span><span class="t2">${TB[r.bot]}</span><span class="t3">${esc(r.sym)}${r.test ? TST : ""}</span>
      <span class="t4 side ${r.side}">${r.side}${r.lev ? " x" + r.lev : ""}</span><span class="t5">${r.size != null ? usd(r.size, 0) : "—"}</span>
      <span class="t6">${r.entry != null ? px(r.entry) : "—"} → ${r.exit != null ? px(r.exit) : "—"}</span>
      <span class="t7 ${cls(r.pnl)}">${sgn(r.pnl)} <small>${r.ret != null ? pct(r.ret, 1) : ""}</small></span><span class="t8">${r.fees != null ? usd(r.fees) : "—"}</span>
      <span class="t9">${esc(r.why || "")} · ${durS(holdS(r))}</span></div>`; }).join("") || `<div class="empty">No trades match.</div>`;
  $("tMore").hidden = rows.length <= TX.n;
}
$("tChips").addEventListener("click", e => { const b = e.target.closest(".tchip"); if (b){ TX.bot = b.dataset.b; TX.n = 60; renderTrades(); } });
$("tQ").addEventListener("input", e => { TX.q = e.target.value; TX.n = 60; renderTrades(); });
$("tSort").addEventListener("change", e => { TX.sort = e.target.value; renderTrades(); });
$("tMore").addEventListener("click", () => { TX.n += 100; renderTrades(); });
$("navBtn").addEventListener("click", () => { const o = document.body.classList.toggle("navopen"); $("navBtn").setAttribute("aria-expanded", o ? "true" : "false"); });
addEventListener("hashchange", route);
setInterval(() => { if (!$("pgTrades").hidden) loadTrades(); }, PUBLIC ? 60000 : 30000);
route();

// ---------- TRENDS bot (news / memes -> trend match). Self-contained block, see app/trends.py ----------
BOTS.trends = {name:"TRENDS", desc:"Follows news, search trends and memes; votes yes when a coin's name rides a hot trend (match >= 60%)"};
ROLE.trends = "is it on trend?"; ICON.trends = ["T", "#ffe14a"];
const TR_SRC = {google:["G","Google Trends"], reddit:["R","Reddit"], wiki:["W","Wikipedia"], hn:["Y","Hacker News"], gdelt:["N","GDELT news"],
  coingecko:["C","CoinGecko"], pump:["P","pump.fun"], dex:["D","DexScreener"], "x-trend":["X","X trends"], "x-news":["X","X news"], "x-post":["X","X posts"], x:["X","X"]};
function renderTrends(){
  const T = S && S.trends; if (!T) return;
  let el = document.getElementById("p-trends");
  if (!el){ const a = document.getElementById("agents"); if (!a) return; el = document.createElement("section"); el.className = "panel trends"; el.id = "p-trends"; a.after(el); }
  const live = Object.entries(T.sources || {}).filter(([k, v]) => v.ok), age = T.updated ? Math.max(0, Math.round((S.server_time - T.updated)/60)) : null;
  const src = (arr) => [...new Set((arr || []).map(k => (TR_SRC[k] || ["?"])[0]))].slice(0, 3).map(c => `<i>${c}</i>`).join("");
  const terms = (T.terms || []).slice(0, 8);
  const hMax = Math.max(...terms.map(t => t.heat), 1), hMin = Math.min(...terms.map(t => t.heat), hMax - 1);
  const chips = terms.length ? terms.map(t => { const r = (t.heat - hMin) / Math.max(hMax - hMin, 1e-6), fs = (10.5 + 8 * r).toFixed(1);
      const tip = `${t.term} · heat ${Math.round(t.heat)} · ${(t.src || []).map(k => (TR_SRC[k] || [0, k])[1]).join(", ")}${t.rising ? " · rising" : ""}`;
      return `<span class="hchip${t.rising ? " up" : ""}" style="font-size:${fs}px;--h:${(0.25 + 0.75*r).toFixed(2)}" title="${esc(tip)}">${esc(t.term)}${t.rising ? "<b>↑</b>" : ""}<span class="hs">${src(t.src)}</span></span>`; }).join("")
    : `<div class="empty">Reading the news…</div>`;
  const ms = (T.matches || []).filter(m => m.score >= 0.3).slice(0, 3);
  const rows = ms.length ? ms.map(m => `<div class="tmr${m.score >= T.vote_at ? " yes" : ""}" title="${esc(m.name || m.sym)} · ${esc(m.kind)} match · ${esc(m.where)}"><b>${esc(m.sym)}</b><span class="tmt">${esc(m.term)}</span><span class="tmb"><i style="width:${Math.round(m.score*100)}%"></i></span><span class="tmp">${Math.round(m.score*100)}%</span></div>`).join("")
    : `<div class="empty">No coin rides a trend right now.</div>`;
  const bb = T.bot_n ? `<div class="tbb">Bot buys on trend: <b>${T.bot_on_trend}</b>/${T.bot_n}</div>` : "";
  el.innerHTML = `<h2 class="hot">WHAT'S HOT <em>${live.length} sources${age != null ? " · " + (age ? age + "m ago" : "now") : ""}</em></h2>
    <div class="hchips">${chips}</div><h3>ON TREND</h3><div class="tml">${rows}</div>${bb}`;
}
{ const _render = render; render = function(){ _render(); try{ renderTrends(); }catch(e){ console.error(e); } }; }
