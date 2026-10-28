import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MEAL_PLAN_PROMPT,
  mealPlanUserPrompt,
  quickPastePrompt,
  type QA,
} from "@/lib/nutrition-ai-prompts";

const QAS: QA[] = [
  { label: "Sex", value: "Male" },
  { label: "Current fasted bodyweight? (lbs)", value: "201" },
  { label: "Goal", value: "Lose body fat" },
  { label: "Any allergies? list all and explain", value: "None" },
  { label: "How many meals can you have per day? (3 minimum)", value: "5" },
  { label: "List all of your foods + preferences", value: "Chicken, rice, oats" },
  { label: "Training days per week", value: "4" },
  { label: "What time do you usually train?", value: "Evening (5–8pm)" },
  { label: "How do you like to eat before training?", value: "A full meal 1–2 hours before" },
];

describe("Copy ChatGPT prompt (Quick Paste)", () => {
  it("fills the client details from the Nutrition Update and keeps the workout-meal rules", () => {
    const p = quickPastePrompt({
      client: { name: "David McIntyre", sex: "Male", age: 34 },
      qas: QAS,
      targetsText: "TRAINING DAY\nCalories: 2200",
    });
    expect(p.startsWith("You are a nutrition coach.")).toBe(true);
    expect(p).toContain("Client name: David McIntyre");
    expect(p).toContain("- Bodyweight: 201");
    expect(p).toContain("- Training days per week: 4");
    expect(p).toContain("- Preferred foods: Chicken, rice, oats");
    expect(p).toContain("- Meals per day: 5");
    expect(p).toContain("TRAINING TIME RULE: Trains in the evening");
    expect(p).toContain('"Meal X (Pre-Workout)"');
    expect(p).toContain("TARGETS (match each menu's Daily Total");
    expect(p).toContain("Calories: 2200");
    // the details come before the format rules, like the coach's old template
    expect(p.indexOf("CLIENT DETAILS")).toBeLessThan(p.indexOf("FORMAT RULES"));
  });

  it("leaves the numbers to fill in when the AI hasn't written targets", () => {
    const p = quickPastePrompt({ client: "David McIntyre", qas: QAS, targetsText: null });
    expect(p).toContain("- Phase / goal: Lose body fat");
    expect(p).toContain("- Daily calorie target: (fill in for each day-type menu)");
    expect(p).not.toContain("TARGETS (match");
    expect(p).not.toContain("see targets");
  });

  it("is the blank template, with workout meals, when there's no Nutrition Update", () => {
    const p = quickPastePrompt({ client: "New Client", phase: "Fat Loss" });
    expect(p).toContain("CLIENT DETAILS (fill in):");
    expect(p).toContain("- Phase / goal: Fat Loss");
    expect(p).toContain("- Usual training time:");
    expect(p).toContain("Pre-Workout");
    expect(p).toContain(MEAL_PLAN_PROMPT.slice(MEAL_PLAN_PROMPT.indexOf("FORMAT RULES")));
  });

  it("the AI's own pass is unchanged when it has targets", () => {
    const u = mealPlanUserPrompt(QAS, "TRAINING DAY\nCalories: 2200");
    expect(u).toContain("- Daily calorie target: use the CALORIE TARGETS below");
    expect(u).toContain("- Phase / goal: use the Goal from the TARGETS below");
  });

  it("asks for bodybuilding-simple plans: plain foods, default staples, vegetables sized as a side", () => {
    expect(MEAL_PLAN_PROMPT).toContain("BODYBUILDING SIMPLE");
    expect(MEAL_PLAN_PROMPT).toMatch(/Never a recipe, dressing, vinaigrette/);
    expect(MEAL_PLAN_PROMPT).toContain("Protein defaults: chicken breast and lean ground beef");
    expect(MEAL_PLAN_PROMPT).toContain("Carb defaults: white rice, potatoes and sweet potatoes");
    expect(MEAL_PLAN_PROMPT).toContain("never bigger than the carb food in the same meal");
    expect(MEAL_PLAN_PROMPT).toContain("Swap:");
    // A fibre target forced vegetables up to match the rice; fibre is reported, never chased.
    const u = mealPlanUserPrompt(QAS, "TRAINING DAY\nCalories: 2200");
    expect(u).not.toMatch(/14 g per 1000 kcal/);
    expect(u).toContain("never a target to chase");
    expect(quickPastePrompt({ qas: QAS })).toContain("BODYBUILDING SIMPLE");
  });

  it("the paste box no longer has its own blank copy of the prompt", () => {
    const src = readFileSync("src/components/nutrition/MealPlanBulkPaste.tsx", "utf8");
    expect(src).not.toContain("CHATGPT_PROMPT");
    expect(src).toContain("quickPastePrompt(");
    const dialog = readFileSync("src/components/nutrition-target-dialog.tsx", "utf8");
    expect(dialog).toMatch(/<MealPlanBulkPaste\s+clientId=/);
  });
});
