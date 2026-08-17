import { describe, it, expect } from "vitest";
import {
  activityOptionValue,
  cardioActivityLabel,
  completionTargetParts,
  formatSpeedRange,
  resolveCardioActivity,
  WALK_STORAGE,
} from "@/lib/cardio-activity";

describe("cardio activity normalization", () => {
  it("maps legacy walking types to Walk + mode", () => {
    expect(cardioActivityLabel({ cardio_type: "Outdoor Walking" })).toBe("Walk · Outdoor");
    expect(cardioActivityLabel({ cardio_type: "Incline Treadmill Walk" })).toBe("Walk · Treadmill");
    expect(cardioActivityLabel({ cardio_type: "Incline Walking" })).toBe("Walk · Treadmill");
  });

  it("uses machine preference to disambiguate bare walking", () => {
    expect(resolveCardioActivity({ cardio_type: "Walking", machine_preference: "Treadmill" }).mode).toBe("treadmill");
    expect(resolveCardioActivity({ cardio_type: "Walking" }).mode).toBeNull();
  });

  it("leaves non-walking activities alone", () => {
    expect(cardioActivityLabel({ cardio_type: "Bike" })).toBe("Bike");
    expect(cardioActivityLabel({ cardio_type: "Stairmaster" })).toBe("Stair Climber");
    expect(cardioActivityLabel({ cardio_type: "Custom", custom_type: "Sled" })).toBe("Sled");
  });

  it("round-trips builder activity values", () => {
    expect(activityOptionValue("Outdoor Walking")).toBe("Walk");
    expect(activityOptionValue("Stairs")).toBe("Stairmaster");
    expect(WALK_STORAGE.treadmill).toBe("Incline Treadmill Walk");
    expect(WALK_STORAGE.outdoor).toBe("Outdoor Walking");
  });

  it("formats speed ranges in both units", () => {
    expect(formatSpeedRange(2, 3)).toBe("2–3 mph");
    expect(formatSpeedRange(2, 3, "kph")).toBe("3.2–4.8 km/h");
    expect(formatSpeedRange(null, null)).toBeNull();
  });

  it("builds one completion target line", () => {
    expect(completionTargetParts({ duration_minutes: 15, steps: 1500, calories: 100 }))
      .toEqual(["15 min", "1,500 steps", "~100 kcal"]);
    expect(completionTargetParts({ duration_minutes: 20, steps: 2000, calories: 135, showCalories: false }))
      .toEqual(["20 min", "2,000 steps"]);
  });
});
