// Per-game scores: entry, validation, skip, pre-fill, editing a past game, undo.
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

jest.mock("firebase/app", () => { throw new Error("no firebase in tests"); });
jest.mock("firebase/firestore", () => { throw new Error("no firebase in tests"); });

const App = require("./App").default;

const mk = (n, i) => ({ id: "p" + i, name: "Player" + (i + 1), joinOrder: i + 1, roundsWaited: 0, gamesPlayed: 0, wins: 0, winStreak: 0, hasPlayed: false, streakedOut: false, injurySubGame: false, isGuest: true });
const read = () => JSON.parse(localStorage.getItem("local_ncbc-main"));
const home = () => screen.getByLabelText("HOME score");
const away = () => screen.getByLabelText("AWAY score");
const type = (el, v) => fireEvent.change(el, { target: { value: v } });

async function start() {
  localStorage.clear();
  localStorage.setItem("local_ncbc-main", JSON.stringify({ view: "setup", teamSize: 5, gameMode: "rotate", setupPlayers: Array.from({ length: 14 }, mk), joinCounter: 14, teamA: [], teamB: [], queue: [], sittingOut: [], injured: [], left: [], gameCount: 0, lastResult: null, history: [], timerRunning: false, timerDone: false, endTime: null, pausedSecondsLeft: 480 }));
  render(<App />);
  fireEvent.click(await screen.findByText(/Run It/, {}, { timeout: 8000 }));
  await screen.findByText(/Home Wins/);
}

afterEach(() => cleanup());

test("records a final score with the game and shows it", async () => {
  await start();
  const before = read().gameCount;
  fireEvent.click(screen.getByText(/Home Wins/));
  expect(read().gameCount).toBe(before); // nothing recorded until the sheet is answered
  type(home(), "21"); type(away(), "17");
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  const st = read();
  expect(st.gameCount).toBe(before + 1);
  expect(st.gameLog).toHaveLength(1);
  expect(st.gameLog[0]).toMatchObject({ side: "A", ws: 21, ls: 17 });
  expect(st.lastResult.score).toBe("Home 21–17");
  expect(screen.getByText("Scores tonight")).toBeTruthy();
});

test("rejects a score where the winner has fewer points, and half-filled scores", async () => {
  await start();
  fireEvent.click(screen.getByText(/Away Wins/));
  type(home(), "21"); type(away(), "15");
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  expect(screen.getByRole("alert").textContent).toMatch(/Away's score has to be higher/);
  expect(read().gameLog || []).toHaveLength(0);
  type(home(), "");
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  expect(screen.getByRole("alert").textContent).toMatch(/Enter both scores/);
  type(home(), "12");
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  expect(read().gameLog[0]).toMatchObject({ side: "B", ws: 15, ls: 12 });
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

test("boxes start empty every game; 9 and 11 fill the winner's box", async () => {
  await start();
  fireEvent.click(screen.getByText(/Home Wins/));
  type(home(), "11"); type(away(), "7");
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  fireEvent.click(screen.getByText(/Away Wins/));
  expect(home().value).toBe("");
  expect(away().value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Won with 9" }));
  expect(away().value).toBe("9");
  type(home(), "6");
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  expect(read().gameLog[1]).toMatchObject({ side: "B", ws: 9, ls: 6 });
});

test("a past game's score can be added later without touching the rotation", async () => {
  await start();
  fireEvent.click(screen.getByText(/Home Wins/));
  fireEvent.click(screen.getByRole("button", { name: "Skip score" }));
  const teams = JSON.stringify([read().teamA, read().teamB, read().queue]);
  fireEvent.click(screen.getByRole("button", { name: /Edit score for game/ }));
  type(home(), "11"); type(away(), "8");
  fireEvent.click(screen.getByRole("button", { name: "Save score" }));
  const st = read();
  expect(st.gameLog[0]).toMatchObject({ ws: 11, ls: 8 });
  expect(st.lastResult.score).toBe("Home 11–8");
  expect(JSON.stringify([st.teamA, st.teamB, st.queue])).toBe(teams);
});

test("undo removes the game and its score", async () => {
  await start();
  fireEvent.click(screen.getByText(/Home Wins/));
  type(home(), "21"); type(away(), "19");
  fireEvent.click(screen.getByRole("button", { name: "Save result" }));
  fireEvent.click(screen.getByText(/Undo/));
  expect(read().gameLog).toHaveLength(0);
  expect(screen.queryByText("Scores tonight")).toBeNull();
});
