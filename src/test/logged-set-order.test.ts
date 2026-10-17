import { describe, expect, it } from "vitest";
import { inWorkoutOrder } from "@/lib/logged-set-order";
import { findPrEvents } from "@/lib/coach-intel";
import { liftProgress, orderBlockSets, type SetRow } from "@/lib/block-analytics";
import { recentPRs } from "@/lib/pl-programs";
import { latestSessionTop } from "@/components/progress-comparison";

// Fill-down saves a workout's sets at the same instant, and the writes land in
// any order: save time must never decide set order or "which came first".
const HOUR = 3_600_000;
const ago = (hours: number, ms = 0) => new Date(Date.now() - hours * HOUR + ms).toISOString();

describe("inWorkoutOrder", () => {
  const place = (s: { day: string | null; at: string; row: string; order: number; set: number }) => ({
    workout: s.day, at: s.at, rowOrder: s.order, rowId: s.row, setIndex: s.set,
  });
  it("workouts by when they started, then the row's place, then the set number", () => {
    const saved = [
      { day: "today", at: ago(1, 30), row: "bench", order: 1, set: 2 },
      { day: "today", at: ago(1, 10), row: "bench", order: 1, set: 3 },
      { day: "last-week", at: ago(170), row: "squat", order: 0, set: 1 },
      { day: "today", at: ago(1, 20), row: "bench", order: 1, set: 1 },
      { day: "today", at: ago(1, 40), row: "squat", order: 0, set: 1 },
    ];
    expect(inWorkoutOrder(saved, place).map((s) => `${s.day}:${s.row}:${s.set}`)).toEqual([
      "last-week:squat:1", "today:squat:1", "today:bench:1", "today:bench:2", "today:bench:3",
    ]);
  });
  it("the same lift on two rows keeps each row's sets together", () => {
    const at = ago(1);
    const saved = [
      { day: "d", at, row: "backoff", order: 3, set: 1 },
      { day: "d", at, row: "top", order: 0, set: 2 },
      { day: "d", at, row: "backoff", order: 3, set: 2 },
      { day: "d", at, row: "top", order: 0, set: 1 },
    ];
    expect(inWorkoutOrder(saved, place).map((s) => `${s.row}:${s.set}`)).toEqual(["top:1", "top:2", "backoff:1", "backoff:2"]);
  });
});

describe("Training Intel PRs (coach-intel)", () => {
  const set = (id: string, day: string, set_index: number, kg: number, at: string) => ({
    id, client_id: "c1", row_id: `bench-${day}`, set_index, actual_load: kg, actual_reps: 1, normalized_kg: kg,
    load_type: "external", completed_at: at,
    pl_exercise_rows: { day_id: day, sort_order: 0, exercises: { name: "Bench Press" } },
  });
  it("raises the running best set by set, never save by save, newest first", () => {
    // sets 1-3 of today saved 3, 2, 1: by save time set 3 (105) would be the PR
    const results = [
      set("s3", "today", 3, 108, ago(1, 0)),
      set("s2", "today", 2, 110, ago(1, 5)),
      set("s1", "today", 1, 105, ago(1, 9)),
    ];
    const prs = findPrEvents("c1", results, new Map([["c1::Bench Press", 100]]));
    expect(prs.map((p) => [p.result_id, p.baseline])).toEqual([["s2", 105], ["s1", 100]]);
  });
  it("an earlier workout's PR raises the bar for the next one", () => {
    const results = [set("b", "today", 1, 115, ago(1)), set("a", "yesterday", 1, 110, ago(25))];
    const prs = findPrEvents("c1", results, new Map([["c1::Bench Press", 100]]));
    expect(prs.map((p) => [p.result_id, p.baseline])).toEqual([["b", 110], ["a", 100]]);
  });
});

