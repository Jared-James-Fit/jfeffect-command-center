import { describe, expect, it } from "vitest";
import { alsoLabel, earnedScopes, formatLoad, formatTonnage, repRecordLabel, tonnageRecordLabel, topScope } from "@/lib/training-records";
import { recordsHeadline } from "@/components/records/training-records";

const rec = (o: Partial<{ atpr: boolean; program_pr: boolean; block_pr: boolean; reps: number }>) =>
  ({ atpr: false, program_pr: false, block_pr: false, reps: 5, ...o });

describe("record terminology", () => {
  it("never produces a bare PR and prioritises ATPR > PROGRAM > BLOCK", () => {
    expect(repRecordLabel(rec({ atpr: true, program_pr: true, block_pr: true }))).toBe("5-REP ATPR");
    expect(repRecordLabel(rec({ program_pr: true, block_pr: true, reps: 3 }))).toBe("3-REP PROGRAM PR");
    expect(repRecordLabel(rec({ block_pr: true, reps: 12 }))).toBe("12-REP BLOCK PR");
    expect(repRecordLabel(rec({}))).toBeNull();
    expect(earnedScopes(rec({ atpr: true, block_pr: true }))).toEqual(["atpr", "block_pr"]);
    expect(alsoLabel(rec({ atpr: true, program_pr: true, block_pr: true }))).toBe("PROGRAM PR · BLOCK PR");
    expect(topScope(rec({ block_pr: true }))).toBe("block_pr");
  });
  it("labels tonnage records with their scope", () => {
    expect(tonnageRecordLabel({ atpr: true, program_pr: true, block_pr: true })).toBe("WORKOUT TONNAGE ATPR");
    expect(tonnageRecordLabel({ atpr: false, program_pr: false, block_pr: true })).toBe("BLOCK TONNAGE PR");
    expect(tonnageRecordLabel({ atpr: false, program_pr: false, block_pr: false })).toBeNull();
  });
  it("headline says ATPR only for all-time records", () => {
    const base = { workout_key: "k", tonnage_kg: 1000, exercise_tonnage: [], tonnage: { atpr: false, program_pr: false, block_pr: false } };
    expect(recordsHeadline({ ...base, records: [{ ...rec({ block_pr: true }), set_id: "1", exercise_id: null, exercise_key: "x", exercise_name: "Squat", load_kg: 100 }] })).toBe("NEW BLOCK PR!");
    expect(recordsHeadline({ ...base, records: [{ ...rec({ atpr: true, block_pr: true }), set_id: "1", exercise_id: null, exercise_key: "x", exercise_name: "Squat", load_kg: 100 }] })).toBe("NEW ATPR!");
    expect(recordsHeadline({ ...base, records: [] })).toBeNull();
  });
});

describe("units", () => {
  it("shows kg and lb users their own unit", () => {
    expect(formatLoad(185, "kg")).toBe("185 kg");
    expect(formatLoad(224.528, "lb")).toBe("495 lb");
    expect(formatLoad(102.0583, "lb")).toBe("225 lb");
    expect(formatTonnage(18420, "kg")).toBe("18,420 kg");
    expect(formatTonnage(1000, "lb")).toBe("2,205 lb");
  });
});

import { computeWorkoutSummary, countsTowardTonnage } from "@/lib/workout-summary";

describe("tonnage = qualifying completed weight × reps", () => {
  const base = { row_id: "r", actual_rpe: null, actual_load_unit: "kg" as const };
  it("excludes incomplete, assisted, bodyweight, warm-up and unloaded sets", () => {
    expect(countsTowardTonnage({ ...base, actual_load: 100, actual_reps: 5, completed_at: "x" })).toBe(true);
    expect(countsTowardTonnage({ ...base, actual_load: 100, actual_reps: 5, completed_at: null })).toBe(false);
    expect(countsTowardTonnage({ ...base, actual_load: 20, actual_reps: 8, completed_at: "x", load_type: "assisted" })).toBe(false);
    expect(countsTowardTonnage({ ...base, actual_load: 0, actual_reps: 10, completed_at: "x", load_type: "bodyweight" })).toBe(false);
    expect(countsTowardTonnage({ ...base, actual_load: 60, actual_reps: 5, completed_at: "x", is_working_set: false })).toBe(false);
  });
  it("sums only qualifying sets in the athlete's unit", () => {
    const s = computeWorkoutSummary(
      [{ id: "r", sets: 4 } as any],
      [
        { ...base, actual_load: 220, actual_reps: 3, completed_at: "x" },
        { ...base, actual_load: 200, actual_reps: 4, completed_at: "x" },
        { ...base, actual_load: 200, actual_reps: 4, completed_at: null },
        { ...base, actual_load: 30, actual_reps: 8, completed_at: "x", load_type: "assisted" },
      ],
      { displayUnit: "kg" },
    );
    expect(s.totalLifted).toBe(220 * 3 + 200 * 4);
  });
});

describe("weight records (heaviest ever, any reps)", () => {
  it("labels by scope and never says a bare PR", async () => {
    const { weightRecordLabel } = await import("@/lib/training-records");
    expect(weightRecordLabel({ atpr: true, program_pr: false, block_pr: true })).toBe("WEIGHT ATPR");
    expect(weightRecordLabel({ atpr: false, program_pr: true, block_pr: true })).toBe("WEIGHT PROGRAM PR");
    expect(weightRecordLabel({ atpr: false, program_pr: false, block_pr: true })).toBe("WEIGHT BLOCK PR");
    expect(weightRecordLabel({ atpr: false, program_pr: false, block_pr: false })).toBeNull();
    expect(weightRecordLabel(null)).toBeNull();
  });

  it("is computed from each workout's heaviest set against earlier completed workouts, any reps", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261004220000_training_load_records.sql", "utf8");
    expect(sql).toContain("ORDER BY s.workout_key, s.exercise_key, s.load_kg DESC, s.reps DESC, s.set_id");
    expect(sql).toMatch(/WHERE p\.completed AND p\.exercise_key = h\.exercise_key\s+AND p\.workout_key <> h\.workout_key AND p\.ord < h\.ord/);
    expect(sql).toContain("'load_records', loads");
    const league = readFileSync("supabase/migrations/20261004220500_league_records_include_weight.sql", "utf8");
    expect(league).toContain("from public.client_load_records(c.client_id) y");
    expect(league).toContain("group by c.client_id, r.exercise_key"); // still one score per lift
  });
});
