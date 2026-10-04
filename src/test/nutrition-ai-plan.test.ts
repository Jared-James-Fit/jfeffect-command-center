import { describe, expect, it } from "vitest";
import { parseFoodWeighingRules, parseMealPlan } from "@/components/nutrition/MealPlanBulkPaste";
import { phaseFromPlanText } from "@/lib/nutrition-cardio";
import { answerFor, cleanAiText, mealPlanUserPrompt, TARGETS_PROMPT } from "@/lib/nutrition-ai-prompts";

const PLAN = `TRAINING-DAY MENU
Meal 1
80 g oats
30 g whey protein

Approximate macros:
45 g protein
55 g carbohydrates
6 g fat
8 g fibre

Daily Total
Approximately 180 g protein, 300 g carbohydrates, 60 g fat and 35 g fibre

NON-TRAINING-DAY MENU
Meal 1
200 g chicken breast

Daily Total
Approximately 180 g protein, 200 g carbohydrates, 65 g fat and 30 g fibre

FOOD-WEIGHING RULES
Weigh meat, rice, potatoes and vegetables cooked.
Weigh oats, whey, peanut butter and oils as packaged.`;

describe("nutrition AI plan", () => {
  it("keeps the coach's targets format in the prompt", () => {
    for (const h of ["CLIENT OVERVIEW", "CALORIE TARGETS", "MACRO TARGETS", "CARDIO STEPS TARGETS:", "CARDIO CALORIE TARGETS:"]) {
      expect(TARGETS_PROMPT).toContain(h);
    }
  });

  it("parses the AI meal plan into day targets and keeps the weighing rules", () => {
    const days = parseMealPlan(PLAN);
    expect(days.map((d) => d.day_label)).toEqual(["Training Day", "Non-Training Day"]);
    expect(days[0]).toMatchObject({ protein: 180, carbs: 300, fats: 60, fibre: 35, calories: 2460 });
    expect(days[1].notes).not.toContain("FOOD-WEIGHING");
    expect(parseFoodWeighingRules(PLAN)).toBe(
      "Weigh meat, rice, potatoes and vegetables cooked.\nWeigh oats, whey, peanut butter and oils as packaged.",
    );
    expect(parseFoodWeighingRules("TRAINING-DAY MENU\nMeal 1")).toBeNull();
  });

  it("fills the meal-plan client details from the Fillout-style answers", () => {
    const qas = [
      { label: "Current fasted bodyweight? (lbs)", value: "182" },
      { label: "Any allergies? list all and explain", value: "peanuts" },
      { label: "List all of your foods + preferences", value: "chicken, rice" },
      { label: "How many meals can you have per day? (3 minimum)", value: "4" },
    ];
    expect(answerFor(qas, "allerg")).toBe("peanuts");
    const p = mealPlanUserPrompt(qas, "CALORIE TARGETS\nTraining Day: 2400");
    expect(p).toContain("- Bodyweight: 182");
    expect(p).toContain("- Allergies / dislikes: peanuts");
    expect(p).toContain("- Preferred foods: chicken, rice");
    expect(p).toContain("Training Day: 2400");
  });

  it("auto-detects the phase from a pasted plan or AI targets", () => {
    expect(phaseFromPlanText("PHASE: Fat Loss\n\nTRAINING-DAY MENU")).toBe("Fat Loss");
    expect(phaseFromPlanText("CLIENT OVERVIEW\nName: A\nGoal: Build muscle / gain weight")).toBe("Muscle Gain");
    expect(phaseFromPlanText("Phase / Goal: Recomp")).toBe("Recomp");
    expect(phaseFromPlanText("TRAINING-DAY MENU\nMeal 1")).toBeNull();
    expect(parseMealPlan("PHASE: Maintenance\n\n" + PLAN)).toHaveLength(2);
  });

  it("strips markdown the model adds", () => {
    expect(cleanAiText("```\n**CLIENT OVERVIEW**\nName: A\n```")).toBe("CLIENT OVERVIEW\nName: A");
  });
});
