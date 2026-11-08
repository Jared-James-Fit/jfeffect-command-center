/**
 * Edit with AI server functions (admins, and a client's own coaches for that
 * client; library templates: admins). Asking writes a turn with the coach's
 * own session (RLS checks who may ask); the background worker answers it.
 * Apply / Undo go through the database functions with the coach's session,
 * which check access again. Rules are read and written with the coach's
 * session (RLS).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RULE_KINDS } from "./ops";

const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("client"), clientId: z.string().uuid(), focusBlockId: z.string().uuid().nullish() }),
  z.object({ kind: z.literal("template"), templateId: z.string().uuid(), personalizeClientId: z.string().uuid().nullish() }),
]);
export type ProgramAiTarget = z.infer<typeof targetSchema>;

async function isAdmin(sb: any, userId: string): Promise<boolean> {
  const { data } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  return !!data;
}

async function assertCanEdit(sb: any, userId: string, target: ProgramAiTarget) {
  if (await isAdmin(sb, userId)) return;
  if (target.kind === "template") throw new Error("Only an admin can edit library templates.");
  const { data } = await sb.rpc("is_assigned_coach", { _client_id: target.clientId });
  if (!data) throw new Error("Only this client's coach (or an admin) can edit their program.");
}

export const askProgramAiFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        target: targetSchema,
        instruction: z.string().trim().min(1, "Tell the AI what to change or ask a question.").max(4000),
        threadId: z.string().uuid().nullish(),
        rejected: z.array(z.string().max(16)).max(80).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await assertCanEdit(sb, context.userId, data.target);
    let parentId: string | null = null;
    if (data.threadId) {
      const { data: last } = await sb
        .from("program_ai_edits")
        .select("id, status, client_id, template_id, updated_at")
        .eq("thread_id", data.threadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!last) throw new Error("That conversation wasn't found.");
      const same = data.target.kind === "client" ? last.client_id === data.target.clientId : last.template_id === data.target.templateId;
      if (!same) throw new Error("That conversation is about another program.");
      if ((last.status === "pending" || last.status === "running") && Date.now() - Date.parse(last.updated_at) < 6 * 60_000) throw new Error("Still working on the last message. Give it a moment.");
      parentId = last.id;
    }
    const row: Record<string, unknown> = {
      thread_id: data.threadId ?? null,
      parent_id: parentId,
      target_kind: data.target.kind,
      client_id: data.target.kind === "client" ? data.target.clientId : null,
      template_id: data.target.kind === "template" ? data.target.templateId : null,
      personalize_client_id: data.target.kind === "template" ? data.target.personalizeClientId ?? null : null,
      focus_block_id: data.target.kind === "client" ? data.target.focusBlockId ?? null : null,
      instruction: data.instruction,
      rejected: data.rejected,
      created_by: context.userId,
      status: "pending",
    };
    const { data: edit, error } = await sb.from("program_ai_edits").insert(row).select("id, thread_id").single();
    if (error) throw new Error(error.message);
    return { editId: edit.id as string, threadId: edit.thread_id as string };
  });

const TURN_COLUMNS = "id, thread_id, instruction, status, stage, result, error, rejected, created_at, finished_at, applied_at, applied_changes, version_id, target_kind, client_id, template_id";

export const programAiThreadFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: turns, error } = await sb.from("program_ai_edits").select(TURN_COLUMNS).eq("thread_id", data.threadId).order("created_at");
    if (error) throw new Error(error.message);
    return { turns: (turns ?? []) as any[] };
  });

/** The latest conversation about this program, if it's recent and not finished (to pick up where the coach left off). */
export const latestProgramAiThreadFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ target: targetSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    let q = sb.from("program_ai_edits").select("thread_id, status, created_at").order("created_at", { ascending: false }).limit(1);
    q = data.target.kind === "client" ? q.eq("client_id", data.target.clientId) : q.eq("template_id", data.target.templateId);
    const { data: last } = await q.maybeSingle();
    if (!last || Date.now() - Date.parse(last.created_at) > 12 * 3_600_000 || ["applied", "discarded"].includes(last.status)) return { threadId: null as string | null };
    return { threadId: last.thread_id as string };
  });