describe("block analytics", () => {
  const row = (over: Partial<SetRow>): SetRow => ({
    id: "x", row_id: "bench", exercise_id: "bench", exercise_name: "Bench Press", category: null,
    day_id: "d1", week_id: "w1", week_index: 1, day_index: 1, day_title: null, block_id: "b",
    row_order: 0, set_index: 1, weight: 100, reps: 1, rpe: null, completed: true, date: ago(48),
    ...over,
  });
  it("lists sets by workout, then row, then set number (the CSV's Sets rows)", () => {
    const sets = orderBlockSets([
      row({ id: "d2-bench-2", day_id: "d2", set_index: 2, date: ago(1, 0) }),
      row({ id: "d1-curl-1", day_id: "d1", row_id: "curl", row_order: 1, date: ago(48, 0) }),
      row({ id: "d2-bench-1", day_id: "d2", set_index: 1, date: ago(1, 9) }),
      row({ id: "d1-bench-1", day_id: "d1", date: ago(48, 9) }),
    ]);
    expect(sets.map((s) => s.id)).toEqual(["d1-bench-1", "d1-curl-1", "d2-bench-1", "d2-bench-2"]);
  });
  it("improvement is first session's best e1RM to last session's best, not one set to another", () => {
    // by save time: first saved 110, last saved 105 (a "-5"); session bests are 110 then 120
    const sets = orderBlockSets([
      row({ day_id: "d1", set_index: 2, weight: 110, date: ago(48, 0) }),
      row({ day_id: "d1", set_index: 1, weight: 100, date: ago(48, 9) }),
      row({ day_id: "d2", set_index: 1, weight: 120, date: ago(1, 0) }),
      row({ day_id: "d2", set_index: 2, weight: 105, date: ago(1, 9) }),
    ]);
    expect(liftProgress(sets)).toEqual([{ name: "Bench Press", delta: 10 }]);
  });
});

describe("recentPRs (pl-programs)", () => {
  const set = (id: string, day: string, set_index: number, lb: number, date: string) => ({
    id, day_id: day, row_id: `bench-${day}`, row_order: 0, set_index, date, load: lb, reps: 1, est_1rm: lb,
    exercise_id: "bench", exercise_name: "Bench Press", load_type: "external",
  });
  it("earlier means an earlier workout or an earlier set in it, never an earlier save", () => {
    const results = [
      set("old", "last-week", 1, 100, ago(170)),
      set("s3", "today", 3, 108, ago(1, 0)),
      set("s2", "today", 2, 110, ago(1, 5)),
      set("s1", "today", 1, 105, ago(1, 9)),
    ];
    expect(recentPRs(results, 30).map((p) => [p.id, p.prior_est])).toEqual([["s2", 105], ["s1", 100]]);
  });
  it("sets saved at the same instant are still one after another", () => {
    const at = ago(1);
    const results = [set("old", "last-week", 1, 100, ago(170)), set("s2", "today", 2, 104, at), set("s1", "today", 1, 103, at)];
    expect(recentPRs(results, 30).map((p) => p.id)).toEqual(["s2", "s1"]);
    // s1 at 105 makes s2 (104) no PR, whichever saved first
    const higher = [results[0], results[1], set("s1", "today", 1, 105, at)];
    expect(recentPRs(higher, 30).map((p) => p.id)).toEqual(["s1"]);
  });
});

describe("Compare blocks: latest session", () => {
  it("shows the last workout's top set, not whichever set saved last", () => {
    const rows = [
      { id: "old", day_id: "d1", sort_order: 0 },
      { id: "top", day_id: "d2", sort_order: 0 },
      { id: "backoff", day_id: "d2", sort_order: 1 },
    ];
    const res = (row_id: string, set_index: number, load: number, reps: number, completed_at: string) => ({
      row_id, set_index, actual_load: load, actual_load_unit: "lb", actual_reps: reps, actual_rpe: null, notes: null, completed_at,
    });
    const results = [
      res("old", 1, 315, 3, ago(170)),
      res("top", 2, 300, 3, ago(1, 0)),
      res("top", 1, 300, 3, ago(1, 5)),
      res("backoff", 1, 250, 8, ago(1, 9)),
    ];
    const top = latestSessionTop(results, rows);
    expect([top?.row_id, top?.set_index]).toEqual(["top", 1]);
  });
});
