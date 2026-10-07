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

describe("one workout identity for points summary and community stats", () => {
  const m = readFileSync("supabase/migrations/20261007100000_completion_workout_key.sql", "utf8");
  it("defines the shared key with the same fallback rule as the records", () => {
    expect(m).toContain("CREATE OR REPLACE FUNCTION public.completion_workout_key(_completion_id uuid)");
    expect(m).toMatch(/r\.scheduled_workout_id IS NULL AND e\.day_id = pc\.day_id\s+AND r\.completed_at IS NOT NULL/);
    expect(m).toContain("REVOKE ALL ON FUNCTION public.completion_workout_key(uuid) FROM PUBLIC, anon, authenticated;");
  });
  it("community stats/exercises and the points summary use it instead of the strict match", () => {
    expect(m.match(/k := public\.completion_workout_key\(pc\.id\);/g)?.length).toBe(2);
    expect(m).toContain("k := public.completion_workout_key(comp.id);");
    expect(m).not.toMatch(/pc\.scheduled_workout_id IS NULL AND r\.scheduled_workout_id IS NULL/);
  });
  it("still finds a completion opened by its scheduled instance", () => {
    expect(m).toMatch(/pc\.scheduled_workout_id = _scheduled_workout_id\s+OR \(pc\.day_id = _day_id AND public\.completion_workout_key\(pc\.id\) = k\)/);
  });
});
