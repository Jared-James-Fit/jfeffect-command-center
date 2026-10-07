/**
 * Native Nutrition Update Request: send it, run the AI on submit, read the
 * results.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
import { NUTRITION_PHASES, phaseFromText } from "@/lib/nutrition-cardio";
import { calcAge, formatHeight, type HeightUnit } from "@/lib/basic-info";
import { sexLabel } from "@/lib/athlete-sex";

const phaseSchema = z.enum(NUTRITION_PHASES.filter((p) => p !== "Custom") as [string, ...string[]]);
const workoutMealsSchema = z.enum(["auto", "pre_post", "post_only", "pre_only", "none"]);

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function isStaff(supabase: any, userId: string) {
  const [{ data: a }, { data: c }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
  ]);
  return !!a || !!c;
}

function answerValue(a: any): string {
  if (a.value_text != null && String(a.value_text).trim()) return String(a.value_text);
  if (a.value_number != null) return String(a.value_number);
  const j = a.value_json;
  if (Array.isArray(j)) return j.map((x) => (typeof x === "string" ? x : x?.name ?? x?.label ?? "")).filter(Boolean).join(", ");
  if (j && typeof j === "object") return JSON.stringify(j);
  return j != null ? String(j) : "";
}

async function loadQAs(sb: any, submissionId: string): Promise<{ sub: any; qas: QA[] }> {
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
async function loadClientBasics(
  sb: Awaited<ReturnType<typeof admin>>,
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

async function runPlan(
  sb: any,
  submissionId: string,
  phaseOverride?: string | null,
  notifyStaff = false,
  workoutMealsOverride?: WorkoutMealsMode | null,
) {
  const { sub, qas } = await loadQAs(sb, submissionId);
  const [coach, basics] = await Promise.all([
    coachSettings(sb, sub.client_id),
    loadClientBasics(sb, sub.client_id),
  ]);
  const selected = phaseOverride ?? coach.phase;
  const workoutMeals = workoutMealsOverride ?? coach.workoutMeals ?? "auto";
  const goalAnswer = qas.find((q) => /^goal$/i.test(q.label.trim()))?.value ?? "";
  const phase = selected ?? phaseFromText(goalAnswer);
  const now = new Date().toISOString();
  await sb.from("nutrition_ai_plans").upsert(
    { submission_id: submissionId, client_id: sub.client_id, status: "generating", error: null, phase, workout_meals: workoutMeals, updated_at: now },
    { onConflict: "submission_id" },
  );
  try {
    const { createLovableAiGateway, DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
    const { generateText } = await import("ai");
    const gateway = createLovableAiGateway();
    const { data: g } = await sb.from("global_ai_config").select("default_model").limit(1).maybeSingle();
    const modelId = g?.default_model || DEFAULT_AI_MODEL;

    const t = await generateText({
      model: gateway(modelId),
      system: TARGETS_PROMPT,
      prompt: targetsUserPrompt(basics, qas, selected),
    });
    const targetsText = cleanAiText(t.text);

    const m = await generateText({
      model: gateway(modelId),
      system: MEAL_PLAN_PROMPT,
      prompt: mealPlanUserPrompt(qas, targetsText, phase ?? phaseFromText(targetsText.match(/^Goal:\s*(.+)$/m)?.[1]), workoutMeals),
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

/** Coach sends the native Nutrition Update Request to a client (assign + chat card). */
export const sendNutritionRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      clientId: z.string().uuid(),
      note: z.string().max(500).nullish(),
      phase: phaseSchema.nullish(),
      workoutMeals: workoutMealsSchema.nullish(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const sb = await admin();
    const formId = NUTRITION_REQUEST_FORM_ID;
    const { data: form } = await sb.from("nf_forms").select("id, title").eq("id", formId).maybeSingle();
    if (!form) throw new Error("Nutrition Update Request form is missing");

    await sb.from("nf_assignments").upsert(
      { form_id: formId, client_id: data.clientId, recurrence: "none", assigned_by: context.userId, settings: { phase: data.phase ?? null, workout_meals: data.workoutMeals ?? "auto" } },
      { onConflict: "form_id,client_id" },
    );

    const note = data.note?.trim();
    const body = note || "Time to update your nutrition 🍽️ Fill this out and I'll build your new targets and meal plan.";
    const { error } = await sb.from("messages").insert({
      client_id: data.clientId,
      sender_id: context.userId,
      sender_role: "admin",
      body,
      attachments: [{
        type: "link",
        kind: "form_request",
        url: `/portal/check-ins/${formId}`,
        form_id: formId,
        assignment_client_ids: [data.clientId],
        request_title: form.title,
        request_note: note || undefined,
      }],
      message_type: "Form",
      is_internal_note: false,
      delivery_status: "sent",
      sent_at: new Date().toISOString(),
      read_by_admin_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    await notifyAppEvent(sb, "nutrition_requested", {
      clientId: data.clientId,
      sourceId: `${formId}:${Date.now()}`,
      actorUserId: context.userId,
    });
    return { ok: true };
  });

/**
 * Run (or re-run) the AI for a submission. Clients may trigger it once for
 * their own fresh submission; staff can regenerate anytime.
 */
export const generateNutritionPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      submissionId: z.string().uuid(),
      force: z.boolean().optional(),
      phase: phaseSchema.nullish(),
      workoutMeals: workoutMealsSchema.nullish(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const staff = await isStaff(context.supabase, context.userId);
    const { data: sub } = await sb
      .from("nf_submissions")
      .select("id, form_id, status, client:client_id(user_id)")
      .eq("id", data.submissionId)
      .maybeSingle();
    if (!sub) throw new Error("Submission not found");
    if (sub.form_id !== NUTRITION_REQUEST_FORM_ID) throw new Error("Not a nutrition request");
    if (!staff && sub.client?.user_id !== context.userId) throw new Error("Not allowed");
    if (sub.status === "in_progress") throw new Error("Submit the form first");

    const { data: existing } = await sb
      .from("nutrition_ai_plans")
      .select("status, updated_at")
      .eq("submission_id", data.submissionId)
      .maybeSingle();
    const busy = existing?.status === "generating" && Date.now() - new Date(existing.updated_at).getTime() < 3 * 60_000;
    if (busy) return { status: "generating" as const };
    if (existing?.status === "ready" && !(staff && data.force)) return { status: "ready" as const };
    if (!staff && existing && existing.status !== "error") return { status: existing.status };

    return runPlan(sb, data.submissionId, staff ? data.phase ?? null : null, !staff, staff ? data.workoutMeals ?? null : null);
  });

