/**
 * Program Intelligence server functions (coach / admin of the client only).
 * Queuing an AI run, retrying one, and the two things a coach does with a
 * generated draft: assign it (dates, visible to the client, placed on their
 * training days) or discard it. Everything is written with the coach's own
 * session, so the database's rules apply too.
 */
import { cardioTargetsFromProposal, type CardioPlan } from "./cardio";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { setupSchema, strategySchema } from "./generator-schemas";
import { draftBlockDates } from "./next-program";
import { BRAINS } from "./types";

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("program") }),
  z.object({ kind: z.literal("blocks"), blockIds: z.array(z.string().uuid()).min(1).max(60) }),
  z.object({ kind: z.literal("dates"), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ kind: z.literal("history") }),
]);

const queueSchema = z
  .object({
    clientId: z.string().uuid(),
    kind: z.enum(["interpret", "strategy", "generate"]),
    scope: scopeSchema,
    brain: z.enum(BRAINS as [string, ...string[]]),
    instructions: z.string().trim().max(2000).nullish(),
    options: z
      .object({
        /** the setup the coach approved (Generate Next Program) */
        setup: setupSchema.optional(),
        /** which setup fields the coach changed from the recommendation */
        edited: z.array(z.string().max(40)).max(40).optional(),
        /** a strategy the coach approved (skips the strategy stage) */
        strategy: strategySchema.optional(),
        strategyJobId: z.string().uuid().optional(),
        /** the data fingerprint on the coach's screen (to flag records that changed since) */
        dataHash: z.string().max(40).optional(),
      })
      .default({}),
    privacySafe: z.boolean().default(false),
  })
  .refine((d) => d.kind === "interpret" || !!d.options.setup, { message: "A setup is required to generate" });

async function assertCoach(ctx: { supabase: unknown; userId: string }, clientId: string): Promise<"admin" | "coach"> {
  const db = ctx.supabase as any;
  const { data: admin } = await db.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (admin) return "admin";
  const { data: assigned } = await db.rpc("is_assigned_coach", { _client_id: clientId });
  if (!assigned) throw new Error("Only this client's coach (or an admin) can use Program Intelligence.");
  return "coach";
}

export const queueIntelJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => queueSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertCoach(context, data.clientId);
    // one run of a kind at a time per client
    const sb = context.supabase as any;
    const { data: busy } = await sb
      .from("program_intel_jobs")
      .select("id, status, updated_at")
      .eq("client_id", data.clientId)
      .eq("kind", data.kind)
      .in("status", ["pending", "running"])
      .gt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString())
      .limit(1);
    if (busy?.length) return { jobId: busy[0].id as string, alreadyRunning: true };
    const { data: job, error } = await sb
      .from("program_intel_jobs")
      .insert({
        client_id: data.clientId,
        kind: data.kind,
        scope: data.scope,
        brain: data.options.setup?.brain ?? data.brain,
        instructions: data.instructions ?? null,
        options: data.options ?? {},
        privacy_safe: data.privacySafe,
        strategy_job_id: data.options.strategyJobId ?? null,
        created_by: context.userId,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { jobId: job.id as string, alreadyRunning: false };
  });

