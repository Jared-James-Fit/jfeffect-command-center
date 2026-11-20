/**
 * Turn a meal plan day's free text (the paste format) into structured meals
 * for display / PDF: foods with amounts, per-meal macros, and loose notes.
 * Pure and tolerant — anything it doesn't recognise is kept as a note.
 */

export type PlanFood = { amount: string; name: string };
export type PlanMacros = { protein?: number; carbs?: number; fat?: number; fibre?: number };
import { detectMealTiming, stripTimingText, type MealTiming } from "@/lib/nutrition-targets/meal-timing";
import { DAILY_TOTAL_HEADING, isTotalLine, readMacroLine } from "@/lib/nutrition-targets/macro-line";

export type PlanMeal = { title: string; foods: PlanFood[]; macros: PlanMacros | null; notes: string[]; timing: MealTiming };
export type StructuredDay = { meals: PlanMeal[]; notes: string[] };

const MEAL_HEADER = /^(meal\s*\d+|breakfast|lunch|dinner|snack(\s*\d+)?|pre[- ]?workout|post[- ]?workout|intra[- ]?workout)\b\s*:?\s*(.*)$/i;
/** "Approximate macros:", "Approx:" (the macros follow on their own lines). */
const MACROS_LABEL = /^approx(?:imate)?\.?\s*(?:macros?)?\s*[:.]?$/i;
/** A coach's "Flexible calories" allowance: its own section after the meals, never part of one. */
export const FLEX_HEADING = /^flex(?:ible)?\s*(?:calories|cals?|kcal|allowance|food|macros)\b/i;
const FOOD_LINE = /^(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)\s*(g|kg|ml|l|oz|lb|lbs|tbsp|tsp|cups?|scoops?|slices?|pieces?|eggs?|whole|cans?|servings?)?\b\.?\s+(.+)$/i;

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
    if (MACROS_LABEL.test(line)) { inMacros = true; continue; }
    // a day's total ends the meals: its lines are never the last meal's macros ("Approximate Daily Total / 205 g protein / …")
    if (DAILY_TOTAL_HEADING.test(line)) { skipTotal = true; meal = null; inMacros = false; continue; }
    if (skipTotal && (/^approximately\b/i.test(line) || isTotalLine(line))) continue;
    if (/^PHASE\s*[:\-]/i.test(line)) continue;
    // flexible calories close the meal before them: what follows is the day's, not that meal's
    if (FLEX_HEADING.test(line)) { meal = null; inMacros = false; skipTotal = false; out.notes.push(line); continue; }

    // any way the macros are written ("45 g protein", "36 g protein, 65 g carbs, 12 g fat", "40P / 60C / 8F")
    const macro = readMacroLine(line);
    if (macro && (inMacros || meal)) {
      if (meal) meal.macros = { ...(meal.macros ?? {}), ...macro };
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
