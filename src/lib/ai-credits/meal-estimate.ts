/**
 * The AI food log: a short description of a meal in, its estimated macros
 * out. The prompt and the reading of the answer (pure); the call itself is
 * `parseMealFromText` (nutrition-dashboard.functions.ts), metered by AI credits.
 */

export const MEAL_ESTIMATE_SYSTEM =
  "You estimate the calories and macronutrients of a meal from a short description a lifter typed into their food log. " +
  "Use realistic, typical portions when amounts aren't given, and the amounts they give when they are. " +
  'Reply with ONLY a JSON object: {"name":string,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}. ' +
  "name is a short, clean name for the meal (under 60 characters). Whole numbers. No prose, no markdown.";

export type MealEstimate = {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

const whole = (v: unknown, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : 0;
};

/**
 * Read the model's answer. A fenced or wrapped JSON object is found; anything
 * that isn't one, or has no calories and no macros, is refused (null), so a
 * use that gave nothing back is refunded instead of logging zeros.
 */
export function parseMealEstimate(text: string, typed: string): MealEstimate | null {
  const raw = String(text ?? "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let j: any;
  try {
    j = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const out: MealEstimate = {
    name:
      String(j.name ?? "")
        .trim()
        .slice(0, 120) || String(typed).trim().slice(0, 120),
    calories: whole(j.calories, 10000),
    protein_g: whole(j.protein_g, 1000),
    carbs_g: whole(j.carbs_g, 2000),
    fat_g: whole(j.fat_g, 1000),
  };
  if (!out.calories && !out.protein_g && !out.carbs_g && !out.fat_g) return null;
  return out;
}
