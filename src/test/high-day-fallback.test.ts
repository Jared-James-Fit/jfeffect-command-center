import { describe, expect, it } from "vitest";
import { DEFAULT_HIGH_WEEKDAY, configuredHighWeekday, resolveClientNutritionDay } from "@/lib/client-nutrition-day";
import { withHighDayFallback } from "@/lib/high-day-schedule";
import { resolveClientWeekDays, type CardioTargetLike } from "@/lib/resolved-client-days";

const week = ["2026-07-06","2026-07-07","2026-07-08","2026-07-09","2026-07-10","2026-07-11","2026-07-12"];
const targets: CardioTargetLike[] = [
  { id: "training", day_type: "Training Day", start_date: "2026-07-01" },
  { id: "high", day_type: "High Day", start_date: "2026-07-01" },
  { id: "non", day_type: "Non-Training Day", start_date: "2026-07-01" },
];
const highDates = (days: ReturnType<typeof resolveClientWeekDays>) =>
  days.filter((d) => d.cardioDayType === "high").map((d) => d.date);

describe("centralized High Day fallback", () => {
  it("is Saturday", () => {
    expect(DEFAULT_HIGH_WEEKDAY).toBe("Saturday");
    expect(withHighDayFallback([])).toEqual(["Saturday"]);
    expect(withHighDayFallback(null)).toEqual(["Saturday"]);
  });

  it("preserves an explicit coach weekday", () => {
    expect(withHighDayFallback(["Wednesday"])).toEqual(["Wednesday"]);
    expect(configuredHighWeekday(["Wednesday"])).toEqual({ weekday: "Wednesday", isFallback: false });
    expect(configuredHighWeekday([])).toEqual({ weekday: "Saturday", isFallback: true });
  });

  it("nutrition: falls back to Saturday only with no selection", () => {
    expect(resolveClientNutritionDay({ dateISO: "2026-07-11" }).dayType).toBe("high");
    expect(resolveClientNutritionDay({ dateISO: "2026-07-12" }).dayType).toBe("non_training");
    expect(resolveClientNutritionDay({ dateISO: "2026-07-11", preferredHighDays: ["Sunday"] }).dayType).toBe("non_training");
    expect(resolveClientNutritionDay({ dateISO: "2026-07-12", preferredHighDays: ["Sunday"] }).dayType).toBe("high");
  });

  it("nutrition: exact-date override beats the fallback", () => {
    const r = resolveClientNutritionDay({
      dateISO: "2026-07-11",
      overrides: [{ override_date: "2026-07-11", day_label: "Non-Training Day" }],
    });
    expect(r.dayType).toBe("non_training");
    expect(r.source).toBe("override");
  });

  it("week resolver (cardio/grocery): Saturday when unconfigured", () => {
    const days = resolveClientWeekDays({ clientId: "c1", weekDates: week, workouts: [], cardioTargets: targets, defaultFullRestDay: false });
    expect(highDates(days)).toEqual(["2026-07-11"]);
  });

  it("week resolver: explicit weekday and exact-date override still win", () => {
    expect(highDates(resolveClientWeekDays({ clientId: "c1", weekDates: week, workouts: [], recurringHighDays: ["Sunday"], cardioTargets: targets, defaultFullRestDay: false }))).toEqual(["2026-07-12"]);
    expect(highDates(resolveClientWeekDays({ clientId: "c1", weekDates: week, workouts: [], highDayOverrides: [{ override_date: "2026-07-08", day_label: "High Day" }], cardioTargets: targets, defaultFullRestDay: false }))).toEqual(["2026-07-08"]);
  });
});
