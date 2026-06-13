/**
 * Server functions for the AI Coaching Review layer.
 *
 * - Intake: normalize submissions from nf_submissions / fillout_submissions /
 *   coaching_applications into one `submission_reviews` row (idempotent via
 *   unique (source_type, source_id)).
 * - List + detail.
 * - AI generation against Lovable AI Gateway (real, not mocked) with
 *   structured-output validation via Zod.
 * - Save Draft / Approve / Send Now / Schedule / Cancel Schedule.
 * - Every state change writes a `submission_audit_events` row.
 *
 * All write operations use the privileged Supabase admin client (loaded
 * lazily inside handlers) to enforce idempotency and to keep RLS off the
 * audit/generation tables — caller authorization is checked explicitly
 * via `requireSupabaseAuth` + `has_role`/`is_assigned_coach`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Input validators -------------------------------------------------

const ListInput = z.object({
  status: z.string().optional(),
  source: z.enum(["native", "fillout", "application"]).optional(),
  clientId: z.string().uuid().optional(),
  formId: z.string().uuid().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).partial();

const GetInput = z.object({ id: z.string().uuid() });

const GenerateInput = z.object({
  reviewId: z.string().uuid(),
  submissionInstruction: z.string().trim().max(2000).optional(),
});

const SaveDraftInput = z.object({
  reviewId: z.string().uuid(),
  coachDraft: z.string().max(20000),
});

const SendNowInput = z.object({
  reviewId: z.string().uuid(),
  body: z.string().trim().min(1, "Response cannot be empty").max(20000),
  idempotencyKey: z.string().min(8).max(120),
});

const ScheduleInput = z.object({
  reviewId: z.string().uuid(),
  scheduledAt: z.string().datetime({ offset: true }),
  body: z.string().trim().min(1).max(20000),
  idempotencyKey: z.string().min(8).max(120),
});

const ArchiveInput = z.object({ reviewId: z.string().uuid() });

const PriorityInput = z.object({
  reviewId: z.string().uuid(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
});

// ---------- Helpers ----------------------------------------------------------

/**
 * Pulls the privileged admin client. Server-only — never imported at module
 * scope of a `*.functions.ts` file (route + functions modules ship to the
 * client bundle; only handler bodies are stripped).
 */
async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Cast to any so we can pass Record<string, unknown> patches and so JSON
  // columns accept generic objects without per-call generics.
  return supabaseAdmin as any;
}

async function assertCoachOrAdmin(supabase: any, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (isAdmin) return { isAdmin: true as const };
  const { data: isCoach } = await supabase.rpc("is_coach_or_admin", {
    _user_id: userId,
  });
  if (!isCoach) {
    throw new Error("Forbidden");
  }
  return { isAdmin: false as const };
}

async function assertCanTouchReview(
  supabase: any,
  userId: string,
  reviewId: string,
): Promise<{ row: any; isAdmin: boolean }> {
  const sb = await admin();
  const { data: row, error } = await sb
    .from("submission_reviews")
    .select("*")
    .eq("id", reviewId)
    .maybeSingle();
  if (error || !row) throw new Error("Review not found");
  const { isAdmin } = await assertCoachOrAdmin(supabase, userId);
  if (isAdmin) return { row, isAdmin: true };
  if (!row.client_id) throw new Error("Forbidden");
  const { data: isAssigned } = await supabase.rpc("is_assigned_coach", {
    _client_id: row.client_id,
  });
  if (!isAssigned) throw new Error("Forbidden");
  return { row, isAdmin: false };
}

async function audit(
  reviewId: string,
  eventType: string,
  actorUserId: string,
  actorRole: string,
  details: Record<string, unknown> = {},
) {
  const sb = await admin();
  await sb.from("submission_audit_events").insert({
    review_id: reviewId,
    event_type: eventType,
    actor_user_id: actorUserId,
    actor_role: actorRole,
    details,
  });
}

