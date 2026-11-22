import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }) } }));

const { MealBuilder } = await import("@/components/nutrition-studio/meal-builder");
const { memberFoodLogPlan, trainingWeekdays } = await import("@/components/nutrition-studio/member-food-log-plan");

const DAY = `Meal 1
100 g cooked chicken breast
250 g cooked sweet potatoes

Approximate macros:
36 g protein
53 g carbohydrates
4 g fat

Meal 2 (Post-Workout)
1 scoop whey protein
1 medium banana
1 cup grandma's stew

Approximate macros:
40 g protein
50 g carbohydrates
10 g fat`;

function render(el: any) {
  const qc = new QueryClient();
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el));
}

describe("the meal builder", () => {
  it("shows each meal, its foods by name, a kept line, and the day against its targets", () => {
    const html = render(createElement(MealBuilder, { notes: DAY, onChange: () => {}, targets: { calories: 1500, protein: 120 } }));
    expect(html.match(/data-meal-card/g)?.length).toBe(2);
    expect(html).toContain("Chicken breast, cooked");
    expect(html).toContain("Sweet potatoes, cooked");
    expect(html).toContain("Whey protein powder");
    expect(html).toContain("grandma&#x27;s stew");
    expect(html).toContain("not in the food list");
    expect(html).toContain("Post-Workout");
    // the day's meals as written (36+40 g protein) against its 1,500 kcal target
    expect(html).toContain("P 76");
    expect(html).toMatch(/kcal under 1,500/);
  });
});

describe("a member's food log reads their plan", () => {
  const plan = {
    days: [
      { id: "t", day_label: "Training day", use_on: "training", calories: 2500, protein: 180, carbs: 280, fats: 70, notes: DAY },
      { id: "r", day_label: "Rest day", use_on: "rest", calories: 2100, protein: 180, carbs: 180, fats: 70, notes: "Meal 1\n150 g cooked chicken breast" },
    ],
  };
  it("a training weekday gets the training day, any other the rest day", () => {
    const fl = memberFoodLogPlan(plan, trainingWeekdays(["Mon", "wednesday", "Fri"]))!;
    expect(fl.targetFor("2026-11-23")?.calories).toBe(2500); // Monday
    expect(fl.targetFor("2026-11-24")?.calories).toBe(2100); // Tuesday
    expect(fl.mealsFor("2026-11-23").length).toBeGreaterThan(0);
  });
  it("no plan, nothing changes", () => {
    expect(memberFoodLogPlan({ days: [] }, [])).toBeNull();
    expect(memberFoodLogPlan(null, [])).toBeNull();
  });
});
