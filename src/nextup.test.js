// The player who was next up steps in for an injured player mid-game. Whatever
// happens to that team, he keeps his place: he's on the court for the game
// he'd have played anyway, and doesn't carry extra priority after that.
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

jest.mock("firebase/app", () => { throw new Error("no firebase in tests"); });
jest.mock("firebase/firestore", () => { throw new Error("no firebase in tests"); });

const App = require("./App").default;

const mk = (n, i) => ({ id: "p" + i, name: "Player" + (i + 1), joinOrder: i + 1, roundsWaited: 0, gamesPlayed: 0, wins: 0, winStreak: 0, hasPlayed: false, streakedOut: false, injurySubGame: false, isGuest: true });
const read = () => JSON.parse(localStorage.getItem("local_ncbc-main"));
const skipWin = home => {
  fireEvent.click(screen.getByText(home ? /Home Wins/ : /Away Wins/));
  fireEvent.click(screen.getByRole("button", { name: "Skip score" }));
};
async function start(n) {
  localStorage.clear();
  localStorage.setItem("local_ncbc-main", JSON.stringify({ view: "setup", teamSize: 5, gameMode: "rotate", setupPlayers: Array.from({ length: n }, mk), joinCounter: n, teamA: [], teamB: [], queue: [], sittingOut: [], injured: [], left: [], gameCount: 0, lastResult: null, history: [], timerRunning: false, timerDone: false, endTime: null, pausedSecondsLeft: 480 }));
  render(<App />);
  fireEvent.click(await screen.findByText(/Run It/, {}, { timeout: 8000 }));
  await screen.findByText(/Home Wins/);
}
// Next-up player replaces a hurt Home player mid-game. Returns the sub's id.
function hurtSubHome() {
  const st = read();
  const nextUp = st.queue[0].id;
  fireEvent.click(screen.getAllByText(st.teamA[0].name)[0]);
  const tip = screen.queryByText(/Game hasn't started/);
  if (tip) fireEvent.click(tip);
  fireEvent.click(screen.getByText("Hurt"));
  expect(read().teamA.some(p => p.id === nextUp)).toBe(true);
  return nextUp;
}
const onCourt = (st, id) => [...st.teamA, ...st.teamB].some(p => p.id === id);

afterEach(() => cleanup());

test.each([[16], [15], [14], [20]])("%i players: team rotates off after 2 straight wins, sub still plays the next game", async n => {
  await start(n);
  skipWin(true);            // Home is on a 1-win streak
  const sub = hurtSubHome(); // next-up player steps in
  skipWin(true);            // second straight win: Home rotates off
  expect(onCourt(read(), sub)).toBe(true);
});

test.each([[16], [15]])("%i players: team loses, sub still plays the next game", async n => {
  await start(n);
  skipWin(true);
  const sub = hurtSubHome();
  skipWin(false);           // Home loses
  expect(onCourt(read(), sub)).toBe(true);
});

test("team wins and stays on: the sub stays on and gets no extra priority afterwards", async () => {
  await start(16);
  const sub = hurtSubHome(); // Home's first game
  skipWin(true);             // first win: Home stays on
  const st = read();
  expect(st.teamA.some(p => p.id === sub)).toBe(true);
  expect(st.teamA.find(p => p.id === sub).roundsWaited).toBe(0);
});
