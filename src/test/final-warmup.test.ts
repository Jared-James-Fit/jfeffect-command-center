import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeWarmup,
  normalizeWarmupRow,
  pickFinalWarmup,
  warmupInUnit,
  offersLastWarmup,
} from "@/lib/final-warmup";

const w = { id: "a", load: 140, unit: "kg" as const, reps: 2, rpe: 7 };

describe("warm-up set helpers", () => {
  it("converts when the athlete toggles kg/lb mid-session", () => {
    expect(warmupInUnit(w, "kg").load).toBe(140);
    expect(warmupInUnit(w, "lb").load).toBeCloseTo(308.6, 1);
    expect(warmupInUnit({ ...w, unit: "lb", load: 315 }, "kg").load).toBeCloseTo(142.9, 1);
  });
  it("describes it for the chip", () => {
    expect(describeWarmup(w, "kg")).toBe("140 kg × 2 · RPE 7");
    expect(describeWarmup({ ...w, rpe: null }, "kg")).toBe("140 kg × 2");
  });
  it("the final warm-up is the heaviest one, compared across units", () => {
    const sets = [
      { ...w, id: "1", load: 60, reps: 5, rpe: null },
      { ...w, id: "2", load: 300, unit: "lb" as const, reps: 2, rpe: 6 }, // 136 kg
      { ...w, id: "3", load: 100, reps: 3, rpe: null },
    ];
    const f = pickFinalWarmup(sets, "kg")!;
    expect(f.load).toBeCloseTo(136.1, 1);
    expect(f.reps).toBe(2);
    expect(pickFinalWarmup([], "kg")).toBeNull();
  });
  it("normalises DB rows (numeric strings) and drops junk", () => {
    expect(
      normalizeWarmupRow({ id: "x", load: "142.5", unit: "kg", reps: 3, rpe: "7.5" }),
    ).toMatchObject({ load: 142.5, reps: 3, rpe: 7.5 });
    expect(normalizeWarmupRow({ id: "x", load: "0", unit: "kg", reps: 3 })).toBeNull();
    expect(normalizeWarmupRow({ id: "x", load: 100, unit: "stone", reps: 3 })).toBeNull();
  });
});

describe("warm-up sets stay out of everything that counts", () => {
  const sql = readFileSync("supabase/migrations/20261006210000_pl_warmup_sets.sql", "utf8");
  it("lives in its own RLS-protected table, not pl_row_results", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.pl_warmup_sets/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/ALTER TABLE public\.pl_row_results/);
  });
  it("the logger never writes warm-ups to pl_row_results", () => {
    const src = readFileSync("src/components/workout-day/final-warmup-input.tsx", "utf8");
    expect(src).not.toContain("pl_row_results");
    expect(src).toContain("pl_warmup_sets");
  });
});

describe("which lifts offer the last-warm-up gauge", () => {
  it("every loaded compound lift, not just squat / bench / deadlift", () => {
    for (const name of [
      "Romanian Deadlift",
      "Landmine Belt Squat",
      "Leg Press",
      "Bulgarian Split Squat",
      "Barbell Hip Thrust",
      "Incline Dumbbell Press",
      "Overhead Press",
      "Chest Supported Row",
      "Lat Pulldown",
    ]) {
      expect(offersLastWarmup("accessory", name), name).toBe(true);
    }
  });

  it("skips isolation work, where a feeler set is clutter", () => {
    for (const name of [
      "EZ Bar Curl",
      "Tricep Pushdown",
      "Lateral Raise",
      "Cable Fly",
      "Leg Extension",
      "Seated Leg Curl",
      "Standing Calf Raise",
      "Ab Wheel",
    ]) {
      expect(offersLastWarmup("accessory", name), name).toBe(false);
    }
  });

  it("competition-lift families always ramp up, whatever the name", () => {
    expect(offersLastWarmup("squat", "SSB Pin Squat")).toBe(true);
    expect(offersLastWarmup("bench", null)).toBe(true);
    expect(offersLastWarmup("accessory", null)).toBe(false);
  });
});
