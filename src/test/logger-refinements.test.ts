import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { percentDetached, withLivePercent } = await import("@/lib/workouts/backoff-basis");
const { recentExerciseIds } = await import("@/components/workout-day/workout-add-exercise");
const { liftHistoryFromRows } = await import("@/lib/analytics/exercise-progress");
const { TypedValueInput } = await import("@/components/workout-day/typed-value-input");

const read = (p: string) => readFileSync(p, "utf8");

describe("a back-off's % only follows a top set of the same exercise", () => {
  const top = { id: "t", exercise_id: "squat", percentage_basis: null };
  const back = { id: "b", exercise_id: "squat", percentage_basis: "top_set", percentage: 92.5, basis_row_id: "t" };
  it("same exercise: the % stands", () => {
    expect(percentDetached(back, [top, back])).toBe(false);
    expect(withLivePercent(back, [top, back])).toBe(back);
  });
  it("the top set swapped to another lift (or the back-off swapped): plain RPE, never another lift's weight", () => {
    const swappedTop = { ...top, exercise_id: "pause-squat" };
    expect(percentDetached(back, [swappedTop, back])).toBe(true);
    expect(withLivePercent(back, [swappedTop, back])).toMatchObject({ percentage: null, percentage_basis: null, basis_row_id: null });
    expect(percentDetached({ ...back, exercise_id: "leg-press" }, [top, back])).toBe(true);
  });
  it("a % of a max, or a back-off with no link, is left alone", () => {
    expect(percentDetached({ id: "x", exercise_id: "hb", percentage_basis: "training_max" }, [])).toBe(false);
    expect(percentDetached({ ...back, basis_row_id: null }, [top])).toBe(false);
    expect(percentDetached(back, [])).toBe(false);
  });
  it("custom-named rows compare by name", () => {
    const t = { id: "t", exercise_name_override: "Box Squat", percentage_basis: null };
    const b = { id: "b", exercise_name_override: "box squat ", percentage_basis: "top_set", basis_row_id: "t" };
    expect(percentDetached(b, [t, b])).toBe(false);
  });
  it("the logger reads every row through it", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("withLivePercent(r, rows as any[])");
    expect(wdv).toContain("row={viewRows.get(r.id) ?? r}");
  });
});

describe("add an exercise: recent first, then muscle groups", () => {
  it("recent is the exercises last logged, newest first, each once", () => {
    const rows = [
      { pl_exercise_rows: { exercise_id: "a" } },
      { pl_exercise_rows: { exercise_id: "b" } },
      { pl_exercise_rows: { exercise_id: "a" } },
      { pl_exercise_rows: null },
      { pl_exercise_rows: { exercise_id: "c" } },
    ];
    expect(recentExerciseIds(rows)).toEqual(["a", "b", "c"]);
    expect(recentExerciseIds(rows, 2)).toEqual(["a", "b"]);
  });
  it("the sheet opens on Recent, with muscle chips from the library", () => {
    const src = read("src/components/workout-day/workout-add-exercise.tsx");
    expect(src).toContain("const chip = group ?? (recent.length ? RECENT : null);");
    expect(src).toContain("topMuscleGroups(library, 8)");
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("clientId={client?.id ?? null}");
  });
});

describe("History & progress: the Analytics lift card, for one exercise", () => {
  const set = (id: string, date: string, kg: number, reps: number, rpe: number | null, extra: Record<string, unknown> = {}) => ({
    id, completed_at: date, actual_reps: reps, actual_rpe_num: rpe, normalized_kg: kg, normalized_lb: kg * 2.2046226218, load_type: "external",
    set_index: 1, pl_exercise_rows: { id: `row-${date}`, pl_days: { id: `day-${date}` } }, ...extra,
  });
  it("loads in lb, an Epley e1RM per set, oldest first, only completed loaded sets", () => {
    const h = liftHistoryFromRows([
      set("2", "2026-11-09T18:00:00Z", 192.5, 4, 7),
      set("1", "2026-11-02T18:00:00Z", 185, 4, 6),
      set("3", "2026-11-09T18:05:00Z", 0, 4, 6),
      set("4", "2026-11-09T18:06:00Z", 50, 8, 7, { load_type: "assisted" }),
      { ...set("5", "2026-11-09T18:07:00Z", 100, 5, 7), completed_at: null },
    ], "Competition Squat")!;
    expect(h.name).toBe("Competition Squat");
    expect(h.points.map((p) => p.id)).toEqual(["1", "2"]);
    expect(h.points[1].load).toBeCloseTo(192.5 * 2.2046226218, 3);
    expect(h.points[1].est_1rm).toBeCloseTo(Math.round(192.5 * 2.2046226218 * (1 + 4 / 30) * 10) / 10, 1);
    expect(h.points[1].rpe).toBe(7);
    expect(h.pr?.id).toBe("2");
  });
  it("nothing loaded: no card", () => {
    expect(liftHistoryFromRows([], "Plank")).toBeNull();
  });
  it("the sheet shows it in single mode above the days, and the card's entry is Last time", () => {
    const sheet = read("src/components/exercise-history-sheet.tsx");
    expect(sheet).toContain("<LiftProgressCard");
    expect(sheet).toContain("single");
    const card = read("src/components/analytics/lift-progress-card.tsx");
    expect(card).toContain("{!single && (");
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("Open history and progress");
    expect(wdv).toContain("History & progress");
  });
});

