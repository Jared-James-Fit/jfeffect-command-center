/**
 * How many different foods a meal plan uses, across its day types: the
 * grocery list size. A good plan reuses the same staples every day and only
 * changes portions; a long list means more shopping and more to get wrong.
 * Pure.
 */
import { splitFoodLine } from "@/lib/nutrition-targets/meal-plan-reader";

const MACRO = /^(protein|carbs?|carbohydrates?|fats?|fib(?:re|er)s?)$/i;

/** "Cooked extra lean chicken breast (95/5)" → "chicken breast". */
export function foodKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+\s*\/\s*\d+\b|\b\d+\s*%/g, " ")
    .replace(/\b(cooked|uncooked|raw|dry|dried|extra|lean|natural|plain|non-?fat|low-?fat|fat-?free|unsweetened|fresh|frozen|organic|large|medium|small|whole|of)\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(singular)
    .join(" ");
}

function singular(w: string): string {
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(o|ch|sh|x)es$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** The foods on one day's meal text (amount lines only; macro lines and notes skipped). */
export function dayFoods(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text ?? "").split("\n")) {
    const { amount, name } = splitFoodLine(raw.replace(/^[-*•·]\s*/, ""));
    if (!amount || MACRO.test(name.trim())) continue;
    const k = foodKey(name);
    if (k) out.add(k);
  }
  return out;
}

export type PlanFoodStats = { total: number; everyDay: number; foods: string[]; days: number };

export function planFoodStats(days: Array<{ notes?: string | null }>): PlanFoodStats {
  const sets = days.map((d) => dayFoods(d.notes)).filter((s) => s.size > 0);
  const all = new Set<string>();
  for (const s of sets) for (const f of s) all.add(f);
  const everyDay = sets.length ? [...all].filter((f) => sets.every((s) => s.has(f))).length : 0;
  return { total: all.size, everyDay, foods: [...all].sort(), days: sets.length };
}

/** About right for a staple-based plan (2-3 proteins, 2-3 carbs, 1-2 fats, 1-2 veg, 1 fruit, + extras). */
export const LEAN_GROCERY_LIST = 14;
