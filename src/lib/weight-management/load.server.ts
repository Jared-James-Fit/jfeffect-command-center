/**
 * Reads one client's records for the weight-management engine, with whatever
 * session it's given: the coach's own login on the dashboard (RLS decides
 * what they may see), the service role in the weekly check-in hook. Every
 * read except the client row is best-effort: a table that can't be read
 * leaves that part empty, never breaks the read. Everything is read once and
 * small (weeks, not years, except the lift history the earlier cuts need).
 */
import { mergeBodyweightSeries, type CanonicalBodyweightRow, type LegacyBodyweightMetricRow } from "@/lib/bodyweight";
import { weeklyAverageKcal } from "@/lib/nutrition-targets/nutrition-intel";
import { healthProfileFromRecords, loadHealthRecords } from "@/lib/health/health-load";
import { buildAssessment, type AssessmentInput, type Assessment, type GoalType } from "@/lib/weight-management/assessment";
import { hasFluidRestriction, type Climate, type SweatLevel } from "@/lib/weight-management/hydration";
import { cardioAdherence, heavyLowerWeekdays, lowerLiftPerformance, pastCutPhases, prepSport, treadmillHistory, waistCm, type CardioDone, type LiftSet, type PlannedDay } from "@/lib/weight-management/records";
import { walkingLimits, type ExistingCardio } from "@/lib/weight-management/treadmill";
import { addDays, round, speedUnitFor, toKg, type SpeedUnit, type WeightUnit } from "@/lib/weight-management/units";
import { experienceLevel } from "@/lib/program-intel/first-program";

const PAGE = 1000;

async function safe<T>(run: () => PromiseLike<{ data: T | null; error?: unknown }>, fallback: T): Promise<T> {
  try {
    const r = await run();
    return r && !r.error && r.data != null ? r.data : fallback;
  } catch {
    return fallback;
  }
}

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: unknown }>, max = 10_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    let r: { data: T[] | null; error?: unknown };
    try {
      r = await page(from, from + PAGE - 1);
    } catch {
      return out;
    }
    if (r.error) return out;
    out.push(...(r.data ?? []));
    if (!r.data || r.data.length < PAGE) return out;
  }
  return out;
}

async function inChunks<T>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error?: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...(await safe<T[]>(() => run(ids.slice(i, i + 150)), [])));
  return out;
}

function localToday(tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function ageOn(dob: string | null | undefined, today: string): number | null {
  if (!dob) return null;
  const b = new Date(`${dob.slice(0, 10)}T00:00:00Z`);
  const t = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(b.getTime())) return null;
  let a = t.getUTCFullYear() - b.getUTCFullYear();
  if (t.getUTCMonth() < b.getUTCMonth() || (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())) a--;
  return a > 5 && a < 110 ? a : null;
}

export type LoadedWeightManagement = {
  input: AssessmentInput;
  assessment: Assessment;
  client: { id: string; userId: string | null; firstName: string; unit: WeightUnit; goalUnit: WeightUnit | null; tz: string; goal: { type: GoalType | null; value: number | null; valueMax: number | null; date: string | null } };
  /** Rows the coach's Apply writes to. */
  refs: {
    trainingCardioId: string | null;
    restCardioId: string | null;
    planId: string | null;
    waterTarget: { active_ml: number; training_extra_ml: number | null; target_source: string } | null;
    profile: Record<string, unknown> | null;
  };
};

