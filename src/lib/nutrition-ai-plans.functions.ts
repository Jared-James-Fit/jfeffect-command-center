/**
 * Native Nutrition Update Request: send it, run the AI on submit, read the
 * results.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { NUTRITION_REQUEST_FORM_ID, REVISE_MAX_CHARS, type WorkoutMealsMode } from "@/lib/nutrition-ai-prompts";
import { NUTRITION_PHASES } from "@/lib/nutrition-cardio";

/** The AI and the answers (server only: loaded inside the handlers). */
const aiPlans = () => import("@/lib/nutrition-ai-plans.server");

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
    const { planBusy, planQueued, queueNutritionPlan } = await aiPlans();
    if (planBusy(existing)) return { status: "generating" as const };
    if (planQueued(existing) && !(staff && data.force)) return { status: "pending" as const };
    if (existing?.status === "ready" && !(staff && data.force)) return { status: "ready" as const };
    if (!staff && existing && existing.status !== "error") return { status: existing.status };

    // Written in the background (nutrition-plans-tick), never inside this
    // request: leaving the screen would cut the AI off mid-plan.
    return queueNutritionPlan(sb, data.submissionId, {
      phase: staff ? data.phase ?? null : null,
      workoutMeals: staff ? data.workoutMeals ?? null : null,
      // Regenerate replaces the plan, and any coach update waiting on it.
      fresh: staff && !!data.force,
    });
  });

/**
 * Coach: change a written plan by telling the AI what to change ("swap the
 * beef for salmon on rest days", "4 meals instead of 5"). Queued for the
 * background writer like a whole plan; Undo puts back the plan before it.
 */
export const reviseNutritionPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      submissionId: z.string().uuid(),
      instructions: z.string().trim().min(3, "Say what to change").max(REVISE_MAX_CHARS),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    return (await aiPlans()).queueNutritionRevision(await admin(), data.submissionId, data.instructions);
  });

export const undoNutritionRevisionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ submissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    return (await aiPlans()).undoNutritionRevision(await admin(), data.submissionId);
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
    const { loadClientBasics, loadQAs, loadTrainingPattern, loadCardioRows } = await aiPlans();
    const { loadProgramContext } = await import("@/lib/program-context.server");
    const { programContextText } = await import("@/lib/program-context");
    const { currentCardioText } = await import("@/lib/nutrition-cardio-sync");
    const [client, program, cardioRows] = await Promise.all([
      loadClientBasics(sb, data.clientId),
      loadProgramContext(sb, data.clientId).catch(() => null),
      loadCardioRows(sb, data.clientId).catch(() => []),
    ]);
    const { data: assignment } = await sb
      .from("nf_assignments")
      .select("created_at, updated_at, settings")
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
      // the latest time it was sent (sending it again updates the assignment)
      requestedAt: assignment?.updated_at ?? assignment?.created_at ?? null,
      requestedPhase: ((assignment?.settings as any)?.phase as string | null) ?? null,
      requestedWorkoutMeals: ((assignment?.settings as any)?.workout_meals as WorkoutMealsMode | null) ?? null,
      clientName: client.name,
      client,
      trainingPattern: await loadTrainingPattern(sb, data.clientId).catch(() => null),
      // The same context the AI gets, for the coach's copy-paste prompts.
      programText: programContextText(program, { readout: false }) || null,
      cardioText: currentCardioText(cardioRows) || null,
    };
  });

/** Coach view: when this client actually trains, from their logged workouts. */
export const getClientTrainingPatternFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    return (await aiPlans()).loadTrainingPattern(await admin(), data.clientId);
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
