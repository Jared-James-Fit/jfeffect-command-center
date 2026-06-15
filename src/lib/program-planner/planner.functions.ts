/**
 * Program Assignment Planner — server functions (Phase 1).
 *
 * Phase 1 ships the dry-run planner only: `planAssignmentFn` reads the
 * template payload and the client's existing schedule and returns a
 * complete preview (placements + conflicts + coverage + summary). Nothing
 * is written to the database here. The commit + undo functions arrive in
 * Phase 2 once the UI is wired.
 *
 * Auth: admin OR is_assigned_coach for the target client. Members and
 * clients are rejected by RLS even if they bypass this check.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeTemplatePayload } from "@/lib/pl-template-blocks";
import { computePlacements, lastPlacedDate } from "./placement";
import { detectConflicts, type ExistingScheduledDay, type ExistingBlockWindow } from "./conflicts";
import { computeCoverage } from "./coverage";
import { materializeSelectedDays, summarize } from "./selection";
import type {
  AssignmentMethod, ConflictDecision, PlannerInput, PlannerPlacement, PlannerPreview, PublishStatus, Weekday,
} from "./types";

const ALLOWED_METHODS: AssignmentMethod[] = [
  "client_days", "entire_sequence", "weekday_map", "manual_dates", "fill_empty", "insert", "replace_range",
];
const ALLOWED_WEEKDAYS: Weekday[] = ["mon","tue","wed","thu","fri","sat","sun"];

const WEEKDAY_NORMALIZE: Record<string, Weekday> = {
  mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun",
  monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun",
};
function normalizeWeekdayList(input: unknown): Weekday[] {
  if (!Array.isArray(input)) return [];
  const out: Weekday[] = [];
  for (const raw of input) {
    const key = String(raw ?? "").trim().toLowerCase();
    const norm = WEEKDAY_NORMALIZE[key];
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
}

/**
 * Resolve a client's saved training days using the canonical priority:
 * committed → available → preferred (minus unavailable). Mirrors
 * `src/lib/auto-scheduler.ts` so the planner and the auto-scheduler agree.
 */
export async function resolveClientTrainingDays(
  supabase: any,
  clientId: string,
): Promise<{ days: Weekday[]; source: "committed" | "available" | "preferred" | "none"; timezone: string | null }> {
  const { data: c } = await supabase
    .from("clients")
    .select("committed_training_days, available_training_days, preferred_training_days, unavailable_training_days, timezone")
    .eq("id", clientId)
    .maybeSingle();
  const committed = normalizeWeekdayList(c?.committed_training_days);
  const available = normalizeWeekdayList(c?.available_training_days);
  const preferred = normalizeWeekdayList(c?.preferred_training_days);
  const unavailable = new Set(normalizeWeekdayList(c?.unavailable_training_days));
  const filter = (list: Weekday[]) => list.filter((d) => !unavailable.has(d));
  if (committed.length) return { days: filter(committed), source: "committed", timezone: c?.timezone ?? null };
  if (available.length) return { days: filter(available), source: "available", timezone: c?.timezone ?? null };
  if (preferred.length) return { days: filter(preferred), source: "preferred", timezone: c?.timezone ?? null };
  return { days: [], source: "none", timezone: c?.timezone ?? null };
}

function validatePlannerInput(d: any): PlannerInput {
  if (!d || typeof d !== "object") throw new Error("Invalid input");
  if (typeof d.clientId !== "string" || !d.clientId) throw new Error("clientId is required");
  if (typeof d.templateId !== "string" || !d.templateId) throw new Error("templateId is required");
  if (!d.selection || !Array.isArray(d.selection.exerciseKeys)) {
    throw new Error("selection.exerciseKeys is required");
  }
  if (!ALLOWED_METHODS.includes(d.method)) throw new Error("Unsupported assignment method");
  const trainingDays: Weekday[] = Array.isArray(d.trainingDays)
    ? d.trainingDays.filter((w: any) => ALLOWED_WEEKDAYS.includes(w))
    : [];
  return {
    clientId: d.clientId,
    templateId: d.templateId,
    selection: { exerciseKeys: d.selection.exerciseKeys.filter((k: any) => typeof k === "string") },
    method: d.method,
    startDate: typeof d.startDate === "string" ? d.startDate : null,
    trainingDays,
    manualDateMap: d.manualDateMap && typeof d.manualDateMap === "object" ? d.manualDateMap : undefined,
    replaceRange: Array.isArray(d.replaceRange) && d.replaceRange.length === 2 ? [d.replaceRange[0], d.replaceRange[1]] : undefined,
  };
}

