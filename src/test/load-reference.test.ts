import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  capAdjustedLoad, competitionMax, hasRpeCap, isCompetitionMaxName, loggedE1rm, plannedLoadLabel, referenceFamily, rpeCapValue, shortLiftName,
} from "@/lib/workouts/load-reference";
import { buildMaxIndex, computeRowLoad, type ClientMaxRow } from "@/lib/pl-maxes";

const max = (lift: string, v: Partial<ClientMaxRow> = {}): ClientMaxRow => ({
  id: lift, client_id: "c", lift, exercise_id: null, one_rm: null, training_max: null, estimated_1rm: null, unit: "kg",
  notes: null, tested_at: null, source: "manual", active: true, source_lift: null, source_exercise_id: null,
  variation_modifier: null, manual_override: false, rounding_step: null, rounding_mode: "nearest", block_id: null,
  updated_at: "", created_at: "", ...v,
});

describe("which max a % reads", () => {
  it("a row's own family first, then the exercise's competition lift, then its movement family", () => {
    expect(referenceFamily({ rowFamily: "deadlift", movementFamily: "accessory" })).toBe("deadlift");
    expect(referenceFamily({ competitionLiftType: "bench", movementFamily: "bench" })).toBe("bench");
    expect(referenceFamily({ movementFamily: "squat" })).toBe("squat");
    expect(referenceFamily({ movementFamily: "accessory" })).toBeNull();
  });

  it("names that stand for a competition lift, and ones that don't", () => {
    expect(isCompetitionMaxName("Competition Bench Press", "bench")).toBe(true);
    expect(isCompetitionMaxName("Bench Press", "bench")).toBe(true);
    expect(isCompetitionMaxName("Competition Squat", "squat")).toBe(true);
    expect(isCompetitionMaxName("Deadlift", "deadlift")).toBe(true);
    expect(isCompetitionMaxName("Paused Squat", "squat")).toBe(false);
    expect(isCompetitionMaxName("Close-Grip Bench", "bench")).toBe(false);
    expect(competitionMax([max("Paused Squat"), max("Competition Squat")], "squat")?.lift).toBe("Competition Squat");
  });

  it("'Competition Bench' finds the 'Competition Bench Press' max (the live mismatch: 126 rows never showed a load)", () => {
    const idx = buildMaxIndex([max("Competition Bench Press", { one_rm: 140 })]);
    const r = computeRowLoad({ exerciseName: "Competition Bench", basis: "1rm", percentage: 75, manualLoadKg: null, manualLoadLb: null, unit: "kg", maxesIndex: idx, family: "bench", ownCompetition: true });
    expect(r.status).toBe("ok");
    expect(r.load).toBe(105);
    expect(r.label).toBe("75% 1RM");
  });

  it("a variation reads its competition lift's TM and says so", () => {
    const idx = buildMaxIndex([max("Competition Squat", { training_max: 200 })]);
    const r = computeRowLoad({ exerciseName: "High Bar Squat", basis: "training_max", percentage: 65, manualLoadKg: null, manualLoadLb: null, unit: "kg", maxesIndex: idx, family: "squat" });
    expect(r.load).toBe(130);
    expect(r.label).toBe("65% Comp Squat TM");
  });

  it("the exercise's own named max still wins (backwards compatible)", () => {
    const idx = buildMaxIndex([max("Competition Squat", { training_max: 200 }), max("Paused Squat", { training_max: 170 })]);
    const r = computeRowLoad({ exerciseName: "Paused Squat", basis: "training_max", percentage: 70, manualLoadKg: null, manualLoadLb: null, unit: "kg", maxesIndex: idx, family: "squat" });
    expect(r.load).toBe(120); // 119 → nearest 2.5
    expect(r.label).toBe("70% TM");
  });

  it("no TM on file: no load (never an invented one); a max of a different kind doesn't stand in", () => {
    const idx = buildMaxIndex([max("Competition Squat", { one_rm: 220 })]);
    const r = computeRowLoad({ exerciseName: "Competition Squat", basis: "training_max", percentage: 70, manualLoadKg: null, manualLoadLb: null, unit: "kg", maxesIndex: idx, family: "squat", ownCompetition: true });
    expect(r.status).toBe("no-max");
    expect(r.load).toBeNull();
  });

  it("an accessory with no family and no max of its own gets nothing", () => {
    const idx = buildMaxIndex([max("Competition Squat", { training_max: 200 })]);
    const r = computeRowLoad({ exerciseName: "Leg Extension", basis: "training_max", percentage: 70, manualLoadKg: null, manualLoadLb: null, unit: "kg", maxesIndex: idx, family: null });
    expect(r.status).toBe("no-max");
  });

  it("% of e1RM: a stored one first, else their logged one", () => {
    const stored = buildMaxIndex([max("Competition Squat", { estimated_1rm: 210 })]);
    expect(computeRowLoad({ exerciseName: "Competition Squat", basis: "est_1rm", percentage: 80, manualLoadKg: null, manualLoadLb: null, unit: "kg", maxesIndex: stored, family: "squat", ownCompetition: true, loggedE1rmKg: 190 }).load).toBe(167.5);
    const none = buildMaxIndex([]);
    const r = computeRowLoad({ exerciseName: "Competition Squat", basis: "est_1rm", percentage: 80, manualLoadKg: null, manualLoadLb: null, unit: "kg", maxesIndex: none, family: "squat", ownCompetition: true, loggedE1rmKg: 200 });
    expect(r.load).toBe(160);
    expect(r.label).toBe("80% e1RM");
    expect(r.max).toBeNull();
    expect(r.refLift).toBe("Competition Squat"); // the line under the prescription names it
    const lb = computeRowLoad({ exerciseName: "Competition Squat", basis: "est_1rm", percentage: 80, manualLoadKg: null, manualLoadLb: null, unit: "lb", maxesIndex: none, family: "squat", ownCompetition: true, loggedE1rmKg: 200 });
    expect(lb.load).toBe(355); // 352.7 lb → nearest 5
  });
});

