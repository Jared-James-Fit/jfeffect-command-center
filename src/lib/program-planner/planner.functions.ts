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
  AssignmentMethod, PlannerInput, PlannerPreview, Weekday,
} from "./types";

const ALLOWED_METHODS: AssignmentMethod[] = [
  "entire_sequence", "weekday_map", "manual_dates", "fill_empty", "insert", "replace_range",
];
const ALLOWED_WEEKDAYS: Weekday[] = ["mon","tue","wed","thu","fri","sat","sun"];

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
      trainingDays: data.trainingDays,
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
    };
  });

/**
 * commitAssignmentFn + undoAssignmentBatchFn ship in Phase 2 once the UI
 * is wired. Phase 1 keeps the surface area minimal so we don't accidentally
 * touch existing client programming before the planner UI exists.
 */