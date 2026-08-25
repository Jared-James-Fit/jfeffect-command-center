import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  resolveEstimatedWorkoutMinutes,
  formatEstimatedMinutes,
} from "@/lib/workout-estimate";
import { estimateDayMinutes } from "@/lib/pl-programs";

describe("resolveEstimatedWorkoutMinutes — canonical source priority", () => {
  it("prefers the day-level coach override over everything", () => {
    expect(
      resolveEstimatedWorkoutMinutes({
        day: { duration_override_min: 75, duration_estimate_min: 60 },
        block: { estimated_minutes: 45 },
        rows: [{ sets: 5 }],
      }),
    ).toBe(75);
  });

  it("falls back to the stored day estimate when no override", () => {
    expect(
      resolveEstimatedWorkoutMinutes({
        day: { duration_override_min: null, duration_estimate_min: 50 },
        block: { estimated_minutes: 45 },
      }),
    ).toBe(50);
  });

  it("falls back to the block-level per-workout estimate", () => {
    expect(
      resolveEstimatedWorkoutMinutes({
        day: { duration_override_min: null, duration_estimate_min: null },
        block: { estimated_minutes: 45 },
      }),
    ).toBe(45);
  });

  it("computes a deterministic estimate from prescribed rows when no stored value exists", () => {
    const rows = [
      { sets: 4, time_profile: "main_lift", rest_seconds: 240 },
      { sets: 3, time_profile: "secondary", rest_seconds: 120 },
    ];
    const expected = estimateDayMinutes(rows as any);
    expect(expected).toBeGreaterThan(0);
    expect(resolveEstimatedWorkoutMinutes({ day: null, block: null, rows: rows as any })).toBe(expected);
  });

  it("fails gracefully (null) when no estimate exists anywhere", () => {
    expect(resolveEstimatedWorkoutMinutes({})).toBeNull();
    expect(resolveEstimatedWorkoutMinutes({ day: {}, block: {}, rows: [] })).toBeNull();
  });

  it("ignores non-positive stored values", () => {
    expect(
      resolveEstimatedWorkoutMinutes({
        day: { duration_override_min: 0, duration_estimate_min: -5 },
        block: { estimated_minutes: 40 },
      }),
    ).toBe(40);
  });

  it("estimated duration is separate from actual duration (no completion input exists)", () => {
    // The resolver contract: it accepts day/block/rows only — completed
    // workouts keep showing pl_day_completions.actual_duration_min via the
    // caller (CompactWorkoutSummaryRow hides the estimate once completed).
    const estimate = resolveEstimatedWorkoutMinutes({ block: { estimated_minutes: 45 } });
    expect(estimate).toBe(45);
  });
});

describe("formatEstimatedMinutes", () => {
  it("formats compact labels", () => {
    expect(formatEstimatedMinutes(45)).toBe("≈ 45 min");
    expect(formatEstimatedMinutes(44.6)).toBe("≈ 45 min");
  });
  it("returns empty string for missing/invalid values", () => {
    expect(formatEstimatedMinutes(null)).toBe("");
    expect(formatEstimatedMinutes(0)).toBe("");
    expect(formatEstimatedMinutes(undefined)).toBe("");
  });
});

describe("no competing duration system", () => {
  it("reuses the existing pl-programs estimator rather than a new one", () => {
    const src = readFileSync("src/lib/workout-estimate.ts", "utf8");
    expect(src).toContain('from "@/lib/pl-programs"');
    expect(src).toContain("estimateDayMinutes");
    // No DB writes / no new storage keys.
    expect(src).not.toMatch(/\.from\(|insert|update|localStorage/);
  });
});
