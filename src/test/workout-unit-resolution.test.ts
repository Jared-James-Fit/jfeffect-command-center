import { describe, expect, it } from "vitest";
import { ATHLETE_HABIT_MIN_LOGS, athleteHabitUnit, readUnitHabitHint, recentUnit, resolveWorkoutRowUnits, writeUnitHabitHint } from "@/lib/workout-unit-resolution";

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

describe("a lift nobody has logged opens in the athlete's own unit, not the kg default", () => {
  // Nicolas, Oct 10 2026: every log in lb, no deadlift-family history (RDLs
  // are a hinge), so his first Competition Deadlift opened in kg and 135 /
  // 185 / 205 lb saved as kg; the next deadlift day suggested 440 lb.
  const compDeadlift = { id: "ex-cdl", competition_lift_type: "deadlift", is_competition_lift: true, movement_family: "deadlift" };
  const rows = [{ id: "dl", exercise_id: "ex-cdl", exercises: compDeadlift, load_unit: null }];
  const log = (unit: string, family = "hinge", load = 100) =>
    ({ actual_load_unit: unit, actual_load: load, pl_exercise_rows: { exercises: { movement_family: family } } });
  const lbHabit = Array.from({ length: 12 }, () => log("lb"));

  it("an athlete who logs in lb gets lb on their first deadlift", () => {
    const units = resolveWorkoutRowUnits({ rows, prefRows: [], historyRows: [], familyHistoryRows: lbHabit, overrides: {} });
    expect(units["row:dl"]).toBe("lb");
  });

  it("a confirmed choice decides even with no logs yet, either way", () => {
    expect(resolveWorkoutRowUnits({ rows, prefRows: [], historyRows: [], athleteChosenUnit: "lb", overrides: {} })["row:dl"]).toBe("lb");
    const accessory = { id: "ex-row", competition_lift_type: null, default_load_unit: "lb" };
    expect(resolveWorkoutRowUnits({
      rows: [{ id: "r", exercise_id: "ex-row", exercises: accessory, load_unit: null }],
      prefRows: [], historyRows: [], athleteChosenUnit: "kg", overrides: {},
    })["row:r"]).toBe("kg");
  });

  it("the lift's own preference, history and family still come first", () => {
    expect(resolveWorkoutRowUnits({
      rows, prefRows: [{ exercise_id: "ex-cdl", unit: "kg" }], historyRows: [], familyHistoryRows: lbHabit, athleteChosenUnit: "lb", overrides: {},
    })["row:dl"]).toBe("kg");
    expect(resolveWorkoutRowUnits({
      rows, prefRows: [], historyRows: [], familyHistoryRows: [...lbHabit, log("kg", "deadlift")], overrides: {},
    })["row:dl"]).toBe("kg");
  });

  it("the athlete's unit beats the coach's row unit", () => {
    expect(resolveWorkoutRowUnits({
      rows: [{ ...rows[0], load_unit: "kg" }], prefRows: [], historyRows: [], familyHistoryRows: lbHabit, overrides: {},
    })["row:dl"]).toBe("lb");
  });

  it("no clear habit (too few logs, or mixed) keeps the old default", () => {
    expect(athleteHabitUnit(Array.from({ length: ATHLETE_HABIT_MIN_LOGS - 1 }, () => log("lb")))).toBeNull();
    expect(athleteHabitUnit([...Array.from({ length: 6 }, () => log("lb")), ...Array.from({ length: 4 }, () => log("kg"))])).toBeNull();
    expect(athleteHabitUnit([...Array.from({ length: 9 }, () => log("lb")), log("kg")])).toBe("lb");
    expect(athleteHabitUnit([...Array.from({ length: 9 }, () => log("lb", "hinge", 0))])).toBeNull();
    expect(resolveWorkoutRowUnits({
      rows, prefRows: [], historyRows: [], familyHistoryRows: [log("lb"), log("lb")], overrides: {},
    })["row:dl"]).toBe("kg");
  });

  it("the workout passes the athlete's confirmed unit only", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const view = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(view).toContain("athleteChosenUnit: (client as any)?.weight_unit_confirmed_at ? (client as any)?.preferred_weight_unit ?? null : null,");
    expect(view).toContain('.select("id, full_name, preferred_weight_unit, weight_unit_confirmed_at")');
    expect(readFileSync("src/lib/workout-context/client-adapter.ts", "utf8")).toContain("weight_unit_confirmed_at: (data as any).weight_unit_confirmed_at ?? null,");
  });
});

