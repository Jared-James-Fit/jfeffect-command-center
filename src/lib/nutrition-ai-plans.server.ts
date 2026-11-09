/**
 * The Nutrition Update Request's server side: reading a submission's answers
 * and the client's basics, and writing the AI targets and meal plan
 * (runPlan / startNutritionPlan). Server only: the form's submit
 * (notifyAppEventFn) and the coach's panel (nutrition-ai-plans.functions.ts)
 * both come through here.
 */
import {
  MEAL_PLAN_PROMPT,
  NUTRITION_REQUEST_FORM_ID,
  REVISE_TARGETS_PROMPT,
  TARGETS_PROMPT,
  cleanAiText,
  mealPlanUserPrompt,
  mealPrepFixPrompt,
  reviseMealPlanUserPrompt,
  reviseTargetsUserPrompt,
  revisionLooksRight,
  targetsUserPrompt,
  type ClientBasics,
  type QA,
  type WorkoutMealsMode,
} from "@/lib/nutrition-ai-prompts";
import { phaseFromText } from "@/lib/nutrition-cardio";
import { planMenus, prepDrift } from "@/lib/nutrition-targets/plan-foods";
import { configuredHighWeekday } from "@/lib/client-nutrition-day";
import { bodyweightAnswerKg, parseAiTargets, planTotalsIssues, safetyNotes, weeklyAverageKcal, withoutCoachNotes, type DayTargets } from "@/lib/nutrition-targets/nutrition-intel";
import { calcAge, formatHeight, type HeightUnit } from "@/lib/basic-info";
import { sexLabel } from "@/lib/athlete-sex";
import { summarizeTrainingTimes, type TrainingPattern } from "@/lib/nutrition-targets/training-pattern";
import { resolveTiming } from "@/lib/analytics/training-time";
import { programContextText } from "@/lib/program-context";
import { formAnswerText as answerValue } from "@/lib/form-answer-text";
import { answerFor } from "@/lib/nutrition-ai-prompts";
import { currentCardioText } from "@/lib/nutrition-cardio-sync";
import {
  pickPreviousPlan,
  planResults,
  previousMealsText,
  previousPlanText,
  type PreviousPlan,
} from "@/lib/nutrition-history";

export async function loadQAs(sb: any, submissionId: string): Promise<{ sub: any; qas: QA[] }> {
  const { data: sub, error } = await sb
    .from("nf_submissions")
    .select("id, form_id, client_id, status, submitted_at, client:client_id(id, full_name, user_id)")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!sub) throw new Error("Submission not found");
  const [{ data: questions }, { data: answers }] = await Promise.all([
    sb.from("nf_questions").select("id, label, order_index, question_type").eq("form_id", sub.form_id).order("order_index"),
    sb.from("nf_answers").select("question_id, value_text, value_number, value_json").eq("submission_id", submissionId),
  ]);
  const byQ = new Map((answers ?? []).map((a: any) => [a.question_id, a]));
  const qas: QA[] = (questions ?? [])
    .filter((q: any) => q.question_type !== "file" && q.question_type !== "video")
    .map((q: any) => ({ label: q.label, value: byQ.has(q.id) ? answerValue(byQ.get(q.id)) : "" }));
  return { sub, qas };
}

/** Name, sex, age and height from the client profile, for the AI and the coach's copy. */
export async function loadClientBasics(
  sb: any,
  clientId: string,
): Promise<ClientBasics> {
  const { data: c } = await sb
    .from("clients")
    .select("full_name, sex, date_of_birth, height_cm, preferred_height_unit")
    .eq("id", clientId)
    .maybeSingle();
  const sex = c?.sex === "male" || c?.sex === "female" ? sexLabel(c.sex) : null;
  return {
    name: c?.full_name ?? "Client",
    sex,
    age: calcAge(c?.date_of_birth ?? null),
    height:
      c?.height_cm != null
        ? formatHeight(Number(c.height_cm), (c.preferred_height_unit as HeightUnit) ?? "imperial")
        : null,
  };
}

