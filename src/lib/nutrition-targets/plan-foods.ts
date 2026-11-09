/**
 * How easy a meal plan is to shop for and prep: how many different foods it
 * uses across its day types (the grocery list size), and which weighed foods
 * change amount between meals or days (`prepDrift`). A good plan reuses the
 * same staples at the same prepped amounts every day; a long list or a food at
 * three different weights means more shopping, more weighing and more to get
 * wrong. Pure.
 */
import { splitFoodLine } from "@/lib/nutrition-targets/meal-plan-reader";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";

const MACRO = /^(protein|carbs?|carbohydrates?|fats?|fib(?:re|er)s?)$/i;

/** "Cooked extra lean chicken breast (95/5)" → "chicken breast". */
export function foodKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+\s*\/\s*\d+\b|\b\d+\s*%/g, " ")
    .replace(
      /\b(cooked|uncooked|raw|dry|dried|extra|lean|natural|plain|non-?fat|low-?fat|fat-?free|unsweetened|fresh|frozen|organic|large|medium|small|whole|of)\b/g,
      " ",
    )
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

/* ------------------------------------------------------------------------ */
/* Meal prep: one weighed amount per food (MEAL_PLAN_PROMPT rule 2c)         */

/** A weighed food that isn't one prepped amount across the plan. */
export type PrepDrift = {
  /** The food as the plan first wrote it ("cooked chicken breast"). */
  food: string;
  unit: "g" | "ml";
  /** Its prepped amount: the one used most (the smaller on a tie). */
  base: number;
  /** Every amount it's written at, smallest first. */
  amounts: number[];
  /** Where each odd amount sits ("High Day Meal 3: 230 g"). */
  odd: string[];
};

/** A whole extra portion is exactly 2× or 3× the prepped amount. */
const WHOLE_PORTIONS = [1, 2, 3];
const WEIGHED = /^(\d+(?:[.,]\d+)?)\s*(g|ml)$/i;

/**
 * The weighed foods (grams / ml) whose amount changes between meals or day
 * types. A meal-prep plan writes each one at one amount everywhere, or at
 * exactly 2× / 3× it where a whole portion was added; anything else means
 * re-weighing on prep day. Counted foods (a bagel, 2 eggs) and the free meal
 * never count. Pure.
 */
export function prepDrift(
  days: Array<{ label?: string | null; notes?: string | null }>,
): PrepDrift[] {
  const seen = new Map<
    string,
    { food: string; unit: "g" | "ml"; at: Array<{ n: number; where: string }> }
  >();
  for (const d of days) {
    for (const meal of structureMealPlanDay(d.notes).meals) {
      if (/free meal/i.test(meal.title)) continue;
      for (const f of meal.foods) {
        const m = f.amount.match(WEIGHED);
        const k = m ? foodKey(f.name) : "";
        if (!m || !k) continue;
        const unit = m[2].toLowerCase() as "g" | "ml";
        const key = `${k}|${unit}`;
        const row = seen.get(key) ?? { food: f.name.trim(), unit, at: [] };
        row.at.push({
          n: Number(m[1].replace(",", ".")),
          where: [d.label, meal.title.split(" · ")[0]].filter(Boolean).join(" "),
        });
        seen.set(key, row);
      }
    }
  }
  const out: PrepDrift[] = [];
  for (const row of seen.values()) {
    const counts = new Map<number, number>();
    for (const a of row.at) counts.set(a.n, (counts.get(a.n) ?? 0) + 1);
    if (counts.size < 2) continue;
    const base = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const fits = (n: number) => WHOLE_PORTIONS.some((k) => Math.abs(n - base * k) <= 1);
    const odd = row.at.filter((a) => !fits(a.n));
    if (!odd.length) continue;
    out.push({
      food: row.food,
      unit: row.unit,
      base,
      amounts: [...counts.keys()].sort((a, b) => a - b),
      odd: odd.map((a) => `${a.where}: ${a.n} ${row.unit}`),
    });
  }
  return out;
}

/** "Cooked chicken breast 150 / 165 / 180 g" for the coach and the fix prompt. */
export function prepDriftLine(d: PrepDrift): string {
  return `${d.food} ${d.amounts.join(" / ")} ${d.unit}`;
}

/** "NON-TRAINING-DAY MENU" → "Non Training Day". */
function menuLabel(header: string): string {
  return header
    .replace(/\s*MENU\s*$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The menus of a whole AI meal plan (the paste format), each with its text, before FOOD-WEIGHING RULES. */
export function planMenus(
  text: string | null | undefined,
): Array<{ label: string; notes: string }> {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const stop = lines.findIndex((l) => /^FOOD[- ]?WEIGHING\b/i.test(l.trim()));
  const body = stop < 0 ? lines : lines.slice(0, stop);
  const out: Array<{ label: string; notes: string[] }> = [];
  for (const raw of body) {
    const t = raw.trim();
    if (/MENU\s*$/i.test(t) && t.length < 80 && !/^meal/i.test(t))
      out.push({ label: menuLabel(t), notes: [] });
    else out.at(-1)?.notes.push(raw);
  }
  return out.map((m) => ({ label: m.label, notes: m.notes.join("\n") }));
}
