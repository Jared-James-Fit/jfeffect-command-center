import { describe, expect, it } from "vitest";
import {
  buildTrainingLoad, fineMuscle, isCompetition, liftOf, muscleCredits, patternOf, trainingLoadText, weekOf,
  type LoadSet, type PlanRow,
} from "@/lib/analytics/training-load";

const SQUAT = { exercise: "Competition Squat", exerciseId: "sq", primary: ["quads", "glutes", "adductors"], secondary: ["lower_back", "core"], competitionLiftType: "squat", isCompetitionLift: true };
const BENCH = { exercise: "Competition Bench Press", exerciseId: "bp", primary: ["chest", "triceps"], secondary: ["front_delts"], competitionLiftType: "bench", isCompetitionLift: true };
const DEAD = { exercise: "Competition Deadlift", exerciseId: "dl", primary: ["glutes", "hamstrings", "lower_back"], secondary: ["quads", "upper_back", "traps", "forearms", "adductors"], competitionLiftType: "deadlift", isCompetitionLift: true };
const ROW = { exercise: "Chest Supported Row", exerciseId: "row", primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps"] };
const WALK = { exercise: "Treadmill Walk", exerciseId: "walk", primary: ["other"], secondary: [], countsTowardVolume: false };

function set(ex: object, day: string, kg: number, reps: number, rpe: number | null, rowId?: string): LoadSet {
  return { ...(ex as any), day, dayId: `day-${day}`, rowId: rowId ?? null, reps, loadKg: kg, rpe, rir: null };
}

describe("training load: classification", () => {
  it("reads muscles finely and credits primary 1, secondary ½, once per muscle", () => {
    expect(fineMuscle("lower_back")).toBe("Erectors");
    expect(fineMuscle("traps")).toBe("Upper back");
    expect(fineMuscle("side_delts")).toBe("Side delts");
    expect(fineMuscle("lats")).toBe("Lats");
    expect(fineMuscle("lateral delts")).toBe("Side delts");
    expect(fineMuscle("other")).toBeNull();
    const c = muscleCredits(DEAD);
    expect(c.get("Glutes")).toBe(1);
    expect(c.get("Erectors")).toBe(1);
    expect(c.get("Quads")).toBe(0.5);
    // traps and upper back are one muscle: credited once, never 1 set
    expect(c.get("Upper back")).toBe(0.5);
    // untagged legacy rows read their one label
    expect(muscleCredits({ primary: [], secondary: [], fallbackMuscle: "Chest" }).get("Chest")).toBe(1);
  });

  it("names the competition lift a set belongs to and whether it's the lift itself", () => {
    expect(liftOf({ exercise: "Pause Squat", competitionLiftType: "squat" })).toBe("squat");
    expect(liftOf({ exercise: "Leg Press", rowFamily: "accessory", competitionLiftType: null })).toBeNull();
    expect(liftOf({ exercise: "Spoto Press", rowFamily: "bench" })).toBe("bench");
    expect(isCompetition({ exercise: "Pause Squat", competitionLiftType: "squat", isCompetitionLift: false })).toBe(false);
    expect(isCompetition({ exercise: "Competition Squat", competitionLiftType: "squat" })).toBe(true);
  });

  it("puts a set in a movement pattern from its name, and leaves conditioning out", () => {
    expect(patternOf({ exercise: "Romanian Deadlift" })).toBe("Hip hinge");
    expect(patternOf({ exercise: "Bulgarian Split Squat" })).toBe("Single-leg");
    expect(patternOf({ exercise: "Lat Pulldown" })).toBe("Vertical pull");
    expect(patternOf({ exercise: "Seated Leg Curl" })).toBe("Knee flexion");
    expect(patternOf({ exercise: "Treadmill Walk", countsTowardVolume: false })).toBeNull();
  });

  it("weeks start on Monday", () => {
    expect(weekOf("2026-11-17")).toBe("2026-11-16");
    expect(weekOf("2026-11-16")).toBe("2026-11-16");
    expect(weekOf("2026-11-22")).toBe("2026-11-16");
  });
});

describe("training load: the read", () => {
  // four weeks: Mon squat + bench, Wed deadlift + row, Fri bench
  const weeks = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"];
  const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
  const sets: LoadSet[] = [];
  const plan: PlanRow[] = [];
  weeks.forEach((mon, wi) => {
    const wed = addDays(mon, 2);
    const fri = addDays(mon, 4);
    for (let k = 0; k < 4; k++) sets.push(set(SQUAT, mon, 150 + wi * 2.5, 5, 8, `sq-${wi}`));
    for (let k = 0; k < 3; k++) sets.push(set(BENCH, mon, 100, 5, 7, `bp1-${wi}`));
    for (let k = 0; k < 3; k++) sets.push(set(DEAD, wed, 180, 4, 7, `dl-${wi}`));
    for (let k = 0; k < 4; k++) sets.push(set(ROW, wed, 60, 10, null, `row-${wi}`));
    for (let k = 0; k < 3; k++) sets.push(set(BENCH, fri, 95, 6, 8, `bp2-${wi}`));
    sets.push(set(WALK, fri, 0, 1, null));
    plan.push(
      { ...SQUAT, rowId: `sq-${wi}`, dayId: `day-${mon}`, day: mon, sets: 4, rpeText: "8" },
      { ...BENCH, rowId: `bp1-${wi}`, dayId: `day-${mon}`, day: mon, sets: 3, rpeText: "7" },
      { ...DEAD, rowId: `dl-${wi}`, dayId: `day-${wed}`, day: wed, sets: 4, rpeText: "7" },
      { ...ROW, rowId: `row-${wi}`, dayId: `day-${wed}`, day: wed, sets: 4, rpeText: "8" },
      { ...BENCH, rowId: `bp2-${wi}`, dayId: `day-${fri}`, day: fri, sets: 3, rpeText: "8" },
    );
  });
  const today = "2026-11-17";
  const load = buildTrainingLoad({ sets, plan, today });

  it("counts working sets per week, hard and unrated apart, and leaves conditioning out", () => {
    expect(load.weeks.map((w) => w.sets)).toEqual([17, 17, 17, 17]);
    expect(load.completeWeeks).toBe(4);
    expect(load.weeks[0].hardSets).toBe(13);
    expect(load.weeks[0].unratedSets).toBe(4);
    expect(load.weeks[0].sessions).toBe(3);
    expect(load.totals.setsPerWeek).toBe(17);
    // the walk never counts
    expect(load.totals.sets).toBe(68);
  });

  it("prescribed vs completed: capped per exercise, missed only on past days", () => {
    // deadlift written 4, done 3 each week
    expect(load.weeks[0].prescribed).toBe(18);
    expect(load.weeks[0].completedOfPrescribed).toBe(17);
    expect(load.weeks[0].missed).toBe(1);
    expect(load.totals.completionPct).toBe(94);
  });

  it("credits muscles fractionally and finds their frequency", () => {
    const chest = load.muscles.find((m) => m.muscle === "Chest")!;
    expect(chest.perWeek).toBe(6);
    expect(chest.directPerWeek).toBe(6);
    expect(chest.frequency).toBe(2);
    const quads = load.muscles.find((m) => m.muscle === "Quads")!;
    // 4 squat sets full, 3 deadlift sets half
    expect(quads.perWeek).toBe(5.5);
    expect(quads.directPerWeek).toBe(4);
    expect(load.patterns[0].pattern).toBe("Horizontal press");
  });

  it("reads each competition lift: frequency, competition sets, intensity against its best estimated max", () => {
    const bench = load.lifts.find((l) => l.lift === "bench")!;
    expect(bench.sessionsPerWeek).toBe(2);
    expect(bench.setsPerWeek).toBe(6);
    expect(bench.competitionSets).toBe(24);
    const squat = load.lifts.find((l) => l.lift === "squat")!;
    expect(squat.heavyExposures).toBe(4);
    expect(squat.intensity.unknown).toBe(0);
    expect(squat.reps.r4_6).toBe(16);
    expect(squat.avgRpe).toBe(8);
    // squat went 150 → 157.5 at the same reps and RPE: up, on stable volume
    expect(squat.trend.kind).toBe("up");
  });

  it("lays the latest week out day by day", () => {
    expect(load.distribution?.week).toBe("2026-11-09");
    expect(load.distribution?.days.map((d) => d.label)).toEqual(["Mon 9", "Wed 11", "Fri 13"]);
    const wed = load.distribution!.days[1];
    expect(wed.lifts.map((l) => l.lift)).toEqual(["deadlift"]);
    expect(wed.posteriorSets).toBe(9);
  });

  it("says what the data supports, and the good news too", () => {
    const ids = load.insights.map((i) => i.id);
    expect(ids).toContain("progress-stable-squat");
    expect(ids).not.toContain("completion");
    expect(ids).not.toContain("heavy-lower-close");
    for (const i of load.insights) {
      expect(i.observation.length).toBeGreaterThan(10);
      expect(["high", "medium", "low"]).toContain(i.confidence);
    }
  });

  it("and the text the AI reads carries the numbers and the flags with their confidence", () => {
    const text = trainingLoadText(load);
    expect(text).toContain("Working sets: 68");
    expect(text).toContain("Prescribed vs completed (past workouts): 68/72 sets (94%)");
    expect(text).toContain("Squat: 1 sessions/wk");
    expect(text).toMatch(/Flag \(good, (high|medium) confidence, no change required\): Squat improving on stable volume/);
  });
});

describe("training load: flags", () => {
  const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

  it("flags missed sets before anything else", () => {
    const sets: LoadSet[] = [];
    const plan: PlanRow[] = [];
    for (let w = 0; w < 3; w++) {
      const d = addDays("2026-10-26", w * 7);
      plan.push({ ...BENCH, rowId: `b${w}`, dayId: `d${w}`, day: d, sets: 10 });
      for (let k = 0; k < 5; k++) sets.push({ ...set(BENCH, d, 100, 5, 7, `b${w}`), dayId: `d${w}` });
    }
    const load = buildTrainingLoad({ sets, plan, today: "2026-11-17" });
    expect(load.insights[0].id).toBe("completion");
    expect(load.insights[0].title).toBe("50% of prescribed sets done");
    expect(load.insights[0].actionNeeded).toBe(true);
  });

  it("names heavy squat and deadlift within 48 hours as a fact to judge, never a required change", () => {
    const sets = [
      set(SQUAT, "2026-11-09", 180, 3, 9),
      set(DEAD, "2026-11-10", 220, 2, 9),
      set(BENCH, "2026-11-12", 100, 5, 7),
    ];
    const load = buildTrainingLoad({ sets, today: "2026-11-17" });
    const flag = load.insights.find((i) => i.id === "heavy-lower-close");
    expect(flag).toBeTruthy();
    expect(flag!.actionNeeded).toBe(false);
    expect(flag!.observation).toContain("back to back");
  });

  it("calls sets running harder than written", () => {
    const sets: LoadSet[] = [];
    const plan: PlanRow[] = [];
    for (let k = 0; k < 10; k++) sets.push(set(ROW, "2026-11-10", 60, 10, 9.5, "r1"));
    plan.push({ ...ROW, rowId: "r1", dayId: "day-2026-11-10", day: "2026-11-10", sets: 10, rpeText: "7-8" });
    const load = buildTrainingLoad({ sets, plan, today: "2026-11-17" });
    expect(load.insights.map((i) => i.id)).toContain("rpe-overshoot");
  });

  it("says nothing it can't back: one week of data is no trend", () => {
    const load = buildTrainingLoad({ sets: [set(SQUAT, "2026-11-16", 150, 5, 8)], today: "2026-11-17" });
    expect(load.lifts[0].trend.kind).toBe("unclear");
    expect(load.insights.filter((i) => i.tone !== "info")).toEqual([]);
  });

  it("an empty history is an empty read, never an error", () => {
    const load = buildTrainingLoad({ sets: [], today: "2026-11-17" });
    expect(load.weeks).toEqual([]);
    expect(load.totals.sets).toBe(0);
    expect(load.distribution).toBeNull();
    expect(trainingLoadText(load)).toBe("");
  });
});