/** When the client actually trains, from their logged workouts (last 8 weeks). */
export async function loadTrainingPattern(sb: any, clientId: string): Promise<TrainingPattern | null> {
  const since = new Date(Date.now() - 56 * 86_400_000).toISOString();
  const [{ data: client }, { data: rows }] = await Promise.all([
    sb.from("clients").select("timezone").eq("id", clientId).maybeSingle(),
    sb
      .from("pl_day_completions")
      .select("started_at, training_started_at, completed_at, actual_duration_min, logged_sets_count")
      .eq("client_id", clientId)
      .gte("completed_at", since)
      .order("completed_at", { ascending: false })
      .limit(200),
  ]);
  // Same rules as Analytics → Training Time: a confirmed start wins, and a
  // workout typed in after the gym says nothing about when they train.
  const starts = (rows ?? []).map((r: any) => {
    const t = resolveTiming({
      startedAt: r.started_at,
      trainingStartedAt: r.training_started_at ?? null,
      completedAt: r.completed_at,
      durationMin: r.actual_duration_min,
      loggedSets: r.logged_sets_count,
    });
    return t && t.source !== "suspect" ? t.start : null;
  });
  return summarizeTrainingTimes(starts, client?.timezone || "UTC");
}

const LB = 2.2046226;

/**
 * The plan the client was on when they sent this update (the latest one made
 * before it), and how it went: bodyweight trend, weekly check-in adherence
 * and flags. Null for a first plan.
 */
export async function loadPreviousPlan(sb: any, sub: { id: string; client_id: string; submitted_at?: string | null }, qas: QA[]): Promise<PreviousPlan | null> {
  const before = sub.submitted_at ?? new Date().toISOString();
  const { data: targets } = await sb
    .from("nutrition_targets")
    .select("id, phase, custom_phase, goal, custom_goal, start_date, created_at, nutrition_target_days(day_label, calories, protein, carbs, fats, fibre, notes, sort_order)")
    .eq("client_id", sub.client_id)
    .lt("created_at", before)
    .order("created_at", { ascending: false })
    .limit(5);
  const t = pickPreviousPlan(
    ((targets ?? []) as any[]).map((x) => ({ ...x, days: x.nutrition_target_days ?? [] })),
    before,
  );
  if (!t) return null;

  const start = String(t.start_date ?? t.created_at).slice(0, 10);
  const end = before.slice(0, 10);
  const [{ data: client }, { data: prevSubs }] = await Promise.all([
    sb.from("clients").select("user_id, preferred_weight_unit, timezone, committed_training_days, preferred_high_days").eq("id", sub.client_id).maybeSingle(),
    sb
      .from("nf_submissions")
      .select("id, submitted_at")
      .eq("form_id", NUTRITION_REQUEST_FORM_ID)
      .eq("client_id", sub.client_id)
      .neq("id", sub.id)
      .lt("submitted_at", before)
      .order("submitted_at", { ascending: false })
      .limit(1),
  ]);
  const unit: "lb" | "kg" = client?.preferred_weight_unit === "kg" ? "kg" : "lb";
  // Log Food keeps a client's entries on their member row (made the first time they log).
  const { data: member } = client?.user_id
    ? await sb.from("app_members").select("id").eq("user_id", client.user_id).maybeSingle()
    : { data: null };
  const [{ data: weights }, { data: checkins }, { data: food }] = await Promise.all([
    client?.user_id
      ? sb
          .from("progress_bodyweight")
          .select("logged_date, weight_value, weight_unit")
          .eq("user_id", client.user_id)
          .gte("logged_date", start)
          .lte("logged_date", end)
      : Promise.resolve({ data: [] }),
    sb
      .from("messenger_checkins")
      .select("answers")
      .eq("client_id", sub.client_id)
      .eq("task_type", "weekly_checkin")
      .eq("status", "completed")
      .gte("submitted_at", `${start}T00:00:00Z`)
      .lt("submitted_at", before),
    member?.id
      ? sb
          .from("member_meal_logs")
          .select("logged_at, calories, protein_g, carbs_g, fat_g")
          .eq("member_id", member.id)
          .gte("logged_at", `${start}T00:00:00Z`)
          .lt("logged_at", before)
          .limit(5000)
      : Promise.resolve({ data: [] }),
  ]);

  // Fallback trend: the last Nutrition Update's bodyweight answer vs this one.
  let formFallback: { fromKg: number; toKg: number; days: number } | null = null;
  const prev = (prevSubs ?? [])[0];
  const nowKg = bodyweightAnswerKg(answerFor(qas, "bodyweight"));
  if (prev?.submitted_at && nowKg) {
    const { qas: prevQas } = await loadQAs(sb, prev.id).catch(() => ({ qas: [] as QA[] }));
    const fromKg = bodyweightAnswerKg(answerFor(prevQas, "bodyweight"));
    const days = (Date.parse(before) - Date.parse(prev.submitted_at)) / 86_400_000;
    if (fromKg) formFallback = { fromKg, toKg: nowKg, days };
  }

  const days = ((t as any).days as any[])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((d) => ({
      label: String(d.day_label ?? "Day"),
      calories: d.calories ?? null,
      protein: d.protein ?? null,
      carbs: d.carbs ?? null,
      fats: d.fats ?? null,
      fibre: d.fibre ?? null,
      meals: d.notes ?? null,
    }));
  const weeksOn = Math.round(((Date.parse(before) - Date.parse(`${start}T00:00:00Z`)) / (7 * 86_400_000)) * 10) / 10;
  return {
    target_id: (t as any).id,
    phase: (t as any).phase === "Custom" ? (t as any).custom_phase ?? "Custom" : (t as any).phase ?? null,
    goal: (t as any).goal === "Custom" ? (t as any).custom_goal ?? null : (t as any).goal ?? null,
    start_date: start,
    weeks_on: weeksOn >= 0 ? weeksOn : null,
    days,
    results: planResults({
      start,
      end,
      unit,
      weights: ((weights ?? []) as any[]).map((w) => ({
        date: String(w.logged_date),
        kg: String(w.weight_unit ?? "").toLowerCase().startsWith("lb") ? Number(w.weight_value) / LB : Number(w.weight_value),
      })),
      checkins: ((checkins ?? []) as any[]).map((c) => ({ answers: c.answers ?? null })),
      formFallback,
      food: ((food ?? []) as any[]).map((f) => ({ at: String(f.logged_at), kcal: f.calories, protein: f.protein_g, carbs: f.carbs_g, fat: f.fat_g })),
      tz: client?.timezone || "America/Winnipeg",
      planKcal: weeklyAverageKcal(
        days,
        ((client?.committed_training_days ?? []) as string[]).filter(Boolean),
        configuredHighWeekday(client?.preferred_high_days ?? null).weekday,
      ),
    }),
  };
}

