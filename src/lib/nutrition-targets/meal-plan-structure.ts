/**
 * Turn a meal plan day's free text (the paste format) into structured meals
 * for display / PDF: foods with amounts, per-meal macros, and loose notes.
 * Pure and tolerant — anything it doesn't recognise is kept as a note.
 */

export type PlanFood = { amount: string; name: string };
export type PlanMacros = { protein?: number; carbs?: number; fat?: number; fibre?: number };
import { detectMealTiming, stripTimingText, type MealTiming } from "@/lib/nutrition-targets/meal-timing";

export type PlanMeal = { title: string; foods: PlanFood[]; macros: PlanMacros | null; notes: string[]; timing: MealTiming };
export type StructuredDay = { meals: PlanMeal[]; notes: string[] };

const MEAL_HEADER = /^(meal\s*\d+|breakfast|lunch|dinner|snack(\s*\d+)?|pre[- ]?workout|post[- ]?workout|intra[- ]?workout)\b\s*:?\s*(.*)$/i;
// Whole line must be the macro ("38 g protein"), so "30 g protein powder" stays a food.
const MACRO_LINE = /^(\d+(?:\.\d+)?)\s*g?\s*(protein|carbs?|carbohydrates?|fats?|fibre|fiber)\s*$/i;
const FOOD_LINE = /^(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)\s*(g|kg|ml|l|oz|lb|lbs|tbsp|tsp|cups?|scoops?|slices?|pieces?|eggs?|whole|cans?|servings?)?\b\.?\s+(.+)$/i;

function macroKey(word: string): keyof PlanMacros {
  const w = word.toLowerCase();
  if (w.startsWith("prot")) return "protein";
  if (w.startsWith("carb")) return "carbs";
  if (w.startsWith("fat")) return "fat";
  return "fibre";
}

export function structureMealPlanDay(text: string | null | undefined): StructuredDay {
  const out: StructuredDay = { meals: [], notes: [] };
  let meal: PlanMeal | null = null;
  let inMacros = false;
  let skipTotal = false;

  for (const raw of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/^[-*•·]\s*/, "").trim();
    if (!line) { inMacros = false; continue; }

    const header = line.match(MEAL_HEADER);
    if (header) {
      const timing = detectMealTiming(line);
      const rest = stripTimingText(header[3] ?? "").replace(/^[:–—-]\s*/, "").trim();
      const base = header[1].replace(/\b\w/g, (c) => c.toUpperCase());
      // A header that is only "Pre-Workout" keeps that as its title.
      meal = { title: rest ? `${base} · ${rest}` : base, foods: [], macros: null, notes: [], timing };
      out.meals.push(meal);
      inMacros = false;
      skipTotal = false;
      continue;
    }
    if (/^approximate macros?:?$/i.test(line)) { inMacros = true; continue; }
    if (/^daily total\b/i.test(line)) { skipTotal = true; meal = null; inMacros = false; continue; }
    if (skipTotal && /^approximately\b/i.test(line)) continue;
    if (/^PHASE\s*[:\-]/i.test(line)) continue;

    const macro = line.match(MACRO_LINE);
    if (macro && (inMacros || meal)) {
      if (meal) {
        meal.macros ??= {};
        meal.macros[macroKey(macro[2])] = Number(macro[1]);
      }
      continue;
    }

    const food = line.match(FOOD_LINE);
    if (food && meal) {
      const unit = food[2] ? ` ${food[2].toLowerCase()}` : "";
      meal.foods.push({ amount: `${food[1].replace(",", ".")}${unit}`, name: food[3].trim() });
      continue;
    }
    (meal ? meal.notes : out.notes).push(line);
  }
  return out;
}

export function macroSummary(m: PlanMacros | null): string | null {
  if (!m) return null;
  const parts = [
    m.protein != null ? `${m.protein}P` : null,
    m.carbs != null ? `${m.carbs}C` : null,
    m.fat != null ? `${m.fat}F` : null,
    m.fibre != null ? `${m.fibre} fibre` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