export async function loadWeightManagement(sb: any, clientId: string, opts: { today?: string } = {}): Promise<LoadedWeightManagement> {
  const { data: c, error } = await sb
    .from("clients")
    .select(
      "id, user_id, first_name, preferred_name, full_name, sex, date_of_birth, height_cm, preferred_weight_unit, timezone, committed_training_days, preferred_training_days, preferred_high_days, is_powerlifter, intake_training_experience, bodyweight_goal_type, bodyweight_goal_value, bodyweight_goal_value_max, bodyweight_goal_unit, bodyweight_goal_date",
    )
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!c) throw new Error("Client not found.");
  const today = opts.today ?? localToday(c.timezone);
  const userId: string | null = c.user_id ?? null;
  const unit: WeightUnit = c.preferred_weight_unit === "kg" ? "kg" : "lb";
  const trainingDays: string[] = (Array.isArray(c.committed_training_days) && c.committed_training_days.length ? c.committed_training_days : c.preferred_training_days ?? []).map(String);
  const since6m = addDays(today, -183);
  const since12m = addDays(today, -365);

  const [bwCanon, bwLegacy, plans, preps, checkins, cardioTargets, cardioDone, waterEntries, waterTarget, measurements, steps, goalsSetup, profile, health, results] = await Promise.all([
    userId
      ? readAll<CanonicalBodyweightRow>((f, t) => sb.from("progress_bodyweight").select("id, logged_date, weight_value, weight_unit, note").eq("user_id", userId).gte("logged_date", since12m).order("logged_date", { ascending: false }).order("id").range(f, t))
      : Promise.resolve([] as CanonicalBodyweightRow[]),
    readAll<LegacyBodyweightMetricRow>((f, t) => sb.from("progress_metrics").select("id, entry_date, bodyweight, bodyweight_unit, notes").eq("client_id", clientId).not("bodyweight", "is", null).gte("entry_date", since12m).order("entry_date", { ascending: false }).order("id").range(f, t)),
    safe<any[]>(() => sb.from("nutrition_targets").select("id, status, start_date, phase, created_at, nutrition_target_days(day_label, calories)").eq("client_id", clientId).order("start_date", { ascending: false }).limit(12), []),
    safe<any[]>(() => sb.from("pl_preps").select("id, title, event_name, event_date, weight_class, federation, goal_type, status, archived").eq("client_id", clientId).gte("event_date", today).order("event_date").limit(5), []),
    safe<any[]>(() => sb.from("messenger_checkins").select("id, submitted_at, answers").eq("client_id", clientId).eq("task_type", "weekly_checkin").eq("status", "completed").not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(8), []),
    safe<any[]>(() => sb.from("cardio_targets").select("id, day_type, cardio_type, custom_type, duration_minutes, frequency_per_week, scheduled_weekdays, incline, speed_min_mph, speed_max_mph, heart_rate_zone, status, enabled, visible_to_client, program_name, start_date, end_date, source, last_updated_at, updated_at").eq("client_id", clientId), []),
    safe<any[]>(() => sb.from("cardio_completions").select("completed_date, cardio_type, completed, skipped, avg_speed, incline, rpe, duration_minutes").eq("client_id", clientId).gte("completed_date", addDays(today, -35)), []),
    userId ? safe<any[]>(() => sb.from("progress_water_entries").select("entry_date, amount_ml").eq("user_id", userId).gte("entry_date", addDays(today, -13)), []) : Promise.resolve([]),
    userId ? safe<any>(() => sb.from("progress_water_targets").select("active_ml, training_extra_ml, target_source, mode").eq("user_id", userId).maybeSingle(), null) : Promise.resolve(null),
    userId ? safe<any[]>(() => sb.from("progress_measurements").select("measured_date, fields, unit").eq("user_id", userId).gte("measured_date", addDays(today, -60)), []) : Promise.resolve([]),
    userId ? safe<any[]>(() => sb.from("wearable_daily_metrics").select("metric_date, steps").eq("user_id", userId).gte("metric_date", addDays(today, -14)), []) : Promise.resolve([]),
    safe<any>(() => sb.from("client_goals_setup").select("training_experience, workout_length_minutes").eq("client_id", clientId).maybeSingle(), null),
    safe<any>(() => sb.from("weight_management_profiles").select("*").eq("client_id", clientId).maybeSingle(), null),
    loadHealthRecords(sb, clientId, { forms: false, today }).catch(() => null),
    readAll<any>((f, t) => sb.from("pl_row_results").select("row_id, actual_load_kg, normalized_kg, actual_reps, actual_rpe_num, actual_rir, completed_at").eq("client_id", clientId).gte("completed_at", `${since12m}T00:00:00Z`).not("completed_at", "is", null).order("completed_at").range(f, t), 20_000),
  ]);

  // bodyweight, both sources, in kg
  const weighIns = mergeBodyweightSeries(bwCanon, bwLegacy)
    .filter((p) => Number.isFinite(p.value) && p.value > 0)
    .map((p) => ({ date: p.date, kg: round(toKg(p.value, p.unit as WeightUnit), 2) }));

  // lifts: squat and deadlift only, as their competition lift type
  const rowIds = [...new Set(results.map((r: any) => r.row_id).filter(Boolean))] as string[];
  const rows = await inChunks<any>(rowIds, (ids) => sb.from("pl_exercise_rows").select("id, exercise_id").in("id", ids));
  const exIds = [...new Set(rows.map((r) => r.exercise_id).filter(Boolean))] as string[];
  const exercises = await inChunks<any>(exIds, (ids) => sb.from("exercises").select("id, competition_lift_type").in("id", ids));
  const liftOfEx = new Map<string, string | null>(exercises.map((e) => [e.id, e.competition_lift_type ?? null]));
  const liftOfRow = new Map<string, string | null>(rows.map((r) => [r.id, liftOfEx.get(r.exercise_id) ?? null]));
  const sets: LiftSet[] = [];
  for (const r of results) {
    const lift = liftOfRow.get(r.row_id);
    if (lift !== "squat" && lift !== "deadlift") continue;
    const kg = Number(r.actual_load_kg ?? r.normalized_kg);
    const reps = Number(r.actual_reps);
    if (!(kg > 0) || !(reps > 0)) continue;
    const rir = r.actual_rir != null && r.actual_rir !== "" ? Number.parseFloat(String(r.actual_rir)) : null;
    sets.push({ lift, date: String(r.completed_at).slice(0, 10), kg, reps, rpe: r.actual_rpe_num ?? null, rir: Number.isFinite(rir as number) ? rir : null });
  }

  // heavy lower days from the next two weeks of their program
  const upcoming = await loadUpcomingDays(sb, clientId, today);
  const heavyLowerDays = heavyLowerWeekdays(upcoming);

  // nutrition plan in effect
  const live = plans.filter((p) => p.status !== "Archived");
  const plan = live[0] ?? null;
  const highDay = Array.isArray(c.preferred_high_days) ? (c.preferred_high_days[0] ?? null) : null;
  const weeklyKcal = plan ? weeklyAverageKcal((plan.nutrition_target_days ?? []).map((d: any) => ({ label: d.day_label, calories: d.calories })), trainingDays, highDay) : null;

  // meet: the next one that isn't archived or cancelled
  const prep = preps.find((p) => !p.archived && !/cancel/i.test(String(p.status ?? ""))) ?? null;

  // cardio
  const liveCardio = cardioTargets.filter(
    (t) => (t.status ?? "Active") === "Active" && t.enabled !== false && !t.program_name && (!t.end_date || t.end_date >= today) && (t.duration_minutes ?? 0) > 0,
  );
  const pickKind = (re: RegExp) =>
    liveCardio
      .filter((t) => re.test(String(t.day_type ?? "")))
      .sort((a, b) => String(b.start_date ?? "").localeCompare(String(a.start_date ?? "")) || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0] ?? null;
  const restRow = pickKind(/non.?training|rest|off/i);
  const trainRow = liveCardio.filter((t) => !/non.?training|rest|off/i.test(String(t.day_type ?? "")) && /training/i.test(String(t.day_type ?? ""))).sort((a, b) => Number(a.source === "program_rows") - Number(b.source === "program_rows"))[0] ?? null;
  const cardioRows = [trainRow, restRow].filter(Boolean) as any[];
  const done: CardioDone[] = cardioDone.map((d) => ({ date: String(d.completed_date).slice(0, 10), type: d.cardio_type ?? null, completed: !!d.completed, skipped: !!d.skipped, speed: d.avg_speed ?? null, incline: d.incline ?? null, rpe: d.rpe ?? null, minutes: d.duration_minutes ?? null }));
  const perWeek = (trainRow ? (trainRow.frequency_per_week ?? trainingDays.length) : 0) + (restRow ? (restRow.frequency_per_week ?? (restRow.scheduled_weekdays ?? []).length) : 0);
  const adherence = cardioAdherence(done, perWeek, today);
  const lastChanged = cardioRows.map((t) => String(t.last_updated_at ?? t.updated_at ?? "").slice(0, 10)).filter(Boolean).sort().pop() ?? null;

  // water
  const byDay = new Map<string, number>();
  for (const e of waterEntries) byDay.set(String(e.entry_date), (byDay.get(String(e.entry_date)) ?? 0) + Number(e.amount_ml || 0));
  const waterDays = [...byDay.values()].filter((v) => v > 0);

  // health: what walking aggravates, and a fluid limit
  let walk: string[] = [];
  let fluidRestriction = false;
  if (health) {
    const hp = healthProfileFromRecords(health, today);
    walk = walkingLimits(hp.injuries.map((i) => [i.area, i.label, i.details].filter(Boolean).join(" ")));
    fluidRestriction = hasFluidRestriction([...hp.conditions, ...hp.medications].map((i) => `${i.label} ${i.details ?? ""}`));
  }

  const stepVals = steps.map((s) => Number(s.steps)).filter((n) => n > 0);
  const goalUnit: WeightUnit | null = c.bodyweight_goal_unit === "kg" ? "kg" : c.bodyweight_goal_unit === "lb" ? "lb" : null;
  const gu = goalUnit ?? unit;
  const speedUnit: SpeedUnit = profile?.speed_unit === "kmh" ? "kmh" : profile?.speed_unit === "mph" ? "mph" : speedUnitFor(unit);

  const input: AssessmentInput = {
    today,
    unit,
    speedUnit,
    sex: c.sex === "M" || /^m(ale)?$/i.test(String(c.sex ?? "")) ? "M" : c.sex === "F" || /^f(emale)?$/i.test(String(c.sex ?? "")) ? "F" : null,
    age: ageOn(c.date_of_birth, today),
    heightCm: c.height_cm ? Number(c.height_cm) : null,
    level: experienceLevel(goalsSetup?.training_experience ?? c.intake_training_experience ?? null),
    weighIns,
    goal: c.bodyweight_goal_type
      ? {
          type: c.bodyweight_goal_type as GoalType,
          kg: c.bodyweight_goal_value != null ? round(toKg(Number(c.bodyweight_goal_value), gu), 2) : null,
          kgMax: c.bodyweight_goal_value_max != null ? round(toKg(Number(c.bodyweight_goal_value_max), gu), 2) : null,
          date: c.bodyweight_goal_date ?? null,
        }
      : null,
    meet: prep?.event_date ? { name: prep.event_name || prep.title || null, date: String(prep.event_date).slice(0, 10), weightClass: prep.weight_class ?? null, federation: prep.federation ?? null, sport: prepSport(prep.goal_type, prep.weight_class) } : null,
    powerlifter: !!c.is_powerlifter,
    plan: { start: plan?.start_date ?? null, weeklyKcal, phase: plan?.phase ?? null, starts: plans.map((p) => p.start_date).filter((d: string | null) => !!d && d >= since6m) },
    checkins: checkins.map((r) => ({ date: String(r.submitted_at).slice(0, 10), answers: (r.answers ?? {}) as Record<string, unknown> })),
    cardio: { targets: cardioRows as ExistingCardio[], lastChanged, history: treadmillHistory(done, today), done: adherence?.done ?? null, planned: adherence?.planned ?? null },
    trainingDays,
    heavyLowerDays,
    sessionMinutes: goalsSetup?.workout_length_minutes ? Number(goalsSetup.workout_length_minutes) : null,
    dailySteps: stepVals.length >= 5 ? Math.round(stepVals.reduce((a, b) => a + b, 0) / stepVals.length) : null,
    water: { avgMl: waterDays.length ? Math.round(waterDays.reduce((a, b) => a + b, 0) / waterDays.length) : null, targetMl: waterTarget?.active_ml ?? null, daysLogged: waterDays.length },
    waist: measurements.map((m) => ({ date: String(m.measured_date).slice(0, 10), cm: waistCm(m.fields, m.unit) ?? 0 })).filter((m) => m.cm > 0),
    performance: lowerLiftPerformance(sets, today),
    health: { walkingLimits: walk, fluidRestriction },
    profile: {
      climate: (profile?.climate as Climate) ?? null,
      sweat: (profile?.sweat_level as SweatLevel) ?? null,
      maxIncline: profile?.max_incline != null ? Number(profile.max_incline) : null,
      availableMinutes: profile?.max_session_minutes ?? null,
    },
    pastPhases: pastCutPhases(weighIns, sets, today),
  };

  return {
    input,
    assessment: buildAssessment(input),
    client: {
      id: c.id,
      userId,
      firstName: String(c.preferred_name || c.first_name || String(c.full_name ?? "").split(" ")[0] || "them"),
      unit,
      goalUnit,
      tz: c.timezone || "America/Winnipeg",
      goal: {
        type: (c.bodyweight_goal_type as GoalType) ?? null,
        value: c.bodyweight_goal_value != null ? Number(c.bodyweight_goal_value) : null,
        valueMax: c.bodyweight_goal_value_max != null ? Number(c.bodyweight_goal_value_max) : null,
        date: c.bodyweight_goal_date ?? null,
      },
    },
    refs: {
      trainingCardioId: trainRow?.id ?? null,
      restCardioId: restRow?.id ?? null,
      planId: plan?.id ?? null,
      waterTarget: waterTarget ? { active_ml: Number(waterTarget.active_ml), training_extra_ml: waterTarget.training_extra_ml ?? null, target_source: String(waterTarget.target_source ?? "") } : null,
      profile,
    },
  };
}