async function authorizeClient(ctx: { supabase: any; userId: string }, clientId: string) {
  const { data: isAdmin } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (isAdmin) return;
  const { data: ok } = await ctx.supabase.rpc("is_assigned_coach", { _client_id: clientId });
  if (!ok) throw new Error("Not authorized to assign programs to this client");
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export const planAssignmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validatePlannerInput)
  .handler(async ({ data, context }): Promise<PlannerPreview> => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    await authorizeClient(ctx, data.clientId);

    // 1. Template payload (admin/coach can read pl_templates via RLS).
    const { data: tpl, error: tplErr } = await ctx.supabase
      .from("pl_templates")
      .select("id, name, template_type, payload")
      .eq("id", data.templateId)
      .maybeSingle();
    if (tplErr) throw new Error(tplErr.message);
    if (!tpl) throw new Error("Template not found");

    const payload = normalizeTemplatePayload(tpl.payload, {
      templateType: tpl.template_type, templateId: tpl.id,
    });

    // 2. Materialize the selected days from the template.
    const days = materializeSelectedDays(payload, data.selection);
    const summary = summarize(payload, data.selection);

    // 2b. For method="client_days", resolve the weekday list from the
    // client's saved availability (committed > available > preferred).
    let effectiveTrainingDays: Weekday[] = data.trainingDays;
    let trainingDaysSource: PlannerPreview["trainingDaysSource"] =
      data.method === "client_days" ? "none" : "manual";
    if (data.method === "client_days") {
      const resolved = await resolveClientTrainingDays(ctx.supabase, data.clientId);
      effectiveTrainingDays = resolved.days;
      trainingDaysSource = resolved.source;
    }

    // 3. Existing schedule + completions for this client.
    const [{ data: existingBlocks = [], error: bErr },
           { data: existingDayRows = [], error: dErr }] = await Promise.all([
      ctx.supabase
        .from("pl_blocks")
        .select("id, name, start_date, end_date, status, archived")
        .eq("client_id", data.clientId)
        .eq("archived", false),
      ctx.supabase
        .from("pl_days")
        .select("id, week_id, title, scheduled_date, schedule_locked, archived, pl_weeks!inner(block_id, pl_blocks!inner(client_id, name))")
        .eq("pl_weeks.pl_blocks.client_id", data.clientId)
        .eq("archived", false)
        .not("scheduled_date", "is", null),
    ] as const);
    if (bErr) throw new Error(bErr.message);
    if (dErr) throw new Error(dErr.message);

    // Pull completion flags for the same days in one round-trip.
    const dayIds = (existingDayRows as any[]).map((r) => r.id);
    let completedSet = new Set<string>();
    if (dayIds.length) {
      const { data: comps } = await ctx.supabase
        .from("pl_day_completions")
        .select("day_id")
        .eq("client_id", data.clientId)
        .in("day_id", dayIds);
      completedSet = new Set((comps ?? []).map((c: any) => c.day_id));
    }

    const existingDays: ExistingScheduledDay[] = (existingDayRows as any[]).map((r) => ({
      dayId: r.id,
      blockId: r.pl_weeks?.block_id,
      blockName: r.pl_weeks?.pl_blocks?.name ?? null,
      title: r.title ?? null,
      scheduled_date: r.scheduled_date,
      schedule_locked: !!r.schedule_locked,
      completed: completedSet.has(r.id),
    }));

    const existingBlockWindows: ExistingBlockWindow[] = (existingBlocks as any[]).map((b) => ({
      blockId: b.id,
      name: b.name,
      start_date: b.start_date,
      end_date: b.end_date,
      status: b.status,
    }));

    // 4. Placement.
    const occupiedDates = new Set(existingDays.map((d) => d.scheduled_date));
    const placements = computePlacements({
      method: data.method,
      startDate: data.startDate,
      trainingDays: effectiveTrainingDays,
      manualDateMap: data.manualDateMap,
      occupiedDates,
      days,
    });

    // 5. Conflicts + coverage.
    const conflicts = detectConflicts({
      placements,
      existingDays,
      existingBlocks: existingBlockWindows,
    });
    const coverage = computeCoverage({
      existingDays,
      newPlacements: placements,
    });

    return {
      placements,
      conflicts,
      coverage,
      summary,
      endDate: lastPlacedDate(placements),
      idempotencyKey: newIdempotencyKey(),
      resolvedTrainingDays: effectiveTrainingDays,
      trainingDaysSource,
    };
  });