/**
 * Idempotent intake: ensure a `submission_reviews` row exists for a given
 * source (native / fillout / application). Returns the row.
 */
async function upsertReview(input: {
  sourceType: "native" | "fillout" | "application";
  sourceId: string;
  formId: string | null;
  clientId: string | null;
  applicationId: string | null;
  submittedAt: string;
}) {
  const sb = await admin();
  const { data: existing } = await sb
    .from("submission_reviews")
    .select("*")
    .eq("source_type", input.sourceType)
    .eq("source_id", input.sourceId)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await sb
    .from("submission_reviews")
    .insert({
      source_type: input.sourceType,
      source_id: input.sourceId,
      form_id: input.formId,
      client_id: input.clientId,
      application_id: input.applicationId,
      submitted_at: input.submittedAt,
      review_status: "submitted",
      ai_status: "pending",
    })
    .select("*")
    .single();
  if (error) throw error;
  await audit(data.id, "submission_received", "00000000-0000-0000-0000-000000000000", "system", {
    source_type: input.sourceType,
    source_id: input.sourceId,
  });
  return data;
}

// ---------- Intake / sync ----------------------------------------------------

/**
 * Sync any submissions that don't yet have a `submission_reviews` row.
 * Runs lazily when the Reviews tab loads so we don't need a separate worker
 * for backfill.
 *
 * Bounded to recent rows to keep the call fast; older history can be opened
 * via the source-specific routes which fall back to this intake.
 */
export const syncSubmissionReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCoachOrAdmin(context.supabase, context.userId);
    const sb = await admin();

    // Native submissions that are submitted/reviewed (not in_progress)
    const { data: nativeSubs } = await sb
      .from("nf_submissions")
      .select("id, form_id, client_id, submitted_at, started_at, status")
      .in("status", ["submitted", "reviewed"])
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(500);
    for (const s of nativeSubs ?? []) {
      await upsertReview({
        sourceType: "native",
        sourceId: s.id,
        formId: s.form_id,
        clientId: s.client_id,
        applicationId: null,
        submittedAt: s.submitted_at ?? s.started_at,
      });
    }

    // Fillout submissions (matched only — unmatched stay in the Fillout tab)
    const { data: fillout } = await sb
      .from("fillout_submissions")
      .select("id, form_id, client_id, submitted_at, created_at, unmatched")
      .eq("unmatched", false)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(500);
    for (const s of fillout ?? []) {
      await upsertReview({
        sourceType: "fillout",
        sourceId: s.id,
        formId: s.form_id,
        clientId: s.client_id,
        applicationId: null,
        submittedAt: s.submitted_at ?? s.created_at,
      });
    }

    // Coaching applications (always intake — Sales also views these)
    const { data: apps } = await sb
      .from("coaching_applications")
      .select("id, client_id, submitted_at, created_at")
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(500);
    for (const s of apps ?? []) {
      await upsertReview({
        sourceType: "application",
        sourceId: s.id,
        formId: null,
        clientId: s.client_id ?? null,
        applicationId: s.id,
        submittedAt: s.submitted_at ?? s.created_at,
      });
    }

    return { ok: true };
  });

// ---------- List -------------------------------------------------------------

export const listSubmissionReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertCoachOrAdmin(context.supabase, context.userId);
    const sb = await admin();

    let q = sb
      .from("submission_reviews")
      .select(
        "id, source_type, source_id, form_id, client_id, application_id, assigned_coach_user_id, priority, review_status, ai_status, latest_generation_id, latest_message_id, coach_draft, submitted_at, scheduled_at, sent_at, updated_at, " +
          "client:clients ( id, full_name, profile_picture_url, status, archived ), " +
          "form:nf_forms ( id, title, form_type )",
      )
      .order("submitted_at", { ascending: false })
      .limit(data.limit ?? 100);

    if (data.status) q = q.eq("review_status", data.status);
    if (data.source) q = q.eq("source_type", data.source);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    if (data.formId) q = q.eq("form_id", data.formId);

    const { data: rows, error } = await q;
    if (error) throw error;

    // Coach RLS-equivalent filter (the admin client bypasses RLS, so we
    // re-enforce here in code).
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (isAdmin) return rows;
    const filtered: any[] = [];
    for (const r of rows ?? []) {
      if (!r.client_id) continue;
      const { data: ok } = await context.supabase.rpc("is_assigned_coach", {
        _client_id: r.client_id,
      });
      if (ok) filtered.push(r);
    }
    return filtered;
  });

