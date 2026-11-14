import { describe, expect, it } from "vitest";
import { loadingRefsFrom, loadingRefsText, rpeForPercent, withLoadingGuard, type LoadingRefs } from "@/lib/program-intel/loading";
import { builtExerciseSchema, type BuiltBlock } from "@/lib/program-intel/generator-schemas";
import { exerciseRow } from "@/lib/program-intel/next-program";
import { LOADING_RULES } from "@/lib/program-intel/generator-prompts";

const now = Date.parse("2026-11-14T12:00:00Z");
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString().slice(0, 10);

const refs = (over: Partial<LoadingRefs> = {}): LoadingRefs => ({
  squat: { tm: true, oneRm: false, e1rm: true },
  bench: { tm: false, oneRm: false, e1rm: true },
  deadlift: { tm: false, oneRm: false, e1rm: false },
  ...over,
});

const ex = (o: Record<string, unknown>) => builtExerciseSchema.parse({ exercise_id: null, exercise_name: "X", sets: 3, reps: "5", ...o });
const block = (exercises: ReturnType<typeof ex>[]): BuiltBlock => ({
  name: "B1", weeks: 4, week_phases: [], progression_rules: [], days: [{ title: "Day 1", exercises }],
} as unknown as BuiltBlock);
const FAMILY: Record<string, "squat" | "bench" | "deadlift" | null> = {
  "Competition Squat": "squat", "High Bar Squat": "squat", "Competition Bench": "bench", "Competition Deadlift": "deadlift",
  "Lateral Raise": null, "Leg Extension": null, "Hip Thrust": null,
};
const familyOf = (_: unknown, name: string) => FAMILY[name] ?? null;

describe("what's on file per lift", () => {
  it("reads the maxes and whether their logs give a recent e1RM (2+ sessions in 6 weeks)", () => {
    const r = loadingRefsFrom(
      [
        { lift: "Competition Squat", exercise_id: null, one_rm: 220, training_max: 200, estimated_1rm: null, unit: "kg", tested_at: null, source: "manual", active: true },
        { lift: "Paused Squat", exercise_id: null, one_rm: null, training_max: 180, estimated_1rm: null, unit: "kg", tested_at: null, source: "manual", active: true },
      ],
      [
        { lift: "bench", compTrend: { first: 1, last: 1, peak: 1, changePct: 0, slopePerWeek: 0, points: [{ date: daysAgo(3), value: 140 }, { date: daysAgo(10), value: 138 }] } },
        { lift: "deadlift", compTrend: { first: 1, last: 1, peak: 1, changePct: 0, slopePerWeek: 0, points: [{ date: daysAgo(90), value: 250 }, { date: daysAgo(3), value: 255 }] } },
      ] as any,
      now,
    );
    expect(r.squat).toEqual({ tm: true, oneRm: true, e1rm: false });
    expect(r.bench).toEqual({ tm: false, oneRm: false, e1rm: true });
    expect(r.deadlift.e1rm).toBe(false); // one session in the window isn't enough
    expect(loadingRefsText(r)).toContain("Deadlift: no max on file: RPE only");
    expect(loadingRefsText(r)).toContain("Squat: percentage_of may be training_max / 1rm");
  });
});

