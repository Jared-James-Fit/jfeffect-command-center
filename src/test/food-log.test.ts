import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  kcalFromMacros,
  localDateOf,
  localDayBounds,
  loggedAtFor,
  plausibleDay,
  plausibleWeekStart,
  quickAddCalories,
  shiftDate,
  sumMacros,
  weekDays,
  weekStartFor,
  weekSummary,
} from "@/lib/food-log";
import { isPlanMealLogged, planMealsFromNotes } from "@/lib/food-log-plan";

const read = (p: string) => readFileSync(p, "utf8");

describe("a food-log day is the person's own day", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("local midnight to local midnight, a valid window the server accepts", () => {
    const { start, end } = localDayBounds("2026-11-15");
    const s = new Date(start);
    expect([s.getFullYear(), s.getMonth(), s.getDate(), s.getHours(), s.getMinutes()]).toEqual([2026, 10, 15, 0, 0]);
    expect(new Date(end).getDate()).toBe(16);
    expect(plausibleDay(start, end)).toBe(true);
    expect(plausibleWeekStart(weekStartFor("2026-11-15"), start)).toBe(true);
    // a window that isn't a day falls back to the server's own
    expect(plausibleDay(start, new Date(Date.parse(start) + 3 * 86400000).toISOString())).toBe(false);
    expect(plausibleDay("nope", end)).toBe(false);
  });

  it("an evening meal is filed under the day it was eaten (not UTC's tomorrow)", () => {
    const eightPm = new Date(2026, 10, 15, 20, 0).toISOString();
    expect(localDateOf(eightPm)).toBe("2026-11-15");
    const { start, end } = localDayBounds("2026-11-15");
    expect(eightPm >= start && eightPm < end).toBe(true);
  });

  it("logging for a past day lands at its local noon; today is now", () => {
    expect(loggedAtFor("2026-11-15", "2026-11-15")).toBeUndefined();
    const noon = new Date(loggedAtFor("2026-11-13", "2026-11-15")!);
    expect([noon.getDate(), noon.getHours()]).toEqual([13, 12]);
    expect(shiftDate("2026-11-01", -1)).toBe("2026-10-31");
  });
});

describe("totals and quick add", () => {
  it("adds up what was logged, numbers or numeric strings", () => {
    expect(
      sumMacros([
        { calories: 500, protein_g: "40", carbs_g: 50, fat_g: 10 },
        { calories: "250", protein_g: 25, carbs_g: null, fat_g: "5.5" },
      ]),
    ).toEqual({ calories: 750, protein: 65, carbs: 50, fat: 15.5 });
  });

  it("left blank, calories come from the label's macros; typed, they win", () => {
    expect(kcalFromMacros(40, 50, 10)).toBe(450);
    expect(quickAddCalories("", "40", "50", "10")).toBe(450);
    expect(quickAddCalories("520", "40", "50", "10")).toBe(520);
    expect(quickAddCalories("0", "40", "", "")).toBe(0);
  });
});

describe("the week behind a day", () => {
  it("7 days ending on the day, each with its own target and what was logged", () => {
    const meals = [
      { logged_at: new Date(2026, 10, 15, 8).toISOString(), calories: 600, protein_g: 50 },
      { logged_at: new Date(2026, 10, 15, 21).toISOString(), calories: 1700, protein_g: 120 },
      { logged_at: new Date(2026, 10, 12, 13).toISOString(), calories: 1500, protein_g: 100 },
    ];
    const days = weekDays("2026-11-15", meals, (d) => ({ calories: d === "2026-11-15" ? 2400 : 2100, protein: 180, carbs: null, fat: null }));
    expect(days.map((d) => d.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(days[6]).toMatchObject({ calories: 2300, protein: 170, meals: 2, target: 2400 });
    expect(days[3]).toMatchObject({ calories: 1500, meals: 1, target: 2100 });
    const sum = weekSummary(days);
    expect(sum).toEqual({ logged: 2, avgCalories: 1900, avgProtein: 135, onTarget: 1, withTarget: 2 });
  });
});

describe("a coach's plan meals log in one tap", () => {
  it("reads each meal's macros from the plan text (both formats), calories from them", () => {
    const notes = [
      "Meal 1 (Pre-Workout)",
      "75 g Oats (dry weight)",
      "1 scoop whey",
      "Approx: 40P / 60C / 8F",
      "",
      "Meal 2",
      "150 g Chicken breast",
      "200 g Rice (cooked)",
      "Approximate Macros:",
      "45 g protein",
      "56 g carbs",
      "5 g fat",
      "",
      "Meal 3",
      "Whatever you like",
    ].join("\n");
    const meals = planMealsFromNotes(notes);
    expect(meals.map((m) => [m.protein_g, m.carbs_g, m.fat_g, m.calories])).toEqual([
      [40, 60, 8, 472],
      [45, 56, 5, 449],
    ]);
    expect(meals[0].name).toMatch(/^Meal 1/);
    expect(isPlanMealLogged(meals[1], [{ name: "meal 2" }])).toBe(true);
    expect(isPlanMealLogged(meals[0], [{ name: "Meal 2" }])).toBe(false);
    expect(planMealsFromNotes("")).toEqual([]);
  });
});

describe("the Food Log screen", () => {
  const panel = read("src/components/nutrition/DailyNutritionPanel.tsx");
  it("never reads a UTC day", () => {
    for (const f of ["src/components/nutrition/DailyNutritionPanel.tsx", "src/components/nutrition/TodaysIntakeCard.tsx", "src/components/nutrition/food-log-context.tsx"]) {
      expect(read(f), f).not.toContain("toISOString().slice(0, 10)");
    }
    expect(read("src/lib/nutrition-dashboard.functions.ts")).toContain("dayBounds(data.date, data.dayStart, data.dayEnd)");
  });
  it("one red action (Log food); coach targets on a coaching client's log", () => {
    expect(panel.match(/<Button className="h-11 w-full text-base"/g)).toHaveLength(1);
    expect(panel).toContain("plan?.targetFor(d) ?? memberTarget");
    expect(read("src/routes/_authenticated/portal/nutrition-targets.tsx")).toContain("<FoodLogPlanProvider value={foodLogPlan}>");
  });
  it("a logged meal opens to edit; a delete has Undo", () => {
    expect(panel).toContain("<EditMealSheet");
    expect(panel).toMatch(/toast\(`Removed \$\{was\.name\}`, \{\s*action: \{\s*label: "Undo"/);
  });
});
