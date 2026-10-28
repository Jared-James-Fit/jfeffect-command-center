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
  TARGETS_PROMPT,
  cleanAiText,
  mealPlanUserPrompt,
  targetsUserPrompt,
  type ClientBasics,
  type QA,
  type WorkoutMealsMode,
} from "@/lib/nutrition-ai-prompts";
import { phaseFromText } from "@/lib/nutrition-cardio";
import { calcAge, formatHeight, type HeightUnit } from "@/lib/basic-info";
import { sexLabel } from "@/lib/athlete-sex";
import { summarizeTrainingTimes, type TrainingPattern } from "@/lib/nutrition-targets/training-pattern";
import { resolveTiming } from "@/lib/analytics/training-time";
import { programContextText } from "@/lib/program-context";
import { formAnswerText as answerValue } from "@/lib/form-answer-text";
import { answerFor } from "@/lib/nutrition-ai-prompts";
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

/** A bodyweight answer ("182", "182 lbs", "82 kg") in kg. The form asks in lbs. */
function answerKg(text: string): number | null {
  const m = String(text ?? "").match(/(\d+(?:\.\d+)?)\s*(kg|lb|lbs)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /kg/i.test(m[2] ?? "") ? n : n / LB;
}

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
    sb.from("clients").select("user_id, preferred_weight_unit").eq("id", sub.client_id).maybeSingle(),
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
  const [{ data: weights }, { data: checkins }] = await Promise.all([
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
  ]);

  // Fallback trend: the last Nutrition Update's bodyweight answer vs this one.
  let formFallback: { fromKg: number; toKg: number; days: number } | null = null;
  const prev = (prevSubs ?? [])[0];
  const nowKg = answerKg(answerFor(qas, "bodyweight"));
  if (prev?.submitted_at && nowKg) {
    const { qas: prevQas } = await loadQAs(sb, prev.id).catch(() => ({ qas: [] as QA[] }));
    const fromKg = answerKg(answerFor(prevQas, "bodyweight"));
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
    }),
  };
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
  const startedAt = new Date().toISOString();
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
    const [coach, basics, history, program] = await Promise.all([
      coachSettings(sb, sub.client_id),
      loadClientBasics(sb, sub.client_id),
      // Never let a history lookup block the plan.
      loadTrainingPattern(sb, sub.client_id).catch(() => null),
      // Which block / week they're in, so fuel matches training demand.
      loadProgramContext(sb, sub.client_id),
    ]);
    const selected = phaseOverride ?? coach.phase;
    const workoutMeals = workoutMealsOverride ?? coach.workoutMeals ?? "auto";
    const goalAnswer = qas.find((q) => /^goal$/i.test(q.label.trim()))?.value ?? "";
    const phase = selected ?? phaseFromText(goalAnswer);
    await sb.from("nutrition_ai_plans").update({ phase, workout_meals: workoutMeals }).eq("submission_id", submissionId);

    const { createLovableAiGateway, DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
    const { generateText } = await import("ai");
    const gateway = createLovableAiGateway();
    const { data: g } = await sb.from("global_ai_config").select("default_model").limit(1).maybeSingle();
    const modelId = g?.default_model || DEFAULT_AI_MODEL;

    const t = await generateText({
      model: gateway(modelId),
      system: TARGETS_PROMPT,
      prompt: targetsUserPrompt(basics, qas, selected, programContextText(program, { readout: false }), previousPlanText(previous)),
    });
    const targetsText = cleanAiText(t.text);

    const m = await generateText({
      model: gateway(modelId),
      system: MEAL_PLAN_PROMPT,
      prompt: mealPlanUserPrompt(qas, targetsText, phase ?? phaseFromText(targetsText.match(/^Goal:\s*(.+)$/m)?.[1]), workoutMeals, history, previousMealsText(previous)),
    });
    const mealPlanText = cleanAiText(m.text);

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
  opts: { phase?: string | null; workoutMeals?: WorkoutMealsMode | null } = {},
) {
  const { data: subRow } = await sb.from("nf_submissions").select("client_id").eq("id", submissionId).maybeSingle();
  if (!subRow) throw new Error("Submission not found");
  const { error } = await sb.from("nutrition_ai_plans").upsert(
    {
      submission_id: submissionId,
      client_id: subRow.client_id,
      status: "pending",
      error: null,
      phase: opts.phase ?? null,
      workout_meals: opts.workoutMeals ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "submission_id" },
  );
  if (error) throw new Error(error.message);
  return { status: "pending" as const };
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
    .select("phase, workout_meals")
    .maybeSingle();
  if (!claimed) return { status: "skipped" as const, submissionId: id };
  const res = await runPlan(sb, id, claimed.phase ?? null, true, (claimed.workout_meals as WorkoutMealsMode | null) ?? null);
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
