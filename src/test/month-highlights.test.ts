import { describe, expect, it } from "vitest";
import { compactWeight, computeMonthHighlights, percentChange, weightComparison } from "@/lib/month-highlights";

const NOW = new Date(2026, 9, 15, 12, 0, 0); // Oct 15, 2026 (local)

let n = 0;
const set = (iso: string, load: number, reps: number, extra: Record<string, unknown> = {}) => ({
  id: `s${n++}`,
  date: new Date(iso).toISOString(),
  load,
  reps,
  counts_load: load > 0,
  exercise_id: "squat",
  exercise_name: "Squat",
  muscle_group: "Quads",
  est_1rm: load > 0 ? load * (1 + reps / 30) : 0,
  ...extra,
});

describe("computeMonthHighlights", () => {
  it("totals weight lifted this month and compares to the same point last month", () => {
    const results = [
      set("2026-10-02T15:00:00", 100, 10), // 1,000
      set("2026-10-02T15:10:00", 100, 10), // 1,000
      set("2026-10-10T15:00:00", 200, 5), //  1,000
      set("2026-09-03T15:00:00", 100, 10), //  1,000 (same point)
      set("2026-09-20T15:00:00", 300, 10), //  3,000 (after the 15th → full-month only)
    ];
    const h = computeMonthHighlights(results, NOW);
    expect(h.monthLabel).toBe("October");
    expect(h.prevMonthLabel).toBe("September");
    expect(h.weightLb).toBe(3000);
    expect(h.prevSamePointLb).toBe(1000);
    expect(h.prevMonthTotalLb).toBe(4000);
    expect(h.workouts).toBe(2);
    expect(h.prevWorkouts).toBe(1);
  });

  it("never counts bodyweight/unloaded sets as weight lifted but still counts the workout", () => {
    const h = computeMonthHighlights([set("2026-10-05T10:00:00", 0, 12, { counts_load: false })], NOW);
    expect(h.weightLb).toBe(0);
    expect(h.workouts).toBe(1);
    expect(h.hasData).toBe(true);
  });

  it("ignores future-dated rows and reports no data for brand-new clients", () => {
    expect(computeMonthHighlights([], NOW).hasData).toBe(false);
    expect(computeMonthHighlights([set("2026-10-20T10:00:00", 100, 10)], NOW).weightLb).toBe(0);
  });

  it("counts a weekly streak and keeps it alive through an empty current week", () => {
    // Weeks (Mon-start): Oct 12 (current, empty), Oct 5, Sep 28, then a gap before Sep 14.
    const alive = computeMonthHighlights(
      [set("2026-10-06T10:00:00", 100, 5), set("2026-09-29T10:00:00", 100, 5), set("2026-09-15T10:00:00", 100, 5)],
      NOW,
    );
    expect(alive.streakWeeks).toBe(2);
    const withCurrent = computeMonthHighlights(
      [set("2026-10-13T10:00:00", 100, 5), set("2026-10-06T10:00:00", 100, 5), set("2026-09-29T10:00:00", 100, 5)],
      NOW,
    );
    expect(withCurrent.streakWeeks).toBe(3);
    expect(computeMonthHighlights([set("2026-08-10T10:00:00", 100, 5)], NOW).streakWeeks).toBe(0);
  });

  it("reports the strongest lift with its 30-day gain, and the most-trained muscle", () => {
    const h = computeMonthHighlights(
      [
        set("2026-08-20T10:00:00", 200, 5), // before the 30-day window
        set("2026-10-10T10:00:00", 220, 5),
      ],
      NOW,
    );
    expect(h.topLift?.name).toBe("Squat");
    expect(h.topLift?.gainLb).toBeGreaterThan(0);
  });
});

describe("display helpers", () => {
  it("formats weights compactly in either unit", () => {
    expect(compactWeight(0, "lb")).toBe("0");
    expect(compactWeight(842, "lb")).toBe("842");
    expect(compactWeight(4210, "lb")).toBe("4.2k");
    expect(compactWeight(42500, "lb")).toBe("43k");
    expect(compactWeight(22046.226, "kg")).toBe("10k");
  });

  it("picks a relatable comparison", () => {
    expect(weightComparison(500)).toBeNull();
    expect(weightComparison(1000)?.text).toBe("about the weight of a grand piano");
    expect(weightComparison(12000)?.text).toBe("about the weight of an elephant");
    expect(weightComparison(48000)?.text).toBe("about 2 school buses");
    expect(weightComparison(2_000_000)?.emoji).toBe("🐋");
  });

  it("computes percent change only when there's a baseline", () => {
    expect(percentChange(118, 100)?.text).toBe("+18%");
    expect(percentChange(94, 100)?.text).toBe("-6%");
    expect(percentChange(50, 0)).toBeNull();
  });
});
