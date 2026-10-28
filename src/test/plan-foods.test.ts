import { describe, expect, it } from "vitest";
import { dayFoods, foodKey, planFoodStats } from "@/lib/nutrition-targets/plan-foods";

describe("plan foods (grocery list size)", () => {
  it("one food, however it's written", () => {
    expect(foodKey("Cooked extra lean chicken breast")).toBe(foodKey("chicken breast (cooked)"));
    expect(foodKey("Extra lean ground beef (95/5 cooked)")).toBe(foodKey("cooked ground beef 95% lean"));
    expect(foodKey("Oats (dry)")).toBe(foodKey("oats"));
    expect(foodKey("rice cakes")).toBe(foodKey("rice cake"));
    expect(foodKey("berries")).toBe(foodKey("berry"));
    expect(foodKey("sweet potatoes")).toBe("sweet potato");
  });

  it("reads food lines only (not macro lines, totals or the free meal note)", () => {
    const day = "Meal 1\n50 g oats\n30 g whey protein powder\nApproximate macros:\n31 g protein\n42 g carbohydrates\n\nMeal 4 – Free Meal\nYour choice: pasta or whatever you're craving\n\nDaily Total\nApproximately 107 g protein";
    expect([...dayFoods(day)].sort()).toEqual(["oat", "whey protein powder"]);
  });

  it("counts the whole list and the foods every day shares", () => {
    const s = planFoodStats([
      { notes: "Meal 1\n60 g oats\n200 g cooked white rice\n150 g cooked chicken breast" },
      { notes: "Meal 1\n40 g oats\n120 g cooked white rice\n150 g chicken breast (cooked)" },
      { notes: "Meal 1\n80 g oats\n300 g white rice (cooked)\n150 g chicken breast\n1 bagel" },
    ]);
    expect(s).toMatchObject({ total: 4, everyDay: 3, days: 3 });
  });
});