// ---------- Detail -----------------------------------------------------------

export const getSubmissionReviewDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GetInput.parse(d))
  .handler(async ({ data, context }) => {
    const { row } = await assertCanTouchReview(context.supabase, context.userId, data.id);
    const sb = await admin();

    // Source-specific submission payload + questions/answers
    let submission: any = null;
    let questions: any[] = [];
    let answers: any[] = [];
    let files: any[] = [];
    let form: any = null;
    let application: any = null;

    if (row.source_type === "native") {
      const { data: s } = await sb
        .from("nf_submissions")
        .select("*")
        .eq("id", row.source_id)
        .maybeSingle();
      submission = s;
      if (row.form_id) {
        const { data: f } = await sb.from("nf_forms").select("*").eq("id", row.form_id).maybeSingle();
        form = f;
        const { data: qs } = await sb
          .from("nf_questions")
          .select("*")
          .eq("form_id", row.form_id)
          .order("order_index", { ascending: true });
        questions = qs ?? [];
      }
      const { data: ans } = await sb
        .from("nf_answers")
        .select("*")
        .eq("submission_id", row.source_id);
      answers = ans ?? [];
      const { data: fs } = await sb
        .from("nf_files")
        .select("*")
        .eq("submission_id", row.source_id);
      files = fs ?? [];
    } else if (row.source_type === "fillout") {
      const { data: s } = await sb
        .from("fillout_submissions")
        .select("*")
        .eq("id", row.source_id)
        .maybeSingle();
      submission = s;
      if (row.form_id) {
        const { data: f } = await sb.from("nf_forms").select("*").eq("id", row.form_id).maybeSingle();
        form = f;
      }
    } else if (row.source_type === "application") {
      const { data: s } = await sb
        .from("coaching_applications")
        .select("*")
        .eq("id", row.source_id)
        .maybeSingle();
      submission = s;
      application = s;
    }

    const client = row.client_id
      ? (
          await sb
            .from("clients")
            .select("id, full_name, email, status, archived, profile_picture_url, goal, current_program, last_active_at")
            .eq("id", row.client_id)
            .maybeSingle()
        ).data
      : null;

    const { data: generations } = await sb
      .from("submission_ai_generations")
      .select("*")
      .eq("review_id", row.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: audits } = await sb
      .from("submission_audit_events")
      .select("*")
      .eq("review_id", row.id)
      .order("created_at", { ascending: false })
      .limit(50);

    const { data: attempts } = await sb
      .from("submission_delivery_attempts")
      .select("*")
      .eq("review_id", row.id)
      .order("attempted_at", { ascending: false })
      .limit(20);

    return {
      review: row,
      submission,
      questions,
      answers,
      files,
      form,
      client,
      application,
      generations: generations ?? [],
      audits: audits ?? [],
      attempts: attempts ?? [],
    };
  });

// ---------- AI generation ----------------------------------------------------

// Structured-output Zod schema — kept small to avoid Gemini's state limits
// when compiled into a constrained-decoding state machine.
const AiOutputSchema = z.object({
  summary: z.string(),
  wins: z.array(z.string()),
  concerns: z.array(z.string()),
  risks: z.array(z.string()),
  recommendations: z.array(z.string()),
  follow_up_questions: z.array(z.string()),
  suggested_actions: z.array(z.string()),
  urgency: z.enum(["low", "normal", "high", "urgent"]),
  client_response: z.string(),
});

