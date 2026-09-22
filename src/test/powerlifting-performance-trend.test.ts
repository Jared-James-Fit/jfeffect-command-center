import { describe, expect, it } from "vitest";
import { buildPowerliftingPerformanceTrend } from "@/lib/analytics/powerlifting-performance-trend";

const start = new Date("2026-09-01T00:00:00");
const end = new Date("2026-09-30T23:59:59");

describe("powerlifting performance trend", () => {
  it("plots only the best e1RM from each workout instead of every set", () => {
    const out = buildPowerliftingPerformanceTrend(
      [
        {
          day_id: "day-1",
          date: "2026-09-16T18:00:00",
          movement_family: "squat",
          purpose_label: "Primary",
          est_1rm: 245,
          load: 225,
          reps: 3,
          exercise_name: "Squat",
        },
        {
          day_id: "day-1",
          date: "2026-09-16T18:05:00",
          movement_family: "squat",
          purpose_label: "Primary",
          est_1rm: 510,
          load: 455,
          reps: 4,
          exercise_name: "Squat",
        },
        {
          day_id: "day-1",
          date: "2026-09-16T18:10:00",
          movement_family: "squat",
          purpose_label: "Primary",
          est_1rm: 330,
          load: 300,
          reps: 3,
          exercise_name: "Squat",
        },
      ],
      { family: "squat", role: "all", start, end, displayUnit: "lb" },
    );

    expect(out).toHaveLength(1);
    expect(out[0].est).toBe(510);
    expect(out[0].load).toBe(455);
    expect(out[0].reps).toBe(4);
  });

  it("respects role filters", () => {
    const out = buildPowerliftingPerformanceTrend(
      [
        {
          day_id: "day-1",
          date: "2026-09-16T18:00:00",
          movement_family: "squat",
          purpose_label: "Primary",
          est_1rm: 500,
          load: 455,
          reps: 3,
        },
        {
          day_id: "day-1",
          date: "2026-09-16T18:10:00",
          movement_family: "squat",
          purpose_label: "Secondary",
          est_1rm: 420,
          load: 385,
          reps: 3,
        },
      ],
      { family: "squat", role: "Secondary", start, end, displayUnit: "lb" },
    );

    expect(out).toHaveLength(1);
    expect(out[0].est).toBe(420);
    expect(out[0].role).toBe("Secondary");
  });

  it("converts normalized lb values to kg when the chart is in kg", () => {
    const out = buildPowerliftingPerformanceTrend(
      [
        {
          day_id: "day-2",
          date: "2026-09-20T18:00:00",
          movement_family: "bench",
          purpose_label: "Primary",
          est_1rm: 330.69339,
          load: 220.46226,
          reps: 10,
        },
      ],
      { family: "bench", role: "all", start, end, displayUnit: "kg" },
    );

    expect(out[0].load).toBe(100);
    expect(out[0].est).toBe(150);
  });

  it("drops zero or invalid strength points", () => {
    const out = buildPowerliftingPerformanceTrend(
      [
        {
          day_id: "day-3",
          date: "2026-09-21T18:00:00",
          movement_family: "deadlift",
          purpose_label: "Primary",
          est_1rm: 0,
          load: 0,
          reps: 5,
        },
      ],
      { family: "deadlift", role: "all", start, end, displayUnit: "lb" },
    );

    expect(out).toEqual([]);
  });
});
