// Hidden self-test: open the app with ?chaos=1 to get a small panel that clicks through
// hundreds of random real actions (wins, subs, swaps, joins, undo, timer...) on THIS device
// and checks the roster after every one. Loaded only when ?chaos=1 is in the address.
// It never opens the end-of-night recap, so it never saves an attendance entry, and it
// clears the session when it finishes.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const panelEl = () => document.getElementById("chaos-panel");
const outside = e => !(panelEl() && panelEl().contains(e));
const visible = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
const buttons = () => Array.from(document.querySelectorAll("button")).filter(b => outside(b) && visible(b));
const txt = e => (e.textContent || "").replace(/\s+/g, " ").trim();

function findBtn(re) { return buttons().find(b => re.test(txt(b))); }
function clickBtn(re) { const b = findBtn(re); if (!b) throw new Error("no button " + re); b.click(); }
// any visible element whose own text matches (rows, labels, chips)
function findLeaf(re) {
  return Array.from(document.querySelectorAll("body *")).find(e => outside(e) && visible(e) && e.children.length === 0 && re.test(txt(e)));
}
function leaves(re) { return Array.from(document.querySelectorAll("body *")).filter(e => outside(e) && visible(e) && e.children.length === 0 && re.test(txt(e))); }
async function waitFor(fn, what, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(40); }
  throw new Error("timed out waiting for " + what);
}
function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true }));
}
const inputWith = ph => Array.from(document.querySelectorAll("input")).find(i => outside(i) && (i.placeholder || "").startsWith(ph));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function mountChaosPanel() {
  if (panelEl()) return;
  const box = document.createElement("div");
  box.id = "chaos-panel";
  box.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:99999;background:#111;color:#fff;font:13px/1.35 -apple-system,system-ui,sans-serif;padding:10px 12px;border-radius:12px;max-height:45vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,.4)";
  box.innerHTML = '<div style="font-weight:700;margin-bottom:6px">Chaos test</div><div id="chaos-msg" style="margin-bottom:8px">Runs random actions on the LIVE session (test players only), then clears it. Start only when no real session is running.</div><div><button id="chaos-go" style="padding:10px 14px;border-radius:10px;border:0;background:#FFC24D;font-weight:700;font-size:15px">Run chaos test</button> <button id="chaos-stop" style="padding:10px 14px;border-radius:10px;border:0;background:#444;color:#fff;font-size:15px">Stop</button></div><pre id="chaos-out" style="white-space:pre-wrap;margin:8px 0 0;font:12px/1.35 ui-monospace,Menlo,monospace"></pre>';
  document.body.appendChild(box);
  let stop = false, running = false;
  const out = t => { document.getElementById("chaos-out").textContent = t; };
  const msg = (t, color) => { const m = document.getElementById("chaos-msg"); m.textContent = t; m.style.color = color || "#fff"; };
  document.getElementById("chaos-stop").onclick = () => { stop = true; };
  document.getElementById("chaos-go").onclick = async () => {
    if (running) return; running = true; stop = false;
    try { await run(msg, out, () => stop); } catch (e) { msg("Could not run: " + e.message, "#ff6b6b"); }
    running = false;
  };
}

