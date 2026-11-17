import { describe, expect, it } from "vitest";
import { summarizeCompleteness, type LoggedSetSpec, type RequiredRowSpec } from "@/lib/workout-completeness";
import { workoutSetProgress } from "@/lib/workout-set-progress";
import { planCheck } from "@/lib/workouts/plan-vs-actual";
import { computeWorkoutSummary } from "@/lib/workout-summary";

// Jared's Tuesday: two required exercises and an optional paused deadlift
// (pl_exercise_rows.is_optional). Skipping the deadlift is a recovery call,
// never missed work.
const required: RequiredRowSpec[] = [
  { rowId: "row", prescribedSets: 2, metricKind: "load_reps" },
  { rowId: "calf", prescribedSets: 1, metricKind: "load_reps" },
  { rowId: "pdl", prescribedSets: 1, metricKind: "load_reps", optional: true },
];
const set = (rowId: string, setIndex: number): LoggedSetSpec => ({ rowId, setIndex, reps: 8, loadKg: 60 });

describe("an optional exercise in the completion summary", () => {
  it("left out, the workout is still 100% logged and asks nothing", () => {
    const s = summarizeCompleteness(required, [set("row", 1), set("row", 2), set("calf", 1)]);
    expect(s.requiredSets).toBe(3);
    expect(s.loggingPercentage).toBe(100);
    expect(s.loggingQuality).toBe("complete");
    expect(s.completedWithMissingLogs).toBe(false);
    expect(s.skippedExercises).toBe(0);
  });

  it("done, its sets count like any other", () => {
    const s = summarizeCompleteness(required, [set("row", 1), set("row", 2), set("calf", 1), set("pdl", 1)]);
    expect(s.requiredSets).toBe(4);
    expect(s.loggedSets).toBe(4);
    expect(s.loggingPercentage).toBe(100);
  });

  it("a required exercise left out still counts against the workout", () => {
    const s = summarizeCompleteness(required, [set("row", 1), set("row", 2)]);
    expect(s.loggingPercentage).toBe(66.7);
    expect(s.completedWithMissingLogs).toBe(true);
  });

  it("cut short, an optional exercise never lowers the percentage", () => {
    const rows: RequiredRowSpec[] = [
      { rowId: "a", prescribedSets: 1, metricKind: "load_reps" },
      { rowId: "o", prescribedSets: 3, metricKind: "load_reps", optional: true },
    ];
    const s = summarizeCompleteness(rows, [set("a", 1), set("o", 1)]);
    expect(s.requiredSets).toBe(2);
    expect(s.loggingPercentage).toBe(100);
    expect(s.completedWithMissingLogs).toBe(false);
  });
});

const done = (row_id: string, set_index: number) => ({ row_id, set_index, completed_at: "2026-11-17T18:00:00Z", actual_reps: 8, actual_load: 60 });
const rows = [
  { id: "row", sets: 2 },
  { id: "calf", sets: 1 },
  { id: "pdl", sets: 1, is_optional: true },
];

describe("an optional exercise in the logger's progress (Focus bars, ring, finish review)", () => {
  it("left out, it never holds up 'every set logged'", () => {
    const p = workoutSetProgress(rows, [done("row", 1), done("row", 2), done("calf", 1)]);
    expect(p.allDone).toBe(true);
    expect(p.setsTotal).toBe(3);
    expect(p.exercisesTotal).toBe(2);
    expect(p.doneRowIds.has("pdl")).toBe(false); // not shown as done when it wasn't
  });

  it("done, it's a done exercise", () => {
    const p = workoutSetProgress(rows, [done("row", 1), done("row", 2), done("calf", 1), done("pdl", 1)]);
    expect(p.allDone).toBe(true);
    expect(p.exercisesTotal).toBe(3);
    expect(p.doneRowIds.has("pdl")).toBe(true);
  });

  it("the required work still has to be logged", () => {
    expect(workoutSetProgress(rows, [done("row", 1), done("pdl", 1)]).allDone).toBe(false);
  });
});

const planRow = (id: string, sets: number, extra: Record<string, unknown> = {}) => ({
  id, sets, reps_text: "8", rpe: "7", exercises: { name: id }, ...extra,
});
const result = (row_id: string, set_index: number) => ({
  row_id, set_index, actual_reps: 8, actual_rpe: 7, completed_at: "2026-11-17T18:00:00Z",
});

describe("an optional exercise in the recap", () => {
  it("left out, the plan check reads done as planned, nothing 'not logged'", () => {
    const c = planCheck([planRow("row", 2), planRow("pdl", 1, { is_optional: true })], [result("row", 1), result("row", 2)]);
    expect(c.notLogged).toBe(0);
    expect(c.asPlanned).toBe(true);
    expect(c.setsPlanned).toBe(2);
  });

  it("cut short, it's never 'fewer sets'", () => {
    const c = planCheck([planRow("row", 1), planRow("pdl", 3, { is_optional: true })], [result("row", 1), result("pdl", 1)]);
    expect(c.lines.find((l) => l.kind === "fewer")).toBeUndefined();
    expect(c.asPlanned).toBe(true);
  });

  it("the summary never lists it as missed or counts its sets as prescribed", () => {
    const summaryRows = [
      { id: "row", sets: 2, exercises: { name: "Row" } },
      { id: "pdl", sets: 1, is_optional: true, exercises: { name: "Paused Deadlift" } },
    ];
    const res = [1, 2].map((i) => ({
      row_id: "row", set_index: i, actual_load: 60, actual_reps: 8, actual_load_unit: "kg" as const, actual_rpe: 7, completed_at: "2026-11-17T18:00:00Z",
    }));
    const s = computeWorkoutSummary(summaryRows, res, { displayUnit: "kg" });
    expect(s.missedExercises).toEqual([]);
    expect(s.prescribedSets).toBe(2);
    expect(s.completionPct).toBe(100);
    expect(s.exercisesTotal).toBe(1);
  });
});
