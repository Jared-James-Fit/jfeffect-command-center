/**
 * Weight-unit audit (Nov 17 2026): one regression suite across athletes who
 * log in lb, in kg, and in a mix of both.
 *
 * - A % of a max is worked out and rounded once, in the unit on screen, with
 *   the coach's rounding only in the max's own unit (100% of a 600 lb max read
 *   595 lb: an lb max's step 5 was used as 5 kg).
 * - Switching the display unit never rewrites a stored set, however often.
 * - A card opens in the unit the athlete logs, per exercise, for every kind of
 *   athlete.
 * - Only a unit stamp nobody chose is cleared (20270406090000).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMaxIndex, computeRowLoad } from "@/lib/pl-maxes";
import { convertLoad, displayLoadInUnit, LB_PER_KG, persistedLoadForDisplayValue } from "@/lib/workout-unit-persistence";
import { resolveWorkoutRowUnits } from "@/lib/workout-unit-resolution";

type U = "kg" | "lb";
const max = (over: Record<string, unknown>) =>
  ({
    id: "m",
    client_id: "c",
    training_max: null,
    estimated_1rm: null,
    active: true,
    rounding_mode: "nearest",
    rounding_step: null,
    block_id: null,
    ...over,
  }) as any;
const pctLoad = (m: any, percentage: number, unit: U) =>
  computeRowLoad({
    exerciseName: m.lift,
    basis: "1rm",
    percentage,
    manualLoadKg: null,
    manualLoadLb: null,
    unit,
    maxesIndex: buildMaxIndex([m]),
  } as any);
const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const PERCENTS = Array.from({ length: 21 }, (_, i) => 50 + i * 2.5);

describe("a % of a max is one physical load, rounded once in the unit shown", () => {
  const lbMax = max({ lift: "Competition Deadlift", unit: "lb", one_rm: 600, rounding_step: 5 });
  const kgMax = max({ lift: "Competition Squat", unit: "kg", one_rm: 235, rounding_step: 2.5 });

  it("an lb max read in lb: exactly the % rounded to 5 lb (100% of 600 lb is 600, not 595)", () => {
    for (const p of PERCENTS) {
      const c = pctLoad(lbMax, p, "lb");
      expect(c.unit).toBe("lb");
      expect(c.load).toBe(roundTo((600 * p) / 100, 5));
    }
    expect(pctLoad(lbMax, 100, "lb").load).toBe(600);
    expect(pctLoad(lbMax, 72.5, "lb").load).toBe(435);
  });

  it("an lb max read in kg rounds to kg plates (2.5 kg), never to its 5 lb step as 5 kg", () => {
    for (const p of PERCENTS) {
      expect(pctLoad(lbMax, p, "kg").load).toBe(roundTo((600 / LB_PER_KG) * (p / 100), 2.5));
    }
    expect(pctLoad(lbMax, 100, "kg").load).toBe(272.5);
  });

  it("a kg max read in lb rounds to 5 lb, read in kg keeps the coach's 2.5 kg", () => {
    for (const p of PERCENTS) {
      expect(pctLoad(kgMax, p, "kg").load).toBe(roundTo((235 * p) / 100, 2.5));
      expect(pctLoad(kgMax, p, "lb").load).toBe(roundTo(235 * LB_PER_KG * (p / 100), 5));
    }
  });

  it("the coach's own rounding still applies in the max's unit", () => {
    const tens = max({ lift: "Competition Squat", unit: "lb", one_rm: 500, rounding_step: 10 });
    expect(pctLoad(tens, 73, "lb").load).toBe(370);
    const down = max({ lift: "Competition Squat", unit: "kg", one_rm: 200, rounding_step: 5, rounding_mode: "down" });
    expect(pctLoad(down, 73, "kg").load).toBe(145);
  });

  it("the workout card asks for the load in its own unit and never rounds it twice", () => {
    const view = ["src/components/workout-day/WorkoutDayView.tsx", "src/lib/workouts/card-suggestion.ts", "src/lib/workouts/card-suggestion-reads.ts"].map((p) => readFileSync(p, "utf8")).join("\n") /* the logger and the card helpers it shares with the coach's quick view */;
    const block = view.slice(view.indexOf("const computed = useMemo(() => {\n    if (!row.percentage"), view.indexOf("// The coach planned this load as a %"));
    expect(block).toContain("unit: activeUnit,");
    expect(block).not.toContain('unit: "kg",');
    // prescribedWeightFor (card-suggestion.ts), called with the card's unit
    expect(view).toContain("if (computed.unit === unit) return computed.load;");
    expect(view).toContain("prescribedWeightFor(row, activeUnit, percentageBackoffWeight, computed as any)");
  });
});

