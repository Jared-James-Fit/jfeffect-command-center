/**
 * The meals a coach's plan day lists, for the food log's "From your plan".
 * Its own file: it reads the meal plan parser (a component module), which
 * the server functions that import food-log.ts never need.
 */

import { mealMacroNumbers } from "@/lib/nutrition-targets/meal-plan-reader";
import { parseMealPlanText } from "@/components/meal-plan-display";
import { kcalFromMacros, type LoggedMeal, type PlanMeal } from "@/lib/food-log";

/**
 * The meals a coach's plan day lists, with their macros, so a client logs
 * "Meal 2" in one tap. Only meals whose protein, carbs and fat the plan
 * states (the same numbers the meal plan card shows); calories from them.
 */
export function planMealsFromNotes(notes: string | null | undefined): PlanMeal[] {
  const text = String(notes ?? "").trim();
  if (!text) return [];
  const out: PlanMeal[] = [];
  for (const s of parseMealPlanText(text)) {
    if (s.kind !== "meal") continue;
    const m = mealMacroNumbers(s);
    if (!m || m.protein == null || m.carbs == null || m.fats == null) continue;
    const title = s.title.replace(/\s+/g, " ").trim();
    out.push({
      name: title || "Plan meal",
      protein_g: m.protein,
      carbs_g: m.carbs,
      fat_g: m.fats,
      calories: kcalFromMacros(m.protein, m.carbs, m.fats),
    });
  }
  return out;
}

/** Whether a logged meal is this plan meal (same name that day), so it reads "Logged". */
export function isPlanMealLogged(meal: PlanMeal, logged: Pick<LoggedMeal, "name">[]): boolean {
  const key = meal.name.trim().toLowerCase();
  return logged.some((l) => String(l.name ?? "").trim().toLowerCase() === key);
}

