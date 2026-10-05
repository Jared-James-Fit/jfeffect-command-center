import { describe, expect, it } from "vitest";
import { canonical, mergeAssignees, mergeQuadrantStyles, reconcilePref } from "@/lib/task-prefs-sync";

const merge = (l: string[], r: string[]) => [...new Set([...r, ...l])];
const j = (v: unknown) => JSON.stringify(v);

describe("reconcilePref", () => {
  it("does nothing when both devices agree", () => {
    expect(reconcilePref({ local: ["a"], remote: ["a"], base: null, merge })).toEqual({ next: ["a"], adopt: false, push: false });
  });
  it("uploads this device's value when the server has none", () => {
    expect(reconcilePref({ local: ["a"], remote: null, base: null, merge })).toEqual({ next: ["a"], adopt: false, push: true });
  });
  it("takes the server's value when this device never set one", () => {
    expect(reconcilePref({ local: undefined, remote: ["a"], base: null, merge })).toEqual({ next: ["a"], adopt: true, push: false });
  });
  it("pushes when only this device changed since last sync", () => {
    expect(reconcilePref({ local: ["a", "b"], remote: ["a"], base: j(["a"]), merge })).toEqual({ next: ["a", "b"], adopt: false, push: true });
  });
  it("adopts when only another device changed since last sync", () => {
    expect(reconcilePref({ local: ["a"], remote: ["a", "c"], base: j(["a"]), merge })).toEqual({ next: ["a", "c"], adopt: true, push: false });
  });
  it("another device clearing the list is adopted, not undone", () => {
    expect(reconcilePref({ local: ["a", "b"], remote: [] as string[], base: j(["a", "b"]), merge })).toEqual({ next: [], adopt: true, push: false });
  });
  it("merges when both changed, and uploads the merged result", () => {
    const d = reconcilePref({ local: ["a", "b"], remote: ["a", "c"], base: j(["a"]), merge });
    expect(d.next).toEqual(["a", "c", "b"]);
    expect(d).toMatchObject({ adopt: true, push: true });
  });
  it("first sync with different values on each device merges instead of overwriting", () => {
    const d = reconcilePref({ local: ["x"], remote: ["y"], base: null, merge });
    expect(d.next).toEqual(["y", "x"]);
  });
});

describe("key order from the database never causes a false difference", () => {
  it("compares objects regardless of key order, but arrays by order", () => {
    expect(canonical({ do: 1, schedule: { b: 2, a: 1 } })).toBe(canonical({ schedule: { a: 1, b: 2 }, do: 1 }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
    const local = { do: { color: "g", title: "Do" }, schedule: { color: "b", title: "S" } };
    const fromDb = { schedule: { title: "S", color: "b" }, do: { title: "Do", color: "g" } };
    expect(reconcilePref({ local, remote: fromDb, base: canonical(fromDb), merge: (l) => l }))
      .toEqual({ next: local, adopt: false, push: false });
  });
});

describe("merge helpers", () => {
  it("keeps every assignee from both devices once", () => {
    const remote = [{ id: "1", name: "Sam" }, { id: "2", name: "Lee" }];
    const local = [{ id: "2", name: "Lee" }, { id: "3", name: "Kai" }];
    expect(mergeAssignees(local, remote).map((a) => a.id)).toEqual(["1", "2", "3"]);
  });
  it("a customised quadrant beats a default one, in both directions", () => {
    const defaults = { do: { c: "g" }, schedule: { c: "b" }, delegate: { c: "y" } };
    const local = { do: { c: "PINK" }, schedule: { c: "b" }, delegate: { c: "y" } };
    const remote = { do: { c: "g" }, schedule: { c: "TEAL" }, delegate: { c: "y" } };
    expect(mergeQuadrantStyles(local, remote, defaults)).toEqual({ do: { c: "PINK" }, schedule: { c: "TEAL" }, delegate: { c: "y" } });
  });
});
