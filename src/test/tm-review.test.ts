import { describe, expect, it } from "vitest";
import { recommendFromCalibration, reviewTrainingMax, type TmSet } from "@/lib/workouts/tm-review";

// Bench Training Max 150 kg. Back-offs at 72.5% (108.75 → 107.5–110 on the bar) for 4, RPE cap 6.
const backoff = (date: string, kg: number, rpe: number | null, reps = 4): TmSet => ({ date, pct: 72.5, cap: 6, kg, reps, rpe });

describe("a block Training Max read from its sets", () => {
  it("on plan: at the planned load and at or under the cap", () => {
    const r = reviewTrainingMax({ tmKg: 150, sets: [backoff("2026-11-19", 107.5, 6), backoff("2026-11-19", 107.5, 5.5), backoff("2026-11-21", 110, 6)] });
    expect(r.status).toBe("on_plan");
    expect(r.suggestedKg).toBeNull();
  });

  it("one bad session is only watched, never changed", () => {
    const r = reviewTrainingMax({ tmKg: 150, sets: [backoff("2026-11-19", 107.5, 7.5), backoff("2026-11-19", 107.5, 8), backoff("2026-11-21", 110, 6)] });
    expect(r.status).toBe("watch");
    expect(r.suggestedKg).toBeNull();
  });

  it("two sessions past the cap flag it with a slightly lower Training Max", () => {
    const r = reviewTrainingMax({
      tmKg: 150,
      sets: [backoff("2026-11-19", 107.5, 7.5), backoff("2026-11-19", 107.5, 8), backoff("2026-11-23", 107.5, 7.5), backoff("2026-11-23", 107.5, 7)],
    });
    expect(r.status).toBe("review");
    expect(r.suggestedKg).not.toBeNull();
    expect(r.suggestedKg!).toBeLessThan(150);
    expect(r.suggestedKg!).toBeGreaterThanOrEqual(142.5); // never more than 5% at once
    expect(r.suggestedKg! % 2.5).toBe(0);
  });

  it("loading under the plan to hold the cap counts as running hard", () => {
    const r = reviewTrainingMax({
      tmKg: 150,
      sets: [backoff("2026-11-19", 100, 6), backoff("2026-11-19", 100, 6), backoff("2026-11-23", 100, 6.5), backoff("2026-11-23", 100, 6)],
    });
    expect(r.status).toBe("review");
  });

  it("unrated sets say nothing", () => {
    expect(reviewTrainingMax({ tmKg: 150, sets: [backoff("2026-11-19", 107.5, null)] }).status).toBe("too_early");
  });
});

describe("a missing Training Max from the calibration", () => {
  it("waits for the single", () => {
    expect(recommendFromCalibration({ sets: [] }).status).toBe("waiting");
  });

  it("needs the single's RPE and a rated back-off before it suggests anything", () => {
    expect(recommendFromCalibration({ sets: [{ kg: 220, reps: 1, rpe: null, single: true }] }).status).toBe("need_more");
    expect(recommendFromCalibration({ sets: [{ kg: 220, reps: 1, rpe: 6, single: true }] }).status).toBe("need_more");
  });

  it("is conservative: 92.5% of the estimated max, rounded down, never the old meet pull", () => {
    // 220 × 1 @6 reads ≈ 255; back-offs 170 × 4 @6 read ≈ 216, more than 8% lower, so the two average ≈ 235
    const r = recommendFromCalibration({
      sets: [
        { kg: 220, reps: 1, rpe: 6, single: true },
        { kg: 170, reps: 4, rpe: 6, single: false },
        { kg: 170, reps: 4, rpe: 6, single: false },
      ],
    });
    expect(r.status).toBe("ready");
    expect(r.e1rmKg!).toBeGreaterThan(225);
    expect(r.e1rmKg!).toBeLessThan(245);
    expect(r.suggestedKg!).toBeLessThan(r.e1rmKg!);
    expect(r.suggestedKg! % 2.5).toBe(0);
    expect(r.suggestedKg!).toBeLessThan(270 * 0.9);
  });

  it("the single holds when the back-offs agree", () => {
    const r = recommendFromCalibration({
      sets: [
        { kg: 220, reps: 1, rpe: 6, single: true },
        { kg: 190, reps: 4, rpe: 6.5, single: false },
      ],
    });
    expect(r.status).toBe("ready");
    expect(Math.round(r.e1rmKg!)).toBe(Math.round(220 / 0.863));
    expect(r.basis).toMatch(/single holds/);
  });
});