/** Coach view: a client's nutrition requests with answers + AI output. */
export const listNutritionRequestsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const sb = await admin();
    const { data: subs } = await sb
      .from("nf_submissions")
      .select("id, status, submitted_at, created_at")
      .eq("form_id", NUTRITION_REQUEST_FORM_ID)
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(10);
    const ids = (subs ?? []).map((s: any) => s.id);
    const { data: plans } = ids.length
      ? await sb.from("nutrition_ai_plans").select("*").in("submission_id", ids)
      : { data: [] };
    const client = await loadClientBasics(sb, data.clientId);
    const { data: assignment } = await sb
      .from("nf_assignments")
      .select("created_at, settings")
      .eq("form_id", NUTRITION_REQUEST_FORM_ID)
      .eq("client_id", data.clientId)
      .maybeSingle();
    const out = [];
    for (const s of subs ?? []) {
      const plan = (plans ?? []).find((p: any) => p.submission_id === s.id) ?? null;
      const qas = s.status === "in_progress" ? [] : (await loadQAs(sb, s.id)).qas;
      out.push({ ...s, plan, answers: qas });
    }
    return {
      requests: out,
      requestedAt: assignment?.created_at ?? null,
      requestedPhase: ((assignment?.settings as any)?.phase as string | null) ?? null,
      requestedWorkoutMeals: ((assignment?.settings as any)?.workout_meals as WorkoutMealsMode | null) ?? null,
      clientName: client.name,
      client,
    };
  });

/** Mark a plan as applied to the client's targets (for the coach's history). */
export const markNutritionPlanAppliedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ submissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const sb = await admin();
    const now = new Date().toISOString();
    await sb.from("nutrition_ai_plans").update({ applied_at: now, applied_by: context.userId, updated_at: now }).eq("submission_id", data.submissionId);
    await sb.from("nf_submissions").update({ status: "reviewed", reviewed_at: now, reviewed_by: context.userId }).eq("id", data.submissionId);
    return { ok: true };
  });
