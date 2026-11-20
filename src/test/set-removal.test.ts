import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_SET_SESSION,
  afterAdd,
  afterRemove,
  clearSetSessions,
  getSetSession,
  putBackWrites,
  rowsWithSkips,
  setKindAt,
  setRemoval,
  setSetSession,
  shownSetCount,
  takeOutWrites,
  withLoggedShown,
  type SetSession,
} from "@/lib/workouts/set-session";
import { workoutSetProgress } from "@/lib/workout-set-progress";
import { SwipeToReveal } from "@/components/workout-day/swipe-to-reveal";

const read = (p: string) => readFileSync(p, "utf8");

describe("added sets delete, the program's sets skip", () => {
  it("a phone that never saw + Add set treats every set as the program's: Skip, never Delete", () => {
    const s = EMPTY_SET_SESSION;
    expect([1, 2, 3, 4].map((n) => setKindAt(n, 4, s))).toEqual(["planned", "planned", "planned", "planned"]);
    expect(setRemoval(4, 4, s)).toBe("skip");
  });

  it("+ Add set remembers the program's count; the new set is the one that deletes", () => {
    const { session, write } = afterAdd(4, EMPTY_SET_SESSION);
    expect(write).toBe(true);
    expect(session.planned).toBe(4);
    expect(setKindAt(5, 5, session)).toBe("added");
    expect(setKindAt(4, 5, session)).toBe("planned");
    expect(setRemoval(5, 5, session)).toBe("delete");
    expect(setRemoval(2, 5, session)).toBe("skip");
    // a second add keeps the program's count
    expect(afterAdd(5, session).session.planned).toBe(4);
  });

  it("deleting an added set: the row's count goes down, the program's count stays", () => {
    const s: SetSession = { planned: 4, skipped: 0 };
    const next = afterRemove("delete", 5, s);
    expect(next).toEqual(s);
    expect(shownSetCount(4, next)).toBe(4);
    expect([1, 2, 3, 4].every((n) => setKindAt(n, 4, next) === "planned")).toBe(true);
  });

  it("skipping hides one of the program's sets for today; the prescription (the row's count) is untouched", () => {
    const s = afterRemove("skip", 4, EMPTY_SET_SESSION);
    expect(s).toEqual({ planned: 4, skipped: 1 });
    expect(shownSetCount(4, s)).toBe(3);
    // added sets stay last and stay deletable after a skip
    const withAdded: SetSession = { planned: 4, skipped: 0 };
    const skipped = afterRemove("skip", 5, withAdded);
    expect(shownSetCount(5, skipped)).toBe(4);
    expect(setKindAt(3, 5, skipped)).toBe("planned");
    expect(setKindAt(4, 5, skipped)).toBe("added");
  });

  it("+ Add set brings a skipped set back first, writing nothing", () => {
    const { session, write } = afterAdd(4, { planned: 4, skipped: 2 });
    expect(write).toBe(false);
    expect(session.skipped).toBe(1);
    expect(shownSetCount(4, session)).toBe(3);
  });

  it("the card always keeps one set: nothing to take out when it's the only one shown", () => {
    expect(setRemoval(1, 1, EMPTY_SET_SESSION)).toBeNull();
    expect(setRemoval(1, 4, { planned: 4, skipped: 3 })).toBeNull();
    expect(shownSetCount(4, { planned: 4, skipped: 9 })).toBe(1);
  });

  it("a skip never hides a set with numbers on it (an undo from the ⋯, another phone logging it)", () => {
    const s: SetSession = { planned: 4, skipped: 1 };
    // set 4 logged again: the skip gives way
    expect(withLoggedShown(4, s, 4)).toEqual({ planned: 4, skipped: 0 });
    // sets 1–3 logged: the skip of the 4th stands (the same object, nothing to save)
    expect(withLoggedShown(4, s, 3)).toBe(s);
    expect(withLoggedShown(4, EMPTY_SET_SESSION, 4)).toBe(EMPTY_SET_SESSION);
  });

  it("a card undo that took the added sets away leaves every set the program's again", () => {
    // planned 4, an undo put the row back to 4 sets
    const s: SetSession = { planned: 4, skipped: 0 };
    expect([1, 2, 3, 4].map((n) => setRemoval(n, 4, s))).toEqual(["skip", "skip", "skip", "skip"]);
  });
});

describe("the writes: rows move by id, never two on one set number", () => {
  type Row = { id: string; set_index: number };
  /** pl_row_results is unique on (client, row, set number): a move onto a taken number fails. */
  const apply = (table: Row[], moves: Array<{ id: string; to: number }>) => {
    for (const m of moves) {
      if (table.some((r) => r.id !== m.id && r.set_index === m.to)) throw new Error(`set ${m.to} taken`);
      table.find((r) => r.id === m.id)!.set_index = m.to;
    }
  };
  const table = (): Row[] => [1, 2, 3, 4, 5].map((n) => ({ id: `r${n}`, set_index: n }));

  it("taking out set 2: it goes, 3–5 move down to 2–4 in a safe order", () => {
    const t = table();
    const { removedId, shifts } = takeOutWrites(t, 2);
    expect(removedId).toBe("r2");
    const after = t.filter((r) => r.id !== removedId);
    apply(after, shifts);
    expect(after.map((r) => `${r.id}:${r.set_index}`)).toEqual(["r1:1", "r3:2", "r4:3", "r5:4"]);
  });

  it("Undo moves them back up (highest first) and the removed row returns at its number", () => {
    const t = table();
    const { removedId, shifts } = takeOutWrites(t, 2);
    const after = t.filter((r) => r.id !== removedId);
    apply(after, shifts);
    apply(after, putBackWrites(shifts));
    after.push({ id: "r2", set_index: 2 });
    expect(after.sort((a, b) => a.set_index - b.set_index).map((r) => `${r.id}:${r.set_index}`)).toEqual(table().map((r) => `${r.id}:${r.set_index}`));
  });

  it("an empty set (nothing logged) removes nothing and still moves the later ones", () => {
    const t = [{ id: "a", set_index: 1 }, { id: "c", set_index: 3 }];
    const { removedId, shifts } = takeOutWrites(t, 2);
    expect(removedId).toBeNull();
    expect(shifts).toEqual([{ id: "c", from: 3, to: 2 }]);
  });
});

