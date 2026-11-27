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

  it("the progress pill counts the lifts, with the cardio as a pulse line beside them (never a heart, which read as a favourite)", () => {
    expect(day).toContain("const liftProgress = liftAndCardioProgress(rows as any[], statusSummary.doneRowIds);");
    expect(day).toContain("{liftProgress.liftsDone}/{liftProgress.liftsTotal}");
    expect(day).toContain('data-progress-cardio={liftProgress.cardioDone ? "done" : "open"}');
    const pill = day.slice(day.indexOf('data-testid="workout-progress"'), day.indexOf("subtitle={"));
    expect(pill).toContain("<Activity ");
    expect(pill).not.toContain("<Heart ");
  });
});

describe("cardio is done when it suits them: before, during, after or later that day", () => {
  it("logging it never starts the workout, its clock or in progress", () => {
    expect(day).toContain("onChange={cardioRow ? refreshCardio : refresh}");
    expect(day).toContain("startsWorkout={!cardioRow}");
    // every place a set starts the session clock checks it; the one left is the page's own (refresh's, the lifts')
    const unguarded = day.split("\n").filter((l) => l.includes("beginWorkoutSession(") && !l.includes("startsWorkout") && !l.includes("import"));
    expect(unguarded).toEqual(["    beginWorkoutSession(dayId);"]);
    const refreshCardioBody = day.slice(day.indexOf("const refreshCardio = () => {"), day.indexOf("};", day.indexOf("const refreshCardio = () => {")));
    expect(refreshCardioBody).not.toContain("markInProgress");
    expect(refreshCardioBody).not.toContain("beginSessionOnAction");
  });

  it("the review pops after prescribed lifting independently of plan cardio", () => {
    // plan cardio is independent of the workout review
    expect(day).toContain("const autoFinishReady = liftLogged.allDone;");
    expect(day).toContain("allDone: autoFinishReady,");
    expect(day).toContain("const reviewReady = liftLogged.allDone;");
    expect(day).toContain("review: reviewReady,");
    expect(day).toContain("{reviewReady ? (");
    expect(day).toContain("Your cardio plan · now or later today");
    expect(day).toContain("setsDone: liftLogged.setsDone,");
    expect(day).toContain(".filter((r: any) => !r?.skipped && !isPlanCardioRow(r))");
    // Finish's required sets leave the plan's cardio out (the shared reading the re-sync uses too)
    expect(day).toContain("requiredRowsFromExerciseRows(rows as any[])");
    expect(readFileSync("src/lib/workout-completeness.ts", "utf8")).toContain(".filter((r) => !r?.cardio_target_id)");
  });

  it("shows one optional cardio reminder beside Done, only on the immediate completion recap", () => {
    const recap = read("src/components/workout-submission-summary.tsx");
    expect(day).toContain('cardioTakeaway?.status === "logged" || cardioTakeaway?.status === "skipped"');
    expect(day).toContain("isPlanCardioRow(r) && !r.skipped && !cardioRowDone(r.id, results as any[])");
    expect(day).toContain("onLogCardio={recapFromSubmitRef.current && pendingCardioRow");
    expect(recap).toContain("{cardio && !onLogCardio && (");
    expect(recap).toContain("{onLogCardio && (");
    expect(recap.indexOf("data-recap-cardio-reminder")).toBeLessThan(recap.indexOf("data-recap-done"));
    expect(recap).toContain("onClick={onLogCardio}>Log cardio</Button>");
    expect(recap).toContain("onClick={close} data-recap-done");
  });

  it("the recap and Vs the plan never call cardio not done yet 'missed'; logged, it counts", async () => {
    const { computeWorkoutSummary } = await import("@/lib/workout-summary");
    const rows = [
      { id: "a", sets: 1, exercises: { name: "Squat" } },
      { id: "w", sets: 1, cardio_target_id: "t", exercises: { name: "Treadmill Walk" } },
    ];
    const squat = { row_id: "a", actual_load: 100, actual_reps: 5, actual_load_unit: "kg" as const, actual_rpe: 8, completed_at: "2026-11-17T18:00:00Z" };
    const before = computeWorkoutSummary(rows as any, [squat] as any, { displayUnit: "kg" });
    expect(before.missedExercises).toEqual([]);
    expect(before.completionPct).toBe(100);
    expect(before.plan?.notLogged).toBe(0);
    const walk = { row_id: "w", actual_load: null, actual_reps: null, actual_load_unit: null, actual_rpe: 5, completed_at: "2026-11-17T18:30:00Z", completed_duration_seconds: 600 };
    const after = computeWorkoutSummary(rows as any, [squat, walk] as any, { displayUnit: "kg" });
    expect(after.exercisesCompleted).toBe(2);
  });

  it("the Workouts page: cardio is its own line on the day card, and never makes the workout in progress", () => {
    const programs = read("src/lib/pl-programs.ts");
    expect(programs).toContain("cardio_target_id, duration_seconds");
    expect(programs).toContain("if (cardioRowIds.has(String(rr.row_id))) {");
    expect(programs).toContain("const lifts = (rowsByDay.get(dayId) ?? []).filter((r: any) => !isPlanCardioRow(r));");
    const card = read("src/components/workouts/WorkoutsExperience.tsx");
    expect(card).toContain('data-day-cardio={cardioDone ? "done" : "open"}');
    expect(card).toContain("search={{ focus: item.cardio.rowId,");
    expect(day).toContain("Before, after or later in the day");
  });
});