describe("what's planned reads faded until it's logged", () => {
  it("a prescribed reps / RPE value is faded and says it's planned", () => {
    const html = renderToStaticMarkup(createElement(TypedValueInput, { value: "4", kind: "reps", onCommit: () => {}, ariaLabel: "Set 1 reps", planned: true }));
    expect(html).toContain("text-muted-foreground/80");
    expect(html).toContain("Set 1 reps, planned 4");
    expect(html).toContain("data-planned");
    const logged = renderToStaticMarkup(createElement(TypedValueInput, { value: "4", kind: "reps", onCommit: () => {}, ariaLabel: "Set 1 reps" }));
    expect(logged).toContain("text-foreground");
    expect(logged).not.toContain("data-planned");
  });
  it("a set's reps and RPE are planned until the set is logged or typed", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("planned={!isConfirmed && !repsEdited}");
    expect(wdv).toContain("planned={!isConfirmed && !rpeEdited}");
  });
});

describe("swap: one tap, and logged sets never change exercise", () => {
  it("the server never moves a row that has sets on it", () => {
    const fn = read("src/lib/quick-swap.functions.ts");
    expect(fn).toContain("if (todayLogged && data.scope === \"today\") throw new Error(SWAP_LOGGED_MESSAGE);");
    expect(fn).toContain("const ids = todayLogged ? [] : [ctx.rowId];");
    // upcoming workouts already started keep theirs too
    expect(fn).toContain("if (logged.has(r.id)) continue;");
  });
  it("the last step is one tap: today, or today and the rest of the block; logged sets turn today into an add", () => {
    const sheet = read("src/components/workout-day/QuickSwapButton.tsx");
    expect(sheet).toContain("data-swap-today");
    expect(sheet).toContain("data-swap-future");
    expect(sheet).toContain("data-swap-add-instead");
    expect(sheet).not.toContain("RadioGroup");
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("loggedSets={existingResults.length}");
    expect(wdv).toContain("onAddAfter={canEditWorkoutStructure && !readonly ? (exercise) => addExerciseNow(exercise, rowIndex + 1) : undefined}");
  });
});

describe("one red per screen", () => {
  it("the rest timer, Fill All and the suggestion line are neutral", () => {
    expect(read("src/components/workout-day/RestTimerButton.tsx")).not.toContain("bg-primary/20 text-primary");
    expect(read("src/components/workout-day/WorkoutDayView.tsx")).not.toContain("border-primary/30 text-primary");
    const card = read("src/components/workout-day/load-suggestion-card.tsx");
    expect(card).not.toContain("border-primary/25 bg-primary/5");
  });
});

describe("a weight the plan filled in reads as the plan", () => {
  it("faded, and the set isn't a draft until it's logged or changed", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("const loadIsPlanned = !isConfirmed && !bw && load !== \"\" && plannedFillRef.current != null && load === plannedFillRef.current;");
    expect(wdv).toContain("const hasAnyEntry = (load.length > 0 && !loadIsPlanned) ||");
    expect(wdv).toContain("planned={loadIsPlanned}");
    expect(read("src/components/workout-day/weight-value-input.tsx")).toContain('planned ? "text-muted-foreground/80" : "text-foreground"');
  });
});

describe("picking an exercise is one tap on it, and the sheets stay neutral", () => {
  it("a swap result picks from its whole row; Use, the filter chips and Add carry no red", () => {
    const sheet = read("src/components/workout-day/QuickSwapButton.tsx");
    expect(sheet).toContain("data-swap-pick={ex.id}");
    expect(sheet).not.toContain('"border-primary bg-primary text-primary-foreground"');
    expect(sheet).toContain('variant="secondary" className="h-8 px-2.5 text-xs" onClick={onSelect}');
    const add = read("src/components/workout-day/workout-add-exercise.tsx");
    expect(add).not.toContain("text-primary");
  });
});