function flattenAnswers(answers: any[], questions: any[]): string {
  if (!answers.length) return "(no answers recorded)";
  const qById = new Map(questions.map((q) => [q.id, q]));
  return answers
    .map((a) => {
      const q = qById.get(a.question_id);
      const label = q?.label || q?.id || a.question_id || "Question";
      const val = a.value_text ?? a.value_json ?? a.value_number ?? a.value_boolean ?? "";
      const display = typeof val === "object" ? JSON.stringify(val) : String(val);
      return `Q: ${label}\nA: ${display}`;
    })
    .join("\n\n");
}

function flattenFilloutPayload(submission: any): string {
  if (!submission) return "(no payload)";
  const qs = submission.response_json?.questions ?? submission.raw_payload?.submission?.questions ?? [];
  if (Array.isArray(qs) && qs.length) {
    return qs
      .map((q: any) => `Q: ${q.name || q.title || q.id}\nA: ${q.value ?? "(empty)"}`)
      .join("\n\n");
  }
  return JSON.stringify(submission.response_json ?? submission.raw_payload ?? {}, null, 2).slice(0, 6000);
}

function flattenApplication(app: any): string {
  if (!app) return "(no application)";
  const fields = [
    "full_name", "email", "phone", "instagram", "location_timezone",
    "main_goal", "target_outcome", "win_90_days", "timeline", "why_now",
    "training_history", "tried_before", "biggest_struggle",
    "days_per_week", "gym_access", "schedule", "current_weight",
    "injuries", "can_follow_plan", "budget_range", "monthly_investment",
    "ready_to_invest", "seriousness", "lead_score", "lead_temperature",
    "recommended_offer", "source", "summary",
  ];
  return fields
    .filter((k) => app[k] != null && app[k] !== "")
    .map((k) => `${k}: ${typeof app[k] === "object" ? JSON.stringify(app[k]) : app[k]}`)
    .join("\n");
}

