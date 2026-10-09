import { describe, expect, it } from "vitest";
import { coachFocus, edgesOver, pointsBySource } from "@/lib/league-insights";

// Real October rows (league timezone, Thursday Oct 9 at noon).
const NOW = new Date("2026-10-09T17:00:00Z");
const base = {
  boost_status: "chasing" as const, needed_workouts: 10, projected_total: null, month_start: "2026-10-01",
  month_closed: false, is_final_week: false, match_points: 0, open_workouts: null, adherence_pct: null,
};
const jared = { ...base, total_points: 125, workout_points: 60, logging_points: 20, bodyweight_points: 20, improvement_points: 25,
  community_points: 0, community_posts: 0, workouts_completed: 6, fully_logged: 4, open_workouts: 18 };
const nicole = { ...base, total_points: 155, workout_points: 50, logging_points: 25, bodyweight_points: 40, improvement_points: 40,
  community_points: 0, community_posts: 0, workouts_completed: 5, fully_logged: 5 };

describe("pointsBySource", () => {
  it("maps the league columns and ignores junk", () => {
    expect(pointsBySource({ ...jared, community_points: undefined })).toEqual({
      workouts: 60, logging: 20, bodyweight: 20, records: 25, community: 0, boost: 0,
    });
    expect(pointsBySource({ workout_points: -5, logging_points: "x" as any, bodyweight_points: 0, improvement_points: 0, match_points: 0 }).workouts).toBe(0);
  });
});

describe("edgesOver", () => {
  it("explains where the leader's points come from, biggest gap first", () => {
    expect(edgesOver(nicole, jared)).toEqual([
      { key: "bodyweight", label: "Bodyweight", diff: 20 },
      { key: "records", label: "Records", diff: 15 },
      { key: "logging", label: "Fully logged", diff: 5 },
    ]);
    expect(edgesOver(jared, nicole)).toEqual([{ key: "workouts", label: "Workouts", diff: 10 }]);
  });
});

describe("coachFocus", () => {
  it("picks the two biggest levers: community and daily weigh-ins for Jared", () => {
    const tips = coachFocus(jared, NOW);
    expect(tips.map((t) => t.key)).toEqual(["community", "bodyweight"]);
    expect(tips[0].upTo).toBe(120); // 4 Mon–Sun weeks touch Oct 9–31 → 2 × 15 × 4
    expect(tips[1].upTo).toBe(115); // 23 days left incl. today × 5
    expect(tips[1].detail).toContain("4 of 9 days");
  });

  it("doesn't nag about a habit the athlete already nails", () => {
    const tips = coachFocus(nicole, NOW);
    expect(tips.map((t) => t.key)).toEqual(["community"]); // weighs in 8/9 days, records maxed, logs everything
  });

  it("puts an unlockable Final Week Boost first", () => {
    const tips = coachFocus({ ...jared, is_final_week: true, needed_workouts: 2, projected_total: 205 }, new Date("2026-10-27T17:00:00Z"));
    expect(tips[0].key).toBe("boost");
    expect(tips[0].title).toBe("Finish 2 more workouts to unlock the boost");
  });

  it("flags missed logging when it's the main leak", () => {
    const tips = coachFocus({ ...nicole, fully_logged: 2, community_posts: 4, community_points: 60 }, NOW);
    expect(tips[0].key).toBe("logging");
    expect(tips[0].detail).toContain("3 of your 5 workouts");
  });

  it("says nothing for a closed or past month", () => {
    expect(coachFocus({ ...jared, month_closed: true }, NOW)).toEqual([]);
    expect(coachFocus({ ...jared, month_start: "2026-09-01" }, NOW)).toEqual([]);
  });
});
