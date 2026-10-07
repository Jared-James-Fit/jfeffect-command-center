import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261007090000_records_legacy_completion_match.sql", "utf8");

describe("records count legacy-logged sets finished through a scheduled instance", () => {
  it("keeps the exact completion match first", () => {
    expect(sql).toMatch(/pc\.scheduled_workout_id = r\.scheduled_workout_id\)\s+OR \(r\.scheduled_workout_id IS NULL AND pc\.scheduled_workout_id IS NULL AND pc\.day_id = e\.day_id\)\)/);
  });
  it("falls back to the day's instance completion only when the exact match misses", () => {
    expect(sql).toMatch(/WHERE c0\.completed_at IS NULL AND r\.scheduled_workout_id IS NULL/);
    expect(sql).toMatch(/pc\.scheduled_workout_id IS NOT NULL/);
    expect(sql).toMatch(/coalesce\(c0\.completed_at, c1\.completed_at\)/);
  });
  it("never borrows a completion whose instance logged its own sets", () => {
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.pl_row_results r2\s+WHERE r2\.scheduled_workout_id = pc\.scheduled_workout_id/);
  });
  it("does not rewrite logged data (logger still finds legacy sets)", () => {
    expect(sql).not.toMatch(/UPDATE public\.pl_row_results/i);
  });
  it("keeps the same output shape and stays private", () => {
    expect(sql).toContain("reps int, load_kg numeric, set_completed_at timestamptz)");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.client_qualifying_sets(uuid) FROM PUBLIC, anon, authenticated;");
  });
});
