// One members list: seeded from the old built-in names plus names added in the
// app, editable (add / rename / remove), and names added on phones still on an
// older version get folded in unless they were removed here.
import React from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

jest.mock("firebase/app", () => { throw new Error("no firebase in tests"); });
jest.mock("firebase/firestore", () => { throw new Error("no firebase in tests"); });

const App = require("./App").default;

const doc = k => JSON.parse(localStorage.getItem("local_" + k) || "null");
const chip = title => screen.queryAllByRole("button").find(b => b.getAttribute("title") === title);
const grid = n => !!chip("Tap to sign up " + n);

async function load(oldNames, members) {
  localStorage.clear();
  localStorage.setItem("local_ncbc-roster", JSON.stringify({ names: oldNames }));
  if (members) localStorage.setItem("local_ncbc-members", JSON.stringify(members));
  render(<App />);
  await screen.findByText(/Tap your name to sign up/, {}, { timeout: 8000 });
  await screen.findByRole("button", { name: "Edit members" }, { timeout: 4000 }); // one list is live
}

afterEach(() => cleanup());

test("first run builds one list from the built-in names plus added names, no separate section", async () => {
  await load(["Hans", "Glen", "Brian Ho"]);
  const m = doc("ncbc-members");
  expect(m.members).toContain("Alex Chiew");
  expect(m.members).toContain("Hans");
  expect(m.members).toContain("Glen");
  expect(m.members.filter(n => n === "Brian Ho")).toHaveLength(1); // no duplicate
  expect(grid("Hans")).toBe(true);
  expect(screen.queryByText(/Added regulars/i)).toBeNull();
});

test("add, rename and remove from Edit members, everywhere at once", async () => {
  await load(["Hans", "Glen"]);
  fireEvent.click(screen.getByRole("button", { name: "Edit members" }));
  fireEvent.click(screen.getByRole("button", { name: "Rename Glen" }));
  fireEvent.change(screen.getByLabelText("New name for Glen"), { target: { value: "Glen Lee" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove Hans" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Rename Nick M" })); // built-in members too
  fireEvent.change(screen.getByLabelText("New name for Nick M"), { target: { value: "Nick Martinez" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.change(screen.getByLabelText("Search or add a member"), { target: { value: "brian ho" } });
  expect(screen.queryByRole("button", { name: "Add" })).toBeNull(); // already a member
  fireEvent.change(screen.getByLabelText("Search or add a member"), { target: { value: "Toby" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  ["Glen Lee", "Nick Martinez", "Toby"].forEach(n => expect(grid(n)).toBe(true));
  ["Glen", "Hans", "Nick M"].forEach(n => expect(grid(n)).toBe(false));
  const m = doc("ncbc-members");
  expect(m.removed).toEqual(expect.arrayContaining(["hans", "glen", "nick m"]));
  // phones on the older version still see the added names list in step
  expect(doc("ncbc-roster").names).toEqual(expect.arrayContaining(["Glen Lee", "Toby"]));
  expect(doc("ncbc-roster").names).not.toContain("Hans");
});

test("an older phone re-adding a removed name doesn't bring it back; a new name is folded in", async () => {
  await load(["Hans", "Glen", "Zed"], { members: ["Alex Chiew", "Glen Lee"], removed: ["hans", "glen"] });
  expect(grid("Hans")).toBe(false);
  expect(grid("Glen")).toBe(false);
  expect(grid("Glen Lee")).toBe(true);
  expect(grid("Zed")).toBe(true);
});

test("signing up still works with an edited name", async () => {
  await load([], { members: ["Glen Lee", "Alex Chiew"], removed: [] });
  fireEvent.click(chip("Tap to sign up Glen Lee"));
  expect(chip("Tap to remove Glen Lee")).toBeTruthy();
  void within;
});
