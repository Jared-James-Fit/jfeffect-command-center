import { describe, expect, it } from "vitest";
import { macroSummary, structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";

const DAY = `PHASE: Muscle Gain
Meal 1
80 g oatmeal
210 g zero sugar Greek yogurt
1 scoop whey
30 g protein powder
Approximate macros:
38 g protein
94 g carbohydrates
16 g fat
12 g fibre
Meal 2
120 g chicken breast
Approximate macros:
46 g protein
78 g carbohydrates
20 g fat
4 g fibre
Daily Total
Approximately 150 g protein, 433 g carbohydrates, 79 g fat and 32 g fibre`;

describe("structureMealPlanDay", () => {
  it("splits meals, foods and per-meal macros; drops totals and the phase line", () => {
    const d = structureMealPlanDay(DAY);
    expect(d.meals.map((m) => m.title)).toEqual(["Meal 1", "Meal 2"]);
    expect(d.meals[0].foods).toEqual([
      { amount: "80 g", name: "oatmeal" },
      { amount: "210 g", name: "zero sugar Greek yogurt" },
      { amount: "1 scoop", name: "whey" },
      { amount: "30 g", name: "protein powder" },
    ]);
    expect(d.meals[0].macros).toEqual({ protein: 38, carbs: 94, fat: 16, fibre: 12 });
    expect(macroSummary(d.meals[1].macros)).toBe("46P · 78C · 20F · 4 fibre");
    expect(d.notes).toEqual([]);
  });

  it("keeps unknown lines as notes", () => {
    const d = structureMealPlanDay("Meal 1\n100 g rice\nSwap rice for potatoes if you want\nDrink 3 L water");
    expect(d.meals[0].notes).toEqual(["Swap rice for potatoes if you want", "Drink 3 L water"]);
  });
});