/**
 * commitAssignmentFn + undoAssignmentBatchFn ship in Phase 2 once the UI
 * is wired. Phase 1 keeps the surface area minimal so we don't accidentally
 * touch existing client programming before the planner UI exists.
 */

// ----- Commit -----

interface CommitInput extends PlannerInput {
  conflictDecisions: Record<string, ConflictDecision>;
  publishStatus: PublishStatus;
  publishAt: string | null;
  idempotencyKey: string;
  programName?: string | null;
}

function validateCommitInput(d: any): CommitInput {
  const base = validatePlannerInput(d);
  const decisions = d?.conflictDecisions && typeof d.conflictDecisions === "object" ? d.conflictDecisions : {};
  const publishStatus: PublishStatus =
    d?.publishStatus === "draft" || d?.publishStatus === "scheduled" ? d.publishStatus : "published";
  return {
    ...base,
    conflictDecisions: decisions,
    publishStatus,
    publishAt: typeof d?.publishAt === "string" ? d.publishAt : null,
    idempotencyKey: typeof d?.idempotencyKey === "string" && d.idempotencyKey ? d.idempotencyKey : newIdempotencyKey(),
    programName: typeof d?.programName === "string" && d.programName ? d.programName : null,
  };
}

function applyDecisionsToPlacements(
  placements: PlannerPlacement[],
  decisions: Record<string, ConflictDecision>,
): PlannerPlacement[] {
  return placements
    .map((p): PlannerPlacement | null => {
      const dec = decisions[p.dayKey];
      if (!dec) return p;
      if (dec.action === "skip_incoming") return null;
      if (dec.action === "move_incoming" && dec.newDate) return { ...p, date: dec.newDate };
      return p;
    })
    .filter((p): p is PlannerPlacement => p !== null);
}

