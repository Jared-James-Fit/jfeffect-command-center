import { describe, expect, it } from "vitest";
import { summarizeNutritionWeek } from "./weekly-summary";

const dates = ["2026-11-23","2026-11-24","2026-11-25","2026-11-26","2026-11-27","2026-11-28","2026-11-29"];
const days = [
  { day_label: "Training Day", calories: 1765 },
  { day_label: "Non-Training Day", calories: 1657 },
  { day_label: "High Day", calories: 1946 },
];
const context = { workoutDates: [dates[0], dates[1], dates[3], dates[4]], preferredHighDays: ["Saturday"], scheduleKnown: true };

describe("weekly nutrition summary", () => {
  it("sums the assigned days, not an unweighted day-type average", () => {
    const result = summarizeNutritionWeek(days, dates, context);
    expect(result.total).toBe(12320);
    expect(result.average).toBe(1760);
    expect(result.estimated).toBe(false);
  });
  it("does not treat a missing calorie target as zero", () => {
    expect(summarizeNutritionWeek(days.slice(0, 1), dates, context).total).toBeNull();
  });
  it("supports a weekday-specific custom prescription", () => {
    const result = summarizeNutritionWeek([...days, { day_label: "Friday special", use_on: "training", weekdays: ["Friday"], calories: 2000 }], dates, context);
    expect(result.total).toBe(12555);
  });
  it("uses exact-date day-type overrides", () => {
    const result = summarizeNutritionWeek(days, dates, { ...context, overrides: [{ override_date: dates[0], day_label: "Rest" }] });
    expect(result.total).toBe(12212);
  });
  it("marks a fallback high day as estimated", () => {
    expect(summarizeNutritionWeek(days, dates, { ...context, preferredHighDays: null }).estimated).toBe(true);
  });
  it("supports a daily plan without any high-day prescription", () => {
    expect(summarizeNutritionWeek([{ day_label: "Every day", calories: 1800 }], dates, context).total).toBe(12600);
  });
  it("rejects partial or duplicate weeks", () => {
    expect(summarizeNutritionWeek(days, dates.slice(0, 6), context).total).toBeNull();
    expect(summarizeNutritionWeek(days, [...dates.slice(0, 6), dates[0]], context).total).toBeNull();
  });
});
