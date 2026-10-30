// Chaos test: drives the real App like an unruly gym night. Random mix of results,
// sheet subs (quick break / hurt / done / change), swaps, roster actions, late
// joins, undo, timer taps, tab hopping and full app restarts. After EVERY action
// it checks the saved session and the screen for corruption.
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

jest.mock("firebase/app", () => { throw new Error("no firebase in tests"); });
jest.mock("firebase/firestore", () => { throw new Error("no firebase in tests"); });
const App = require("./App").default;

// jsdom has no audio/speech; the real timer buzzer needs them.
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
window.AudioContext = function () { return { state: "running", resume() {}, currentTime: 0, destination: {}, createOscillator: () => ({ connect() {}, start() {}, stop() {}, type: "", frequency: param() }), createGain: () => ({ connect() {}, gain: param() }) }; };
window.speechSynthesis = { speak() {}, cancel() {}, getVoices: () => [] };
window.SpeechSynthesisUtterance = function () {};
// jsdom has no canvas. Stub just enough that the end-of-night recap image code really runs
// (layout, wrapping, sorting, measuring) so a thrown error in it would show up here.
let canvasDraws = 0;
window.scrollTo = () => {};
// jsdom never loads images; make the logo "load" so the recap draws.
window.Image = function () { const im = { width: 409, height: 536 }; Object.defineProperty(im, "src", { set() { setTimeout(() => im.onload && im.onload(), 0); } }); return im; };
HTMLCanvasElement.prototype.getContext = function () {
  const ctx = { measureText: (s) => ({ width: String(s).length * 14 }), createLinearGradient: () => ({ addColorStop() {} }) };
  return new Proxy(ctx, { get: (o, k) => (k in o ? o[k] : (k === "canvas" ? this : () => { canvasDraws++; })), set: () => true });
};
HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob(["x"], { type: "image/png" })); };
URL.createObjectURL = () => "blob:test"; URL.revokeObjectURL = () => {};

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mk = (n, i) => ({ id: "p" + i, name: "Player" + (i + 1), joinOrder: i + 1, roundsWaited: 0, gamesPlayed: 0, wins: 0, winStreak: 0, hasPlayed: false, streakedOut: false, injurySubGame: false, isGuest: i % 5 === 4 });
const read = () => JSON.parse(localStorage.getItem("local_ncbc-main"));
// Tap a win button, then either pick a final score on the 0-11 pad or skip it.
function winAndScore(home, rnd) {
  fireEvent.click(screen.getByText(home ? /Home Wins/ : /Away Wins/));
  if (rnd() < 0.5) {
    const hi = String(9 + Math.floor(rnd() * 3)), lo = String(Math.floor(rnd() * 9));
    fireEvent.click(screen.getByRole("button", { name: hi }));
    fireEvent.click(screen.getByRole("button", { name: lo }));
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Skip score" }));
  }
}
const label = (t) => screen.getByText(t, { selector: "span" });

