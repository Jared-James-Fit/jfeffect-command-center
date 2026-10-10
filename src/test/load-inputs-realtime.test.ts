import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyOptimisticSetResult, optimisticNormalizedLoads } from "@/lib/optimistic-set-result";
import { smoothedBodyweightKgAt } from "@/lib/bodyweight";

describe("optimistic set results (instant suggestion updates)", () => {
  const rows = [{ id: "a", row_id: "r1", set_index: 1, actual_load: 100, entered_value: 100, entered_unit: "kg", normalized_kg: 100, normalized_lb: 220.46, actual_reps: 5, completed_at: "x", actual_rpe_num: null }];
  it("patches an existing set and recomputes normalized loads like the DB trigger", () => {
    const out = applyOptimisticSetResult(rows, { row_id: "r1", set_index: 1, entered_value: 225, entered_unit: "lb", actual_load: 225, actual_load_unit: "lb", actual_reps: 5, actual_rpe_num: 7 }, "a")!;
    expect(out).toHaveLength(1);
    expect(out[0].normalized_lb).toBe(225);
    expect(out[0].normalized_kg).toBeCloseTo(102.06, 2);
    expect(out[0].actual_rpe_num).toBe(7);
    expect(rows[0].normalized_kg).toBe(100); // never mutates the cache in place
  });
  it("adds a new set with a temporary id", () => {
    const out = applyOptimisticSetResult(rows, { row_id: "r1", set_index: 2, entered_value: 105, entered_unit: "kg", actual_reps: 5 }, null)!;
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe("optimistic:r1:2");
    expect(out[1].normalized_kg).toBe(105);
  });
  it("clears loads for a bodyweight / empty set and leaves non-array caches alone", () => {
    expect(optimisticNormalizedLoads(null, "kg").normalized_kg).toBeNull();
    expect(applyOptimisticSetResult(undefined, { row_id: "r1", set_index: 1 }, null)).toBeUndefined();
  });
  it("is wired before the write, with a rollback on failure", () => {
    const src = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    const patchAt = src.indexOf("applyOptimisticSetResult(old, payload, existing?.id ?? null)");
    const writeAt = src.indexOf("adapter.upsertPlRowResultRaw(payload, existing.id)");
    expect(patchAt).toBeGreaterThan(0);
    expect(patchAt).toBeLessThan(writeAt);
    expect(src).toContain("Roll the optimistic patch back");
  });
});

describe("smoothed bodyweight", () => {
  const s = [
    { date: "2026-09-01", kg: 90 }, { date: "2026-09-28", kg: 92 }, { date: "2026-09-30", kg: 93 }, { date: "2026-10-03", kg: 94 },
  ];
  it("averages the last 7 days", () => {
    expect(smoothedBodyweightKgAt(s, Date.parse("2026-10-04T12:00:00Z"))).toBeCloseTo((92 + 93 + 94) / 3, 6);
  });
  it("falls back to the latest within 30 days, else null", () => {
    expect(smoothedBodyweightKgAt(s, Date.parse("2026-09-20T12:00:00Z"))).toBe(90);
    expect(smoothedBodyweightKgAt(s, Date.parse("2026-12-01T12:00:00Z"))).toBeNull();
  });
});

describe("history feeding suggestions", () => {
  const src = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  it("uses confirmed sets only, paged past the 1,000-row cap", () => {
    expect(src).toMatch(/\.not\("completed_at", "is", null\)\s+\.order\("completed_at", \{ ascending: false \}\)/);
    expect(src).toContain("fetchAllPages((from, to) =>");
  });
  it("passes bodyweight into the model and recomputes when it changes", () => {
    expect(src).toContain("warmup: warmupForModel, bodyweightKg });");
    expect(src).toMatch(/warmupForModel\?\.rpe, bodyweightKg\]\);/);
  });
});
