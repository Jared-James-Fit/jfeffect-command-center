import { describe, expect, it } from "vitest";
import { audibleStep, percentOf1RM, suggestionPicks, type LoadSuggestion } from "@/lib/load-suggestion";
import { readFileSync } from "node:fs";
import { backoffCards, firstHeavyCards, rangeLift } from "@/lib/workouts/pick-range";

const cold = { source: "history" as const, early: false, carried: false, warmup: null, today: [] };
const hint: LoadSuggestion = { target: 420, low: 395, high: 445, unit: "lb" };
const picks = (o: { mainLift?: boolean; firstOfLift?: boolean; loggedHere?: boolean } = {}) =>
  suggestionPicks({ hint, model: cold, mainLift: o.mainLift ?? true, effortPrescribed: true, firstOfLift: o.firstOfLift, loggedHere: o.loggedHere });

describe("a range only for a barbell squat, bench or deadlift", () => {
  it("the competition lifts and their barbell variations", () => {
    for (const [family, name, equipment] of [
      ["squat", "Competition Squat", "Barbell, Rack"], ["squat", "High Bar Squat", "Barbell, Rack"], ["squat", "2-Count Paused Squat", null],
      ["squat", "Safety Squat Bar Squat", "Barbell, Rack"], ["bench", "Competition Bench", "Barbell, Bench, Rack"], ["bench", "Larsen Press", "Barbell, Bench"],
      ["bench", "Close-Grip Bench Press", "Barbell, Bench, Rack"], ["deadlift", "Competition Deadlift", "Barbell, Rack"],
      ["deadlift", "3-0-0 Tempo to Knee Sumo Deadlift", null], ["deadlift", "Trap Bar Deadlift", "Barbell"],
    ] as const) expect(rangeLift(family, name, equipment)).toBe(true);
  });
  it("never a dumbbell, machine, band or belt-squat lift of those families, or an accessory", () => {
    for (const [family, name, equipment] of [
      ["bench", "Incline Dumbbell Press", "Dumbbell"], ["bench", "Incline Bench Press - Dumbbell", "Dumbbell"], ["bench", "Band Bench Press", "Bands"],
      ["bench", "Chest Bench Press Correct Stance", "Bodyweight"], ["squat", "Belt Squat", "Machine"], ["squat", "Landmine Belt Squat", "Barbell"],
      ["deadlift", "Band Deadlift", "Bands"], ["accessory", "Romanian Deadlift", "Barbell"], [null, "Leg Press", "Machine"],
    ] as const) expect(rangeLift(family, name, equipment)).toBe(false);
  });
});

describe("a range only for the day's first heavy set of the lift", () => {
  const row = (id: string, family: string, name: string, equipment: string | null = "Barbell") =>
    ({ id, exercises: { name, equipment, movement_family: family } });
  const day = [
    row("dl-top", "deadlift", "Competition Deadlift"),
    row("dl-back", "deadlift", "Competition Deadlift"),
    row("db-press", "bench", "Incline Dumbbell Press", "Dumbbell"),
    row("bench", "bench", "Competition Bench"),
    row("cgbp", "bench", "Close-Grip Bench Press"),
    row("rdl", "accessory", "Romanian Deadlift"),
  ];
  it("the first barbell card of each lift; its back-offs and a variation after it read one number", () => {
    expect([...firstHeavyCards(day, new Set())].sort()).toEqual(["bench", "dl-top"]);
  });
  it("a dumbbell press before the bench doesn't take the bench's range", () => {
    expect(firstHeavyCards(day, new Set()).has("db-press")).toBe(false);
    expect(firstHeavyCards(day, new Set(["db-press"])).has("bench")).toBe(true);
  });
  it("once the lift has a set logged on another card (done out of order), one number", () => {
    expect(firstHeavyCards(day, new Set(["cgbp"])).has("bench")).toBe(false);
    // its own logged set is the card's business (loggedHere), not another card's
    expect(firstHeavyCards(day, new Set(["dl-top"])).has("dl-top")).toBe(true);
  });
  it("the engine: a later card of the lift, or any set logged on this card (rated or not), is one number", () => {
    expect(picks()).not.toBeNull();
    expect(picks({ firstOfLift: true })).not.toBeNull();
    expect(picks({ firstOfLift: false })).toBeNull();
    expect(picks({ loggedHere: true })).toBeNull();
    expect(picks({ mainLift: false })).toBeNull();
  });
});

describe("the range is one RPE either side, not an arbitrary percentage", () => {
  it("one audible is a little under one rep in reserve on the chart at 1–8 reps", () => {
    for (const reps of [1, 3, 4, 5, 6, 8]) {
      const oneRpe = percentOf1RM(reps, 2)! / percentOf1RM(reps, 3)! - 1; // RPE 8 vs 7
      expect(oneRpe).toBeGreaterThan(0.028);
      expect(oneRpe).toBeLessThan(0.047);
    }
    // ±one audible (rounded to plates) lands between ±2.5% and ±4% of a typical top set
    for (const [t, u] of [[420, "lb"], [190, "kg"], [305, "lb"]] as const) {
      const pct = audibleStep(t, u) / t;
      expect(pct).toBeGreaterThanOrEqual(0.02);
      expect(pct).toBeLessThanOrEqual(0.04);
    }
  });
});

describe("a back-off card's own number before its top set carries", () => {
  it("a later card of the same exercise is its back-offs, whatever's in between", () => {
    const rows = [{ id: "a", exercises: { id: "sq" } }, { id: "b", exercises: { id: "rdl" } }, { id: "c", exercises: { id: "sq" } }, { id: "d", exercise_id: "rdl" }];
    expect([...backoffCards(rows)]).toEqual(["c", "d"]);
  });
  it("reads its past back-offs as logged, never as the top set they imply", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).toContain('backoffs: followsSameExercise ? "as_logged" : undefined,');
    expect(wdv).toContain("followsSameExercise={backoffRowIds.has(r.id)}");
    expect(wdv).toContain("firstHeavySet={firstHeavyRowIds.has(r.id)}");
  });
});