describe("switching the display unit never rewrites a stored set", () => {
  const stored = (value: number, unit: U) => ({
    entered_value: value,
    entered_unit: unit,
    actual_load: value,
    actual_load_unit: unit,
    normalized_kg: unit === "kg" ? value : value / LB_PER_KG,
    normalized_lb: unit === "lb" ? value : value * LB_PER_KG,
  });
  // the logger shows a converted load to 4 decimals (SetRow's fmtLoad)
  const shown = (v: number) => String(Math.round(v * 10000) / 10000);

  it("toggling back and forth, any number of times, saves the pair exactly as typed", () => {
    const values: Array<[number, U]> = [
      [225, "lb"], [455, "lb"], [5, "lb"], [72.5, "lb"], [135.5, "lb"],
      [90, "kg"], [102.5, "kg"], [227.5, "kg"], [1.25, "kg"], [300, "kg"],
    ];
    for (const [value, unit] of values) {
      const existing = stored(value, unit);
      let display = displayLoadInUnit(existing, unit)!;
      let at: U = unit;
      for (let i = 0; i < 12; i++) {
        const next: U = at === "kg" ? "lb" : "kg";
        display = Number(shown(convertLoad(display, at, next)));
        at = next;
        expect(persistedLoadForDisplayValue(shown(display), at, existing)).toEqual({ value, unit });
      }
    }
  });

  it("a number typed after a switch is saved in the unit it was typed in", () => {
    const existing = stored(100, "kg");
    expect(persistedLoadForDisplayValue("225", "lb", existing)).toEqual({ value: 225, unit: "lb" });
  });
});

