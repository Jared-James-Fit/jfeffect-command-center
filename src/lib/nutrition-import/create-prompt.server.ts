/**
 * Create with Cleo's prompt (Nov 22 2026): the app's own meal-plan rules
 * (MEAL_PLAN_PROMPT, the same a Nutrition Update's plan is written under) and
 * the member's answers as the same client details (mealPlanUserPrompt), with
 * their own saved targets as the TARGETS. The model writes foods to those
 * numbers; it never decides a number. Server only: AI prompts never ship in a
 * client chunk.
 */
import { MEAL_PLAN_PROMPT, mealPlanUserPrompt } from "@/lib/nutrition-ai-prompts.server";
import { createQAs, createTargetsText, phaseForGoal, type CreateAnswers, type MemberTargets } from "./create";
import { dietTags } from "@/lib/nutrition-targets/food-notes";

export const CREATE_SYSTEM = MEAL_PLAN_PROMPT;

const BUDGET_RULE: Record<CreateAnswers["budget"], string> = {
  tight: "tight: only the cheapest staples (chicken thighs or breast, eggs, ground beef or turkey, canned tuna, rice, potatoes, oats, bananas, frozen vegetables, peanut butter); nothing pricey",
  moderate: "moderate: everyday groceries; nothing specialty or premium",
  flexible: "flexible: whatever fits the plan best, still common grocery-store foods",
};

/** The diets their answers name (the tapped one and any in their words), for the allergy line. */
function dietsOf(a: CreateAnswers): string | null {
  const d = new Set(dietTags([a.avoidText]));
  if (a.diet && a.diet !== "No restrictions") d.add(a.diet);
  return d.size ? [...d].join(", ") : null;
}

/** The whole user prompt for a member's draft. */
export function createUserPrompt(a: CreateAnswers, t: MemberTargets): string {
  const notes = [
    "MEMBER NOTES (follow these; they win over the defaults above, never over an allergy or a diet):",
    `- Cooking: ${
      a.cooking === "simple"
        ? "simple: a few plain foods cooked fresh, nothing that needs a batch cook"
        : "meal prep: they cook once for the week, the same containers (rule 2c)"
    }`,
    `- Budget: ${BUDGET_RULE[a.budget]}`,
    "- This is a draft they edit food by food in the app themselves: keep it plain, easy to change, and on their TARGETS.",
  ].join("\n");
  const menus =
    a.trainingDays > 0
      ? "MENUS (this replaces rule 1): their targets are the same every day, so write ONE menu headed EVERY-DAY MENU, eaten every day. Tag its Pre-Workout and Post-Workout meals around their training time (the TRAINING TIME RULE); on days they don't train they eat the same meals."
      : "MENUS (this replaces rule 1 and the TRAINING TIME RULE): they don't train, so write ONE menu headed EVERY-DAY MENU, with no Pre-Workout or Post-Workout tags.";
  const details = mealPlanUserPrompt(
    createQAs(a),
    createTargetsText(t),
    phaseForGoal(t.goal),
    a.trainingDays > 0 ? "auto" : "none",
    null,
    null,
    notes,
    dietsOf(a),
  );
  return `${details}\n\n${menus}`;
}
