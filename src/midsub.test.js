// Mid-game subs follow their team's streak: when the team rotates off after
// two straight wins, the sub goes with them and is first in line next game.
import React from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

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

// Open a Home player's sheet and sub them out mid-game with the given reason.
function subOutHome(name, reason) {
  fireEvent.click(screen.getAllByText(name)[0]);
  const tip = screen.queryByText(/Game hasn't started/);
  if (tip) fireEvent.click(tip); // mark the game as in progress
  fireEvent.click(screen.getByText(reason));
}

afterEach(() => cleanup());

test.each([["Quick break"], ["Hurt"], ["Done for the day"]])("%s: the sub rotates off with his team and leads the line", async reason => {
  await start(16); // 5 v 5 with 6 waiting
  skipWin(true); // Home 1-0: everyone on Home is at a 1-win streak
  let st = read();
  const out = st.teamA[0];
  const subName = st.queue.length ? undefined : undefined;
  subOutHome(out.name, reason);
  st = read();
  const sub = st.teamA.find(p => p.midSub);
  expect(sub).toBeTruthy();
  expect(sub.teamStreak).toBe(1);
  skipWin(true); // Home wins again: the team's second straight win
  st = read();
  // Nobody from that Home team (sub included) is still on Home.
  const onHome = st.teamA.map(p => p.id);
  expect(onHome).not.toContain(sub.id);
  // The sub is back at the front of the line, not the back.
  expect(st.queue[0].id).toBe(sub.id);
  expect(st.queue[0].winStreak).toBe(0);
  // Clean-up flags don't linger on anyone.
  [...st.teamA, ...st.teamB, ...st.queue].forEach(p => { expect(p.midSub).toBeFalsy(); expect(p.wasMidSub).toBeUndefined(); });
  void subName;
});

test("a sub on a team's first game keeps playing with them like before", async () => {
  await start(16);
  const st0 = read();
  subOutHome(st0.teamA[0].name, "Quick break");
  const sub = read().teamA.find(p => p.midSub);
  skipWin(true); // Home's first win: nobody has 2 yet
  const st = read();
  expect(st.teamA.map(p => p.id)).toContain(sub.id);
  expect(st.teamA.find(p => p.id === sub.id).winStreak).toBe(1);
});