export const commitAssignmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateCommitInput)
  .handler(async ({ data, context }) => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    await authorizeClient(ctx, data.clientId);

    // Idempotency short-circuit.
    const { data: existingOp } = await ctx.supabase
      .from("pl_assignment_operations")
      .select("id, created_block_ids, status, workouts_added")
      .eq("client_id", data.clientId)
      .eq("template_id", data.templateId)
      .eq("idempotency_key", data.idempotencyKey)
      .maybeSingle();
    if (existingOp) {
      return {
        batchId: existingOp.id,
        createdBlockIds: existingOp.created_block_ids ?? [],
        idempotent: true,
        counts: { added: existingOp.workouts_added ?? 0, replaced: 0, merged: 0, skipped: 0, moved: 0 },
      };
    }

    // Re-run plan server-side as the source of truth.
    const { data: tpl, error: tplErr } = await ctx.supabase
      .from("pl_templates")
      .select("id, name, template_type, payload")
      .eq("id", data.templateId)
      .maybeSingle();
    if (tplErr) throw new Error(tplErr.message);
    if (!tpl) throw new Error("Template not found");
    const payload = normalizeTemplatePayload(tpl.payload, { templateType: tpl.template_type, templateId: tpl.id });
    const days = materializeSelectedDays(payload, data.selection);
    if (days.length === 0) throw new Error("Nothing selected to assign");
    const summary = summarize(payload, data.selection);

    const { data: existingDayRows = [] } = await ctx.supabase
      .from("pl_days")
      .select("id, scheduled_date, archived, pl_weeks!inner(block_id, pl_blocks!inner(client_id))")
      .eq("pl_weeks.pl_blocks.client_id", data.clientId)
      .eq("archived", false)
      .not("scheduled_date", "is", null);
    const occupiedDates = new Set<string>((existingDayRows as any[]).map((r) => r.scheduled_date));

    // Resolve client_days at commit time too so the snapshot stored in
    // pl_assignment_operations.training_weekdays reflects the *actual* days
    // used. Later changes to the client's availability never silently
    // rewrite this assignment.
    let effectiveTrainingDays: Weekday[] = data.trainingDays;
    if (data.method === "client_days") {
      const resolved = await resolveClientTrainingDays(ctx.supabase, data.clientId);
      effectiveTrainingDays = resolved.days;
      if (!effectiveTrainingDays.length) {
        throw new Error("This client has no saved training days. Choose Weekdays manually or set the client's training days first.");
      }
    }

    const rawPlacements = computePlacements({
      method: data.method,
      startDate: data.startDate,
      trainingDays: effectiveTrainingDays,
      manualDateMap: data.manualDateMap,
      occupiedDates,
      days,
    });
    const finalPlacements = applyDecisionsToPlacements(rawPlacements, data.conflictDecisions);

    // Apply "replace_existing" decisions FIRST so the dates open up.
    let replacedCount = 0;
    for (const dec of Object.values(data.conflictDecisions)) {
      if (dec.action === "replace_existing" && (dec as any).dayId) {
        await ctx.supabase
          .from("pl_days")
          .update({ archived: true, archived_at: new Date().toISOString(), archived_by: ctx.userId })
          .eq("id", (dec as any).dayId);
        replacedCount++;
      }
    }

    // Resolve unique block keys to commit.
    const blockKeys = Array.from(new Set(finalPlacements.map((p) => p.blockKey)));
    const visible = data.publishStatus === "published";
    const startDate = finalPlacements.reduce<string | null>(
      (min, p) => (p.date && (!min || p.date < min) ? p.date : min),
      null,
    );
    const endDate = lastPlacedDate(finalPlacements);
    const placement = tpl.template_type === "full_prep"
      ? { mode: "new_prep" as const, prep: {} }
      : { mode: "standalone_block" as const };

    const beforeStamp = new Date(Date.now() - 1000).toISOString();
    const { error: rpcErr } = await ctx.supabase.rpc("pl_assign_template_to_client", {
      p_template_id: data.templateId,
      p_client_id: data.clientId,
      p_placement: placement as any,
      p_name: data.programName ?? null,
      p_client_visible: visible,
      p_start_date: startDate,
      p_end_date: endDate,
      p_selected_block_ids: blockKeys.length > 0 ? blockKeys : null,
      p_start_from_block_id: null,
    } as any);
    if (rpcErr) throw new Error(rpcErr.message);

    // Fetch newly created blocks + their weeks/days so we can apply scheduled_date per placement.
    const { data: newBlocks } = await ctx.supabase
      .from("pl_blocks")
      .select("id, name, created_at, pl_weeks(id, week_index, pl_days(id, day_index))")
      .eq("client_id", data.clientId)
      .eq("source_template_id", data.templateId)
      .gte("created_at", beforeStamp)
      .order("created_at", { ascending: true });

    const orderedBlocks = (newBlocks ?? []) as any[];
    const blockIdByKey = new Map<string, string>();
    blockKeys.forEach((key, i) => {
      if (orderedBlocks[i]) blockIdByKey.set(key, orderedBlocks[i].id);
    });

    // Apply scheduled_date for each placement; null-date placements stay unscheduled.
    for (const p of finalPlacements) {
      const block = orderedBlocks.find((b) => b.id === blockIdByKey.get(p.blockKey));
      if (!block) continue;
      const weeks = (block.pl_weeks || []).slice().sort((a: any, b: any) => a.week_index - b.week_index);
      const targetWeek = weeks[p.weekIndex];
      if (!targetWeek) continue;
      const dayList = (targetWeek.pl_days || []).slice().sort((a: any, b: any) => a.day_index - b.day_index);
      const targetDay = dayList[p.dayIndex];
      if (!targetDay || !p.date) continue;
      await ctx.supabase
        .from("pl_days")
        .update({ scheduled_date: p.date, schedule_source: "planner" })
        .eq("id", targetDay.id);
    }

    // Counts
    let skippedCount = rawPlacements.length - finalPlacements.length;
    let movedCount = 0, mergedCount = 0;
    for (const dec of Object.values(data.conflictDecisions)) {
      if (dec.action === "move_existing" || dec.action === "move_incoming") movedCount++;
      else if (dec.action === "merge") mergedCount++;
    }

    const createdBlockIds = orderedBlocks.map((b) => b.id);
    const { data: opRow, error: opErr } = await ctx.supabase
      .from("pl_assignment_operations")
      .insert({
        client_id: data.clientId,
        template_id: data.templateId,
        actor_user_id: ctx.userId,
        idempotency_key: data.idempotencyKey,
        mode: `planner_${data.method}`,
        selected_block_keys: blockKeys,
        selected_week_keys: [],
        selected_day_keys: finalPlacements.map((p) => p.dayKey),
        selected_exercise_keys: data.selection.exerciseKeys,
        assignment_method: data.method,
        training_weekdays: effectiveTrainingDays,
        conflict_decisions: data.conflictDecisions as any,
        publish_status: data.publishStatus,
        publish_at: data.publishAt,
        published_at: data.publishStatus === "published" ? new Date().toISOString() : null,
        workouts_added: finalPlacements.filter((p) => p.date).length,
        workouts_merged: mergedCount,
        workouts_replaced: replacedCount,
        workouts_skipped: skippedCount,
        workouts_moved: movedCount,
        created_block_ids: createdBlockIds,
        template_schema_version: 2,
        planner_payload: { summary, placements: finalPlacements, endDate } as any,
        status: "completed",
      })
      .select("id")
      .single();
    if (opErr) throw new Error(opErr.message);

    await ctx.supabase.from("pl_bulk_operations").insert({
      operation_id: opRow.id,
      action: "planner_assign",
      scope: "client_blocks",
      source_ids: [],
      destination_ids: [data.clientId],
      created_ids: createdBlockIds,
      meta: { templateId: data.templateId, placements: finalPlacements.length },
      actor_user_id: ctx.userId,
    });

    return {
      batchId: opRow.id,
      createdBlockIds,
      idempotent: false,
      counts: {
        added: finalPlacements.filter((p) => p.date).length,
        replaced: replacedCount,
        merged: mergedCount,
        skipped: skippedCount,
        moved: movedCount,
      },
    };
  });

