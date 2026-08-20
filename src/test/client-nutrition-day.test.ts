import { describe, expect, it } from "vitest";
import {
  DEFAULT_HIGH_WEEKDAY,
  configuredHighWeekday,
  normalizeDayLabel,
  pickPlanDayIndex,
  resolveClientNutritionDay,
  resolvePlanDaySelection,
  weekdayForISO,
} from "@/lib/client-nutrition-day";
import { buildCookbookQuerySpec, COOKBOOK_PAGE_SIZE } from "@/lib/recipes";

// 2026-08-15 = Saturday, 2026-08-17 = Monday, 2026-08-19 = Wednesday
const SATURDAY = "2026-08-15";
const MONDAY = "2026-08-17";
const WEDNESDAY = "2026-08-19";

describe("day type priority", () => {
  it("weekday helper is correct", () => {
    expect(weekdayForISO(SATURDAY)).toBe("Saturday");
    expect(weekdayForISO(MONDAY)).toBe("Monday");
  });

  it("High Day beats a scheduled workout", () => {
    const r = resolveClientNutritionDay({
      dateISO: WEDNESDAY,
      preferredHighDays: ["Wednesday"],
      workoutDates: [WEDNESDAY],
    });
    expect(r.dayType).toBe("high");
    expect(r.source).toBe("high_day");
  });

  it("workout beats rest", () => {
    const r = resolveClientNutritionDay({
      dateISO: MONDAY,
      preferredHighDays: ["Wednesday"],
      workoutDates: [MONDAY],
    });
    expect(r.dayType).toBe("training");
    expect(r.source).toBe("workout");
  });

  it("falls back to non-training", () => {
    const r = resolveClientNutritionDay({
      dateISO: MONDAY,
      preferredHighDays: ["Wednesday"],
      workoutDates: [],
    });
    expect(r.dayType).toBe("non_training");
    expect(r.source).toBe("default");
  });

  it("exact-date override beats the recurring High Day and the workout", () => {
    const r = resolveClientNutritionDay({
      dateISO: WEDNESDAY,
      preferredHighDays: ["Wednesday"],
      workoutDates: [WEDNESDAY],
      overrides: [{ override_date: WEDNESDAY, day_label: "Non-Training Day" }],
    });
    expect(r.dayType).toBe("non_training");
    expect(r.source).toBe("override");
  });

  it("an admin override can move the High Day onto another date", () => {
    const r = resolveClientNutritionDay({
      dateISO: MONDAY,
      preferredHighDays: ["Wednesday"],
      overrides: [{ override_date: MONDAY, day_label: "High Day" }],
    });
    expect(r.dayType).toBe("high");
    expect(r.source).toBe("override");
  });
});

describe("Saturday fallback", () => {
  it("is used only when the coach made no selection", () => {
    expect(DEFAULT_HIGH_WEEKDAY).toBe("Saturday");
    expect(configuredHighWeekday([]).weekday).toBe("Saturday");
    expect(configuredHighWeekday([]).isFallback).toBe(true);
    expect(configuredHighWeekday(["Sunday"]).weekday).toBe("Sunday");
    expect(configuredHighWeekday(["Sunday"]).isFallback).toBe(false);
  });

  it("never overrides a coach selection", () => {
    const r = resolveClientNutritionDay({ dateISO: SATURDAY, preferredHighDays: ["Sunday"], workoutDates: [] });
    expect(r.dayType).toBe("non_training");
    expect(r.highWeekday).toBe("Sunday");
  });

  it("never beats an exact-date override", () => {
    const r = resolveClientNutritionDay({
      dateISO: SATURDAY,
      preferredHighDays: [],
      overrides: [{ override_date: SATURDAY, day_label: "Training Day" }],
    });
    expect(r.dayType).toBe("training");
    expect(r.source).toBe("override");
  });

  it("flags the fallback High Day as suggested", () => {
    const r = resolveClientNutritionDay({ dateISO: SATURDAY, preferredHighDays: [] });
    expect(r.dayType).toBe("high");
    expect(r.suggested).toBe(true);
    expect(r.highWeekdayIsFallback).toBe(true);
  });

  it("flags an unknown schedule as suggested", () => {
    const r = resolveClientNutritionDay({
      dateISO: MONDAY,
      preferredHighDays: ["Saturday"],
      scheduleKnown: false,
    });
    expect(r.suggested).toBe(true);
  });
});

