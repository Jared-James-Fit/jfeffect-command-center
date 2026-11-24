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
import { barriersFromCheckins, type QualityScore } from "@/lib/plan-quality";
import { changeRead, diffNutrition, newNutritionPlanChanges, nutritionFingerprint, type NutritionDayFp, type PlanChange } from "@/lib/plan-changes";

const dayFp = (d: any): NutritionDayFp => ({ label: String(d.day_label ?? "Day"), kcal: d.calories, protein: d.protein, carbs: d.carbs, fats: d.fats, steps: d.steps, notes: d.notes ?? null });
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const SAFETY = /(eating disorder|anorexi|bulimi|binge|arfid|pregnan|breastfeed|nursing (my|a) baby)/i;

export async function nutritionQualityFor(sb: any, clientId: string): Promise<{ quality: QualityScore | null; planId: string | null; pending?: { at: string; count: number } | null }> {
  const { data: plan } = await sb
    .from("nutrition_targets")
    .select("id, start_date, phase, last_updated_at, nutrition_target_days(day_label, calories, protein, carbs, fats, steps, notes, use_on, sort_order)")
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
    sb.from("clients").select("preferred_high_days, full_name").eq("id", clientId).maybeSingle(),
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
  // ── the change log: a new plan against the one before, Adjust plan edits, and in-place edits ──
  const today = assessment.today;
  const known: PlanChange[] = [];
  try {
    if (plan.start_date && plan.start_date >= plusDays(today, -90)) {
      const { data: prevPlan } = await sb
        .from("nutrition_targets")
        .select("id, start_date, nutrition_target_days(day_label, calories, protein, carbs, fats, steps, notes, sort_order)")
        .eq("client_id", clientId)
        .neq("id", plan.id)
        .lt("start_date", plan.start_date)
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      known.push(
        ...newNutritionPlanChanges(
          prevPlan ? { id: prevPlan.id, start: prevPlan.start_date, days: ((prevPlan.nutrition_target_days ?? []) as any[]).map(dayFp) } : null,
          { id: plan.id, start: plan.start_date, days: days.map(dayFp) },
          today,
        ),
      );
    }
    const { data: edits } = await sb
      .from("nutrition_plan_edits")
      .select("applied_at, restore")
      .eq("target_id", plan.id)
      .eq("status", "applied")
      .not("applied_at", "is", null)
      .gte("applied_at", `${plusDays(today, -90)}T00:00:00Z`)
      .order("applied_at", { ascending: true });
    const applied = ((edits ?? []) as any[]).filter((e) => Array.isArray(e.restore?.days));
    applied.forEach((e, i) => {
      const before = (e.restore.days as any[]).map(dayFp);
      const after = i + 1 < applied.length ? (applied[i + 1].restore.days as any[]).map(dayFp) : days.map(dayFp);
      const on = String(e.applied_at).slice(0, 10);
      known.push(...diffNutrition(nutritionFingerprint(plan.id, null, before), nutritionFingerprint(plan.id, null, after), on).map((c) => ({ ...c, on })));
    });
  } catch {
    /* the plan's history is best effort */
  }
  const { trackPlanChanges } = await import("@/lib/plan-changes.server");
  const fp = nutritionFingerprint(plan.id, plan.start_date ?? null, days.map(dayFp));
  // an in-place edit is a change of the same plan; a new plan is read from its history above
  const logged = await trackPlanChanges(sb, clientId, "nutrition", fp, today, { comparable: (prev) => (prev.items._plan as any)?.id === plan.id });
  // edited in place before the change log saw it: the size isn't known, so it's listed but never holds the read
  const editedOn = plan.last_updated_at ? String(plan.last_updated_at).slice(0, 10) : null;
  if (editedOn && plan.start_date && editedOn > plusDays(plan.start_date, 1) && editedOn >= plusDays(today, -28) && ![...logged, ...known].some((c) => c.on === editedOn))
    known.push({ domain: "nutrition", area: "macros", size: "minor", summary: "Plan edited", on: editedOn, unknown: true });
  const weighIns14 = input.weighIns.filter((w) => w.date >= plusDays(today, -14)).length;
  const changeLog = changeRead("nutrition", [...logged, ...known], today, { meetWeeksOut: assessment.meetWeeksOut, weighIns14 });

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
    changeLog,
    barriers: barriersFromCheckins(input.checkins.slice().sort((a, b) => b.date.localeCompare(a.date))),
    firstName: String((c as any)?.full_name ?? "").trim().split(/\s+/)[0] || null,
  });
  // a written plan change nobody has put on the plan or discarded: the strip's reminder
  let pending: { at: string; count: number } | null = null;
  try {
    const { data: ready } = await sb
      .from("nutrition_plan_edits")
      .select("updated_at")
      .eq("target_id", plan.id)
      .eq("status", "ready")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ready && Date.now() - Date.parse(ready.updated_at) >= 30 * 60_000) pending = { at: String(ready.updated_at), count: 1 };
  } catch {
    /* a reminder is optional */
  }
  return { quality, planId: plan.id, pending };
}