describe("the loading guard on a built block", () => {
  it("keeps a % of a max that's on file, with its RPE cap", () => {
    const { block: b, changed } = withLoadingGuard(block([ex({ exercise_name: "High Bar Squat", sets: 2, reps: "6", percentage: 65, percentage_of: "training_max", rpe: "6" })]), refs(), familyOf);
    expect(changed).toEqual([]);
    expect(b.days[0].exercises[0]).toMatchObject({ percentage: 65, percentage_of: "training_max", rpe: "6" });
  });

  it("never invents a training max: no TM on file → the RPE that load means", () => {
    const { block: b, changed } = withLoadingGuard(block([ex({ exercise_name: "Competition Deadlift", percentage: 75, percentage_of: "training_max", reps: "5" })]), refs(), familyOf);
    const e = b.days[0].exercises[0];
    expect(e.percentage).toBeNull();
    expect(Number(e.rpe)).toBeGreaterThanOrEqual(5);
    expect(Number(e.rpe)).toBeLessThanOrEqual(9);
    expect(changed[0]).toMatch(/no deadlift training max on file/);
  });

  it("a missing tested 1RM reads their logged e1RM instead (the same thing, from training)", () => {
    const { block: b } = withLoadingGuard(block([ex({ exercise_name: "Competition Bench", percentage: 80, percentage_of: "1rm", reps: "3", rpe: "7" })]), refs(), familyOf);
    expect(b.days[0].exercises[0]).toMatchObject({ percentage: 80, percentage_of: "e1rm", rpe: "7" });
  });

  it("no percentage on accessories: a raise or a leg extension stays RPE / RIR", () => {
    const { block: b, changed } = withLoadingGuard(block([ex({ exercise_name: "Lateral Raise", reps: "12-15", percentage: 60, percentage_of: "e1rm" })]), refs(), familyOf);
    expect(b.days[0].exercises[0]).toMatchObject({ percentage: null, rir: "2" });
    expect(changed[0]).toMatch(/accessory work stays RPE \/ RIR/);
  });

  it("a top-set back-off needs the top set of the same exercise before it", () => {
    const top = ex({ exercise_id: "sq", exercise_name: "Competition Squat", sets: 1, reps: "4", rpe: "7" });
    const back = ex({ exercise_id: "sq", exercise_name: "Competition Squat", sets: 2, reps: "4", percentage: 92.5, percentage_of: "top_set", rpe: "6" });
    expect(withLoadingGuard(block([top, back]), refs(), familyOf).changed).toEqual([]);
    const orphan = withLoadingGuard(block([back]), refs(), familyOf);
    expect(orphan.block.days[0].exercises[0]).toMatchObject({ percentage: null, rpe: "6" });
  });

  it("checks each week with the basis it was written with, and a kept week names it", () => {
    const e = ex({ exercise_name: "High Bar Squat", percentage: 65, percentage_of: "training_max", rpe: "6", weeks: [{ week: 2, percentage: 67.5 }] });
    const { block: b } = withLoadingGuard(block([e]), refs(), familyOf);
    expect(b.days[0].exercises[0].weeks?.[0]).toMatchObject({ percentage: 67.5, percentage_of: "training_max" });
  });

  it("the RPE a percentage means for its reps", () => {
    expect(rpeForPercent(70, "5")).toBe("5"); // easy: ~6 in the tank, never written below RPE 5
    expect(rpeForPercent(80, "5")).toBe("7.5");
    expect(Number(rpeForPercent(90, "2"))).toBeGreaterThanOrEqual(8);
  });
});

describe("a built exercise becomes a row", () => {
  it("writes the basis the generator chose (a % with none named reads as e1RM, as before)", () => {
    expect(exerciseRow(ex({ exercise_name: "High Bar Squat", percentage: 65, percentage_of: "training_max", rpe: "6" }), 1, 0)).toMatchObject({ percentage: 65, percentage_basis: "training_max", rpe: "6" });
    expect(exerciseRow(ex({ exercise_name: "Competition Squat", percentage: 92.5, percentage_of: "top_set", rpe: "6" }), 1, 1)).toMatchObject({ percentage: 92.5, percentage_basis: "top_set" });
    expect(exerciseRow(ex({ exercise_name: "Competition Bench", percentage: 80 }), 1, 0)).toMatchObject({ percentage_basis: "est_1rm" });
    expect(exerciseRow(ex({ exercise_name: "Leg Extension", reps: "12", rir: "2" }), 1, 0)).not.toHaveProperty("percentage");
  });
  it("reads loose words for the basis", () => {
    expect(builtExerciseSchema.parse({ exercise_name: "A", sets: 1, reps: "1", percentage_of: "Training Max" }).percentage_of).toBe("training_max");
    expect(builtExerciseSchema.parse({ exercise_name: "A", sets: 1, reps: "1", percentage_of: "top set" }).percentage_of).toBe("top_set");
    expect(builtExerciseSchema.parse({ exercise_name: "A", sets: 1, reps: "1", percentage_of: "something" }).percentage_of).toBeNull();
  });
});

describe("the prompt's loading rules", () => {
  it("names each method and the never-invent rule", () => {
    for (const s of ["RPE only", "RIR only", "Percentage + RPE cap", "RPE top set + % back-offs", "never invent a training max", "Never a percentage on them"]) expect(LOADING_RULES).toContain(s);
  });
});
