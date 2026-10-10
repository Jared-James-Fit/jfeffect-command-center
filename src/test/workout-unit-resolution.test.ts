import { describe, expect, it } from "vitest";
import { resolveWorkoutRowUnits } from "@/lib/workout-unit-resolution";

const pausedBench = { id: "ex-pb", is_competition_lift: false, competition_lift_type: null, default_load_unit: null };

describe("one unit per exercise per workout", () => {
  // Jared McIntyre, Oct 2026: top set (no coach unit) + a backoff the coach
  // prescribed in kg, first time doing the lift (no preference, no history).
  const rows = [
    { id: "top", exercise_id: "ex-pb", exercises: pausedBench, load_unit: null },
    { id: "backoff", exercise_id: "ex-pb", exercises: pausedBench, load_unit: "kg" },
  ];

  it("gives the backoff the same unit as the top set (the bug: top=lb, backoff=kg)", () => {
    const units = resolveWorkoutRowUnits({ rows, prefRows: [], historyRows: [], overrides: {} });
    expect(units["row:top"]).toBe("lb");
    expect(units["row:backoff"]).toBe("lb");
  });

  it("follows the client's saved preference for every card of the exercise", () => {
    const units = resolveWorkoutRowUnits({
      rows, prefRows: [{ exercise_id: "ex-pb", unit: "kg" }], historyRows: [], overrides: {},
    });
    expect(units).toEqual({ "row:top": "kg", "row:backoff": "kg" });
  });

  it("a toggle on one card switches every card of that exercise", () => {
    const units = resolveWorkoutRowUnits({ rows, prefRows: [], historyRows: [], overrides: { "exercise:ex-pb": "kg" } });
    expect(units).toEqual({ "row:top": "kg", "row:backoff": "kg" });
  });

  it("uses recent history before the coach's row unit", () => {
    const units = resolveWorkoutRowUnits({
      rows: [...rows].reverse(),
      prefRows: [],
      historyRows: [
        { actual_load_unit: "lb", pl_exercise_rows: { exercise_id: "ex-pb" } },
        { actual_load_unit: "lb", pl_exercise_rows: { exercise_id: "ex-pb" } },
      ],
      overrides: {},
    });
    expect(units).toEqual({ "row:backoff": "lb", "row:top": "lb" });
  });

  it("different exercises still resolve independently", () => {
    const squat = { id: "ex-sq", competition_lift_type: "squat" };
    const units = resolveWorkoutRowUnits({
      rows: [...rows, { id: "sq", exercise_id: "ex-sq", exercises: squat, load_unit: null }],
      prefRows: [], historyRows: [], overrides: {},
    });
    expect(units["row:sq"]).toBe("kg");
    expect(units["row:top"]).toBe("lb");
  });
});

describe("a lift's first log opens in the unit the athlete uses for that lift", () => {
  // Hall of Strength, Oct 2026: lb squatters opened their first Competition
  // Squat in kg (the competition-lift default) and saved 305 lb as 305 kg.
  const compSquat = { id: "ex-csq", competition_lift_type: "squat", is_competition_lift: true, movement_family: "squat" };
  const tempoSquat = { id: "ex-tsq", competition_lift_type: null, movement_family: "squat" };
  const compBench = { id: "ex-cb", competition_lift_type: "bench", is_competition_lift: true, movement_family: "bench" };
  const log = (unit: string, family: string, load = 100) =>
    ({ actual_load_unit: unit, actual_load: load, pl_exercise_rows: { exercises: { movement_family: family } } });

  it("an lb squatter's first Competition Squat opens in lb, not the kg default", () => {
    const units = resolveWorkoutRowUnits({
      rows: [{ id: "sq", exercise_id: "ex-csq", exercises: compSquat, load_unit: null }],
      prefRows: [], historyRows: [],
      familyHistoryRows: [log("lb", "squat"), log("lb", "squat"), log("kg", "squat")],
      overrides: {},
    });
    expect(units["row:sq"]).toBe("lb");
  });

  it("the athlete's squat unit beats the coach's kg on a new variation (Shaina's tempo squat)", () => {
    const units = resolveWorkoutRowUnits({
      rows: [{ id: "t", exercise_id: "ex-tsq", exercises: tempoSquat, load_unit: "kg" }],
      prefRows: [], historyRows: [], familyHistoryRows: [log("lb", "squat")], overrides: {},
    });
    expect(units["row:t"]).toBe("lb");
  });

  it("each lift keeps its own habit: kg bench, lb squat", () => {
    const units = resolveWorkoutRowUnits({
      rows: [
        { id: "sq", exercise_id: "ex-csq", exercises: compSquat, load_unit: null },
        { id: "b", exercise_id: "ex-cb", exercises: compBench, load_unit: null },
      ],
      prefRows: [], historyRows: [],
      familyHistoryRows: [log("lb", "squat"), log("kg", "bench"), log("kg", "bench")],
      overrides: {},
    });
    expect(units).toEqual({ "row:sq": "lb", "row:b": "kg" });
  });

  it("the exercise's own history and saved preference still come first", () => {
    const rows = [{ id: "sq", exercise_id: "ex-csq", exercises: compSquat, load_unit: null }];
    const family = [log("lb", "squat"), log("lb", "squat")];
    expect(resolveWorkoutRowUnits({
      rows, prefRows: [], familyHistoryRows: family, overrides: {},
      historyRows: [{ actual_load_unit: "kg", pl_exercise_rows: { exercise_id: "ex-csq" } }],
    })["row:sq"]).toBe("kg");
    expect(resolveWorkoutRowUnits({
      rows, prefRows: [{ exercise_id: "ex-csq", unit: "kg" }], historyRows: [], familyHistoryRows: family, overrides: {},
    })["row:sq"]).toBe("kg");
  });

  it("machines and empty sets don't count, and no habit keeps the old default", () => {
    const rows = [{ id: "sq", exercise_id: "ex-csq", exercises: compSquat, load_unit: null }];
    const units = resolveWorkoutRowUnits({
      rows, prefRows: [], historyRows: [],
      familyHistoryRows: [log("lb", "accessory"), log("lb", "squat", 0), { actual_load_unit: "lb", pl_exercise_rows: null }],
      overrides: {},
    });
    expect(units["row:sq"]).toBe("kg");
  });
});

describe("a set is saved in the unit its number was typed in", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const view = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  const setRow = view.slice(view.indexOf("function SetRow({"));

  it("keeps the typed number and its unit as one pair", () => {
    expect(setRow).toContain('const [loadUnit, setLoadUnit] = useState<"kg" | "lb">(unit);');
    expect(setRow).toContain("unit: loadUnit, bw, loadType");
  });

  it("every save path persists the pair, never the card's current unit", () => {
    expect(setRow).not.toContain("persistedLoadForDisplayValue(load, unit, existing)");
    expect(setRow.match(/persistedLoadForDisplayValue\(load, loadUnit, existing\)/g)?.length).toBe(3);
  });

  it("no load write inside the set row bypasses the pairing", () => {
    const body = setRow.slice(0, setRow.search(/\n(?:export )?function [A-Za-z]/));
    const bare = body.match(/(?<![\w.])setLoad\(/g) ?? [];
    // only the one inside setLoadPaired itself
    expect(bare.length).toBe(1);
  });
});