describe("a card opens in the unit the athlete logs: lb, kg and mixed athletes", () => {
  const ex = (id: string, family: string, comp = false, def: U | null = null) => ({
    id,
    movement_family: family,
    is_competition_lift: comp,
    competition_lift_type: comp ? family : null,
    default_load_unit: def,
  });
  const exercises = {
    squat: ex("ex-sq", "squat", true),
    deadlift: ex("ex-dl", "deadlift", true),
    bench: ex("ex-b", "bench", true),
    pausedDl: ex("ex-pdl", "deadlift"),
    newAccessory: ex("ex-new", "accessory", false, "lb"),
    newKgMachine: ex("ex-kgm", "accessory", false, "kg"),
  };
  const rows = Object.entries(exercises).map(([k, e]) => ({ id: k, exercise_id: e.id, exercises: e, load_unit: null }));
  const fam = (unit: U, family: string, n: number) =>
    Array.from({ length: n }, () => ({ actual_load_unit: unit, actual_load: 100, pl_exercise_rows: { exercises: { movement_family: family } } }));
  const hist = (unit: U, exId: string, n: number) =>
    Array.from({ length: n }, () => ({ actual_load_unit: unit, actual_load: 100, pl_exercise_rows: { exercise_id: exId } }));
  const resolve = (h: { historyRows: any[]; familyHistoryRows: any[]; athleteChosenUnit?: U | null }) =>
    resolveWorkoutRowUnits({ rows, prefRows: [], overrides: {}, ...h });

  it("an lb lifter: every card in lb, competition lifts included", () => {
    const units = resolve({
      historyRows: [...hist("lb", "ex-sq", 6), ...hist("lb", "ex-b", 6)],
      familyHistoryRows: [...fam("lb", "squat", 20), ...fam("lb", "bench", 20), ...fam("lb", "accessory", 40)],
    });
    expect(new Set(Object.values(units))).toEqual(new Set(["lb"]));
  });

  it("a kg lifter: every card in kg, a new lb-default accessory included", () => {
    const units = resolve({
      historyRows: [...hist("kg", "ex-sq", 6)],
      familyHistoryRows: [...fam("kg", "squat", 20), ...fam("kg", "deadlift", 20), ...fam("kg", "accessory", 40)],
      athleteChosenUnit: "lb",
    });
    expect(new Set(Object.values(units))).toEqual(new Set(["kg"]));
  });

  it("a mixed lifter (deadlifts in kg, everything else lb, like Jarrett): each lift keeps its own unit", () => {
    const units = resolve({
      historyRows: [...hist("kg", "ex-dl", 8), ...hist("lb", "ex-sq", 8), ...hist("lb", "ex-b", 8)],
      familyHistoryRows: [...fam("kg", "deadlift", 16), ...fam("lb", "squat", 60), ...fam("lb", "bench", 50), ...fam("lb", "accessory", 24)],
    });
    expect(units["row:deadlift"]).toBe("kg");
    expect(units["row:pausedDl"]).toBe("kg"); // a new deadlift variation follows the deadlift family
    expect(units["row:squat"]).toBe("lb");
    expect(units["row:bench"]).toBe("lb");
    expect(units["row:newAccessory"]).toBe("lb"); // 134 of 150 in lb: the habit
  });

  it("a mixed lifter with no clear habit falls back to the account's confirmed unit, then the library", () => {
    const mixed = [...fam("kg", "accessory", 60), ...fam("lb", "accessory", 60)];
    expect(resolve({ historyRows: [], familyHistoryRows: mixed, athleteChosenUnit: "kg" })["row:newAccessory"]).toBe("kg");
    expect(resolve({ historyRows: [], familyHistoryRows: mixed })["row:newAccessory"]).toBe("lb");
    expect(resolve({ historyRows: [], familyHistoryRows: mixed })["row:newKgMachine"]).toBe("kg");
  });

  it("an athlete who moved from kg to lb follows the move", () => {
    const units = resolve({
      historyRows: [...hist("lb", "ex-dl", 4), ...hist("kg", "ex-dl", 12)],
      familyHistoryRows: [...fam("lb", "deadlift", 6), ...fam("kg", "deadlift", 20), ...fam("lb", "accessory", 100)],
    });
    expect(units["row:deadlift"]).toBe("lb");
    expect(units["row:pausedDl"]).toBe("lb");
  });
});

describe("only a unit nobody chose stops counting as chosen (20270406090000)", () => {
  const sql = readFileSync("supabase/migrations/20270406090000_weight_unit_unconfirm_db_stamped.sql", "utf8");

  it("clears the confirmation, never the unit itself", () => {
    const setClause = sql.match(/update public\.clients\s+set ([\s\S]*?)\swhere /i)?.[1] ?? "";
    expect(setClause.trim()).toBe("weight_unit_confirmed_at = null");
  });

  it("matches only database-stamped confirmations (sub-millisecond), never an answer given in the app", () => {
    expect(sql).toContain("% 1000) <> 0");
    expect(sql).toContain("preferred_weight_unit = 'kg'");
    // an app answer is a JavaScript ISO timestamp: millisecond precision, so its microseconds % 1000 is 0
    const appStamp = new Date("2026-10-18T23:59:42.171Z").toISOString();
    expect(appStamp).toMatch(/\.\d{3}Z$/);
  });
});

