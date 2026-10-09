/**
 * Pure helpers behind the client meal plan reader: split a coach food line
 * into amount + name, and read a meal's macros from either paste format.
 */
import type { MealPlanSection } from "@/components/meal-plan-display";

type MealSection = Extract<MealPlanSection, { kind: "meal" }>;

const AMOUNT_LINE =
  /^(~?\s*(?:\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|[½¼¾⅓⅔])(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?\s*(?:g|kg|mg|ml|l|oz|lbs?|tbsp|tsp|cups?|scoops?|slices?)?)\s+(.+)$/i;

/** "30 g protein isolate" → amount "30 g", name "Protein isolate". Anything else stays a note line. */
export function splitFoodLine(line: string): { amount: string | null; name: string } {
  const m = line.trim().match(AMOUNT_LINE);
  if (!m) return { amount: null, name: line.trim() };
  const amount = m[1]
    .replace(/\s+/g, " ")
    .replace(/(\d)\s*([a-z]+)$/i, "$1 $2")
    .trim();
  const name = m[2].trim();
  return { amount, name: name.charAt(0).toUpperCase() + name.slice(1) };
}

export type MealMacros = { protein?: number; carbs?: number; fats?: number; fibre?: number };

/** Numbers from either macro format the coach paste supports. */
export function mealMacroNumbers(
  meal: Pick<MealSection, "approx" | "approxMacros">,
): MealMacros | null {
  const out: MealMacros = {};
  for (const line of meal.approxMacros?.items ?? []) {
    const m = line.match(/(\d+(?:\.\d+)?)\s*g?\s*(protein|carb\w*|fat\w*|fib(?:re|er)s?)/i);
    if (!m) continue;
    const n = Number(m[1]);
    const w = m[2].toLowerCase();
    if (w.startsWith("prot")) out.protein = n;
    else if (w.startsWith("carb")) out.carbs = n;
    else if (w.startsWith("fat")) out.fats = n;
    else out.fibre = n;
  }
  if (meal.approx) {
    for (const m of meal.approx.matchAll(/(\d+(?:\.\d+)?)\s*G?\s*(FIB(?:RE|ER)|[PCF])\b/gi)) {
      const n = Number(m[1]);
      const k = m[2].toUpperCase();
      if (k === "P") out.protein ??= n;
      else if (k === "C") out.carbs ??= n;
      else if (k === "F") out.fats ??= n;
      else out.fibre ??= n;
    }
  }
  return Object.keys(out).length ? out : null;
}