/** The client's cardio targets (all statuses; the cardio helpers skip archived ones). */
export async function loadCardioRows(sb: any, clientId: string): Promise<any[]> {
  const { data } = await sb
    .from("cardio_targets")
    .select("id, day_type, status, enabled, program_name, cardio_type, duration_minutes, frequency_per_week, calorie_target_min, calorie_target_mode, updated_at, source")
    .eq("client_id", clientId);
  return (data ?? []) as any[];
}

/** The days the client trains (their committed schedule), for the cardio the AI writes. */
export async function loadTrainingDays(sb: any, clientId: string): Promise<string[]> {
  const { data } = await sb.from("clients").select("committed_training_days").eq("id", clientId).maybeSingle();
  return ((data?.committed_training_days ?? []) as string[]).filter(Boolean);
}

async function coachSettings(sb: any, clientId: string): Promise<{ phase: string | null; workoutMeals: WorkoutMealsMode | null }> {
  const { data } = await sb
    .from("nf_assignments")
    .select("settings")
    .eq("form_id", NUTRITION_REQUEST_FORM_ID)
    .eq("client_id", clientId)
    .maybeSingle();
  const st = (data?.settings as any) ?? {};
  return { phase: st.phase ?? null, workoutMeals: st.workout_meals ?? null };
}