export const retryIntelJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: job } = await sb.from("program_intel_jobs").select("id, client_id, status").eq("id", data.jobId).maybeSingle();
    if (!job) throw new Error("That run wasn't found.");
    await assertCoach(context, job.client_id);
    if (job.status !== "error") throw new Error("Only a failed run can be retried.");
    // it picks up at the stage that failed
    const { error } = await sb.from("program_intel_jobs").update({ status: "pending", attempts: 0 }).eq("id", job.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const assignIntelDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), acknowledgeAudit: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: job } = await sb.from("program_intel_jobs").select("id, client_id, kind, status, result").eq("id", data.jobId).maybeSingle();
    if (!job || job.kind !== "generate") throw new Error("That draft wasn't found.");
    const role = await assertCoach(context, job.client_id);
    if (job.status !== "ready") throw new Error(job.status === "assigned" ? "This draft is already assigned." : "This draft isn't ready to assign.");
    if (job.result?.audit?.overall === "failed" && !data.acknowledgeAudit) throw new Error("This draft failed validation. Review the scorecard (or fix it in the editor) and confirm to assign it anyway.");
    const blockIds: string[] = (job.result?.blockIds ?? []).filter(Boolean);
    const { data: blocks } = await sb.from("pl_blocks").select("id, weeks, client_id, client_visible").in("id", blockIds);
    const ordered = blockIds.map((id) => (blocks ?? []).find((b: any) => b.id === id)).filter(Boolean) as any[];
    if (!ordered.length) throw new Error("The draft's blocks were deleted. Generate a new program.");
    if (ordered.some((b) => b.client_id !== job.client_id)) throw new Error("That draft belongs to another client.");
    // Each block's real week count (the coach may have added or removed weeks while editing).
    const weekRows = await Promise.all(ordered.map((b) => sb.from("pl_weeks").select("id, week_index").eq("block_id", b.id).eq("archived", false).is("deleted_at", null).order("week_index")));
    const counts = weekRows.map((r: any) => (r.data ?? []).length || 1);
    const dates = draftBlockDates(data.startDate, counts);
    for (const [i, b] of ordered.entries()) {
      const { error } = await sb.from("pl_blocks").update({ start_date: dates[i].start, end_date: dates[i].end, weeks: counts[i], client_visible: true, status: "Active" }).eq("id", b.id);
      if (error) throw new Error(error.message);
      for (const [wi, w] of ((weekRows[i] as any).data ?? []).entries()) {
        const d = dates[i].weeks[wi];
        if (!d) continue;
        const { error: we } = await sb.from("pl_weeks").update({ start_date: d.start, end_date: d.end }).eq("id", w.id);
        if (we) throw new Error(we.message);
      }
    }
    // Place the workouts on the client's committed training days (as when any program is assigned).
    let placed = false;
    try {
      const { realignClientToCommittedDays } = await import("@/lib/schedule-bulk.functions");
      const r = await realignClientToCommittedDays({ clientId: job.client_id, userId: context.userId, role, includePinned: false });
      placed = !r.noop;
    } catch (e) {
      console.warn("[program-intel] realign after assign failed", e);
    }
    // Cardio: one plan. A plan proposed with this program becomes theirs only when they have none
    // (their nutrition plan replaces it later); then every upcoming workout gets the plan's session.
    let cardio: { proposedPlanAdded: boolean; synced: unknown } = { proposedPlanAdded: false, synced: null };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as any;
      const planned = (job.result?.setup?.cardio ?? null) as CardioPlan | null;
      if (planned?.source === "proposed") {
        const { data: live } = await admin
          .from("cardio_targets")
          .select("id, day_type")
          .eq("client_id", job.client_id)
          .eq("status", "Active")
          .eq("enabled", true)
          .is("program_name", null);
        const hasPlan = ((live ?? []) as Array<{ day_type: string | null }>).some((t) => /training|rest/i.test(t.day_type ?? ""));
        if (!hasPlan) {
          const { data: c } = await admin.from("clients").select("committed_training_days").eq("id", job.client_id).maybeSingle();
          const rows = cardioTargetsFromProposal(planned, { clientId: job.client_id, trainingDays: c?.committed_training_days ?? [], today: data.startDate });
          if (rows.length) {
            const { error: ce } = await admin.from("cardio_targets").insert(rows);
            if (!ce) cardio.proposedPlanAdded = true;
          }
        }
      }
      const { data: synced } = await admin.rpc("program_cardio_sync", { p_client: job.client_id });
      cardio.synced = synced ?? null;
    } catch (e) {
      console.warn("[program-intel] cardio after assign failed", e);
    }
    const { error: je } = await sb.from("program_intel_jobs").update({ status: "assigned" }).eq("id", job.id);
    if (je) throw new Error(je.message);
    return { ok: true, blockIds, start: dates[0].start, end: dates[dates.length - 1].end, placedOnTrainingDays: placed, cardio };
  });

export const discardIntelDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: job } = await sb.from("program_intel_jobs").select("id, client_id, kind, status, result").eq("id", data.jobId).maybeSingle();
    if (!job) throw new Error("That run wasn't found.");
    await assertCoach(context, job.client_id);
    if (job.status === "assigned") throw new Error("An assigned program is kept; edit or archive it from the client's program.");
    const blockIds: string[] = (job.result?.blockIds ?? []).filter(Boolean);
    // Only blocks the client never saw and that hold no training are removed.
    for (const id of blockIds) {
      const { data: b } = await sb.from("pl_blocks").select("id, client_visible").eq("id", id).maybeSingle();
      if (!b || b.client_visible) continue;
      const { error } = await sb.from("pl_blocks").delete().eq("id", id);
      if (error) throw new Error(error.message);
    }
    await sb.from("program_intel_observations").update({ status: "rejected", reviewed_by: context.userId, reviewed_at: new Date().toISOString() }).eq("job_id", job.id).eq("status", "proposed");
    const { error } = await sb.from("program_intel_jobs").update({ status: "discarded" }).eq("id", job.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