describe("what the athlete logs beats the account's unit (Jared McIntyre, Nov 16 2026)", () => {
  // His account said kg (stamped by a migration, never chosen) while 148 of his
  // last 150 loaded sets were lb: every exercise he'd never logged opened in kg.
  const adduction = { id: "ex-add", competition_lift_type: null, movement_family: "accessory", default_load_unit: null };
  const pullUp = { id: "ex-pu", competition_lift_type: null, movement_family: "accessory", default_load_unit: "lb" };
  const rows = [
    { id: "a", exercise_id: "ex-add", exercises: adduction, load_unit: null },
    { id: "p", exercise_id: "ex-pu", exercises: pullUp, load_unit: null },
  ];
  const log = (unit: string, family = "accessory", load = 100) =>
    ({ actual_load_unit: unit, actual_load: load, pl_exercise_rows: { exercises: { movement_family: family } } });
  const lbHabit = [...Array.from({ length: 148 }, () => log("lb")), log("kg"), log("kg")];

  it("a new accessory opens in lb for an lb lifter whose account says kg", () => {
    const units = resolveWorkoutRowUnits({
      rows, prefRows: [], historyRows: [], familyHistoryRows: lbHabit, athleteChosenUnit: "kg", overrides: {},
    });
    expect(units).toEqual({ "row:a": "lb", "row:p": "lb" });
  });

  it("the account's unit still decides when the logs show no habit", () => {
    const mixed = [...Array.from({ length: 6 }, () => log("lb")), ...Array.from({ length: 4 }, () => log("kg"))];
    expect(resolveWorkoutRowUnits({
      rows, prefRows: [], historyRows: [], familyHistoryRows: mixed, athleteChosenUnit: "kg", overrides: {},
    })["row:a"]).toBe("kg");
  });

  it("a kg lifter's habit beats an lb account the same way", () => {
    const kgHabit = Array.from({ length: 20 }, () => log("kg"));
    expect(resolveWorkoutRowUnits({
      rows, prefRows: [], historyRows: [], familyHistoryRows: kgHabit, athleteChosenUnit: "lb", overrides: {},
    })["row:p"]).toBe("kg");
  });

  it("before the logs load, the habit last read on this phone paints first", () => {
    const loading = { rows, prefRows: [], historyRows: [], athleteChosenUnit: "kg" as const, overrides: {} };
    expect(resolveWorkoutRowUnits({ ...loading, habitHint: "lb" })["row:a"]).toBe("lb");
    // no hint yet: the account's unit, as before
    expect(resolveWorkoutRowUnits({ ...loading, habitHint: null })["row:a"]).toBe("kg");
    // once the logs are in they decide, whatever the hint said
    expect(resolveWorkoutRowUnits({ ...loading, habitHint: "kg", familyHistoryRows: lbHabit })["row:a"]).toBe("lb");
  });

  it("the hint is kept per athlete on the phone", () => {
    const g = globalThis as any;
    const before = g.localStorage;
    const mem = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    try {
      writeUnitHabitHint("client-1", "lb");
      expect(readUnitHabitHint("client-1")).toBe("lb");
      expect(readUnitHabitHint("client-2")).toBeNull();
      writeUnitHabitHint("client-1", null);
      expect(readUnitHabitHint("client-1")).toBeNull();
    } finally {
      g.localStorage = before;
    }
    // no storage at all (a private window): nothing breaks, no hint
    expect(readUnitHabitHint("client-1")).toBeNull();
  });

  it("a set with no weight never decides the unit (Hanging Leg Raises saved as 0 kg)", () => {
    const units = resolveWorkoutRowUnits({
      rows: [rows[0]], prefRows: [], familyHistoryRows: lbHabit, overrides: {},
      historyRows: [{ actual_load_unit: "kg", actual_load: 0, pl_exercise_rows: { exercise_id: "ex-add" } }],
    });
    expect(units["row:a"]).toBe("lb");
  });

  it("a toggle saved on the exercise still wins over the habit", () => {
    expect(resolveWorkoutRowUnits({
      rows, prefRows: [{ exercise_id: "ex-add", unit: "kg" }], historyRows: [], familyHistoryRows: lbHabit, overrides: {},
    })["row:a"]).toBe("kg");
  });
});

