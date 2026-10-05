import { describe, expect, it } from "vitest";
import { detectMealTiming, listMealHeaders, setMealTiming } from "@/lib/nutrition-targets/meal-timing";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";

const DAY = `Meal 1
100 g oats
30 g whey

Meal 2 (Pre-Workout)
150 g cooked rice
120 g chicken breast

Meal 3: Dinner
200 g potatoes`;

describe("meal timing tags", () => {
  it("detects the common ways coaches and the AI write it", () => {
    expect(detectMealTiming("Meal 2 (Pre-Workout)")).toBe("pre");
    expect(detectMealTiming("Meal 3 – Post Workout")).toBe("post");
    expect(detectMealTiming("Meal 3 (Pre/Post Workout Meal)")).toBe("pre_post");
    expect(detectMealTiming("Pre-training snack")).toBe("pre");
    expect(detectMealTiming("Meal 1")).toBeNull();
    expect(detectMealTiming("200 g potatoes")).toBeNull();
  });

  it("lists meal headers with their tags", () => {
    const h = listMealHeaders(DAY);
    expect(h.map((x) => x.timing)).toEqual([null, "pre", null]);
  });

  it("tags, retags and clears a meal without touching the foods", () => {
    let t = setMealTiming(DAY, 2, "post");
    expect(t).toContain("Meal 3: Dinner (Post-Workout)");
    t = setMealTiming(t, 1, null);
    expect(t).toContain("\nMeal 2\n150 g cooked rice");
    t = setMealTiming(t, 0, "pre");
    expect(t.startsWith("Meal 1 (Pre-Workout)\n100 g oats")).toBe(true);
    expect(t).toContain("200 g potatoes");
  });

  it("structured meals expose the tag with a clean title", () => {
    const s = structureMealPlanDay(setMealTiming(DAY, 2, "post"));
    expect(s.meals.map((m) => m.timing)).toEqual([null, "pre", "post"]);
    expect(s.meals[1].title).toBe("Meal 2");
    expect(s.meals[2].title).toBe("Meal 3 · Dinner");
    expect(s.meals[1].foods).toHaveLength(2);
  });
});
