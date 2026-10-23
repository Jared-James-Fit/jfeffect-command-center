import { describe, expect, it } from "vitest";
import {
  DEFAULT_HIGH_WEEKDAY,
  carryPlanDayRules,
  configuredHighWeekday,
  normalizeDayLabel,
  pickPlanDayForDate,
  pickPlanDayIndex,
  planDayRule,
  resolveClientNutritionDay,
  resolvePlanDaySelection,
  weekdayForISO,
  weekdaysFromLabel,
} from "@/lib/client-nutrition-day";
import { buildGroceryList } from "@/lib/grocery-list";
import { buildCookbookQuerySpec, COOKBOOK_PAGE_SIZE, recipeMethodBadge } from "@/lib/recipes";

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
    const r = resolveClientNutritionDay({
      dateISO: SATURDAY,
      preferredHighDays: ["Sunday"],
      workoutDates: [],
    });
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
      expect(days[idx].day_label.toLowerCase()).toContain(
        t === "non_training" ? "non-training" : t,
      );
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
    const monday = { dayType: "training", weekday: "Monday" } as const;

    const automatic = resolvePlanDaySelection(uploaded, monday, null);
    expect(automatic).toMatchObject({
      automaticPlanDayId: "training",
      selectedPlanDayId: "training",
      isManual: false,
    });

    const friday = resolvePlanDaySelection(uploaded, monday, "friday");
    expect(friday).toMatchObject({
      automaticPlanDayId: "training",
      selectedPlanDayId: "friday",
      isManual: true,
    });
    expect(uploaded.find((day) => day.id === friday.selectedPlanDayId)?.day_label).toBe(
      "Training Day (Friday Only)",
    );

    const offDay = resolvePlanDaySelection(
      uploaded,
      { dayType: "high", weekday: "Saturday" },
      "off",
    );
    expect(offDay).toMatchObject({ selectedPlanDayId: "off", isManual: true });
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