// ----- Undo -----

export const undoAssignmentBatchFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => ({
    batchId: String(d?.batchId ?? ""),
    force: Boolean(d?.force),
  }))
  .handler(async ({ data, context }) => {
    if (!data.batchId) throw new Error("batchId required");
    const ctx = { supabase: context.supabase, userId: context.userId };
    const { data: op } = await ctx.supabase
      .from("pl_assignment_operations")
      .select("id, client_id, created_block_ids, undone_at")
      .eq("id", data.batchId)
      .maybeSingle();
    if (!op) throw new Error("Assignment batch not found");
    if (op.undone_at) return { alreadyUndone: true, archived: 0 };
    await authorizeClient(ctx, op.client_id);

    const blockIds = (op.created_block_ids ?? []) as string[];
    if (!data.force && blockIds.length > 0) {
      const { data: weekRows } = await ctx.supabase
        .from("pl_weeks").select("id").in("block_id", blockIds);
      const weekIds = (weekRows ?? []).map((w: any) => w.id);
      if (weekIds.length) {
        const { data: dayRows } = await ctx.supabase
          .from("pl_days").select("id").in("week_id", weekIds);
        const dayIds = (dayRows ?? []).map((d: any) => d.id);
        if (dayIds.length) {
          const { count } = await ctx.supabase
            .from("pl_row_results")
            .select("id", { count: "exact", head: true })
            .in("day_id", dayIds);
          if ((count ?? 0) > 0) {
            throw new Error("Client has logged results from this assignment. Re-run with force to undo anyway.");
          }
        }
      }
    }

    if (blockIds.length) {
      await ctx.supabase
        .from("pl_blocks")
        .update({ archived: true, archived_at: new Date().toISOString(), archived_by: ctx.userId, client_visible: false })
        .in("id", blockIds);
    }
    await ctx.supabase
      .from("pl_assignment_operations")
      .update({ undone_at: new Date().toISOString(), undone_by: ctx.userId })
      .eq("id", op.id);

    return { ok: true, archived: blockIds.length };
  });

// ----- History list -----

export const listAssignmentBatchesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => ({ clientId: String(d?.clientId ?? "") }))
  .handler(async ({ data, context }) => {
    if (!data.clientId) throw new Error("clientId required");
    const ctx = { supabase: context.supabase, userId: context.userId };
    await authorizeClient(ctx, data.clientId);
    const { data: rows = [] } = await ctx.supabase
      .from("pl_assignment_operations")
      .select("id, template_id, mode, assignment_method, publish_status, created_at, workouts_added, workouts_replaced, workouts_skipped, workouts_moved, undone_at, created_block_ids, pl_templates(name)")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(50);
    return rows;
  });