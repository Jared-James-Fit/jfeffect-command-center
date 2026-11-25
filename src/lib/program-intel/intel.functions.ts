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
import { cleanProgramName, isGeneratedLabel, programIntelNote } from "./program-name";
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
    // their records go to OpenAI: only with the client's permission (5.1.2(i), src/lib/ai-consent)
    await (await import("@/lib/ai-consent/consent.server")).requireClientAiConsent(data.clientId);
    // one run at a time per client: a second tap, a second device or a strategy beside a build
    // gets the run already going (the worker keeps any run of the last 2 days alive or stops it
    // with Try again, jobs.server.ts), never a second generation writing alongside it
    const sb = context.supabase as any;
    const live = data.kind === "interpret" ? ["interpret"] : ["strategy", "generate"];
    const { data: busy } = await sb
      .from("program_intel_jobs")
      .select("id, status, updated_at")
      .eq("client_id", data.clientId)
      .in("kind", live)
      .in("status", ["pending", "running"])
      .gt("updated_at", new Date(Date.now() - 2 * 86_400_000).toISOString())
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
    await (await import("@/lib/ai-consent/consent.server")).requireClientAiConsent(job.client_id);
    // it picks up at the stage that failed
    const { error } = await sb.from("program_intel_jobs").update({ status: "pending", attempts: 0 }).eq("id", job.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const assignIntelDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), acknowledgeAudit: z.boolean().default(false), allowOverlap: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: job } = await sb.from("program_intel_jobs").select("id, client_id, kind, status, result").eq("id", data.jobId).maybeSingle();
    if (!job || job.kind !== "generate") throw new Error("That draft wasn't found.");
    const role = await assertCoach(context, job.client_id);
    if (job.status !== "ready") throw new Error(job.status === "assigned" ? "This draft is already assigned." : "This draft isn't ready to assign.");
    if (job.result?.audit?.overall === "failed" && !data.acknowledgeAudit) throw new Error("This draft failed validation. Review the scorecard (or fix it in the editor) and confirm to assign it anyway.");
    const blockIds: string[] = (job.result?.blockIds ?? []).filter(Boolean);
    const { data: blocks } = await sb.from("pl_blocks").select("id, weeks, client_id, client_visible, prep_id, coach_notes").in("id", blockIds);
    const ordered = blockIds.map((id) => (blocks ?? []).find((b: any) => b.id === id)).filter(Boolean) as any[];
    if (!ordered.length) throw new Error("The draft's blocks were deleted. Generate a new program.");
    if (ordered.some((b) => b.client_id !== job.client_id)) throw new Error("That draft belongs to another client.");
    // Each block's real week count (the coach may have added or removed weeks while editing).
    const weekRows = await Promise.all(ordered.map((b) => sb.from("pl_weeks").select("id, week_index").eq("block_id", b.id).eq("archived", false).is("deleted_at", null).order("week_index")));
    const counts = weekRows.map((r: any) => (r.data ?? []).length || 1);
    const dates = draftBlockDates(data.startDate, counts);
    // never two programs on the same days by accident: a start inside a program that's still running needs the coach's say-so
    if (!data.allowOverlap) {
      const end = dates[dates.length - 1].end;
      const { data: running } = await sb
        .from("pl_blocks")
        .select("id, name, start_date, end_date, status")
        .eq("client_id", job.client_id)
        .eq("client_visible", true)
        .eq("archived", false)
        .gte("end_date", data.startDate)
        .lte("start_date", end);
      const clash = (running ?? []).filter((b: any) => !blockIds.includes(b.id) && !/^(draft|archived|completed)$/i.test(String(b.status ?? "")));
      if (clash.length) {
        const last = clash.map((b: any) => b.end_date as string).sort().slice(-1)[0];
        throw new Error(`It starts ${data.startDate}, but "${clash[0].name}" runs until ${last}: both programs would have workouts on the same days. Start after it, or confirm the overlap.`);
      }
    }
    const name: string | null = job.result?.program?.program_name ?? null;
    for (const [i, b] of ordered.entries()) {
      const { error } = await sb.from("pl_blocks").update({ start_date: dates[i].start, end_date: dates[i].end, weeks: counts[i], client_visible: true, status: "Active", coach_notes: programIntelNote(b.coach_notes, name, false) }).eq("id", b.id);
      if (error) throw new Error(error.message);
      for (const [wi, w] of ((weekRows[i] as any).data ?? []).entries()) {
        const d = dates[i].weeks[wi];
        if (!d) continue;
        const { error: we } = await sb.from("pl_weeks").update({ start_date: d.start, end_date: d.end }).eq("id", w.id);
        if (we) throw new Error(we.message);
      }
    }
    // The program's name on every screen ("Westerns Prep" on their Workouts card, the coach's Training tab):
    // one program record for its blocks, like a library program's. Only for a real name, never the
    // generator's own label, and never over a program record the coach already put them in.
    const prepId = await nameAssignedProgram(sb, { clientId: job.client_id, userId: context.userId, name, blocks: ordered, start: dates[0].start, end: dates[dates.length - 1].end, weeks: counts.reduce((n, c) => n + c, 0) });
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
    let cardio: { proposedPlanAdded: boolean; synced: Record<string, any> | null } = { proposedPlanAdded: false, synced: null };
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
    return { ok: true, blockIds, prepId, start: dates[0].start, end: dates[dates.length - 1].end, placedOnTrainingDays: placed, cardio };
  });