export const generateSubmissionDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GenerateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { row } = await assertCanTouchReview(context.supabase, context.userId, data.reviewId);
    const sb = await admin();

    // 1. Mark review as processing
    await sb
      .from("submission_reviews")
      .update({ ai_status: "processing", review_status: "processing" })
      .eq("id", row.id);

    // 2. Load configs
    const { data: globalCfg } = await sb
      .from("global_ai_config")
      .select("*")
      .limit(1)
      .maybeSingle();
    const { data: formCfg } = row.form_id
      ? await sb.from("form_ai_configs").select("*").eq("form_id", row.form_id).maybeSingle()
      : { data: null };

    // 3. Build context
    let detailText = "";
    let formTitle = "Submission";
    if (row.source_type === "native") {
      const { data: ans } = await sb.from("nf_answers").select("*").eq("submission_id", row.source_id);
      const { data: qs } = row.form_id
        ? await sb
            .from("nf_questions")
            .select("*")
            .eq("form_id", row.form_id)
            .order("order_index", { ascending: true })
        : { data: [] };
      const { data: f } = row.form_id
        ? await sb.from("nf_forms").select("title").eq("id", row.form_id).maybeSingle()
        : { data: null };
      formTitle = f?.title ?? "Native form";
      detailText = flattenAnswers(ans ?? [], qs ?? []);
    } else if (row.source_type === "fillout") {
      const { data: s } = await sb
        .from("fillout_submissions")
        .select("*")
        .eq("id", row.source_id)
        .maybeSingle();
      formTitle = s?.form_name ?? "Fillout submission";
      detailText = flattenFilloutPayload(s);
    } else {
      const { data: app } = await sb
        .from("coaching_applications")
        .select("*")
        .eq("id", row.source_id)
        .maybeSingle();
      formTitle = "Coaching application";
      detailText = flattenApplication(app);
    }

    const client = row.client_id
      ? (
          await sb
            .from("clients")
            .select("full_name, goal, current_program, training_history")
            .eq("id", row.client_id)
            .maybeSingle()
        ).data
      : null;

    // 4. Build prompt
    const allowed = formCfg?.allowed_client_context ?? [];
    const safeClient = client
      ? Object.fromEntries(
          Object.entries(client).filter(([k]) => allowed.length === 0 || allowed.includes(k)),
        )
      : null;

    const systemPrompt = [
      "You are an AI assistant helping a strength & conditioning coach review a client submission.",
      "Reply ONLY in the structured JSON schema requested. Never fabricate medical advice.",
      globalCfg?.brand_voice && `BRAND VOICE: ${globalCfg.brand_voice}`,
      globalCfg?.tone && `TONE: ${globalCfg.tone}`,
      globalCfg?.safety_rules && `SAFETY RULES: ${globalCfg.safety_rules}`,
      globalCfg?.escalation_rules && `ESCALATION: ${globalCfg.escalation_rules}`,
      formCfg?.instructions && `FORM-SPECIFIC INSTRUCTIONS: ${formCfg.instructions}`,
      formCfg?.response_tone && `RESPONSE TONE: ${formCfg.response_tone}`,
      formCfg?.response_length && `RESPONSE LENGTH: ${formCfg.response_length}`,
      formCfg?.allow_recommend_programming === false &&
        "Do NOT recommend specific programming changes. Suggestions only.",
      formCfg?.allow_recommend_nutrition === false &&
        "Do NOT recommend specific nutrition changes. Suggestions only.",
      data.submissionInstruction &&
        `COACH'S INSTRUCTION FOR THIS GENERATION ONLY: ${data.submissionInstruction}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const userPrompt = [
      `Form: ${formTitle}`,
      safeClient ? `Client context: ${JSON.stringify(safeClient)}` : "",
      "",
      "Submission:",
      detailText.slice(0, 8000),
      "",
      "Generate the structured analysis and a client-facing response.",
      "The client_response is what the coach will edit and send — write it directly to the client.",
    ]
      .filter(Boolean)
      .join("\n");

    // 5. Create generation row (running)
    const { data: gen, error: genErr } = await sb
      .from("submission_ai_generations")
      .insert({
        review_id: row.id,
        status: "running",
        model: formCfg?.model || globalCfg?.default_model || "google/gemini-3-flash-preview",
        global_config_version: globalCfg?.version ?? null,
        form_config_version: formCfg?.version ?? null,
        submission_instruction: data.submissionInstruction ?? null,
        input_context: {
          form_title: formTitle,
          client: safeClient,
          detail: detailText.slice(0, 8000),
        },
        started_at: new Date().toISOString(),
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (genErr || !gen) throw genErr ?? new Error("Could not create generation row");

    await audit(row.id, "ai_generation_started", context.userId, "coach", { generation_id: gen.id });

    // 6. Call AI
    try {
      const { createLovableAiGateway, DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
      const { generateText, Output } = await import("ai");
      const gateway = createLovableAiGateway();
      const modelId = gen.model || DEFAULT_AI_MODEL;

      const result = await generateText({
        model: gateway(modelId),
        system: systemPrompt,
        prompt: userPrompt,
        experimental_output: Output.object({ schema: AiOutputSchema }),
      });

      const parsed = (result as any).experimental_output ?? null;
      if (!parsed) {
        throw new Error("AI returned no structured output");
      }
      // Re-validate to be safe (constrained decoding may still drift)
      const safe = AiOutputSchema.parse(parsed);

      const updated = await sb
        .from("submission_ai_generations")
        .update({
          status: "succeeded",
          completed_at: new Date().toISOString(),
          structured_output: safe,
          client_response: safe.client_response,
          urgency: safe.urgency,
          usage: (result as any).usage ?? null,
        })
        .eq("id", gen.id)
        .select("*")
        .single();

      // Mark review draft_ready. Do NOT overwrite a coach edit if one exists.
      const patch: Record<string, unknown> = {
        ai_status: "ready",
        latest_generation_id: gen.id,
      };
      // Only auto-seed coach_draft when there isn't already one
      if (!row.coach_draft) patch.coach_draft = safe.client_response;
      if (row.review_status === "processing" || row.review_status === "submitted") {
        patch.review_status = "draft_ready";
      }
      if (safe.urgency === "high" || safe.urgency === "urgent") {
        patch.priority = safe.urgency;
      }
      await sb.from("submission_reviews").update(patch).eq("id", row.id);

      await audit(row.id, "ai_generation_completed", context.userId, "coach", {
        generation_id: gen.id,
        urgency: safe.urgency,
      });

      return { ok: true, generation: updated.data };
    } catch (err: any) {
      const message =
        err?.responseBody || err?.message || "AI generation failed (unknown error)";
      await sb
        .from("submission_ai_generations")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error: String(message).slice(0, 4000),
        })
        .eq("id", gen.id);
      await sb
        .from("submission_reviews")
        .update({ ai_status: "failed", review_status: "needs_review" })
        .eq("id", row.id);
      await audit(row.id, "ai_generation_failed", context.userId, "coach", {
        generation_id: gen.id,
        error: String(message).slice(0, 500),
      });
      throw new Error(`AI generation failed: ${String(message).slice(0, 200)}`);
    }
  });

// ---------- Coach edit / approval -------------------------------------------

export const saveCoachDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveDraftInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertCanTouchReview(context.supabase, context.userId, data.reviewId);
    const sb = await admin();
    await sb
      .from("submission_reviews")
      .update({
        coach_draft: data.coachDraft,
        review_status: "coach_editing",
      })
      .eq("id", data.reviewId);
    await audit(data.reviewId, "coach_draft_saved", context.userId, "coach", {
      length: data.coachDraft.length,
    });
    return { ok: true };
  });

export const setReviewPriority = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PriorityInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertCanTouchReview(context.supabase, context.userId, data.reviewId);
    const sb = await admin();
    await sb
      .from("submission_reviews")
      .update({ priority: data.priority })
      .eq("id", data.reviewId);
    await audit(data.reviewId, "priority_changed", context.userId, "coach", { priority: data.priority });
    return { ok: true };
  });

export const archiveReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ArchiveInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertCanTouchReview(context.supabase, context.userId, data.reviewId);
    const sb = await admin();
    await sb.from("submission_reviews").update({ review_status: "archived" }).eq("id", data.reviewId);
    await audit(data.reviewId, "review_archived", context.userId, "coach");
    return { ok: true };
  });

// ---------- Send Now (idempotent) --------------------------------------------

export const approveAndSendNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SendNowInput.parse(d))
  .handler(async ({ data, context }) => {
    const { row } = await assertCanTouchReview(context.supabase, context.userId, data.reviewId);
    if (!row.client_id) {
      throw new Error("This submission isn't linked to a client. Map it first.");
    }
    const sb = await admin();

    // Idempotency: if this idempotency key already produced a successful
    // delivery for this review, return that message without sending again.
    if (row.send_idempotency_key === data.idempotencyKey && row.latest_message_id) {
      return { ok: true, messageId: row.latest_message_id, deduped: true };
    }

    // Optimistically mark sending
    await sb
      .from("submission_reviews")
      .update({ review_status: "sending", send_idempotency_key: data.idempotencyKey })
      .eq("id", row.id);

    try {
      const { data: msg, error: msgErr } = await sb
        .from("messages")
        .insert({
          client_id: row.client_id,
          sender_id: context.userId,
          sender_role: "admin",
          body: data.body,
          attachments: [],
          message_type: row.source_type === "application" ? "General" : "Check-In",
          is_internal_note: false,
          read_by_admin_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (msgErr || !msg) throw msgErr ?? new Error("Message insert failed");

      await sb
        .from("submission_reviews")
        .update({
          review_status: "sent",
          approved_response: data.body,
          delivered_response: data.body,
          latest_message_id: msg.id,
          approved_at: new Date().toISOString(),
          approved_by: context.userId,
          sent_at: new Date().toISOString(),
          sent_by: context.userId,
          last_delivery_error: null,
        })
        .eq("id", row.id);

      await sb.from("submission_delivery_attempts").insert({
        review_id: row.id,
        outcome: "success",
        message_id: msg.id,
        initiated_by: context.userId,
        delivery_channel: "in_app_message",
      });
      await audit(row.id, "response_sent", context.userId, "coach", { message_id: msg.id });

      // Backwards compat: mirror into nf_reviews when source is native, so
      // the legacy check-in-reviews UI also reflects the send.
      if (row.source_type === "native") {
        await sb.from("nf_reviews").insert({
          submission_id: row.source_id,
          reviewer_user_id: context.userId,
          reply_text: data.body,
          message_id: msg.id,
          sent_to_messenger_at: new Date().toISOString(),
        });
        await sb
          .from("nf_submissions")
          .update({ status: "reviewed", reviewed_at: new Date().toISOString(), reviewed_by: context.userId })
          .eq("id", row.source_id);
      }

      return { ok: true, messageId: msg.id, deduped: false };
    } catch (err: any) {
      await sb
        .from("submission_reviews")
        .update({
          review_status: "delivery_failed",
          last_delivery_error: String(err?.message ?? err).slice(0, 1000),
        })
        .eq("id", row.id);
      await sb.from("submission_delivery_attempts").insert({
        review_id: row.id,
        outcome: "failed",
        error: String(err?.message ?? err).slice(0, 1000),
        initiated_by: context.userId,
      });
      await audit(row.id, "delivery_failed", context.userId, "coach", { error: String(err?.message ?? err).slice(0, 500) });
      throw err;
    }
  });

// ---------- Schedule ---------------------------------------------------------

export const scheduleSendResponse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ScheduleInput.parse(d))
  .handler(async ({ data, context }) => {
    const { row } = await assertCanTouchReview(context.supabase, context.userId, data.reviewId);
    if (!row.client_id) throw new Error("Submission has no client to send to");
    const sb = await admin();

    // Upsert the schedule row by idempotency key
    const { data: existing } = await sb
      .from("scheduled_submission_responses")
      .select("*")
      .eq("idempotency_key", data.idempotencyKey)
      .maybeSingle();
    if (existing) {
      return { ok: true, scheduleId: existing.id, deduped: true };
    }

    const { data: sched, error } = await sb
      .from("scheduled_submission_responses")
      .insert({
        review_id: row.id,
        scheduled_at: data.scheduledAt,
        status: "pending",
        idempotency_key: data.idempotencyKey,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error || !sched) throw error ?? new Error("Could not schedule");

    await sb
      .from("submission_reviews")
      .update({
        review_status: "scheduled",
        approved_response: data.body,
        coach_draft: data.body,
        approved_at: new Date().toISOString(),
        approved_by: context.userId,
        scheduled_at: data.scheduledAt,
        scheduled_by: context.userId,
        schedule_cancelled_at: null,
      })
      .eq("id", row.id);

    await audit(row.id, "response_scheduled", context.userId, "coach", {
      schedule_id: sched.id,
      scheduled_at: data.scheduledAt,
    });
    return { ok: true, scheduleId: sched.id, deduped: false };
  });

export const cancelScheduledSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ArchiveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { row } = await assertCanTouchReview(context.supabase, context.userId, data.reviewId);
    const sb = await admin();
    await sb
      .from("scheduled_submission_responses")
      .update({ status: "cancelled" })
      .eq("review_id", row.id)
      .eq("status", "pending");
    await sb
      .from("submission_reviews")
      .update({
        review_status: "approved",
        scheduled_at: null,
        schedule_cancelled_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    await audit(row.id, "schedule_cancelled", context.userId, "coach");
    return { ok: true };
  });