async function run(msg, out, shouldStop) {
  const api = () => window.__ncbcChaos && window.__ncbcChaos.get();
  if (!api()) throw new Error("app not ready");
  let s = api().getState();
  if (s.view !== "setup" || s.setupPlayers.length || s.teamA.length || s.queue.length || s.sittingOut.length || s.injured.length || s.left.length) {
    throw new Error("a session is already in progress here. Finish or clear it first, then run the test.");
  }
  const STEPS = 150, N = 14 + Math.floor(Math.random() * 7); // 14-20 test players
  const seed = Date.now() % 100000; const rnd = mulberry(seed);
  const violations = []; const counts = {}; let lastAct = "setup", expected = N, tab = "game", late = 0;
  const bump = k => { lastAct = k; counts[k] = (counts[k] || 0) + 1; };
  const rec = t => { if (violations.length < 12) violations.push(t); };

  msg("Adding " + N + " test players...");
  for (let i = 1; i <= N; i++) {
    typeInto(await waitFor(() => inputWith("Your name"), "name box"), "Chaos" + i);
    await sleep(30);
    const plus = buttons().find(b => txt(b) === "+"); if (!plus) throw new Error("no + button");
    plus.click();
    (await waitFor(() => findBtn(/Guest/), "Guest button")).click();
    await sleep(40);
  }
  clickBtn(/Run It/); await sleep(300);
  await waitFor(() => api().getState().view !== "setup", "game start");
  const modeNow = api().getState().gameMode;

  const goTab = async t => {
    if (tab === t) return;
    const nav = Array.from(document.querySelectorAll("nav button")).find(b => new RegExp(t === "game" ? "Game$" : t === "roster" ? "Roster$" : "Log$").test(txt(b)));
    if (!nav) throw new Error("no " + t + " tab"); nav.click(); tab = t; await sleep(60);
  };

  let step = 0;
  for (; step < STEPS && !shouldStop(); step++) {
    msg("Step " + (step + 1) + " of " + STEPS + " - " + lastAct, "#fff");
    const st0 = api().getState(); const pool = st0.queue.length + st0.sittingOut.length; const r = rnd();
    try {
      if (r < 0.29) {
        await goTab("game"); clickBtn(rnd() < 0.5 ? /Home Wins/ : /Away Wins/); bump("win");
      } else if (r < 0.49 && pool >= 1) {
        await goTab("game");
        const who = [...st0.teamA, ...st0.teamB][Math.floor(rnd() * 10)];
        const row = Array.from(document.querySelectorAll(".native-row")).find(e => visible(e) && txt(e).includes(who.name));
        if (!row) throw new Error("court row for " + who.name + " not on screen");
        row.click(); await waitFor(() => findLeaf(/^Coming in$/i), "sub sheet");
        if (rnd() < 0.3 && pool > 1) {
          clickBtn(/^Change$/); await sleep(60);
          const rows = leaves(/GP$/); if (rows.length) rows[Math.floor(rnd() * rows.length)].click(); bump("change");
          await waitFor(() => findBtn(/^Quick break/), "sheet back on the main view");
        }
        const p = rnd();
        if (p < 0.55) { clickBtn(/^Quick break/); bump("quick"); }
        else if (p < 0.8) { clickBtn(/^Hurt/); bump("hurt"); }
        else if (st0.left.length < 3) { clickBtn(/^Done for the day/); bump("done"); }
        else { clickBtn(/^Cancel$/); bump("cancel"); }
      } else if (r < 0.53) {
        await goTab("game");
        const who = [...st0.teamA, ...st0.teamB][Math.floor(rnd() * 10)];
        const row = Array.from(document.querySelectorAll(".native-row")).find(e => visible(e) && txt(e).includes(who.name));
        if (!row) throw new Error("court row not on screen");
        row.click(); await waitFor(() => findBtn(/Swap teams instead/), "swap button"); clickBtn(/Swap teams instead/); await sleep(60);
        const rows = leaves(/^\d+GP$/); rows[Math.floor(rnd() * rows.length)].click(); bump("swap");
      } else if (r < 0.69) {
        await goTab("roster");
        const all = [...st0.queue, ...st0.sittingOut, ...st0.injured, ...st0.left];
        if (all.length) {
          const who = all[Math.floor(rnd() * all.length)];
          const el = findLeaf(new RegExp("^" + esc(who.name) + "$")); if (!el) throw new Error(who.name + " not in roster lists");
          el.click(); await sleep(80);
          const opts = [/Skip next game/, /Back in the queue/, /Back for the day/, /Sit out/, /Mark injured/].filter(re => findBtn(re) || findLeaf(re));
          if (opts.length) { const re = opts[Math.floor(rnd() * opts.length)]; (findBtn(re) || findLeaf(re)).click(); bump("roster"); }
          else { clickBtn(/^Cancel$/); bump("rosterCancel"); }
        }
      } else if (r < 0.77) {
        await goTab("roster"); clickBtn(/Join the run/); await sleep(80); const v = rnd();
        if (v < 0.5) {
          const adds = buttons().filter(b => /Add$/.test(txt(b)) && b.querySelector("span"));
          if (adds.length) { adds[Math.floor(rnd() * adds.length)].click(); expected++; bump("joinMember"); await sleep(60); }
          clickBtn(/^Done$/);
        } else if (v < 0.85) {
          typeInto(inputWith("Search members"), "ChaosLate" + (++late)); await sleep(60);
          clickBtn(/as a new name/); (await waitFor(() => findBtn(/Guest/), "Guest button")).click(); expected++; bump("lateJoin");
        } else { clickBtn(/^Done$/); bump("joinCancel"); }
      } else if (r < 0.82) {
        await goTab("game"); const u = findBtn(/Undo$/); if (u) { u.click(); bump("undo"); }
      } else if (r < 0.88) {
        await goTab("game");
        const t = ["▶", "⏸", "-1m", "+10s", "■"].map(x => buttons().find(b => txt(b) === x)).filter(Boolean);
        if (t.length) { t[Math.floor(rnd() * t.length)].click(); bump("timer"); }
      } else if (r < 0.93) {
        await goTab("game"); clickBtn(/Home Wins/); clickBtn(/Away Wins/); bump("doubleWin");
      } else {
        await goTab("log"); await waitFor(() => findLeaf(/^Attendance$/), "Attendance page"); await goTab("game"); bump("tabHop");
      }
    } catch (e) { rec("step " + (step + 1) + " (" + lastAct + "): " + e.message); break; }

    await sleep(90);
    const st = api().getState();
    const all = [...st.teamA, ...st.teamB, ...st.queue, ...st.sittingOut, ...st.injured, ...st.left];
    const ids = all.map(p => p.id);
    if (new Set(ids).size !== ids.length) rec("step " + (step + 1) + ": duplicate player");
    if (ids.length !== expected) rec("step " + (step + 1) + ": count " + ids.length + " but expected " + expected + " (after " + lastAct + ")");
    if (st.teamA.length !== 5 || st.teamB.length !== 5) rec("step " + (step + 1) + ": team sizes " + st.teamA.length + "/" + st.teamB.length);
    if (modeNow === "rotate" && [...st.teamA, ...st.teamB].some(p => p.winStreak > 2)) rec("step " + (step + 1) + ": streak above 2 on court");
    if (JSON.stringify(st).includes("undefined")) rec("step " + (step + 1) + ": undefined in state");
    if (/Something went wrong/.test(document.body.innerText)) { rec("step " + (step + 1) + ": error screen showing"); break; }
    if (findLeaf(/^Coming in$/i)) rec("step " + (step + 1) + ": sub sheet left open");
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) rec("step " + (step + 1) + ": page scrolls sideways");
    const nav = document.querySelector("nav");
    if (!nav || nav.getBoundingClientRect().bottom > window.innerHeight + 1) rec("step " + (step + 1) + ": tab bar off screen");
    if (violations.length > 5) break;
  }

  msg("Cleaning up...");
  try { await waitFor(() => !findLeaf(/^Coming in$/i), "sheet closed", 1500); } catch (e) { /* ignore */ }
  api().clear(); await sleep(600);
  const end = api().getState();
  const clean = end.view === "setup" && !end.setupPlayers.length && !end.teamA.length && !end.queue.length;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const summary = violations.length === 0 ? "PASS - " + total + " random actions, no problems" : "FAIL - " + violations.length + " problem(s)";
  msg(summary + (clean ? ". Session cleared." : ". WARNING: session NOT cleared, clear it by hand."), violations.length ? "#ff6b6b" : "#6bff95");
  out((violations.length ? violations.join("\n") + "\n\n" : "") + "Players " + N + ", mode " + modeNow + ", seed " + seed + "\nActions: " + JSON.stringify(counts));
}
