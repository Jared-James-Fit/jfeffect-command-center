import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  selectExerciseNoteHistory,
  noteContextLabel,
} from "@/lib/exercise-note-history";

const note = (over: Partial<any>): any => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  exercise_id: over.exercise_id ?? "ex-1",
  exercise_name: over.exercise_name ?? "Barbell Bench Press",
  content: over.content ?? "Felt strong",
  status: over.status ?? "new",
  created_at: over.created_at ?? "2026-08-01T10:00:00Z",
  updated_at: over.updated_at ?? "2026-08-01T10:00:00Z",
  day_id: over.day_id ?? "day-1",
  pl_days: over.pl_days ?? null,
});

describe("selectExerciseNoteHistory", () => {
  it("matches by canonical exercise_id when available", () => {
    const rows = [
      note({ id: "a", exercise_id: "ex-1" }),
      note({ id: "b", exercise_id: "ex-2", exercise_name: "Barbell Bench Press" }),
    ];
    const out = selectExerciseNoteHistory(rows, { exerciseId: "ex-1", exerciseName: "Barbell Bench Press" });
    expect(out.map((n: any) => n.id)).toEqual(["a"]);
  });

  it("falls back to exact name matching only when no exercise_id is given", () => {
    const rows = [
      note({ id: "a", exercise_id: null, exercise_name: "barbell bench press" }),
      note({ id: "b", exercise_id: null, exercise_name: "Close-Grip Bench Press" }),
    ];
    const out = selectExerciseNoteHistory(rows, { exerciseId: null, exerciseName: "Barbell Bench Press" });
    expect(out.map((n: any) => n.id)).toEqual(["a"]);
  });

  it("never fuzzy-merges similar exercise names", () => {
    const rows = [
      note({ id: "a", exercise_id: null, exercise_name: "Bench Press" }),
      note({ id: "b", exercise_id: null, exercise_name: "Bench Press Close Grip" }),
    ];
    const out = selectExerciseNoteHistory(rows, { exerciseId: null, exerciseName: "Bench Press" });
    expect(out).toHaveLength(1);
  });

  it("sorts newest first", () => {
    const rows = [
      note({ id: "old", updated_at: "2026-07-01T10:00:00Z" }),
      note({ id: "new", updated_at: "2026-08-17T10:00:00Z" }),
      note({ id: "mid", updated_at: "2026-08-09T10:00:00Z" }),
    ];
    const out = selectExerciseNoteHistory(rows, { exerciseId: "ex-1" });
    expect(out.map((n: any) => n.id)).toEqual(["new", "mid", "old"]);
  });

  it("excludes the current day's note (the editable one) from history", () => {
    const rows = [
      note({ id: "current", day_id: "day-today", updated_at: "2026-08-26T10:00:00Z" }),
      note({ id: "past", day_id: "day-last-week", updated_at: "2026-08-17T10:00:00Z" }),
    ];
    const out = selectExerciseNoteHistory(rows, {
      exerciseId: "ex-1",
      excludeNoteId: "current",
      excludeDayId: "day-today",
    });
    expect(out.map((n: any) => n.id)).toEqual(["past"]);
  });

  it("respects the limit", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      note({ id: `n${i}`, updated_at: `2026-08-${String(i + 1).padStart(2, "0")}T10:00:00Z` }),
    );
    expect(selectExerciseNoteHistory(rows, { exerciseId: "ex-1", limit: 20 })).toHaveLength(20);
  });

  it("returns a clean empty array when there is no history", () => {
    expect(selectExerciseNoteHistory([], { exerciseId: "ex-1" })).toEqual([]);
    expect(selectExerciseNoteHistory(null, { exerciseId: "ex-1" })).toEqual([]);
  });
});

describe("noteContextLabel", () => {
  it("builds block · week · day context", () => {
    const n = note({
      pl_days: { title: "Lower Strength", day_index: 2, pl_weeks: { week_index: 4, pl_blocks: { name: "Block 3" } } },
    });
    expect(noteContextLabel(n)).toBe("Block 3 · Week 4 · Lower Strength");
  });
  it("falls back to Day N when title is missing, and omits missing parts", () => {
    expect(noteContextLabel(note({ pl_days: { day_index: 1 } }))).toBe("Day 1");
    expect(noteContextLabel(note({ pl_days: null }))).toBe("");
  });
});

describe("notes sheet contract", () => {
  const src = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

  it("lazy-loads history only when the sheet is open (no workout-render N+1)", () => {
    expect(src).toContain('queryKey: ["exercise-note-history"');
    expect(src).toContain("enabled: open && !!clientId");
  });

  it("history is keyed by canonical exercise identity", () => {
    expect(src).toContain('q.eq("exercise_id", exerciseId)');
  });

  it("applies the keyboard-aware class so Save Note stays above the iOS keyboard", () => {
    expect(src).toContain("keyboard-aware-bottom-sheet");
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain('html[data-keyboard-open="true"] .keyboard-aware-bottom-sheet');
    expect(css).toContain("--vv-h");
  });

  it("save invalidates the history cache so saved notes appear in history", () => {
    expect(src).toContain('qc.invalidateQueries({ queryKey: ["exercise-note-history", clientId] })');
  });

  it("opening Notes performs no workout lifecycle writes", () => {
    // The history query is a read-only select on pl_exercise_notes; the only
    // mutation paths are behind the explicit Save button (existing behavior).
    const sheet = src.slice(src.indexOf("function ExerciseNotesSheet"), src.indexOf("function SetRow"));
    expect(sheet).not.toContain("startWorkoutFn");
    expect(sheet).not.toContain("completeWorkoutFn");
    expect(sheet).not.toContain("pl_day_completions");
  });
});