export async function runPlan(
  sb: any,
  submissionId: string,
  phaseOverride?: string | null,
  notifyStaff = false,
  workoutMealsOverride?: WorkoutMealsMode | null,
) {
  // The row goes in first, so the coach's panel shows it building, and
  // anything that goes wrong after this (a lookup, the AI) is on the row as
  // the error instead of leaving no trace.
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const { data: subRow } = await sb.from("nf_submissions").select("client_id").eq("id", submissionId).maybeSingle();
  if (!subRow) throw new Error("Submission not found");
  const { error: rowError } = await sb.from("nutrition_ai_plans").upsert(
    { submission_id: submissionId, client_id: subRow.client_id, status: "generating", error: null, updated_at: startedAt },
    { onConflict: "submission_id" },
  );
  if (rowError) throw new Error(rowError.message);
  try {
    const { sub, qas } = await loadQAs(sb, submissionId);
    const { loadProgramContext } = await import("@/lib/program-context.server");
    // The plan they were on, snapshotted the first time so a regenerate after
    // it was replaced or deleted still sees it.
    const { data: planRow } = await sb.from("nutrition_ai_plans").select("previous_plan").eq("submission_id", submissionId).maybeSingle();
    let previous = (planRow?.previous_plan ?? null) as PreviousPlan | null;
    if (!previous) {
      previous = await loadPreviousPlan(sb, sub, qas).catch(() => null);
      if (previous) await sb.from("nutrition_ai_plans").update({ previous_plan: previous }).eq("submission_id", submissionId);
    }
    const [coach, basics, history, program, cardioRows, trainingDays, athlete] = await Promise.all([
      coachSettings(sb, sub.client_id),
      loadClientBasics(sb, sub.client_id),
      // Never let a history lookup block the plan.
      loadTrainingPattern(sb, sub.client_id).catch(() => null),
      // Which block / week they're in, so fuel matches training demand.
      loadProgramContext(sb, sub.client_id),
      // Their cardio now: the AI adjusts it with the calories.
      loadCardioRows(sb, sub.client_id),
      loadTrainingDays(sb, sub.client_id).catch(() => [] as string[]),
      // Their records as Program Intelligence reads them (never blocks the plan).
      loadNutritionAthlete(sb, sub.client_id),
    ]);
    const selected = phaseOverride ?? coach.phase;
    const workoutMeals = workoutMealsOverride ?? coach.workoutMeals ?? "auto";
    const goalAnswer = qas.find((q) => /^goal$/i.test(q.label.trim()))?.value ?? "";
    const phase = selected ?? phaseFromText(goalAnswer);
    await sb.from("nutrition_ai_plans").update({ phase, workout_meals: workoutMeals }).eq("submission_id", submissionId);

    // The targets are the coaching decision (the strong tier); the meal plan is writing to them.
    const deadline = startedMs + RUN_BUDGET_MS;
    const t = await askNutrition(
      sb,
      "nutrition",
      TARGETS_PROMPT,
      targetsUserPrompt(basics, qas, selected, programContextText(program, { readout: false }), previousPlanText(previous), currentCardioText(cardioRows, { trainingDays }), {
        athlete: athlete?.text ?? null,
        safety: safetyNotes(qas),
      }),
      deadline - WRITE_RESERVE_MS,
    );
    const targetsText = cleanAiText(t.text);

    // The meal plan is the client's: the targets' COACH NOTES (reasoning, health flags) stay out of it.
    const mealPrompt = mealPlanUserPrompt(qas, withoutCoachNotes(targetsText) ?? "", phase ?? phaseFromText(targetsText.match(/^Goal:\s*(.+)$/m)?.[1]), workoutMeals, history, previousMealsText(previous));
    const m = await askNutrition(sb, "nutrition_write", MEAL_PLAN_PROMPT, mealPrompt, deadline);
    const mealPlanText = await withPrepFix(
      cleanAiText(m.text),
      mealPrompt,
      (prompt) => (deadline - Date.now() > FIX_MIN_MS ? askNutrition(sb, "nutrition_write", MEAL_PLAN_PROMPT, prompt, deadline).then((r) => r.text) : Promise.resolve("")),
      parseAiTargets(targetsText),
    );
    const modelId = `targets ${t.model} · meals ${m.model}`;

    await sb.from("nutrition_ai_plans").update({
      status: "ready",
      targets_text: targetsText,
      meal_plan_text: mealPlanText,
      model: modelId,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("submission_id", submissionId);
    if (notifyStaff) {
      const { notifyAppEvent } = await import("@/lib/push/app-events.server");
      await notifyAppEvent(sb, "nutrition_plan_ready", { clientId: sub.client_id, sourceId: submissionId });
    }
    return { status: "ready" as const };
  } catch (e: any) {
    await sb.from("nutrition_ai_plans").update({
      status: "error",
      error: String(e?.message ?? e).slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("submission_id", submissionId);
    return { status: "error" as const, error: String(e?.message ?? e) };
  }
}

/**
 * A written plan is checked in code, not trusted to the model: a weighed food
 * at different amounts between meals or day types (prepDrift), a menu whose
 * Daily Total is off its targets or whose meals don't add up to it
 * (planTotalsIssues). One that fails gets one targeted fix, kept only when it
 * still reads as the same plan (same menus, a Daily Total) with fewer
 * problems. A failed fix never costs the plan already written. Exported for tests.
 */
export async function withPrepFix(draft: string, userPrompt: string, ask: (prompt: string) => Promise<string>, targets: DayTargets[] = []): Promise<string> {
  const issues = (text: string) => ({ drift: prepDrift(planMenus(text)), totals: targets.length ? planTotalsIssues(text, targets) : [] });
  const before = issues(draft);
  const count = (x: ReturnType<typeof issues>) => x.drift.length + x.totals.length;
  if (!count(before)) return draft;
  const fixed = cleanAiText(await ask(mealPrepFixPrompt(userPrompt, draft, before.drift, before.totals)).catch(() => ""));
  if (!fixed || !revisionLooksRight("meals", draft, fixed)) return draft;
  if (planMenus(fixed).length !== planMenus(draft).length) return draft;
  return count(issues(fixed)) < count(before) ? fixed : draft;
}

/* ------------------------------------------------------------------------ */
/* Which model answers                                                       */

/** A whole plan (targets, meals, one fix) finishes inside one background request. */
export const RUN_BUDGET_MS = 270_000;
/** Kept back from the targets for writing the meal plan. */
const WRITE_RESERVE_MS = 90_000;
/** The fix only runs with this much of the budget left. */
const FIX_MIN_MS = 45_000;
/** Each model's own limit: the first gets longer (a strong model thinks), the fallback less. */
const FIRST_MODEL_MS = 150_000;
const NEXT_MODEL_MS = 110_000;

/**
 * One nutrition call, routed like the training AI (src/lib/ai/routing.ts: "nutrition" for the
 * targets, the strong tier only; "nutrition_write" for meal plans, fast first; an admin
 * override in app_settings.ai_routes wins), trying the next model when one fails or runs out of
 * time, never past `deadline`.
 */
export async function askNutrition(sb: any, task: "nutrition" | "nutrition_write", system: string, prompt: string, deadline: number): Promise<{ text: string; model: string }> {
  const { callModel, ModelHttpError } = await import("@/lib/ai/model-client.server");
  const { resolveRoute } = await import("@/lib/ai/routing");
  const { data } = await sb.from("app_settings").select("value").eq("key", "ai_routes").maybeSingle();
  let override: any = null;
  try {
    override = data?.value ? JSON.parse(data.value) : null;
  } catch {
    override = null;
  }
  const route = resolveRoute(task, override);
  const errors: string[] = [];
  for (const [i, model] of route.models.entries()) {
    const timeoutMs = Math.min(i === 0 ? FIRST_MODEL_MS : NEXT_MODEL_MS, deadline - Date.now());
    if (timeoutMs < 20_000) {
      errors.push(`${model}: out of time`);
      break;
    }
    try {
      const r = await callModel(model, { system, prompt, effort: route.effort, maxOutputTokens: route.maxOutputTokens, timeoutMs, temperature: 0.3 });
      if (!r.text.trim()) throw new Error("an empty answer");
      return { text: r.text, model };
    } catch (e: any) {
      if (e instanceof ModelHttpError && e.status === 402) throw new Error("Lovable AI credits are used up. Add credits in Lovable, then Regenerate.");
      errors.push(`${model}: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }
  throw new Error(
    route.strongOnly
      ? `The coaching model didn't answer (${errors.join("; ")}). Nutrition targets aren't handed to a weaker model; Regenerate in a few minutes.`
      : `No model answered (${errors.join("; ")}). Try again in a few minutes.`,
  );
}

/**
 * The athlete as Program Intelligence reads them (nutrition-athlete.ts): their whole history,
 * read once. Null when it can't be read in time; a plan is never held up by it.
 */
export async function loadNutritionAthlete(sb: any, clientId: string): Promise<{ text: string } | null> {
  const read = (async () => {
    const [{ loadIntelRecords }, { buildGeneratorIntel }, { nutritionAthleteText }] = await Promise.all([
      import("@/lib/program-intel/load"),
      import("@/lib/program-intel/intelligence"),
      import("@/lib/nutrition-targets/nutrition-athlete"),
    ]);
    const rec = await loadIntelRecords(sb, clientId, { kind: "history" } as any);
    const intel = buildGeneratorIntel(rec);
    return { text: nutritionAthleteText(intel.ctx, intel.development) };
  })();
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000));
  return Promise.race([read, timeout]).catch(() => null);
}

/** A plan for this submission is already being written (started under 3 minutes ago). */
export function planBusy(existing: { status?: string | null; updated_at?: string | null } | null | undefined, now = Date.now()): boolean {
  return existing?.status === "generating" && !!existing.updated_at && now - new Date(existing.updated_at).getTime() < 3 * 60_000;
}

/** Queued for the background writer in the last 3 minutes (asking again would only queue it twice). */
export function planQueued(existing: { status?: string | null; updated_at?: string | null } | null | undefined, now = Date.now()): boolean {
  return existing?.status === "pending" && !!existing.updated_at && now - new Date(existing.updated_at).getTime() < 3 * 60_000;
}

/** A "generating" run this old was cut off (its request ended before the AI finished). */
export const STALE_RUN_MS = 10 * 60_000;

/**
 * Hand a plan to the background writer: the row goes to "pending" (with the
 * coach's phase / workout-meals choice for this run, or null for the
 * defaults), and the database's `nutrition_ai_plans_queue_run` trigger calls
 * the nutrition-plans-tick hook at once (pg_cron's run of the same hook every
 * 5 minutes catches anything that slipped). Never written inside the
 * caller's request: a phone or a tab that closes would cut the AI off
 * mid-plan and leave it "generating" forever.
 */
export async function queueNutritionPlan(
  sb: any,
  submissionId: string,
  opts: { phase?: string | null; workoutMeals?: WorkoutMealsMode | null; fresh?: boolean } = {},
) {
  const { data: subRow } = await sb.from("nf_submissions").select("client_id").eq("id", submissionId).maybeSingle();
  if (!subRow) throw new Error("Submission not found");
  const now = new Date().toISOString();
  // A coach update that's waiting (or was cut off) is put back in line as the
  // same update, never turned into a whole new plan. Only Regenerate
  // (`fresh`) replaces it.
  if (!opts.fresh) {
    const { data: row } = await sb.from("nutrition_ai_plans").select("revise_instructions, status").eq("submission_id", submissionId).maybeSingle();
    if (row?.revise_instructions && (row.status === "pending" || row.status === "generating")) {
      const { error } = await sb.from("nutrition_ai_plans").update({ status: "pending", error: null, updated_at: now }).eq("submission_id", submissionId);
      if (error) throw new Error(error.message);
      return { status: "pending" as const };
    }
  }
  const { error } = await sb.from("nutrition_ai_plans").upsert(
    {
      submission_id: submissionId,
      client_id: subRow.client_id,
      status: "pending",
      error: null,
      phase: opts.phase ?? null,
      workout_meals: opts.workoutMeals ?? null,
      // A whole new plan: earlier updates (and their Undo) belong to the old one.
      revise_instructions: null,
      revisions: [],
      updated_at: now,
    },
    { onConflict: "submission_id" },
  );
  if (error) throw new Error(error.message);
  return { status: "pending" as const };
}

/** Coach updates kept for Undo (the newest last). */
export const REVISIONS_KEPT = 5;

export type PlanRevision = {
  at: string;
  instructions: string;
  before: { targets_text: string | null; meal_plan_text: string | null };
};

/**
 * The coach's "Change something": queue an update of a written plan for the
 * background writer (same queue and trigger as a whole plan). The plan stays
 * as it is until the update is written; a failed one leaves it untouched.
 */
export async function queueNutritionRevision(sb: any, submissionId: string, instructions: string) {
  const { data: row } = await sb
    .from("nutrition_ai_plans")
    .select("status, updated_at, meal_plan_text")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (!row?.meal_plan_text) throw new Error("There's no plan to update yet");
  if (planBusy(row) || planQueued(row)) return { status: row.status as "pending" | "generating" };
  if (row.status !== "ready") throw new Error("The plan isn't ready to update");
  const { error } = await sb
    .from("nutrition_ai_plans")
    .update({ status: "pending", revise_instructions: instructions.trim(), error: null, updated_at: new Date().toISOString() })
    .eq("submission_id", submissionId);
  if (error) throw new Error(error.message);
  return { status: "pending" as const };
}

/** Undo the latest coach update: the plan as it was before it. */
export async function undoNutritionRevision(sb: any, submissionId: string) {
  const { data: row } = await sb.from("nutrition_ai_plans").select("status, revisions").eq("submission_id", submissionId).maybeSingle();
  const revisions = (row?.revisions ?? []) as PlanRevision[];
  const last = revisions[revisions.length - 1];
  if (!row || row.status !== "ready" || !last) throw new Error("Nothing to undo");
  const { error } = await sb
    .from("nutrition_ai_plans")
    .update({
      targets_text: last.before.targets_text,
      meal_plan_text: last.before.meal_plan_text,
      revisions: revisions.slice(0, -1),
      revise_instructions: null,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("submission_id", submissionId)
    .eq("status", "ready");
  if (error) throw new Error(error.message);
  return { ok: true, instructions: last.instructions };
}

/**
 * Write a coach update (the background writer, never a request): pass 1
 * gives the targets back, changed only if the instructions are about
 * numbers; pass 2 changes the meal plan as asked and keeps the rest. Output
 * that doesn't read as a plan is thrown away, and any failure leaves the plan
 * as it was ("ready", with the error and the instructions kept for Try again).
 */
export async function runRevision(sb: any, submissionId: string, instructions: string, notifyStaff = false) {
  const { data: row } = await sb
    .from("nutrition_ai_plans")
    .select("client_id, targets_text, meal_plan_text, phase, workout_meals, revisions")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (!row?.meal_plan_text) {
    // Nothing written to update: write the whole plan instead.
    await sb.from("nutrition_ai_plans").update({ revise_instructions: null }).eq("submission_id", submissionId);
    return runPlan(sb, submissionId, row?.phase ?? null, notifyStaff, (row?.workout_meals as WorkoutMealsMode | null) ?? null);
  }
  try {
    const { qas } = await loadQAs(sb, submissionId);
    const history = await loadTrainingPattern(sb, row.client_id).catch(() => null);
    const deadline = Date.now() + RUN_BUDGET_MS;
    const models: string[] = [];

    const oldTargets = String(row.targets_text ?? "");
    let targetsText = oldTargets;
    if (oldTargets.trim()) {
      const t = await askNutrition(sb, "nutrition_write", REVISE_TARGETS_PROMPT, reviseTargetsUserPrompt(oldTargets, instructions), deadline - WRITE_RESERVE_MS);
      models.push(`targets ${t.model}`);
      const next = cleanAiText(t.text);
      if (revisionLooksRight("targets", oldTargets, next)) targetsText = next;
    }
    const phase = row.phase ?? phaseFromText(targetsText.match(/^Goal:\s*(.+)$/m)?.[1]);
    const m = await askNutrition(
      sb,
      "nutrition_write",
      MEAL_PLAN_PROMPT,
      reviseMealPlanUserPrompt({
        qas,
        targetsText: withoutCoachNotes(targetsText) ?? "",
        mealPlanText: row.meal_plan_text,
        instructions,
        phase,
        workoutMeals: (row.workout_meals as WorkoutMealsMode | null) ?? null,
        history,
      }),
      deadline,
    );
    models.push(`meals ${m.model}`);
    const modelId = `update · ${models.join(" · ")}`;
    const mealPlanText = cleanAiText(m.text);
    if (!revisionLooksRight("meals", row.meal_plan_text, mealPlanText)) {
      throw new Error("The AI's answer didn't come back as a meal plan. Try wording the change differently");
    }

    const now = new Date().toISOString();
    const revisions: PlanRevision[] = [
      ...((row.revisions ?? []) as PlanRevision[]),
      { at: now, instructions, before: { targets_text: row.targets_text ?? null, meal_plan_text: row.meal_plan_text } },
    ].slice(-REVISIONS_KEPT);
    await sb.from("nutrition_ai_plans").update({
      status: "ready",
      targets_text: targetsText,
      meal_plan_text: mealPlanText,
      revise_instructions: null,
      revisions,
      error: null,
      model: modelId,
      generated_at: now,
      updated_at: now,
    }).eq("submission_id", submissionId);
    if (notifyStaff) {
      const { notifyAppEvent } = await import("@/lib/push/app-events.server");
      await notifyAppEvent(sb, "nutrition_plan_ready", { clientId: row.client_id, sourceId: submissionId });
    }
    return { status: "ready" as const };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    await sb.from("nutrition_ai_plans").update({
      status: "ready",
      error: msg.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("submission_id", submissionId);
    return { status: "error" as const, error: msg };
  }
}

/**
 * The background writer (nutrition-plans-tick hook): claim a queued plan, or
 * one whose run was cut off, and write it. The claim is one conditional
 * update, so two runs never write the same plan. Without an id it takes the
 * oldest waiting plan from the last 2 days.
 */
export async function runQueuedPlan(sb: any, submissionId?: string | null) {
  let id = submissionId ?? null;
  if (!id) {
    const since = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    const stale = new Date(Date.now() - STALE_RUN_MS).toISOString();
    const { data } = await sb
      .from("nutrition_ai_plans")
      .select("submission_id")
      .gte("updated_at", since)
      .or(`status.eq.pending,and(status.eq.generating,updated_at.lt."${stale}")`)
      .order("updated_at", { ascending: true })
      .limit(1);
    id = data?.[0]?.submission_id ?? null;
  }
  if (!id) return { status: "idle" as const };
  const stale = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const { data: claimed } = await sb
    .from("nutrition_ai_plans")
    .update({ status: "generating", error: null, updated_at: new Date().toISOString() })
    .eq("submission_id", id)
    .or(`status.eq.pending,and(status.eq.generating,updated_at.lt."${stale}")`)
    .select("phase, workout_meals, revise_instructions")
    .maybeSingle();
  if (!claimed) return { status: "skipped" as const, submissionId: id };
  const res = claimed.revise_instructions
    ? await runRevision(sb, id, claimed.revise_instructions, true)
    : await runPlan(sb, id, claimed.phase ?? null, true, (claimed.workout_meals as WorkoutMealsMode | null) ?? null);
  return { ...res, submissionId: id };
}

/**
 * A client just sent their Nutrition Update Request: queue their AI targets
 * and meal plan for the background writer, so it never depends on their
 * phone staying open (the coach is told the request is in before this runs,
 * and again when the plan is ready). Once per submission: one already
 * queued, being written, or written, is left alone.
 */
export async function startNutritionPlan(sb: any, submissionId: string) {
  const { data: existing } = await sb.from("nutrition_ai_plans").select("status, updated_at").eq("submission_id", submissionId).maybeSingle();
  if (planBusy(existing)) return { status: "generating" as const };
  if (planQueued(existing)) return { status: "pending" as const };
  if (existing && existing.status !== "error" && existing.status !== "generating" && existing.status !== "pending") {
    return { status: existing.status };
  }
  return queueNutritionPlan(sb, submissionId);
}