describe("analytics compare a kg set and an lb set as one physical weight", () => {
  it("block analytics reads every set in the block's unit from the stored mirrors, never its raw number", () => {
    const src = readFileSync("src/lib/block-analytics.ts", "utf8");
    expect(src).toContain("const weight = displayLoadInUnit(r, unit);");
    expect(src).not.toMatch(/r\.actual_load != null \? Number\(r\.actual_load\)/);
  });

  it("progress comparison: 140 kg beats 225 lb, and the delta is in A's unit", async () => {
    const { bestSet, bestSetDelta } = await import("@/components/progress-comparison");
    const set = (load: number, unit: U, reps = 3) =>
      ({ row_id: "r", set_index: 1, actual_load: load, actual_load_unit: unit, actual_reps: reps, actual_rpe: null, notes: null, completed_at: "2026-11-01" }) as any;
    expect(bestSet([set(225, "lb"), set(140, "kg")])?.actual_load).toBe(140);
    // 100 kg vs 225 lb (102.06 kg): -2.1 kg, never "-125"
    expect(bestSetDelta(set(100, "kg"), set(225, "lb"))).toBe(-2.1);
    expect(bestSetDelta(set(225, "lb"), set(100, "kg"))).toBe(4.5);
    expect(bestSetDelta(set(315, "lb"), set(300, "lb"))).toBe(15);
  });

  it("plan vs actual sums volume and e1RM in kg from the kg mirror", () => {
    const src = readFileSync("src/lib/analytics/planned-vs-actual.ts", "utf8");
    expect(src).toContain("normalized_kg");
    expect(src).toContain("s + kgOf(r) * (Number(r.actual_reps) || 0)");
    expect(src).not.toContain("row.load_lb ?? row.load_kg");
  });
});

describe("a variation max read from its competition lift keeps the right unit", () => {
  it("90% of a 200 kg Competition Squat on a Pause Squat kept in lb is 397 lb, and 70% of it is 280 lb", async () => {
    const { effectiveMax } = await import("@/lib/pl-maxes");
    const comp = max({ id: "c1", lift: "Competition Squat", unit: "kg", one_rm: 200 });
    const pause = max({ id: "p1", lift: "Pause Squat", unit: "lb", one_rm: null, source_lift: "Competition Squat", variation_modifier: 90 });
    const index = buildMaxIndex([comp, pause]);
    expect(effectiveMax(pause, index).one_rm).toBeCloseTo(396.83, 2);
    const c = computeRowLoad({ exerciseName: "Pause Squat", basis: "1rm", percentage: 70, manualLoadKg: null, manualLoadLb: null, unit: "lb", maxesIndex: index } as any);
    expect(c.load).toBe(280);
  });

  it("the same unit on both is unchanged", async () => {
    const { effectiveMax } = await import("@/lib/pl-maxes");
    const comp = max({ id: "c1", lift: "Competition Bench", unit: "kg", training_max: 150 });
    const paused = max({ id: "p1", lift: "2-Count Pause Bench Press", unit: "kg", training_max: null, source_lift: "Competition Bench" });
    expect(effectiveMax(paused, buildMaxIndex([comp, paused])).training_max).toBe(150);
  });
});