describe("a logged e1RM worth programming from", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const day = (d: number) => new Date(now - d * 86_400_000).toISOString();

  it("needs two sessions of RPE-rated sets in the last 6 weeks", () => {
    expect(loggedE1rm([{ kg: 180, reps: 3, rpe: 8, at: day(3) }], now)).toBeNull();
    const two = loggedE1rm([{ kg: 180, reps: 3, rpe: 8, at: day(3) }, { kg: 175, reps: 3, rpe: 8, at: day(10) }], now);
    expect(two?.sessions).toBe(2);
    // 180 / 0.863 = 208.6, 175 / 0.863 = 202.8 → median 205.7
    expect(two?.kg).toBeCloseTo(205.5, 0);
  });

  it("ignores unrated sets, high reps, light RPE and anything older than 6 weeks", () => {
    const r = loggedE1rm([
      { kg: 300, reps: 3, rpe: null, at: day(2) },
      { kg: 100, reps: 15, rpe: 9, at: day(4) },
      { kg: 250, reps: 3, rpe: 5, at: day(5) },
      { kg: 400, reps: 1, rpe: 9, at: day(60) },
    ], now);
    expect(r).toBeNull();
  });
});

describe("labels and the RPE cap", () => {
  it("says where the weight came from in a few characters", () => {
    expect(plannedLoadLabel({ percentage: 70, basis: "training_max" })).toBe("70% TM");
    expect(plannedLoadLabel({ percentage: 92.5, basis: "top_set" })).toBe("92.5% of top set");
    expect(plannedLoadLabel({ percentage: 65, basis: "training_max", refLift: "Competition Squat", viaFamily: true })).toBe("65% Comp Squat TM");
    expect(plannedLoadLabel({ percentage: 70, basis: "manual" })).toBeNull();
    expect(shortLiftName("Competition Bench Press")).toBe("Comp Bench");
  });

  it("an RPE next to a planned % is its cap", () => {
    expect(rpeCapValue("6")).toBe(6);
    expect(rpeCapValue("6-7")).toBe(7);
    expect(rpeCapValue("")).toBeNull();
    expect(hasRpeCap({ percentage: 92.5, percentage_basis: "top_set", rpe: "6" })).toBe(true);
    expect(hasRpeCap({ percentage: 70, percentage_basis: "training_max", rpe: "7" })).toBe(true);
    expect(hasRpeCap({ percentage: null, percentage_basis: null, rpe: "7" })).toBe(false); // an RPE top set is a target
    expect(hasRpeCap({ percentage: 70, percentage_basis: "training_max", rpe: "7", manual_override: true })).toBe(false);
  });

  it("a set over the cap brings the next one down, never above the plan, and a set within it changes nothing", () => {
    // 165 × 4 @8 with a cap of 6: e1RM 165 / 0.837 = 197.1; 4 reps @6 = 0.786 → 154.9 → 152.5
    expect(capAdjustedLoad({ planned: 165, last: { load: 165, reps: 4, rpe: 8 }, cap: 6, targetReps: 4, step: 2.5 })).toBe(152.5);
    expect(capAdjustedLoad({ planned: 165, last: { load: 165, reps: 4, rpe: 6 }, cap: 6, targetReps: 4, step: 2.5 })).toBeNull();
    expect(capAdjustedLoad({ planned: 165, last: { load: 165, reps: 4, rpe: null }, cap: 6, targetReps: 4, step: 2.5 })).toBeNull();
    // half a point over still steps down at least one plate
    expect(capAdjustedLoad({ planned: 165, last: { load: 165, reps: 4, rpe: 6.5 }, cap: 6, targetReps: 4, step: 2.5 })).toBeLessThanOrEqual(162.5);
  });
});

describe("the athlete's workout card (source)", () => {
  const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  it("fills a planned % load into untouched weight cells, adopted as shown (no draft)", () => {
    expect(wdv).toContain("autoFillSuggestedWeight={autoFillPlanned}");
    expect(wdv).toContain("const plannedFillRef = useRef<string | null>");
    expect(wdv).toMatch(/setLoadPaired\(next\);\s*adoptShownAsSaved\(true\);/);
  });
  it("says where the weight came from once (the % line) and when a set went over its cap", () => {
    expect(wdv).toContain("data-pct-line");
    expect(wdv).not.toContain("data-planned-load-label");
    expect(wdv).toContain("computed.max ?? (computed.refLift ? { lift: computed.refLift, unit: computed.unit } : null)");
    expect(wdv).toContain("data-rpe-cap-next");
  });
  it("reads the reference lift and the logged e1RM", () => {
    expect(wdv).toContain("family: refFamily,");
    expect(wdv).toContain("loggedE1rmByFamily={loggedE1rmByFamily}");
  });
});
