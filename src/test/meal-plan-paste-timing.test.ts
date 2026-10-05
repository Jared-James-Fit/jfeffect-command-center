import { describe, expect, it } from "vitest";
import { parseMealPlan } from "@/components/nutrition/MealPlanBulkPaste";
import { listMealHeaders } from "@/lib/nutrition-targets/meal-timing";
import { manualMealPlanPrompt, mealPlanUserPrompt } from "@/lib/nutrition-ai-prompts";

const PLAN = `PHASE: Fat Loss

TRAINING-DAY MENU
Meal 1
100 g oats
30 g whey

Approximate macros:
40 g protein
60 g carbohydrates
8 g fat
8 g fibre

Meal 2 (Pre-Workout)
150 g cooked rice
120 g chicken breast

Meal 3 (Post-Workout)
200 g potatoes
150 g lean beef

Daily Total
Approximately 180 g protein, 250 g carbohydrates, 60 g fat and 30 g fibre

NON-TRAINING-DAY MENU
Meal 1
100 g oats

Daily Total
Approximately 170 g protein, 180 g carbohydrates, 65 g fat and 28 g fibre`;

describe("pasted plans keep workout-meal tags", () => {
  it("tags survive parsing into days", () => {
    const days = parseMealPlan(PLAN);
    const training = days.find((d) => /training/i.test(d.day_label) && !/non/i.test(d.day_label))!;
    expect(training).toBeTruthy();
    expect(listMealHeaders(training.notes).map((h) => h.timing)).toEqual([null, "pre", "post"]);
    const rest = days.find((d) => /non/i.test(d.day_label))!;
    expect(listMealHeaders(rest.notes).every((h) => h.timing === null)).toBe(true);
  });

  it("prompts carry training time and the coach override", () => {
    const qas = [
      { label: "What time do you usually train?", value: "Evening (5–8pm)" },
      { label: "How do you like to eat before training?", value: "Small snack 30–60 min before" },
    ];
    const p = mealPlanUserPrompt(qas, "CALORIE TARGETS", "Fat Loss", "post_only");
    expect(p).toContain("Usual training time: Evening (5–8pm)");
    expect(p).toContain("Eating before training: Small snack");
    expect(p).toContain("COACH WORKOUT MEALS: Client trains fasted");
    expect(mealPlanUserPrompt(qas, "x", null, "auto")).not.toContain("COACH WORKOUT MEALS");
    expect(manualMealPlanPrompt(qas, "x", null, "pre_post")).toContain("(Pre-Workout)");
  });
});
