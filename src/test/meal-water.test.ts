import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  formatDayWater,
  parseWaterTarget,
  splitWaterAcrossMeals,
} from "@/lib/nutrition-targets/meal-water";

describe("water split across the meals", () => {
  it("reads the coach's water target however it's typed", () => {
    expect(parseWaterTarget("3.5 L")).toEqual({ ml: 3500, unit: "ml" });
    expect(parseWaterTarget("3.5L")).toEqual({ ml: 3500, unit: "ml" });
    expect(parseWaterTarget("3,5 litres")).toEqual({ ml: 3500, unit: "ml" });
    expect(parseWaterTarget("3500 ml")).toEqual({ ml: 3500, unit: "ml" });
    expect(parseWaterTarget("120 oz")).toEqual({ ml: 3549, unit: "oz" });
    expect(parseWaterTarget("14 cups")).toEqual({ ml: 3500, unit: "ml" });
    expect(parseWaterTarget("3")).toEqual({ ml: 3000, unit: "ml" });
    expect(parseWaterTarget("lots")).toBeNull();
    expect(parseWaterTarget("")).toBeNull();
    expect(parseWaterTarget("0.1 L")).toBeNull();
  });

  it("splits evenly in 50 ml glasses that add up to the day", () => {
    const even = splitWaterAcrossMeals(3500, [null, null, null, null, null]);
    expect(even).toEqual([700, 700, 700, 700, 700]);
    const odd = splitWaterAcrossMeals(3500, [null, null, null, null, null, null]);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(3500);
    expect(odd.every((v) => v % 50 === 0)).toBe(true);
  });

  it("gives the meals around training a bit more", () => {
    const w = splitWaterAcrossMeals(3500, [null, null, "pre", "post", null]);
    expect(w.reduce((a, b) => a + b, 0)).toBe(3500);
    expect(w[2]).toBeGreaterThan(w[0]);
    expect(w[3]).toBeGreaterThan(w[4]);
  });

  it("keeps ounces in ounces", () => {
    const oz = splitWaterAcrossMeals(3549, [null, null, null, null], "oz");
    expect(oz).toEqual([30, 30, 30, 30]);
    expect(formatDayWater(3549, "oz")).toBe("120 oz");
    expect(formatDayWater(3500, "ml")).toBe("3.5 L");
    expect(formatDayWater(3000, "ml")).toBe("3 L");
  });

  it("the client's Nutrition page leads with the meal plan, then groceries, then targets; rules and disclaimer are taps", () => {
    const page = readFileSync("src/routes/_authenticated/portal/nutrition-targets.tsx", "utf8");
    const meal = page.indexOf("<MealPlanReader");
    const grocery = page.indexOf("<GroceryListEntryCard");
    const targets = page.indexOf("<MacroTargetsChart");
    expect(meal).toBeGreaterThan(0);
    expect(meal).toBeLessThan(grocery);
    expect(grocery).toBeLessThan(targets);
    expect(page).toContain("water={plan.water ?? null}");
    expect(page).toContain("How to weigh your food");
    expect(page).toContain("<NutritionInfoSheet");
    expect(page).not.toContain("Food-Weighing Rules</div>");
    const reader = readFileSync("src/components/nutrition/MealPlanReader.tsx", "utf8");
    expect(reader).toContain("data-meal-water");
  });
});
