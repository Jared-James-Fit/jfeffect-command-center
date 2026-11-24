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
import { scoreNutritionPlan, dayKindOf, mealFactsOf, type NutritionDayIn } from "@/lib/nutrition-targets/plan-quality";
import type { QualityScore } from "@/lib/plan-quality";

const SAFETY = /(eating disorder|anorexi|bulimi|binge|arfid|pregnan|breastfeed|nursing (my|a) baby)/i;

export async function nutritionQualityFor(sb: any, clientId: string): Promise<{ quality: QualityScore | null; planId: string | null }> {
  const { data: plan } = await sb
    .from("nutrition_targets")
    .select("id, start_date, phase, last_updated_at, nutrition_target_days(day_label, calories, protein, carbs, fats, notes, use_on, sort_order)")
    .eq("client_id", clientId)
    .neq("status", "Archived")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!plan) return { quality: null, planId: null };
  const days = ((plan.nutrition_target_days ?? []) as any[]).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const loaded = await loadWeightManagement(sb, clientId);
  const { input, assessment } = loaded;
  const [{ data: c }, goalsRes] = await Promise.all([
    sb.from("clients").select("preferred_high_days").eq("id", clientId).maybeSingle(),
    Promise.resolve(sb.from("client_goals_setup").select("food_dislikes").eq("client_id", clientId).maybeSingle()).catch(() => ({ data: null })),
  ]);
  const dislikes = Array.isArray((goalsRes as any)?.data?.food_dislikes) ? ((goalsRes as any).data.food_dislikes as unknown[]).map(String).filter((v) => v && !/^(none|no|n\/a|nothing)$/i.test(v.trim())) : [];
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
  const meals = mealFactsOf(
    days.map((d, i) => ({ label: dayIns[i].label, notes: d.notes ?? null, kind: dayIns[i].kind, kcal: dayIns[i].kcal, protein: dayIns[i].protein, carbs: dayIns[i].carbs, fats: dayIns[i].fats })),
    { dislikes },
  );
  // their cardio in force, a week (the weight-management read's own targets): what nutrition has to fuel on top
  const cardioMinutes = (() => {
    const t = (input.cardio?.targets ?? []) as Array<{ day_type: string | null; duration_minutes: number | null; frequency_per_week?: number | null; scheduled_weekdays?: string[] | null }>;
    if (!t.length) return null;
    const td = Math.max(0, input.trainingDays.length);
    let m = 0;
    for (const x of t) {
      const mins = Number(x.duration_minutes ?? 0) || 0;
      const label = String(x.day_type ?? "").toLowerCase();
      const per = x.scheduled_weekdays?.length || Number(x.frequency_per_week ?? 0) || (label.includes("non") || label.includes("rest") ? 7 - td : label.includes("train") ? td : 1);
      m += mins * per;
    }
    return m > 0 ? Math.round(m) : null;
  })();
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
    meals,
    cardioMinutes,
    lowerPerformance: input.performance.lower,
    // when the plan last changed: its start, or an edit since (Adjust plan, the editor)
    changedOn: [plan.start_date, plan.last_updated_at ? String(plan.last_updated_at).slice(0, 10) : null].filter((d): d is string => !!d && d <= assessment.today).sort().pop() ?? null,
    today: assessment.today,
  });
  return { quality, planId: plan.id };
}