describe("an exercise follows its newest logs, never a vote over a mixed window", () => {
  // Jared's Competition Deadlift: 8 kg sets from October under 4 lb sets from
  // November; a majority vote over the window put the card back in kg.
  const compDeadlift = { id: "ex-cdl", competition_lift_type: "deadlift", is_competition_lift: true, movement_family: "deadlift" };
  const rows = [{ id: "dl", exercise_id: "ex-cdl", exercises: compDeadlift, load_unit: null }];
  const h = (unit: string) => ({ actual_load_unit: unit, actual_load: 200, pl_exercise_rows: { exercise_id: "ex-cdl" } });

  it("moved from kg to lb: lb", () => {
    const historyRows = [h("lb"), h("lb"), h("lb"), h("lb"), ...Array.from({ length: 8 }, () => h("kg"))];
    expect(resolveWorkoutRowUnits({ rows, prefRows: [], historyRows, overrides: {} })["row:dl"]).toBe("lb");
  });

  it("the family follows its newest logs too", () => {
    const f = (unit: string) => ({ actual_load_unit: unit, actual_load: 200, pl_exercise_rows: { exercises: { movement_family: "deadlift" } } });
    const familyHistoryRows = [f("lb"), f("lb"), f("lb"), f("lb"), ...Array.from({ length: 10 }, () => f("kg"))];
    expect(resolveWorkoutRowUnits({ rows, prefRows: [], historyRows: [], familyHistoryRows, overrides: {} })["row:dl"]).toBe("lb");
  });

  it("recentUnit: the newest few decide, a tie goes to the newest", () => {
    expect(recentUnit(["lb", "kg", "kg", "kg", "kg"], 3)).toBe("kg");
    expect(recentUnit(["lb", "lb", "kg", "kg", "kg"], 3)).toBe("lb");
    expect(recentUnit(["kg", "lb"], 3)).toBe("kg");
    expect(recentUnit([null, "lb"], 3)).toBe("lb");
    expect(recentUnit([], 3)).toBeNull();
  });
});

describe("the workout reads what decides a card's unit on every day", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const view = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  const block = view.slice(view.indexOf('queryKey: ["client-lift-family-unit-history"'), view.indexOf("// Map exercise_id -> resolved unit"));

  it("the habit is read on accessory days too, not only with a squat / bench / deadlift", () => {
    expect(block).toContain("enabled: secondaryHydrationReady && !!client?.id,");
    expect(view).not.toContain("hasMainLiftRow");
  });

  it("only sets with a weight are read, and the reads are kept on the phone", () => {
    const history = view.slice(view.indexOf('queryKey: ["client-exercise-unit-history"'), view.indexOf('queryKey: ["client-lift-family-unit-history"'));
    expect(history).toContain('.gt("actual_load", 0)');
    expect(history).toContain("gcTime: UNIT_CACHE_MS");
    expect(block).toContain('.gt("actual_load", 0)');
    expect(block).toContain("gcTime: UNIT_CACHE_MS");
  });

  it("the card's switch shows both units, the one in use checked", () => {
    const sw = view.slice(view.indexOf("function UnitSwitch("));
    expect(sw).toContain('role="radiogroup"');
    expect(sw).toContain('(["kg", "lb"] as const).map(');
    expect(sw).toContain("aria-checked={on}");
  });
});
