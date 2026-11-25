import { describe, expect, it } from "vitest";
import { weekStart, weekTotals, weeklyRecap, type WeekWorkout } from "@/lib/premium/weekly-recap";

const w = (over: Partial<WeekWorkout> = {}): WeekWorkout => ({ completed_at: "2026-11-18T18:00:00Z", actual_duration_min: 60, logged_sets_count: 20, session_weight_total: 10000, session_weight_unit: "lb", ...over });

describe("Cleo's weekly recap", () => {
  it("2 to 4 cards from what was logged, with last week beside them", () => {
    const r = weeklyRecap([w(), w(), w({ actual_duration_min: 45, logged_sets_count: 18, session_weight_total: 8000 })], [w(), w()])!;
    expect(r.cards.map((c) => [c.key, c.value, c.sub])).toEqual([
      ["workouts", "3", "1 workout more than last week"],
      ["time", "2h 45m", null],
      ["sets", "58", "18 sets more than last week"],
      ["lifted", "28,000 lb", "8,000 lb more than last week"],
    ]);
    expect(r.body).toBe("3 workouts, up from 2. Keep that going.");
  });

  it("never adds pounds to kilograms, never pads, nothing for an empty week", () => {
    expect(weekTotals([w(), w({ session_weight_unit: "kg" })]).lifted).toBeNull();
    expect(weeklyRecap([], null)).toBeNull();
    // one workout with nothing else logged: one card is not a recap
    expect(weeklyRecap([w({ actual_duration_min: null, logged_sets_count: 0, session_weight_total: 0 })], null)).toBeNull();
  });

  it("weeks start on Monday", () => {
    expect(weekStart("2026-11-25")).toBe("2026-11-23");
    expect(weekStart("2026-11-23")).toBe("2026-11-23");
    expect(weekStart("2026-11-29")).toBe("2026-11-23");
  });
});
