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

describe("the plan's reps and RPE are filled in, ready to log with just a weight", () => {
  it("a reps / RPE box shows its value at full strength, never faded or labelled planned", () => {
    const html = renderToStaticMarkup(createElement(TypedValueInput, { value: "5", kind: "reps", onCommit: () => {}, ariaLabel: "Set 2 reps" }));
    expect(html).toContain("text-foreground");
    expect(html).not.toContain("text-muted-foreground/80");
    expect(html).not.toContain("data-planned");
    expect(html).toContain('aria-label="Set 2 reps"');
    const typed = read("src/components/workout-day/typed-value-input.tsx");
    expect(typed).not.toContain("planned");
  });
  it("every open set starts with the prescription's reps and RPE, and a set holding only them is never a draft", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("const [reps, setReps] = useState(existing?.actual_reps?.toString() ?? prescribedRepsStr);");
    expect(wdv).toContain("(existing?.actual_rpe ?? prescribedRpeStr)");
    expect(wdv).not.toContain("planned={!isConfirmed");
    expect(wdv).toContain("const hasAnyEntry = load.length > 0 || bw || repsOwn || rpeOwn");
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

describe("an untouched set is empty until they act", () => {
  it("no weight is put in for them (the blue box), and a set holding only the plan isn't a draft", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("const hasAnyEntry = load.length > 0 || bw || repsOwn || rpeOwn || caloriesEdited || distanceEdited;");
    expect(wdv).not.toContain("loadIsPlanned");
    expect(read("src/components/workout-day/weight-value-input.tsx")).not.toContain("planned");
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
