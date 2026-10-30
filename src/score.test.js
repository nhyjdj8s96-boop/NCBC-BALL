// Per-game scores: 0-11 pad entry, validation, skip, blank start, editing a past game, undo.
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

jest.mock("firebase/app", () => { throw new Error("no firebase in tests"); });
jest.mock("firebase/firestore", () => { throw new Error("no firebase in tests"); });

const App = require("./App").default;

const mk = (n, i) => ({ id: "p" + i, name: "Player" + (i + 1), joinOrder: i + 1, roundsWaited: 0, gamesPlayed: 0, wins: 0, winStreak: 0, hasPlayed: false, streakedOut: false, injurySubGame: false, isGuest: true });
const read = () => JSON.parse(localStorage.getItem("local_ncbc-main"));
const box = (team) => screen.getByRole("button", { name: team + " score" });
const tap = (n) => fireEvent.click(screen.getByRole("button", { name: String(n) }));
const pick = (team, n) => { fireEvent.click(box(team)); tap(n); };
const save = (name = "Save result") => fireEvent.click(screen.getByRole("button", { name }));

async function start() {
  localStorage.clear();
  localStorage.setItem("local_ncbc-main", JSON.stringify({ view: "setup", teamSize: 5, gameMode: "rotate", setupPlayers: Array.from({ length: 14 }, mk), joinCounter: 14, teamA: [], teamB: [], queue: [], sittingOut: [], injured: [], left: [], gameCount: 0, lastResult: null, history: [], timerRunning: false, timerDone: false, endTime: null, pausedSecondsLeft: 480 }));
  render(<App />);
  fireEvent.click(await screen.findByText(/Run It/, {}, { timeout: 8000 }));
  await screen.findByText(/Home Wins/);
}

afterEach(() => cleanup());

test("two taps on the pad record the score: winner first, then loser", async () => {
  await start();
  const before = read().gameCount;
  fireEvent.click(screen.getByText(/Home Wins/));
  expect(read().gameCount).toBe(before); // nothing recorded until the sheet is answered
  tap(11); tap(8); save();
  const st = read();
  expect(st.gameCount).toBe(before + 1);
  expect(st.gameLog[0]).toMatchObject({ side: "A", ws: 11, ls: 8 });
  expect(st.lastResult.score).toBe("Home 11–8");
  expect(screen.getByText("Scores tonight")).toBeTruthy();
});

test("rejects a winner with fewer points, and a half-filled score", async () => {
  await start();
  fireEvent.click(screen.getByText(/Away Wins/));
  tap(9); save();
  expect(screen.getByRole("alert").textContent).toMatch(/Enter both scores/);
  pick("HOME", 10); save();
  expect(screen.getByRole("alert").textContent).toMatch(/Away's score has to be higher/);
  expect(read().gameLog || []).toHaveLength(0);
  pick("HOME", 6); save();
  expect(read().gameLog[0]).toMatchObject({ side: "B", ws: 9, ls: 6 });
});

test("skip records the game with no score; cancel records nothing", async () => {
  await start();
  fireEvent.click(screen.getByText(/Home Wins/));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(read().gameLog || []).toHaveLength(0);
  fireEvent.click(screen.getByText(/Home Wins/));
  fireEvent.click(screen.getByRole("button", { name: "Skip score" }));
  const gm = read().gameLog[0];
  expect(gm.side).toBe("A");
  expect(gm.ws).toBeUndefined();
  expect(screen.getByText("+ Add score")).toBeTruthy();
});

test("both boxes start blank every game", async () => {
  await start();
  fireEvent.click(screen.getByText(/Home Wins/));
  tap(11); tap(7); save();
  fireEvent.click(screen.getByText(/Away Wins/));
  expect(box("HOME").textContent).toBe("–");
  expect(box("AWAY").textContent).toBe("–");
});

test("a past game's score can be added later without touching the rotation", async () => {
  await start();
  fireEvent.click(screen.getByText(/Home Wins/));
  fireEvent.click(screen.getByRole("button", { name: "Skip score" }));
  const teams = JSON.stringify([read().teamA, read().teamB, read().queue]);
  fireEvent.click(screen.getByRole("button", { name: /Edit score for game/ }));
  tap(11); tap(8); save("Save score");
  const st = read();
  expect(st.gameLog[0]).toMatchObject({ ws: 11, ls: 8 });
  expect(st.lastResult.score).toBe("Home 11–8");
  expect(JSON.stringify([st.teamA, st.teamB, st.queue])).toBe(teams);
});

test("undo removes the game and its score", async () => {
  await start();
  fireEvent.click(screen.getByText(/Home Wins/));
  tap(11); tap(9); save();
  fireEvent.click(screen.getByText(/Undo/));
  expect(read().gameLog).toHaveLength(0);
  expect(screen.queryByText("Scores tonight")).toBeNull();
});

test("Other score takes points above 11 from the keyboard", async () => {
  await start();
  fireEvent.click(screen.getByText(/Away Wins/));
  fireEvent.click(screen.getByRole("button", { name: "Other score (over 11)" }));
  fireEvent.change(screen.getByLabelText("Away points (other score)"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByLabelText("Home points (other score)"), { target: { value: "13" } });
  save();
  expect(read().gameLog[0]).toMatchObject({ side: "B", ws: 15, ls: 13 });
  expect(read().lastResult.score).toBe("Away 15–13");
});
