import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cardioLast, focusPlaceLabel, isPlanCardioRow, liftAndCardioProgress, liftCount } from "@/lib/workouts/workout-cardio";

const read = (p: string) => readFileSync(p, "utf8");
const day = read("src/components/workout-day/WorkoutDayView.tsx");
const story = read("src/components/workout-day/workout-story.tsx");

const squat = { id: "a" };
const bench = { id: "b" };
const walk = { id: "w", cardio_target_id: "t1" };
const rdl = { id: "c" };

describe("the day's cardio is its own part of the workout, after the lifting", () => {
  it("only a row linked to the cardio plan is the day's cardio; a program's own timed rows are exercises", () => {
    expect(isPlanCardioRow(walk)).toBe(true);
    expect(isPlanCardioRow({ id: "run", cardio_target_id: null })).toBe(false);
    expect(isPlanCardioRow(squat)).toBe(false);
    expect(isPlanCardioRow(null)).toBe(false);
  });

  it("puts the cardio last and keeps the lifts in their own order", () => {
    expect(cardioLast([squat, walk, bench, rdl]).map((r) => r.id)).toEqual(["a", "b", "c", "w"]);
    expect(liftCount([squat, walk, bench, rdl])).toBe(3);
  });

  it("hands the same array back when nothing moves, so memos hold", () => {
    const rows = [squat, bench, walk];
    expect(cardioLast(rows)).toBe(rows);
    const none = [squat, bench];
    expect(cardioLast(none)).toBe(none);
  });

  it("Focus says Exercise N of the lifts, then Cardio", () => {
    expect(focusPlaceLabel(0, 4, 3)).toBe("Exercise 1 of 3");
    expect(focusPlaceLabel(2, 4, 3)).toBe("Exercise 3 of 3");
    expect(focusPlaceLabel(3, 4, 3)).toBe("Cardio");
    expect(focusPlaceLabel(3, 5, 3)).toBe("Cardio 1 of 2");
    expect(focusPlaceLabel(4, 5, 3)).toBe("Cardio 2 of 2");
    // no cardio: just the exercises, as before
    expect(focusPlaceLabel(1, 3, 3)).toBe("Exercise 2 of 3");
  });

  it("the progress counts the lifts apart from the cardio", () => {
    const rows = [squat, bench, rdl, walk];
    const open = liftAndCardioProgress(rows, new Set(["a"]));
    expect(open).toEqual({ liftsDone: 1, liftsTotal: 3, cardioTotal: 1, cardioDone: false });
    const done = liftAndCardioProgress(rows, new Set(["a", "b", "c", "w"]));
    expect(done).toEqual({ liftsDone: 3, liftsTotal: 3, cardioTotal: 1, cardioDone: true });
    // a skipped exercise isn't counted; a day with no cardio has none
    expect(liftAndCardioProgress([squat, { id: "s", skipped: true }], new Set())).toEqual({ liftsDone: 0, liftsTotal: 1, cardioTotal: 0, cardioDone: false });
  });
});

describe("the logger shows the cardio under its own heading", () => {
  it("orders the rows once, cardio last", () => {
    expect(day).toContain("const rows = useMemo(() => (rawRows ? cardioLast(rawRows as any[]) : NO_ROWS), [rawRows]);");
    expect(day).toContain("const liftRows = useMemo(() => liftCount(rows as any[]), [rows]);");
  });

  it("a Cardio heading before the first cardio card in the list; Focus says it in its top bar", () => {
    expect(day).toContain("{cardioRow && rowIndex === liftRows && !storyOpen && (");
    expect(day).toContain("data-cardio-section");
    expect(day).toContain(">Cardio</h2>");
    expect(day).toContain("aria-label={storyOpen ? focusPlaceLabel(rowIndex, (rows as any[]).length, liftRows) : undefined}");
    expect(day).toContain("cardioFrom={liftRows}");
    expect(story).toContain("{focusPlaceLabel(index, count, cardioFrom ?? count)}");
    // the card's own line only in Focus, neutral (green is for done)
    expect(day).toContain("{(row as any).cardio_target_id && focusMode && (");
    expect(day).not.toContain("text-emerald-600 dark:text-emerald-400\" data-cardio-plan-row");
  });

  it("moves and new exercises stay with the lifting; the cardio never moves", () => {
    expect(day).toContain("if (from < 0 || to < 0 || to >= liftRows || from >= liftRows) return;");
    expect(day).toContain("const to = Math.max(0, Math.min(liftRows - 1, position - 1));");
    expect(day).toContain("canMoveUp={canEditWorkoutStructure && !cardioRow && rowIndex > 0}");
    expect(day).toContain("canMoveDown={canEditWorkoutStructure && !cardioRow && rowIndex < liftRows - 1}");
    expect(day).toContain("moveCount={canEditWorkoutStructure && !cardioRow ? liftRows : undefined}");
    expect(day).toContain("insertAt = liftRows,");
    expect(day).toContain("{canEditWorkoutStructure && !storyOpen && !cardioRow && (");
  });

  it("the progress pill counts the lifts, with the cardio as a heart beside them", () => {
    expect(day).toContain("const liftProgress = liftAndCardioProgress(rows as any[], statusSummary.doneRowIds);");
    expect(day).toContain("{progressPct}% · {liftProgress.liftsDone}/{liftProgress.liftsTotal}");
    expect(day).toContain('data-progress-cardio={liftProgress.cardioDone ? "done" : "open"}');
  });
});