/** Their program's next two weeks: each dated workout's exercises in order, with each exercise's competition lift type. */
async function loadUpcomingDays(sb: any, clientId: string, today: string): Promise<PlannedDay[]> {
  const blocks = await safe<any[]>(() => sb.from("pl_blocks").select("id, archived, client_visible, status").eq("client_id", clientId).eq("client_visible", true), []);
  const blockIds = blocks.filter((b) => !b.archived && b.status !== "Archived").map((b) => b.id);
  if (!blockIds.length) return [];
  const weeks = await inChunks<any>(blockIds, (ids) => sb.from("pl_weeks").select("id").in("block_id", ids).is("deleted_at", null));
  const weekIds = weeks.map((w) => w.id);
  const end = addDays(today, 13);
  const days = await inChunks<any>(weekIds, (ids) => sb.from("pl_days").select("id, scheduled_date").in("week_id", ids).eq("archived", false).is("deleted_at", null).gte("scheduled_date", today).lte("scheduled_date", end));
  if (!days.length) return [];
  const rows = await inChunks<any>(days.map((d) => d.id), (ids) => sb.from("pl_exercise_rows").select("day_id, sort_order, exercise_id").in("day_id", ids));
  const exIds = [...new Set(rows.map((r) => r.exercise_id).filter(Boolean))] as string[];
  const ex = await inChunks<any>(exIds, (ids) => sb.from("exercises").select("id, competition_lift_type").in("id", ids));
  const lift = new Map<string, string | null>(ex.map((e) => [e.id, e.competition_lift_type ?? null]));
  return days.map((d) => ({
    date: String(d.scheduled_date),
    rows: rows.filter((r) => r.day_id === d.id).map((r) => ({ order: Number(r.sort_order ?? 0), lift: r.exercise_id ? (lift.get(r.exercise_id) ?? null) : null })),
  }));
}