describe("the workout's progress counts a skipped set as nothing left to do", () => {
  beforeEach(() => clearSetSessions());
  const rows = [{ id: "squat", sets: 4 }, { id: "bench", sets: 3 }];
  const done = (row: string, n: number) => ({ row_id: row, set_index: n, completed_at: "2026-11-20T10:00:00Z", actual_reps: 5, actual_load: 100 });
  const results = [done("squat", 1), done("squat", 2), done("squat", 3), done("bench", 1), done("bench", 2), done("bench", 3)];

  it("set 4 of 4 not done: the workout isn't finished; skipped: it is (the review can open)", () => {
    expect(workoutSetProgress(rows, results).allDone).toBe(false);
    setSetSession("client:instance", "squat", { planned: 4, skipped: 1 });
    const progressRows = rowsWithSkips(rows, (id) => getSetSession("client:instance", id));
    expect(progressRows[0].sets).toBe(3);
    expect(workoutSetProgress(progressRows, results).allDone).toBe(true);
    // the rows themselves (the prescription) never change
    expect(rows[0].sets).toBe(4);
  });

  it("another workout's skips never apply", () => {
    setSetSession("client:other-instance", "squat", { planned: 4, skipped: 1 });
    expect(rowsWithSkips(rows, (id) => getSetSession("client:instance", id))).toBe(rows);
  });
});

describe("the swipe on a set or warm-up row", () => {
  it("a row's swipe is flat and quiet: one small word, red only for Delete, neutral for Skip", () => {
    const del = renderToStaticMarkup(createElement(SwipeToReveal, { enabled: true, variant: "row", actionLabel: "Delete set 5 of Squat", onAction() {}, children: createElement("span", null, "set") }));
    expect(del).toContain('data-swipe-variant="row"');
    expect(del).toContain('data-swipe-action="delete"');
    expect(del).toContain("bg-destructive");
    expect(del).not.toContain("rounded-[1.35rem]");
    expect(del).not.toContain("lucide-trash");
    // hidden and out of the tab order until swiped to
    expect(del).toContain('aria-hidden="true"');
    expect(del).toContain('tabindex="-1"');
    const skip = renderToStaticMarkup(createElement(SwipeToReveal, { enabled: true, variant: "row", actionText: "Skip", tone: "neutral", actionLabel: "Skip set 2 of Squat today", onAction() {}, children: createElement("span", null, "set") }));
    expect(skip).toContain('data-swipe-action="skip"');
    expect(skip).toContain("bg-secondary");
    expect(skip).not.toContain("bg-destructive");
  });

  it("a swipe that starts on a set is the set's, never its exercise card's", () => {
    const src = read("src/components/workout-day/swipe-to-reveal.tsx");
    expect(src).toContain('const owner = el?.closest?.("[data-swipe-root]");');
    expect(src).toContain("return !!owner && owner !== root;");
    // vertical scrolling stays native; typing in a box never starts a swipe
    expect(src).toContain("touch-pan-y");
    expect(src).toContain("if (el?.closest?.(NO_SIDE_SWIPE)) return true;");
  });

  it("every set row and warm-up row has it, and the card's ⋯ offers the same without a swipe", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain('actionText={removal === "skip" ? "Skip" : "Delete"}');
    expect(wdv).toContain("onAction={() => void takeOutSet(i + 1)}");
    expect(wdv).toContain('data-testid="card-skip-set"');
    expect(wdv).toContain('data-testid="card-delete-set"');
    // Undo, never a blocking confirm; a set's row comes back by id
    expect(wdv).not.toContain("window.confirm(`Remove set");
    expect(wdv).toContain('action: { label: "Undo", onClick: () => void putSetBack({ kind, setIndex, removed, shifted, previous }) },');
    expect(wdv).toContain("for (const s of putBackWrites(r.shifted)) {");
    // a skip never touches the prescription
    expect(wdv).toContain('if (kind === "delete") {\n        const { error } = await sb.from("pl_exercise_rows").update({ sets: next }).eq("id", row.id);');
    // the workout's progress reads the skips
    expect(wdv).toContain("const loggedProgress = useMemo(() => workoutSetProgress(progressRows, results as any[]), [progressRows, results]);");
    const warm = read("src/components/workout-day/final-warmup-input.tsx");
    expect(warm).toContain('variant="row"');
    expect(warm).toContain("actionLabel={saved ? `Delete warm-up ${label}` : \"Discard new warm-up\"}");
  });
});