describe("AI prescriptions never guess kg or lb silently", () => {
  it("Cleo: a bare load takes its row's unit, else the athlete's, never a blanket lb", async () => {
    const { withLoadUnits, rxToRow } = await import("@/lib/cleo-program");
    const edit = withLoadUnits({ day_id: "d", changes: [{ op: "update", row_id: "r-kg", load: 105 }, { op: "add", exercise_id: "x", load: 60 }] }, "lb", new Map([["r-kg", "kg"]]));
    expect((edit.changes[0] as any).load_unit).toBe("kg");
    expect((edit.changes[1] as any).load_unit).toBe("lb");
    expect(rxToRow(edit.changes[0] as any)).toMatchObject({ load_unit: "kg", load_kg: 105, load_lb: null });
    // a kg athlete building a program: bare loads, weekly progression included, are kg
    const build = withLoadUnits({ client_id: "c", days: [{ exercises: [{ exercise_id: "x", load: 100, weeks: [{ week: 2, load: 102.5 }] }] }] }, "kg");
    expect((build.days[0].exercises[0] as any).load_unit).toBe("kg");
    expect((build.days[0].exercises[0].weeks[0] as any).load_unit).toBe("kg");
    // a unit the model gave is never replaced
    expect(withLoadUnits({ changes: [{ op: "update", row_id: "r-kg", load: 225, load_unit: "lb" }] }, "kg", new Map([["r-kg", "kg"]])).changes[0].load_unit).toBe("lb");
  });

  it("Edit with AI: a load about 2.2× off what they lift is flagged as a kg / lb mix-up", async () => {
    const { looksLikeUnitMixup } = await import("@/lib/program-ai/engine");
    expect(looksLikeUnitMixup(225, 102)).toBe(true); // 225 "kg" for a 225 lb lifter
    expect(looksLikeUnitMixup(100 / 2.2046226218, 100)).toBe(true); // 100 "lb" for a 100 kg lifter
    expect(looksLikeUnitMixup(105, 100)).toBe(false);
    expect(looksLikeUnitMixup(140, 100)).toBe(false);
    const src = readFileSync("src/lib/program-ai/engine.ts", "utf8");
    expect(src).toContain("came without kg or lb, so it reads as");
    expect(src).toContain("Are kg and lb mixed up?");
  });

  it("a template personalized for an athlete reads in their unit, like their brief", () => {
    const worker = readFileSync("src/lib/program-ai/worker.server.ts", "utf8");
    expect(worker).toContain('if (snap.kind === "template") snap.unit = a.unit;');
  });

  it("the AI brief's prescribed load is the coach's fixed load only, read from its unit's column", async () => {
    const { prescribedFixedKg } = await import("@/lib/program-intel/core");
    const base = { percentage: null, percentage_basis: null, load_kg: null, load_lb: null, load_unit: null, manual_override: null };
    // Dwayne's 70% squat with a stale "455" (lb) cached in load_kg: the % is the prescription, not 455 kg
    expect(prescribedFixedKg({ ...base, percentage: 70, percentage_basis: "1rm", load_kg: 455 })).toBeNull();
    // the coach's exact override over a % counts
    expect(prescribedFixedKg({ ...base, percentage: 70, percentage_basis: "1rm", load_kg: 200, load_unit: "kg", manual_override: true })).toBe(200);
    // an lb row with an old kg number left behind reads its lb number
    expect(prescribedFixedKg({ ...base, percentage_basis: "manual", load_kg: 100, load_lb: 225, load_unit: "lb" })).toBeCloseTo(102.06, 2);
    expect(prescribedFixedKg({ ...base, load_lb: 135 })).toBeCloseTo(61.23, 2);
  });
});

describe("the program builder keeps one load in one unit", () => {
  const src = readFileSync("src/route-pages/_authenticated/admin/program-library_.$templateId.tsx", "utf8");

  it("typing a load clears the other unit's column, and switching the unit moves the number with it", () => {
    expect(src).toContain('setRow({ ...row, load_unit: rowUnit, load_kg: rowUnit === "kg" ? n : null, load_lb: rowUnit === "lb" ? n : null });');
    expect(src).toContain('setRow({ ...row, load_unit: u, load_kg: u === "kg" ? n ?? null : null, load_lb: u === "lb" ? n ?? null : null });');
  });

  it("a row with no load_unit reads its unit from the column holding the number", () => {
    expect(src).toContain('row.load_unit === "lb" || (row.load_unit !== "kg" && row.load_lb != null && row.load_kg == null) ? "lb" : "kg"');
  });

  it("copying a week or saving a block as a template carries the row's unit", () => {
    const programs = readFileSync("src/lib/pl-programs.ts", "utf8");
    expect(programs.match(/load_unit: (opts\.prescriptions \? )?r\.load_unit \?\? null/g)?.length).toBe(3);
  });
});
