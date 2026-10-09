import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// Minimal localStorage stub (test env is "node").
const store = new Map<string, string>();
(
  globalThis as unknown as {
    window: { localStorage: Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear"> };
  }
).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
};
const localStorage = (globalThis as unknown as { window: { localStorage: Storage } }).window
  .localStorage;
import { splitFoodLine, mealMacroNumbers } from "@/lib/nutrition-targets/meal-plan-reader";
import { kcalShares } from "@/components/nutrition/macro-palette";
import { parseMealPlanText, type MealPlanSection } from "@/components/meal-plan-display";
import { mealPlanViewKey, readMealPlanView } from "@/lib/nutrition-targets/meal-plan-view";

const PLAN = `Meal 1
30 g protein isolate
5 g creatine monohydrate
60 g frozen blueberries
Approximate macros:
25 g protein
10 g carbohydrates
1 g fat
1 g fibre

Meal 2 (Pre-Workout)
90 g chicken breast
200 g white jasmine rice
Approx: 33P / 56C / 4F`;

describe("meal plan reader", () => {
  it("splits amounts from food names without losing the coach's wording", () => {
    expect(splitFoodLine("30 g protein isolate")).toEqual({
      amount: "30 g",
      name: "Protein isolate",
    });
    expect(splitFoodLine("0.75 g sea salt or pink salt")).toEqual({
      amount: "0.75 g",
      name: "Sea salt or pink salt",
    });
    expect(splitFoodLine("30g oats")).toEqual({ amount: "30 g", name: "Oats" });
    expect(splitFoodLine("1/2 cup berries")).toEqual({ amount: "1/2 cup", name: "Berries" });
    expect(splitFoodLine("2 large eggs")).toEqual({ amount: "2", name: "Large eggs" });
    expect(splitFoodLine("1 lemon, zested")).toEqual({ amount: "1", name: "Lemon, zested" });
    expect(splitFoodLine("Cook in a non-stick pan")).toEqual({
      amount: null,
      name: "Cook in a non-stick pan",
    });
  });

  it("reads per-meal macros from both paste formats", () => {
    const meals = parseMealPlanText(PLAN).filter(
      (s): s is Extract<MealPlanSection, { kind: "meal" }> => s.kind === "meal",
    );
    expect(meals).toHaveLength(2);
    expect(mealMacroNumbers(meals[0])).toEqual({ protein: 25, carbs: 10, fats: 1, fibre: 1 });
    expect(mealMacroNumbers(meals[1])).toEqual({ protein: 33, carbs: 56, fats: 4 });
    expect(meals[1].timing).toBe("pre");
  });

  it("calorie shares always total 100%", () => {
    const { kcal, pcts } = kcalShares(167, 120, 47);
    expect(kcal).toBe(1571);
    expect(pcts).toEqual([42, 31, 27]);
    expect(kcalShares(33, 33, 33).pcts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(kcalShares(0, 0, 0).pcts).toEqual([0, 0, 0]);
  });

  describe("view preference", () => {
    beforeEach(() => {
      localStorage.clear();
    });
    it("defaults to swipe and remembers scroll per user", () => {
      expect(readMealPlanView("u1")).toBe("swipe");
      localStorage.setItem("jf:" + mealPlanViewKey("u1"), JSON.stringify("scroll"));
      expect(readMealPlanView("u1")).toBe("scroll");
      expect(readMealPlanView("u2")).toBe("swipe");
      localStorage.setItem("jf:" + mealPlanViewKey("u2"), JSON.stringify("garbage"));
      expect(readMealPlanView("u2")).toBe("swipe");
    });
  });

  it("client nutrition page uses the chart and the reader", () => {
    const page = readFileSync("src/routes/_authenticated/portal/nutrition-targets.tsx", "utf8");
    expect(page).toContain("<MacroTargetsChart");
    expect(page).toContain("<MealPlanReader");
    expect(page).not.toContain("collapsibleMeals");
  });

  it("member nutrition surfaces use the same chart and reader", () => {
    const dashboard = readFileSync("src/components/nutrition/NutritionDashboard.tsx", "utf8");
    const panel = readFileSync("src/components/nutrition/MemberMealPlanPanel.tsx", "utf8");
    expect(dashboard).toContain("<MacroTargetsChart");
    expect(dashboard).toContain("setWaterOpen(true)");
    expect(dashboard).not.toContain("MacroBreakdown");
    expect(panel).toContain("<MacroTargetsChart");
    expect(panel).toContain("<MealPlanReader");
  });

  it("keeps coach workout-meal tags and custom labels in the reader", () => {
    const cases: [string, string, string | undefined, string | undefined][] = [
      ["Meal 2 (Pre-Workout)", "Meal 2", undefined, "pre"],
      ["Meal 3 (Post-Workout)", "Meal 3", undefined, "post"],
      ["Meal 3 (Pre/Post Workout Meal)", "Meal 3", undefined, "pre_post"],
      ["Meal 4 - post workout", "Meal 4", undefined, "post"],
      ["Breakfast (Pre-Workout)", "Breakfast", undefined, "pre"],
      ["Meal 5 (Before bed)", "Meal 5", "Before bed", undefined],
      ["Meal 2: Pre-Workout (7am)", "Meal 2", "7am", "pre"],
    ];
    for (const [header, title, subtitle, timing] of cases) {
      const [meal] = parseMealPlanText(`${header}\n90 g chicken breast`);
      expect(meal).toMatchObject({ kind: "meal", title });
      expect((meal as { subtitle?: string }).subtitle).toBe(subtitle);
      expect((meal as { timing?: string | null }).timing ?? undefined).toBe(timing);
    }
    const reader = readFileSync("src/components/nutrition/MealPlanReader.tsx", "utf8");
    expect(reader).toContain("<MealTimingBadge");
    expect(reader).toContain("MEAL_TIMING_HINT[meal.timing]");
    expect(reader).toContain("TIMING_RING[m.timing]");
  });
});