/**
 * The program record an assigned draft's blocks go under, titled with its name. Best effort: the
 * assign stands without it (the blocks are then read as a program of their own, as before).
 */
async function nameAssignedProgram(
  sb: any,
  x: { clientId: string; userId: string; name: string | null; blocks: Array<{ id: string; prep_id?: string | null }>; start: string; end: string; weeks: number },
): Promise<string | null> {
  const title = cleanProgramName(x.name);
  if (!title || isGeneratedLabel(title)) return null;
  if (x.blocks.some((b) => b.prep_id)) return null;
  try {
    const { data: prep, error } = await sb
      .from("pl_preps")
      .insert({ client_id: x.clientId, title, goal_type: "Custom", status: "Active", client_visible: true, start_date: x.start, end_date: x.end, total_weeks: x.weeks, created_by: x.userId })
      .select("id")
      .single();
    if (error || !prep) throw new Error(error?.message ?? "no program record");
    const { error: be } = await sb.from("pl_blocks").update({ prep_id: prep.id }).in("id", x.blocks.map((b) => b.id));
    if (be) {
      await sb.from("pl_preps").delete().eq("id", prep.id);
      throw new Error(be.message);
    }
    return prep.id as string;
  } catch (e) {
    console.warn("[program-intel] naming the assigned program failed", e);
    return null;
  }
}

/**
 * Rename a generated program: the name on the draft, and once it's assigned the program record
 * its blocks share (one made for it on assign, or one titled with its old name), so the athlete
 * reads the new name too.
 */
export const renameIntelProgramFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), name: z.string().trim().min(1).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: job } = await sb.from("program_intel_jobs").select("id, client_id, kind, status, result").eq("id", data.jobId).maybeSingle();
    if (!job || job.kind !== "generate" || !job.result?.program) throw new Error("That program wasn't found.");
    await assertCoach(context, job.client_id);
    if (job.status !== "ready" && job.status !== "assigned") throw new Error("Only a finished program can be renamed.");
    const name = cleanProgramName(data.name);
    if (!name) throw new Error("Give it a name, like Westerns Prep or Off-Season Strength.");
    const old: string = job.result.program.program_name ?? "";
    if (old === name) return { ok: true, name, prepId: null };
    const result = { ...job.result, program: { ...job.result.program, program_name: name } };
    const { error } = await sb.from("program_intel_jobs").update({ result }).eq("id", job.id);
    if (error) throw new Error(error.message);
    const blockIds: string[] = (job.result.blockIds ?? []).filter(Boolean);
    if (!blockIds.length) return { ok: true, name, prepId: null };
    const { data: blocks } = await sb.from("pl_blocks").select("id, prep_id, coach_notes").in("id", blockIds);
    for (const b of (blocks ?? []) as Array<{ id: string; coach_notes: string | null }>) {
      const note = programIntelNote(b.coach_notes, name, job.status !== "assigned");
      if (note !== b.coach_notes) await sb.from("pl_blocks").update({ coach_notes: note }).eq("id", b.id);
    }
    if (job.status !== "assigned") return { ok: true, name, prepId: null };
    const preps = [...new Set(((blocks ?? []) as Array<{ prep_id: string | null }>).map((b) => b.prep_id))];
    let prepId: string | null = null;
    if (preps.length === 1 && preps[0]) {
      const { data: prep } = await sb.from("pl_preps").select("id, title").eq("id", preps[0]).maybeSingle();
      if (prep && (prep.title === old || isGeneratedLabel(prep.title))) {
        const { error: pe } = await sb.from("pl_preps").update({ title: name }).eq("id", prep.id);
        if (pe) throw new Error(pe.message);
        prepId = prep.id;
      }
    } else if (preps.length === 1 && !preps[0]) {
      const { data: dated } = await sb.from("pl_blocks").select("id, prep_id, start_date, end_date, weeks").in("id", blockIds).order("start_date");
      const list = (dated ?? []) as Array<{ id: string; prep_id: string | null; start_date: string | null; end_date: string | null; weeks: number | null }>;
      const start = list.find((b) => b.start_date)?.start_date;
      const end = [...list].reverse().find((b) => b.end_date)?.end_date;
      if (start && end) prepId = await nameAssignedProgram(sb, { clientId: job.client_id, userId: context.userId, name, blocks: list, start, end, weeks: list.reduce((n, b) => n + (b.weeks ?? 0), 0) });
    }
    return { ok: true, name, prepId };
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
    // a model still thinking for a discarded run is stopped, so it isn't billed for nothing (best effort)
    const live = Object.values((job.result?.pending ?? {}) as Record<string, { id?: string; hedge?: { id: string } }>).flatMap((p) => [p?.id, p?.hedge?.id]).filter((x): x is string => !!x);
    if (live.length) {
      try {
        const { cancelBackground } = await import("@/lib/ai/model-client.server");
        await Promise.all(live.map((id) => Promise.resolve(cancelBackground(id)).catch(() => undefined)));
      } catch {
        // the discard stands either way
      }
    }
    return { ok: true };
  });