describe("which saved plan day a date gets (Jared's Friday)", () => {
  // Jared's plan as saved: the Friday day sits second, after the general one.
  const jared = [
    { id: "train", day_label: "Training Day" },
    { id: "fri", day_label: "Training Day (Friday Only)" },
    { id: "rest", day_label: "Rest Day" },
  ];
  const FRIDAY = "2026-10-23";
  const SAT = "2026-10-24";
  const pickOn = (
    days: any[],
    dateISO: string,
    workoutDates: string[],
    preferredHighDays: string[] = [],
  ) => {
    const r = resolveClientNutritionDay({ dateISO, workoutDates, preferredHighDays });
    const pick = pickPlanDayForDate(days, {
      dayType: r.dayType,
      baseType: r.baseType,
      weekday: weekdayForISO(dateISO),
    });
    return { id: pick.index >= 0 ? days[pick.index].id : null, dayType: pick.dayType };
  };

  it("a training Friday gets the Friday-only day, every other training day the general one", () => {
    expect(weekdayForISO(FRIDAY)).toBe("Friday");
    expect(pickOn(jared, FRIDAY, [FRIDAY])).toEqual({ id: "fri", dayType: "training" });
    expect(pickOn(jared, "2026-10-19", ["2026-10-19"])).toEqual({
      id: "train",
      dayType: "training",
    });
    // a Friday with no workout is a rest day: the Friday day is for training Fridays
    expect(pickOn(jared, FRIDAY, [])).toEqual({ id: "rest", dayType: "non_training" });
  });

  it("a plan with no High Day doesn't leave the fallback Saturday empty", () => {
    // no High Day picked by the coach: Saturday is the suggested High Day, but this plan has none
    expect(pickOn(jared, SAT, [SAT])).toEqual({ id: "train", dayType: "training" });
    expect(pickOn(jared, SAT, [])).toEqual({ id: "rest", dayType: "non_training" });
    // a plan that has one still gets it
    const withHigh = [...jared, { id: "high", day_label: "High Day" }];
    expect(pickOn(withHigh, SAT, [SAT])).toEqual({ id: "high", dayType: "high" });
  });

  it("the coach's own setting beats the name, and Only when picked is never automatic", () => {
    const days = [
      { id: "a", day_label: "Training Day" },
      { id: "b", day_label: "Big day", use_on: "training", weekdays: ["Wednesday"] },
      { id: "c", day_label: "Rest Day", use_on: "manual" },
    ];
    expect(pickOn(days, "2026-10-21", ["2026-10-21"]).id).toBe("b");
    expect(pickOn(days, "2026-10-22", ["2026-10-22"]).id).toBe("a");
    expect(pickOn(days, "2026-10-22", []).id).toBeNull();
    // an explicit [] is "any day", whatever the name says
    expect(planDayRule({ day_label: "Training Day (Friday Only)", weekdays: [] }).weekdays).toEqual(
      [],
    );
  });

  it("an every-day day fills in, and a day for the weekday beats it", () => {
    const days = [
      { id: "all", day_label: "Daily" },
      { id: "fri", day_label: "Friday plan" },
      { id: "train", day_label: "Training Day" },
    ];
    expect(pickOn(days, "2026-10-20", []).id).toBe("all");
    expect(pickOn(days, "2026-10-20", ["2026-10-20"]).id).toBe("train");
    expect(pickOn(days, FRIDAY, [FRIDAY]).id).toBe("fri");
    expect(planDayRule({ day_label: "Low Day" }, 1).use).toBe("every_day");
    expect(planDayRule({ day_label: "Low Day" }, 2).use).toBeNull();
  });

  it("reads weekdays from a day's name", () => {
    expect(weekdaysFromLabel("Training Day (Friday Only)")).toEqual(["Friday"]);
    expect(weekdaysFromLabel("Training Day")).toEqual([]);
    expect(weekdaysFromLabel("Non-Training Day")).toEqual([]);
    expect(weekdaysFromLabel("Mon / Wed")).toEqual(["Monday", "Wednesday"]);
    expect(weekdaysFromLabel("Mon-Fri")).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]);
    expect(weekdaysFromLabel("Fri - Mon")).toEqual(["Monday", "Friday", "Saturday", "Sunday"]);
    expect(weekdaysFromLabel("Weekends")).toEqual(["Saturday", "Sunday"]);
    expect(weekdaysFromLabel("Every day but Sunday")).toHaveLength(6);
    expect(weekdaysFromLabel("Training Day (Friday Only, not Sat)")).toEqual(["Friday"]);
    expect(weekdaysFromLabel("Thurs & Sat")).toEqual(["Thursday", "Saturday"]);
    // words that only start like a day aren't one
    expect(weekdaysFromLabel("Saturated fat · Wedding · Monster")).toEqual([]);
  });

  it("a rewrite keeps the coach's setting for every day it keeps by name", () => {
    const before = [
      { day_label: "Training Day", use_on: "training", weekdays: ["Friday"] },
      { day_label: "Rest Day", use_on: "manual", weekdays: null },
    ];
    const after = carryPlanDayRules(before, [
      { day_label: "training day", calories: 2000 },
      { day_label: "High Day", calories: 2600 },
    ]);
    expect(after[0]).toMatchObject({ calories: 2000, use_on: "training", weekdays: ["Friday"] });
    expect(after[1]).toEqual({ day_label: "High Day", calories: 2600 });
  });

  it("the grocery list shops each date for the day it gets", () => {
    const days = [
      { id: "train", day_label: "Training Day", notes: "100g rice" },
      { id: "fri", day_label: "Training Day (Friday Only)", notes: "200g oats" },
      { id: "rest", day_label: "Rest Day", notes: "50g rice" },
    ];
    const list = buildGroceryList({
      planDays: days,
      dayCounts: { training: 2, non_training: 1, high: 0 },
      dates: [
        { dayType: "training", weekday: "Monday" },
        { dayType: "training", weekday: "Friday" },
        { dayType: "non_training", weekday: "Sunday" },
      ],
    });
    const qty = Object.fromEntries(list.items.map((i) => [i.name.toLowerCase(), i.quantityLabel]));
    expect(qty).toMatchObject({ rice: "150 g", oats: "200 g" });
    expect(list.totalDaysCovered).toBe(3);
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
    expect(spec.tagGroups).toEqual([
      ["high-protein"],
      ["low-calorie", "fat-loss", "lower-calorie"],
    ]);
    expect(spec.maxPrepMinutes).toBe(20);
  });

  it("Desserts maps to Dessert", () => {
    expect(buildCookbookQuerySpec({ category: "Desserts" }).category).toBe("Dessert");
  });

  it("Easiest method filters easy tags and sorts fastest first; All keeps newest", () => {
    const easy = buildCookbookQuerySpec({ method: "easiest" });
    expect(easy.methodTags).toContain("easy");
    expect(easy.methodTags).toContain("grab-and-go");
    expect(easy.orderBy).toBe("prep");
    expect(easy.tagGroups).toEqual([]);
    expect(buildCookbookQuerySpec({ method: "pan" }).methodTags).toEqual(["pan", "one-pan"]);
    const all = buildCookbookQuerySpec({ method: "all" });
    expect(all.methodTags).toBeNull();
    expect(all.orderBy).toBe("newest");
  });

  it("labels how a recipe is made", () => {
    expect(recipeMethodBadge(["easy", "air-fryer", "dinner"])).toBe("Air fryer");
    expect(recipeMethodBadge(["easy", "no-cook", "grab-and-go"])).toBe("Store-bought");
    expect(recipeMethodBadge(["high-protein"])).toBeNull();
  });
});