describe("plan day matching (one selected state for targets + meals)", () => {
  const days = [
    { day_label: "TRAINING-DAY MENU", calories: 2600 },
    { day_label: "NON-TRAINING-DAY MENU", calories: 2200 },
    { day_label: "HIGH-DAY MENU", calories: 3100 },
  ];

  it("labels normalize without confusing non-training with training", () => {
    expect(normalizeDayLabel("NON-TRAINING-DAY MENU")).toBe("non_training");
    expect(normalizeDayLabel("Training Day")).toBe("training");
    expect(normalizeDayLabel("HIGH-DAY MENU")).toBe("high");
    expect(normalizeDayLabel("Rest")).toBe("non_training");
    expect(normalizeDayLabel("")).toBeNull();
  });

  it("a manual view switch moves targets and meals together", () => {
    for (const t of ["training", "non_training", "high"] as const) {
      const idx = pickPlanDayIndex(days, t);
      expect(idx).toBeGreaterThanOrEqual(0);
      // Same index is used for the macro targets and the meal notes.
      expect(days[idx].day_label.toLowerCase()).toContain(t === "non_training" ? "non-training" : t);
    }
  });

  it("never substitutes another coach day when one is missing", () => {
    expect(pickPlanDayIndex([{ day_label: "TRAINING-DAY MENU" }], "high")).toBe(-1);
    expect(pickPlanDayIndex([], "training")).toBe(-1);
  });

  it("keeps exact coach-created titles independently reviewable by stable ID", () => {
    const uploaded = [
      { id: "training", day_label: "Training Day" },
      { id: "friday", day_label: "Training Day (Friday Only)" },
      { id: "off", day_label: "OFF-DAY" },
    ];

    const automatic = resolvePlanDaySelection(uploaded, "training", null);
    expect(automatic).toMatchObject({ automaticPlanDayId: "training", selectedPlanDayId: "training", isManual: false });

    const friday = resolvePlanDaySelection(uploaded, "training", "friday");
    expect(friday).toMatchObject({ automaticPlanDayId: "training", selectedPlanDayId: "friday", isManual: true });
    expect(uploaded.find((day) => day.id === friday.selectedPlanDayId)?.day_label).toBe("Training Day (Friday Only)");

    const offDay = resolvePlanDaySelection(uploaded, "high", "off");
    expect(offDay).toMatchObject({ automaticPlanDayId: null, selectedPlanDayId: "off", isManual: true });
    expect(uploaded.find((day) => day.id === offDay.selectedPlanDayId)?.day_label).toBe("OFF-DAY");
  });

  it("resolution is pure — inputs are not mutated (no coach writes)", () => {
    const overrides = [{ override_date: MONDAY, day_label: "High Day" }];
    const preferred = ["Wednesday"];
    const snapshot = JSON.stringify({ overrides, preferred, days });
    resolveClientNutritionDay({ dateISO: MONDAY, overrides, preferredHighDays: preferred });
    pickPlanDayIndex(days, "high");
    expect(JSON.stringify({ overrides, preferred, days })).toBe(snapshot);
  });
});

describe("cookbook batching / search / filters", () => {
  it("batches 12 per page", () => {
    const p0 = buildCookbookQuerySpec({});
    expect(COOKBOOK_PAGE_SIZE).toBe(12);
    expect(p0.from).toBe(0);
    expect(p0.to).toBe(11);
    const p2 = buildCookbookQuerySpec({ page: 2 });
    expect(p2.from).toBe(24);
    expect(p2.to).toBe(35);
  });

  it("Recommended applies no category filter and Snacks maps to Snack", () => {
    expect(buildCookbookQuerySpec({ category: "Recommended" }).category).toBeNull();
    expect(buildCookbookQuerySpec({ category: "Snacks" }).category).toBe("Snack");
    expect(buildCookbookQuerySpec({ category: "Breakfast" }).category).toBe("Breakfast");
  });

  it("trims search and drops empty terms", () => {
    expect(buildCookbookQuerySpec({ search: "  chicken " }).search).toBe("chicken");
    expect(buildCookbookQuerySpec({ search: "   " }).search).toBeNull();
  });

  it("combines filters as AND across groups, OR within aliases", () => {
    const spec = buildCookbookQuerySpec({ filters: ["high-protein", "lower-calorie", "quick"] });
    expect(spec.tagGroups).toEqual([["high-protein"], ["low-calorie", "fat-loss", "lower-calorie"]]);
    expect(spec.maxPrepMinutes).toBe(20);
  });
});