async function chaos(N, mode, steps, seed) {
  localStorage.clear();
  localStorage.setItem("local_ncbc-main", JSON.stringify({ view: "setup", teamSize: 5, gameMode: mode, setupPlayers: Array.from({ length: N }, mk), joinCounter: N, teamA: [], teamB: [], queue: [], sittingOut: [], injured: [], left: [], gameCount: 0, lastResult: null, history: [], timerRunning: false, timerDone: false, endTime: null, pausedSecondsLeft: 480 }));
  const rnd = mulberry(seed);
  let view = render(<App />);
  fireEvent.click(await screen.findByText(/Run It/, {}, { timeout: 8000 }));
  let expected = N, tab = "game", late = 0;
  const counts = {}; let lastAct = ''; const bump = (k) => { lastAct = k; counts[k] = (counts[k] || 0) + 1; };
  const violations = [];
  const goTab = (t) => { if (tab !== t) { fireEvent.click(label(t === "game" ? "Game" : t === "roster" ? "Roster" : "Log")); tab = t; } };

  for (let i = 0; i < steps; i++) {
    const st0 = read();
    const pool = st0.queue.length + st0.sittingOut.length;
    const r = rnd();
    try {
      if (r < 0.30) {
        goTab("game"); winAndScore(rnd() < 0.5, rnd); bump("win");
      } else if (r < 0.50 && pool >= 1) {
        goTab("game");
        const court = [...st0.teamA, ...st0.teamB]; const who = court[Math.floor(rnd() * court.length)];
        const row = screen.getAllByText(who.name).find(e => e.parentElement && String(e.parentElement.className).includes("native-row"));
        fireEvent.click(row); screen.getByText("Coming in");
        if (rnd() < 0.3 && pool > 1) { fireEvent.click(screen.getByRole("button", { name: "Change" })); const rows = screen.getAllByText(/GP$/); fireEvent.click(rows[Math.floor(rnd() * rows.length)]); bump("change"); }
        if (rnd() < 0.15) { fireEvent.click(screen.getByText(/Game (hasn't started|in progress)/)); bump("tipToggle"); }
        const p = rnd();
        if (p < 0.55) { fireEvent.click(screen.getByText("Quick break")); bump("quick"); }
        else if (p < 0.80) { fireEvent.click(screen.getByText("Hurt")); bump("hurt"); }
        else if (st0.left.length < 3) { fireEvent.click(screen.getByText("Done for the day")); bump("done"); }
        else { fireEvent.click(screen.getByText("Cancel")); bump("cancel"); }
      } else if (r < 0.55) {
        goTab("game");
        const court = [...st0.teamA, ...st0.teamB]; const who = court[Math.floor(rnd() * court.length)];
        const row = screen.getAllByText(who.name).find(e => e.parentElement && String(e.parentElement.className).includes("native-row"));
        fireEvent.click(row); fireEvent.click(screen.getByText("Swap teams instead"));
        const rows = screen.getAllByText(/^\d+GP$/); fireEvent.click(rows[Math.floor(rnd() * rows.length)]); bump("swap");
      } else if (r < 0.73) {
        goTab("roster");
        const all = [...st0.queue, ...st0.sittingOut, ...st0.injured, ...st0.left];
        if (all.length) {
          const who = all[Math.floor(rnd() * all.length)];
          fireEvent.click(screen.getAllByText(who.name)[0]);
          const opts = [/Skip next game/, /Back in the queue/, /Back for the day/, /Sit out/, /Mark injured/].filter(re => screen.queryByText(re));
          if (opts.length) { const pickRe = opts[Math.floor(rnd() * opts.length)]; const zone = st0.queue.some(x => x.id === who.id) ? "queue" : st0.sittingOut.some(x => x.id === who.id) ? "sitting" : st0.injured.some(x => x.id === who.id) ? "injured" : "left"; fireEvent.click(screen.getByText(pickRe)); bump("roster:" + zone + ":" + String(pickRe).replace(/[\/\\]/g, "")); }
          else { fireEvent.click(screen.getByText("Cancel")); bump("rosterCancel"); }
        }
      } else if (r < 0.77) {
        goTab("roster");
        fireEvent.click(screen.getByRole("button", { name: /Join the run/ }));
        const v = rnd();
        if (v < 0.5) {
          const adds = screen.queryAllByText("Add").map(e => e.closest("button")).filter(Boolean);
          if (adds.length) { fireEvent.click(adds[Math.floor(rnd() * adds.length)]); expected++; bump("joinMember"); }
          if (rnd() < 0.5) { fireEvent.change(screen.getByPlaceholderText(/Search members/), { target: { value: "a" } }); bump("joinSearch"); }
          fireEvent.click(screen.getByRole("button", { name: "Done" }));
        } else if (v < 0.85) {
          fireEvent.change(screen.getByPlaceholderText(/Search members/), { target: { value: "Latecomer" + (++late) } });
          fireEvent.click(screen.getByRole("button", { name: /as a new name/ })); fireEvent.click(screen.getByRole("button", { name: /Guest just for tonight/ })); expected++; bump("lateJoin");
        } else {
          fireEvent.click(screen.getByRole("button", { name: "Done" })); bump("joinCancel");
        }
        if (screen.queryByPlaceholderText(/Search members/)) violations.push("step " + i + ": join sheet left open");
      } else if (r < 0.82) {
        goTab("game"); const u = screen.queryByText(/Undo last result/); if (u) { fireEvent.click(u); bump("undo"); }
      } else if (r < 0.89) {
        goTab("game");
        const t = [/^▶$/, /^⏸$/, /^-1m$/, /^\+10s$/, /^■$/].map(re => screen.queryByText(re)).filter(Boolean);
        if (t.length) { fireEvent.click(t[Math.floor(rnd() * t.length)]); bump("timer"); }
      } else if (r < 0.915) {
        goTab("game"); winAndScore(true, rnd); winAndScore(false, rnd); bump("doubleWin");
      } else if (r < 0.935) {
        const before = read();
        fireEvent.click(screen.getByRole("button", { name: "End session" })); fireEvent.click(screen.getByRole("button", { name: "Yes, end session" }));
        screen.getByRole("button", { name: "Share image" }); screen.getByText("Done — clear session");
        await screen.findByAltText("Monday Night Ball recap");
        fireEvent.click(screen.getByText("Go back — keep playing"));
        if (JSON.stringify(read()) !== JSON.stringify(before)) violations.push("step " + i + ": recap changed the live session");
        if (screen.queryByRole("button", { name: "Share image" })) violations.push("step " + i + ": recap did not close");
        bump("recap");
      } else if (r < 0.95) {
        goTab("log"); screen.getByText("Attendance"); goTab("game"); bump("tabHop");
      } else {
        const before = read(); view.unmount(); cleanup();
        view = render(<App />); await screen.findByText("Game", { selector: "span" }, { timeout: 8000 }); tab = "game";
        const after = read();
        const ids = (s) => [...s.teamA, ...s.teamB, ...s.queue, ...s.sittingOut, ...s.injured, ...s.left].map(p => p.id).sort().join();
        if (ids(before) !== ids(after)) violations.push("step " + i + ": restart changed the roster");
        bump("restart");
      }
    } catch (e) { violations.push("step " + i + ": action threw: " + String(e.message).split("\n")[0].slice(0, 120)); break; }

    const st = read();
    if (process.env.CHAOS_DEBUG) console.log('step', i, 'last', lastAct, JSON.stringify(counts), 'total', st.teamA.length+st.teamB.length+st.queue.length+st.sittingOut.length+st.injured.length+st.left.length, 'expected', expected, 'tab', tab);
    const all = [...st.teamA, ...st.teamB, ...st.queue, ...st.sittingOut, ...st.injured, ...st.left];
    const ids = all.map(p => p.id);
    if (new Set(ids).size !== ids.length) violations.push("step " + i + ": duplicate player");
    if (ids.length !== expected) violations.push("step " + i + ": count " + ids.length + " != " + expected);
    if (st.teamA.length !== 5 || st.teamB.length !== 5) violations.push("step " + i + ": team sizes " + st.teamA.length + "/" + st.teamB.length);
    if (JSON.stringify(st).includes("undefined")) violations.push("step " + i + ": undefined in state");
    if (mode === "rotate" && [...st.teamA, ...st.teamB].some(p => p.winStreak > 2)) violations.push("step " + i + ": streak > 2 on court");
    if (screen.queryByText(/Something went wrong/)) { violations.push("step " + i + ": ErrorBoundary showing"); break; }
    if (screen.queryByText("Coming in")) violations.push("step " + i + ": sheet left open");
    if (tab === "game") [...st.teamA, ...st.teamB].forEach(p => { if (!screen.queryAllByText(p.name).length) violations.push("step " + i + ": " + p.name + " is on court but not on screen"); });
    if (violations.length > 8) break;
  }
  view.unmount(); cleanup();
  return { N, mode, steps, counts, violationCount: violations.length, violations: violations.slice(0, 6) };
}

const results = [];
afterAll(() => { console.log("canvas draw calls (recap code ran): " + canvasDraws); console.log("CHAOS RESULTS\n" + results.map(r => JSON.stringify(r)).join("\n")); });

test.each([[10, "rotate", 1], [11, "king", 2], [13, "rotate", 3], [16, "king", 4], [18, "rotate", 5], [20, "rotate", 6], [22, "king", 7], [24, "rotate", 8], [24, "king", 9], [12, "rotate", 10]])("chaos N=%i %s seed %i", async (N, mode, seed) => {
  const r = await chaos(N, mode, 250, seed * 1013);
  results.push(r);
  expect(r.violations).toEqual([]);
}, 280000);
