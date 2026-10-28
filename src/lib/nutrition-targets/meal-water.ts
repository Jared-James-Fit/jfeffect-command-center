/**
 * The day's water target split across the meals, so a client knows how much
 * to drink with each one instead of chasing a daily number. Meals around
 * training get a bit more (sweat losses): Pre- or Post-Workout 1.25×, a
 * Pre/Post meal 1.5×, every other meal 1×. Amounts are rounded to a glass
 * size (50 ml, or 1 oz) and always add up to the day's target.
 */
import type { MealTiming } from "@/lib/nutrition-targets/meal-timing";

export type WaterUnit = "ml" | "oz";

const ML_PER_OZ = 29.5735;
const WEIGHT: Record<Exclude<MealTiming, null>, number> = { pre: 1.25, post: 1.25, pre_post: 1.5 };

/**
 * The coach's water target as typed on the plan ("3.5 L", "3500 ml", "120 oz",
 * "14 cups") in ml, and the unit to show per meal. Unreadable → null.
 */
export function parseWaterTarget(
  text: string | null | undefined,
): { ml: number; unit: WaterUnit } | null {
  const t = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(",", ".");
  if (!t) return null;
  const m = t.match(
    /(\d+(?:\.\d+)?)\s*(ml|millilit(?:re|er)s?|l\b|lit(?:re|er)s?|fl\.?\s*oz|oz|ounces?|cups?)?/,
  );
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = m[2] ?? "";
  let ml: number;
  let unit: WaterUnit = "ml";
  if (/^ml|^millilit/.test(u)) ml = n;
  else if (/^l\b|^l$|^lit/.test(u)) ml = n * 1000;
  else if (/oz|ounce/.test(u)) {
    ml = n * ML_PER_OZ;
    unit = "oz";
  } else if (/cup/.test(u)) ml = n * 250;
  else if (n <= 10)
    ml = n * 1000; // "3.5" = litres
  else if (n >= 500)
    ml = n; // "3500" = ml
  else return null;
  if (ml < 500 || ml > 10_000) return null;
  return { ml: Math.round(ml), unit };
}

/** Each meal's share of the day's water, in the shown unit's steps, summing to the target. */
export function splitWaterAcrossMeals(
  totalMl: number,
  timings: MealTiming[],
  unit: WaterUnit = "ml",
): number[] {
  if (!timings.length || !(totalMl > 0)) return [];
  const step = unit === "oz" ? ML_PER_OZ : 50;
  const steps = Math.round(totalMl / step);
  const weights = timings.map((t) => (t ? WEIGHT[t] : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sum) * steps);
  const out = raw.map(Math.floor);
  let left = steps - out.reduce((a, b) => a + b, 0);
  // largest remainder first; ties go to the workout meals (heavier weight)
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r), w: weights[i] }))
    .sort((a, b) => b.rem - a.rem || b.w - a.w || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return unit === "oz" ? out : out.map((s) => s * 50);
}

export function formatMealWater(amount: number, unit: WaterUnit): string {
  return unit === "oz" ? `${amount} oz` : `${amount} ml`;
}

/** "3.5 L" / "120 oz" for the day, in the unit the coach used. */
export function formatDayWater(ml: number, unit: WaterUnit): string {
  if (unit === "oz") return `${Math.round(ml / ML_PER_OZ)} oz`;
  const l = ml / 1000;
  return `${Number.isInteger(l) ? l : l.toFixed(1).replace(/\.0$/, "")} L`;
}
