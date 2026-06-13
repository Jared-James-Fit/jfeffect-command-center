/**
 * Server functions for global + per-form AI configuration.
 * Admin can write. Coaches can read.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function requireAdmin(supabase: any, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Admin only");
}

// ---------- Global -----------------------------------------------------------

export const getGlobalAiConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    const sb = await admin();
    const { data } = await sb.from("global_ai_config").select("*").limit(1).maybeSingle();
    return data;
  });

const GlobalUpdateInput = z
  .object({
    brand_voice: z.string().max(4000).nullable(),
    tone: z.string().max(2000).nullable(),
    safety_rules: z.string().max(4000).nullable(),
    prohibited_phrases: z.array(z.string().max(200)).max(200),
    escalation_rules: z.string().max(4000).nullable(),
    default_analysis_structure: z.string().max(2000).nullable(),
    default_response_structure: z.string().max(2000).nullable(),
    default_model: z.string().max(120),
  })
  .partial();

export const updateGlobalAiConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GlobalUpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const sb = await admin();
    const { data: existing } = await sb.from("global_ai_config").select("id, version").limit(1).maybeSingle();
    if (!existing) {
      const { error } = await sb.from("global_ai_config").insert({ ...data, singleton: true, updated_by: context.userId });
      if (error) throw error;
      return { ok: true };
    }
    const { error } = await sb
      .from("global_ai_config")
      .update({ ...data, updated_by: context.userId, version: (existing.version ?? 1) + 1 })
      .eq("id", existing.id);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Per form ---------------------------------------------------------

const FormConfigGetInput = z.object({ formId: z.string().uuid() });

export const getFormAiConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FormConfigGetInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const sb = await admin();
    const { data: row } = await sb
      .from("form_ai_configs")
      .select("*")
      .eq("form_id", data.formId)
      .maybeSingle();
    return row;
  });

const FormConfigUpdateInput = z.object({
  formId: z.string().uuid(),
  enabled: z.boolean().optional(),
  instructions: z.string().max(8000).nullable().optional(),
  response_tone: z.string().max(500).nullable().optional(),
  response_length: z.enum(["short", "medium", "long"]).optional(),
  internal_analysis_structure: z.string().max(2000).nullable().optional(),
  client_response_structure: z.string().max(2000).nullable().optional(),
  escalation_rules: z.string().max(2000).nullable().optional(),
  priority_rules: z.string().max(2000).nullable().optional(),
  allow_recommend_programming: z.boolean().optional(),
  allow_recommend_nutrition: z.boolean().optional(),
  require_coach_approval: z.boolean().optional(),
  review_sla_hours: z.number().int().min(1).max(720).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  allowed_client_context: z.array(z.string().max(120)).max(50).optional(),
});

export const upsertFormAiConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FormConfigUpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const sb = await admin();
    const { formId, ...rest } = data;
    const { data: existing } = await sb
      .from("form_ai_configs")
      .select("id, version")
      .eq("form_id", formId)
      .maybeSingle();
    if (!existing) {
      const { error } = await sb
        .from("form_ai_configs")
        .insert({ form_id: formId, ...rest, updated_by: context.userId });
      if (error) throw error;
    } else {
      const { error } = await sb
        .from("form_ai_configs")
        .update({ ...rest, updated_by: context.userId, version: (existing.version ?? 1) + 1 })
        .eq("id", existing.id);
      if (error) throw error;
    }
    return { ok: true };
  });

// ---------- Playground ------------------------------------------------------

const PlaygroundInput = z.object({
  formId: z.string().uuid().nullable(),
  submissionInstruction: z.string().max(2000).nullable().optional(),
  sampleAnswers: z.string().max(8000),
});

/**
 * Run a dry-run AI generation for an admin in the AI Settings playground.
 * NEVER writes a review, message, generation row, or audit event.
 */
export const runAiPlayground = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PlaygroundInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const sb = await admin();
    const { data: globalCfg } = await sb.from("global_ai_config").select("*").limit(1).maybeSingle();
    const { data: formCfg } = data.formId
      ? await sb.from("form_ai_configs").select("*").eq("form_id", data.formId).maybeSingle()
      : { data: null };

    const systemPrompt = [
      "You are an AI assistant helping a strength & conditioning coach review a client submission.",
      "Reply ONLY in the structured JSON schema requested. Never fabricate medical advice.",
      globalCfg?.brand_voice && `BRAND VOICE: ${globalCfg.brand_voice}`,
      globalCfg?.tone && `TONE: ${globalCfg.tone}`,
      globalCfg?.safety_rules && `SAFETY RULES: ${globalCfg.safety_rules}`,
      formCfg?.instructions && `FORM INSTRUCTIONS: ${formCfg.instructions}`,
      data.submissionInstruction &&
        `ADHOC INSTRUCTION FOR THIS TEST: ${data.submissionInstruction}`,
      "THIS IS A TEST RUN. Output is for previewing instructions only.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const { createLovableAiGateway, DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
    const { generateText } = await import("ai");
    const gateway = createLovableAiGateway();
    const modelId = formCfg?.model || globalCfg?.default_model || DEFAULT_AI_MODEL;

    const jsonInstruction = [
      "",
      "Reply with a single JSON object ONLY (no markdown, no commentary) matching:",
      '{ "summary": string, "wins": string[], "concerns": string[], "risks": string[],',
      '  "recommendations": string[], "follow_up_questions": string[],',
      '  "suggested_actions": string[],',
      '  "urgency": "low"|"normal"|"high"|"urgent",',
      '  "client_response": string }',
    ].join("\n");

    const result = await generateText({
      model: gateway(modelId),
      system: systemPrompt + jsonInstruction,
      prompt:
        "Sample submission to analyse:\n\n" + data.sampleAnswers + "\n\nProduce the structured analysis and a client-facing response.",
    });
    const stripped = (result.text ?? "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let out: any = null;
    try { out = JSON.parse(stripped); }
    catch {
      const m = stripped.match(/\{[\s\S]*\}/);
      if (m) { try { out = JSON.parse(m[0]); } catch {} }
    }
    return {
      ok: true,
      model: modelId,
      systemPrompt,
      output: out,
    };
  });