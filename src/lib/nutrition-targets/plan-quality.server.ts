/**
 * Reads what the nutrition plan quality score needs for one client (Nov 23
 * 2026): their current plan, the weight-management engine's read of their
 * records (bodyweight, trend, check-ins, training days), the maintenance their
 * results imply, and their food on file (allergies and diets checked against
 * the plan's meals). Server only; the caller checks access first.
 */
import { loadWeightManagement } from "@/lib/weight-management/load.server";
import { observedMaintenance, weeklyAverageKcal, weightTrend } from "@/lib/nutrition-targets/nutrition-intel";
import { allergenConflictLine, allergenConflicts, onFileRules } from "@/lib/nutrition-targets/food-history";
import { scoreNutritionPlan, dayKindOf, type NutritionDayIn } from "@/lib/nutrition-targets/plan-quality";
import type { QualityScore } from "@/lib/plan-quality";

const SAFETY = /(eating disorder|anorexi|bulimi|binge|arfid|pregnan|breastfeed|nursing (my|a) baby)/i;

export async function nutritionQualityFor(sb: any, clientId: string): Promise<{ quality: QualityScore | null; planId: string | null }> {
  const { data: plan } = await sb
    .from("nutrition_targets")
    .select("id, start_date, phase, nutrition_target_days(day_label, calories, protein, carbs, fats, notes, use_on, sort_order)")
    .eq("client_id", clientId)
    .neq("status", "Archived")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!plan) return { quality: null, planId: null };
  const days = ((plan.nutrition_target_days ?? []) as any[]).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const loaded = await loadWeightManagement(sb, clientId);
  const { input, assessment } = loaded;
  const { data: c } = await sb.from("clients").select("preferred_high_days").eq("id", clientId).maybeSingle();
  const highDay = Array.isArray(c?.preferred_high_days) ? (c.preferred_high_days[0] ?? null) : null;
  const weekly = weeklyAverageKcal(days.map((d) => ({ label: d.day_label, calories: d.calories })), input.trainingDays, highDay);
  const trend = plan.start_date ? weightTrend(input.weighIns, plan.start_date, assessment.today) : null;
  const maintenance = observedMaintenance({ trend, food: null, planKcal: weekly, adherence: assessment.checkins.adherence });

  let conflicts: string[] = [];
  let restrictions = 0;
  let safety: string[] = [];
  try {
    const { loadFoodContext } = await import("@/lib/nutrition-ai-plans.server");
    const food = await loadFoodContext(sb, clientId, assessment.today);
    const why = onFileRules(food.history);
    restrictions = Object.keys(why).length;
    const hits = allergenConflicts(days.map((d) => ({ label: d.day_label, notes: d.notes })), Object.keys(why));
    conflicts = hits.length ? allergenConflictLine(hits, why).split(/;\s*/).filter(Boolean) : [];
    safety = food.health.conditions.map((e: any) => String(e.label ?? "")).filter((l) => SAFETY.test(l));
  } catch {
    /* food on file is optional for the score */
  }

  const dayIns: NutritionDayIn[] = days.map((d) => ({
    label: String(d.day_label ?? "Day"),
    kcal: d.calories != null ? Number(d.calories) : null,
    protein: d.protein != null ? Number(d.protein) : null,
    carbs: d.carbs != null ? Number(d.carbs) : null,
    fats: d.fats != null ? Number(d.fats) : null,
    kind: dayKindOf(String(d.day_label ?? ""), d.use_on),
  }));
  const quality = scoreNutritionPlan(dayIns, {
    direction: input.goal?.type || assessment.goal || input.plan.phase ? assessment.direction : null,
    sex: input.sex,
    bodyweightKg: assessment.trajectory.current?.kg ?? null,
    weeklyKcal: weekly,
    maintenance: maintenance?.kcal ?? null,
    trend: trend ? { pctPerWeek: trend.pctPerWeek, clear: trend.clear } : null,
    trendStatus: assessment.trajectory.status ?? null,
    adherence: assessment.checkins.adherence,
    hungerHigh: assessment.checkins.hungerHigh,
    recoveryFlags: (assessment.checkins.poorSleep >= 2 ? 1 : 0) + (assessment.checkins.lowEnergy >= 2 ? 1 : 0),
    trainingDays: input.trainingDays.length,
    powerlifter: input.powerlifter || assessment.context === "powerlifting_class",
    meetWeeksOut: assessment.meetWeeksOut,
    conflicts,
    restrictions,
    hasMeals: days.some((d) => String(d.notes ?? "").trim().length > 20),
    safety,
    checkins: assessment.checkins.count,
  });
  return { quality, planId: plan.id };
}
