// Stress test: drives the real App through hundreds of random games and checks
// the saved session after every result. Firebase is mocked away so the app
// uses its localStorage fallback, which lets us read the full state back out.
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

jest.mock("firebase/app", () => { throw new Error("no firebase in tests"); });
jest.mock("firebase/firestore", () => { throw new Error("no firebase in tests"); });

const App = require("./App").default;

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mk = (n, i) => ({ id: "p" + i, name: "Player" + (i + 1), joinOrder: i + 1, roundsWaited: 0, gamesPlayed: 0, wins: 0, winStreak: 0, hasPlayed: false, streakedOut: false, injurySubGame: false, isGuest: true });
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
const read = () => JSON.parse(localStorage.getItem("local_ncbc-main"));

async function run(N, mode, games, seed, undoRate = 0) {
  localStorage.clear();
  const players = Array.from({ length: N }, mk);
  localStorage.setItem("local_ncbc-main", JSON.stringify({ view: "setup", teamSize: 5, gameMode: mode, setupPlayers: players, joinCounter: N, teamA: [], teamB: [], queue: [], sittingOut: [], injured: [], left: [], gameCount: 0, lastResult: null, history: [], timerRunning: false, timerDone: false, endTime: null, pausedSecondsLeft: 480 }));
  const rnd = mulberry(seed);
  const { unmount } = render(<App />);
  const runBtn = await screen.findByText(/Run It/, {}, { timeout: 8000 });
  fireEvent.click(runBtn);
  const violations = [];
  const maxWait = {};
  for (let g = 0; g < games; g++) {
    if (undoRate && rnd() < undoRate) {
      const u = screen.queryByText(/Undo last result/);
      if (u) fireEvent.click(u);
    }
    await screen.findByText(/Home Wins/);
    winAndScore(rnd() < 0.5, rnd);
    const st = read();
    const all = [...st.teamA, ...st.teamB, ...st.queue, ...st.sittingOut, ...st.injured, ...st.left];
    const ids = all.map(p => p.id);
    if (new Set(ids).size !== ids.length) violations.push(`game ${g}: duplicate player`);
    if (ids.length !== N) violations.push(`game ${g}: player count ${ids.length} != ${N}`);
    if (st.teamA.length !== 5 || st.teamB.length !== 5) violations.push(`game ${g}: team sizes ${st.teamA.length}/${st.teamB.length}`);
    if (mode === "rotate") {
      [...st.teamA, ...st.teamB].forEach(p => { if (p.winStreak > 2) violations.push(`game ${g}: ${p.name} streak ${p.winStreak}`); });
    }
    st.queue.forEach(p => { maxWait[p.id] = Math.max(maxWait[p.id] || 0, p.roundsWaited); });
    if (JSON.stringify(st).includes("undefined")) violations.push(`game ${g}: undefined in state`);
  }
  const st = read();
  const everyone = [...st.teamA, ...st.teamB, ...st.queue, ...st.sittingOut];
  const gp = everyone.map(p => p.gamesPlayed);
  const result = { N, mode, games, violations: violations.slice(0, 5), violationCount: violations.length, gpMin: Math.min(...gp), gpMax: Math.max(...gp), worstWait: Math.max(0, ...Object.values(maxWait)) };
  unmount(); cleanup();
  return result;
}


async function runSubs(N, steps, seed) {
  localStorage.clear();
  const players = Array.from({ length: N }, mk);
  localStorage.setItem("local_ncbc-main", JSON.stringify({ view: "setup", teamSize: 5, gameMode: "rotate", setupPlayers: players, joinCounter: N, teamA: [], teamB: [], queue: [], sittingOut: [], injured: [], left: [], gameCount: 0, lastResult: null, history: [], timerRunning: false, timerDone: false, endTime: null, pausedSecondsLeft: 480 }));
  const rnd = mulberry(seed);
  const { unmount } = render(<App />);
  fireEvent.click(await screen.findByText(/Run It/, {}, { timeout: 8000 }));
  const violations = []; const counts = { win: 0, quick: 0, hurt: 0, done: 0, change: 0 };
  for (let i = 0; i < steps; i++) {
    let st = read();
    const poolSize = st.queue.length + st.sittingOut.length;
    const r = rnd();
    if (r < 0.5 || poolSize < 2) {
      await screen.findByText(/Home Wins/); winAndScore(rnd() < 0.5, rnd); counts.win++;
    } else {
      const court = [...st.teamA, ...st.teamB];
      const who = court[Math.floor(rnd() * court.length)];
      const row = screen.getAllByText(who.name).find(e => e.parentElement && String(e.parentElement.className).includes("native-row"));
      fireEvent.click(row);
      await screen.findByText("Coming in");
      if (rnd() < 0.3 && poolSize > 1) {
        fireEvent.click(screen.getByText("Change"));
        const rows = await screen.findAllByText(/GP$/);
        fireEvent.click(rows[1 + Math.floor(rnd() * (rows.length - 1))]);
        await screen.findByText("Coming in"); counts.change++;
      }
      const pick = rnd();
      if (pick < 0.6) { fireEvent.click(screen.getByText("Quick break")); counts.quick++; }
      else if (pick < 0.85) { fireEvent.click(screen.getByText("Hurt")); counts.hurt++; }
      else if (st.left.length < 2) { fireEvent.click(screen.getByText("Done for the day")); counts.done++; }
      else { fireEvent.click(screen.getByText("Cancel")); }
    }
    st = read();
    const all = [...st.teamA, ...st.teamB, ...st.queue, ...st.sittingOut, ...st.injured, ...st.left];
    const ids = all.map(p => p.id);
    if (new Set(ids).size !== ids.length) violations.push("step " + i + ": duplicate player");
    if (ids.length !== N) violations.push("step " + i + ": count " + ids.length + " != " + N);
    if (st.teamA.length !== 5 || st.teamB.length !== 5) violations.push("step " + i + ": team sizes " + st.teamA.length + "/" + st.teamB.length);
    if (JSON.stringify(st).includes("undefined")) violations.push("step " + i + ": undefined in state");
    if (screen.queryByText("Coming in")) violations.push("step " + i + ": sheet left open");
  }
  unmount(); cleanup();
  return { N, steps, counts, violationCount: violations.length, violations: violations.slice(0, 5) };
}

const results = [];
afterAll(() => { console.log("STRESS RESULTS\n" + results.map(r => JSON.stringify(r)).join("\n")); });

describe("stress", () => {
  const cases = [];
  [10, 11, 12, 15, 20, 24].forEach(N => ["rotate", "king"].forEach(m => cases.push([N, m])));
  test.each(cases)("N=%i mode=%s, 150 random games", async (N, mode) => {
    const r = await run(N, mode, 150, N * 31 + (mode === "king" ? 7 : 0));
    results.push(r);
    expect(r.violationCount).toBe(0);
  }, 120000);
  test.each([[14, 11], [18, 23], [24, 37]])("one-sheet subs: N=%i", async (N, seed) => {
    const r = await runSubs(N, 120, seed);
    results.push({ ...r, subs: true });
    expect(r.violationCount).toBe(0);
  }, 180000);
  test.each([[10, "rotate"], [12, "rotate"], [24, "rotate"], [24, "king"]])("with random Undo: N=%i mode=%s", async (N, mode) => {
    const r = await run(N, mode, 150, N * 97, 0.15);
    results.push({ ...r, undo: true });
    expect(r.violationCount).toBe(0);
  }, 120000);
});