export const applyProgramAiFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ editId: z.string().uuid(), changeIds: z.array(z.string().max(16)).min(1).max(80), newTemplateName: z.string().trim().max(200).nullish() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { applyEdit } = await import("./apply.server");
    return applyEdit({ supabase: context.supabase, userId: context.userId }, data.editId, data.changeIds, { newTemplateName: data.newTemplateName ?? null });
  });

export const discardProgramAiFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ editId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    // readable = allowed (RLS); then the status changes with the service key
    const { data: edit } = await sb.from("program_ai_edits").select("id, thread_id, status").eq("id", data.editId).maybeSingle();
    if (!edit) throw new Error("That proposal wasn't found.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any).from("program_ai_edits").update({ status: "discarded" }).eq("thread_id", edit.thread_id).in("status", ["ready", "pending", "error"]);
    return { ok: true };
  });

export const undoProgramAiFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ versionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: v, error } = await sb.from("pl_program_versions").select("id, kind").eq("id", data.versionId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!v) throw new Error("That change wasn't found in the history.");
    if (v.kind === "ai_edit") {
      const { undoVersion } = await import("./apply.server");
      return undoVersion({ supabase: sb, userId: context.userId }, data.versionId);
    }
    // Cleo's changes undo the way Cleo does
    const { restoreVersion } = await import("@/lib/cleo-history.server");
    const note = await restoreVersion({ supabase: sb, userId: context.userId }, data.versionId);
    return { note, redoVersionId: null, scheduleNote: null };
  });

export const programHistoryFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ target: targetSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    let q = sb.from("pl_program_versions").select("id, kind, summary, source, created_at, created_by, restored_at, restore_note, edit_id").order("created_at", { ascending: false }).limit(30);
    q = data.target.kind === "client" ? q.eq("client_id", data.target.clientId) : q.eq("template_id", data.target.templateId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { versions: (rows ?? []) as any[] };
  });

const ruleSchema = z.object({
  id: z.string().uuid().nullish(),
  clientId: z.string().uuid().nullish(),
  kind: z.enum(RULE_KINDS),
  rule: z.string().trim().min(3, "Write the rule.").max(500),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  active: z.boolean().default(true),
  source: z.enum(["coach", "ai_suggested"]).default("coach"),
});

export const listProgramRulesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid().nullish() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    let q = sb.from("program_rules").select("id, client_id, kind, rule, expires_on, active, source, created_at, updated_at").order("created_at");
    q = data.clientId ? q.or(`client_id.eq.${data.clientId},client_id.is.null`) : q.is("client_id", null);
    const { data: rules, error } = await q;
    if (error) throw new Error(error.message);
    let observations: any[] = [];
    if (data.clientId) {
      const { data: obs } = await sb
        .from("program_intel_observations")
        .select("id, statement, corrected_statement, status, category, created_at")
        .eq("client_id", data.clientId)
        .in("status", ["approved", "corrected"])
        .order("created_at", { ascending: false })
        .limit(20);
      observations = obs ?? [];
    }
    return { rules: (rules ?? []) as any[], observations };
  });

export const saveProgramRuleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ruleSchema.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    if (!data.clientId && !(await isAdmin(sb, context.userId))) throw new Error("Only an admin can set a rule for every athlete.");
    const row = {
      client_id: data.clientId ?? null,
      kind: data.kind,
      rule: data.rule,
      expires_on: data.kind === "temporary_restriction" ? data.expiresOn ?? null : null,
      active: data.active,
      source: data.source,
      updated_by: context.userId,
    };
    const q = data.id ? sb.from("program_rules").update(row).eq("id", data.id) : sb.from("program_rules").insert({ ...row, created_by: context.userId });
    const { data: saved, error } = await q.select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!saved) throw new Error("That rule couldn't be saved.");
    return { id: saved.id as string };
  });

export const deleteProgramRuleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: gone, error } = await (context.supabase as any).from("program_rules").delete().eq("id", data.id).select("id");
    if (error) throw new Error(error.message);
    if (!gone?.length) throw new Error("That rule couldn't be removed.");
    return { ok: true };
  });
