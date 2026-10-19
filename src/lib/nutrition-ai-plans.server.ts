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

function answerValue(a: any): string {
  if (a.value_text != null && String(a.value_text).trim()) return String(a.value_text);
  if (a.value_number != null) return String(a.value_number);
  const j = a.value_json;
  if (Array.isArray(j)) return j.map((x) => (typeof x === "string" ? x : x?.name ?? x?.label ?? "")).filter(Boolean).join(", ");
  if (j && typeof j === "object") return JSON.stringify(j);
  return j != null ? String(j) : "";
}

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
      prompt: targetsUserPrompt(basics, qas, selected, programContextText(program, { readout: false })),
    });
    const targetsText = cleanAiText(t.text);

    const m = await generateText({
      model: gateway(modelId),
      system: MEAL_PLAN_PROMPT,
      prompt: mealPlanUserPrompt(qas, targetsText, phase ?? phaseFromText(targetsText.match(/^Goal:\s*(.+)$/m)?.[1]), workoutMeals, history),
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

/**
 * A client just sent their Nutrition Update Request: write their AI targets
 * and meal plan here, on the server, so it never depends on their phone
 * staying open or loading anything (the coach is told the request is in
 * before this runs, and again when the plan is ready). Once per submission:
 * one already being written, or written, is left alone.
 */
export async function startNutritionPlan(sb: any, submissionId: string) {
  const { data: existing } = await sb.from("nutrition_ai_plans").select("status, updated_at").eq("submission_id", submissionId).maybeSingle();
  if (planBusy(existing)) return { status: "generating" as const };
  if (existing && existing.status !== "error" && existing.status !== "generating") return { status: existing.status };
  return runPlan(sb, submissionId, null, true);
}
