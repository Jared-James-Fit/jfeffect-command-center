import { describe, it, expect } from "vitest";
import {
  defaultCardioConfigFor,
  INCLINE_TREADMILL_DEFAULT,
  resolveTrainingWeekdays,
  scheduledWeekdaysForDayType,
} from "@/lib/cardio-prescription";

describe("Apply Default Cardio defaults", () => {
  const labels = ["Training Day", "Rest Day", "Non-Training Day", "High Day", "Low Day", "Daily", "Day 1", "Something Custom"];

  it("is an incline treadmill walk for every day type", () => {
    for (const label of labels) {
      expect(defaultCardioConfigFor(label).cardio_type, label).toBe(INCLINE_TREADMILL_DEFAULT.cardio_type);
    }
  });

  it("never defaults to an outdoor activity", () => {
    for (const label of labels) {
      const c = defaultCardioConfigFor(label);
      expect(`${c.cardio_type} ${c.client_notes}`.toLowerCase(), label).not.toContain("outdoor");
    }
  });

  it("keeps the per-day duration/intensity tweaks", () => {
    expect(defaultCardioConfigFor("Training Day").duration_minutes).toBe(INCLINE_TREADMILL_DEFAULT.duration_minutes);
    expect(defaultCardioConfigFor("Low Day")).toMatchObject({ duration_minutes: 30, intensity: "Low Intensity" });
    expect(defaultCardioConfigFor("Daily").duration_minutes).toBe(25);
  });
});

describe("default cardio weekdays", () => {
  // Jennifer Merrells: committed Mon/Tue/Thu/Fri, nothing in preferred, high day Saturday.
  const jennifer = { committed_training_days: ["Monday", "Tuesday", "Thursday", "Friday"], preferred_training_days: [] };
  const training = resolveTrainingWeekdays(jennifer);
  const sched = (dayType: string, fullRestDay: string | null = null) =>
    scheduledWeekdaysForDayType({ dayType, trainingDays: training, highDay: "Saturday", fullRestDay });

  it("prefers committed training days over empty preferred days", () => {
    expect(training).toEqual(["Monday", "Tuesday", "Thursday", "Friday"]);
  });

  it("falls back to preferred days only when nothing is committed", () => {
    expect(resolveTrainingWeekdays({ committed_training_days: [], preferred_training_days: ["Wednesday"] })).toEqual(["Wednesday"]);
    expect(resolveTrainingWeekdays(null)).toEqual([]);
  });

  it("keeps training and non-training days from overlapping", () => {
    expect(sched("Training Day")).toEqual(["Monday", "Tuesday", "Thursday", "Friday"]);
    expect(sched("Non-Training Day")).toEqual(["Wednesday", "Sunday"]);
    expect(sched("Rest Day")).toEqual(["Wednesday", "Sunday"]);
    expect(sched("High Day")).toEqual(["Saturday"]);
  });

  it("drops the full cardio rest day from non-training", () => {
    expect(sched("Non-Training Day", "Sunday")).toEqual(["Wednesday"]);
  });

  it("writes no explicit schedule when training days are unknown (the old bug)", () => {
    const none = (dayType: string) =>
      scheduledWeekdaysForDayType({ dayType, trainingDays: [], highDay: "Saturday", fullRestDay: null });
    // Previously Non-Training became Mon-Fri + Sun and shadowed the training-day target.
    expect(none("Non-Training Day")).toEqual([]);
    expect(none("Training Day")).toEqual([]);
    expect(none("High Day")).toEqual(["Saturday"]);
  });
});
