/**
 * Auto-calculate baseline nutrition + recovery targets for a member from
 * their latest bodyweight and goal tags. This is a coach-friendly default,
 * not a clinical recommendation — admins can still override per-member.
 *
 * Formulas (bodyweight in lb):
 *   - Calories   = lb × multiplier   (cut 11 / maintain 14 / bulk 16)
 *   - Protein g  = lb × 1.0
 *   - Fats g     = lb × 0.4
 *   - Carbs g    = remaining kcal / 4
 *   - Water L    = lb × 0.5 oz / 33.814 (rounded to 0.1 L)
 *   - Sleep h    = 8
 */
import type { NutritionTargets } from "@/components/nutrition/NutritionDashboard";

const LB_PER_KG = 2.2046226218;

export type GoalKind = "cut" | "maintain" | "bulk";

export function inferGoalKind(tags: string[] | null | undefined, freeform?: string | null): GoalKind {
  const blob = [...(tags ?? []), freeform ?? ""].join(" ").toLowerCase();
  if (/(cut|fat[\s-]?loss|lose|deficit|lean[\s-]?out|shred)/.test(blob)) return "cut";
  if (/(bulk|gain|muscle|mass|surplus|grow)/.test(blob)) return "bulk";
  return "maintain";
}

export function computeMemberTargets(
  bodyweightKg: number | null,
  goal: GoalKind,
): NutritionTargets | undefined {
  if (!bodyweightKg || bodyweightKg <= 0) return undefined;
  const lb = bodyweightKg * LB_PER_KG;
  const calMult = goal === "cut" ? 11 : goal === "bulk" ? 16 : 14;
  const calories = Math.round((lb * calMult) / 10) * 10;
  const protein = Math.round(lb * 1.0);
  const fats = Math.round(lb * 0.4);
  const fatKcal = fats * 9;
  const proKcal = protein * 4;
  const carbs = Math.max(0, Math.round((calories - fatKcal - proKcal) / 4));
  const waterL = Math.round((lb * 0.5) / 33.814 * 10) / 10;
  return {
    calories,
    protein,
    carbs,
    fats,
    water: `${waterL}L`,
    sleep: "8h",
  };
}
