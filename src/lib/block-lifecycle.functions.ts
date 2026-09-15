/**
 * BLOCK LIFECYCLE — server functions for flexible block scheduling.
 *
 * Canonical contract (unchanged):
 *   pl_blocks / pl_weeks / pl_days  = WHAT the client trains
 *   pl_scheduled_workouts           = WHEN it happens (calendar truth)
 *   pl_day_completions + logged sets = WHAT ACTUALLY HAPPENED (immutable)
 *
 * Every mutation here only ever touches the WHEN layer, and only for FUTURE,
 * UNCOMPLETED instances. Completed workouts, logged sets, RPE, notes, PRs and
 * their dates are never read-modify-written. Program definitions (pl_days) are
 * never deleted — a block that ended early can be extended again later and its
 * workouts re-placed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

type Ctx = { supabase: any; userId: string };

async function assertCoachOrAdmin(ctx: Ctx, clientId: string) {
  const { data: isAdmin } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (isAdmin === true) return;
  const { data: client } = await ctx.supabase
    .from("clients")
    .select("id, assigned_coach_id")
    .eq("id", clientId)
    .maybeSingle();
  if (client?.assigned_coach_id) {
    const { data: coach } = await ctx.supabase
      .from("coaches")
      .select("id, user_id")
      .eq("id", client.assigned_coach_id)
      .maybeSingle();
    if (coach?.user_id === ctx.userId) return;
  }
  throw new Error("Only this client's coach can change their training schedule.");
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function diffDays(fromISO: string, toISO: string): number {
  const [y1, m1, d1] = fromISO.split("-").map(Number);
  const [y2, m2, d2] = toISO.split("-").map(Number);
  return Math.round(
    (new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86400000,
  );
}

/** Load a block plus every day it owns, its calendar instances and completions. */
async function loadBlockSchedule(supabase: any, blockId: string) {
  const { data: block } = await supabase
    .from("pl_blocks")
    .select("id, client_id, name, status, start_date, end_date, weeks, week_duration_days, archived, completed_at")
    .eq("id", blockId)
    .maybeSingle();
  if (!block) throw new Error("Block not found.");

  const { data: weeks } = await supabase
    .from("pl_weeks")
    .select("id, week_index, date_source")
    .eq("block_id", blockId)
    .order("week_index");
  const weekIds = (weeks ?? []).map((w: any) => w.id);

  const { data: days } = weekIds.length
    ? await supabase
        .from("pl_days")
        .select("id, week_id, day_index, title, scheduled_date, archived, deleted_at")
        .in("week_id", weekIds)
    : { data: [] as any[] };
  const dayList = (days ?? []).filter((d: any) => !d.archived && !d.deleted_at);
  const dayIds = dayList.map((d: any) => d.id);

  const { data: instances } = dayIds.length
    ? await supabase
        .from("pl_scheduled_workouts")
        .select("id, source_day_id, scheduled_date")
        .eq("client_id", block.client_id)
        .in("source_day_id", dayIds)
    : { data: [] as any[] };

  const { data: completions } = dayIds.length
    ? await supabase
        .from("pl_day_completions")
        .select("id, day_id, scheduled_workout_id, completed_at")
        .eq("client_id", block.client_id)
        .in("day_id", dayIds)
    : { data: [] as any[] };

  const completedDayIds = new Set<string>(
    (completions ?? []).filter((c: any) => c.completed_at).map((c: any) => String(c.day_id)),
  );
  const completedInstanceIds = new Set<string>(
    (completions ?? [])
      .filter((c: any) => c.completed_at && c.scheduled_workout_id)
      .map((c: any) => String(c.scheduled_workout_id)),
  );


  const titleByDay = new Map<string, string>(
    dayList.map((d: any) => [d.id, d.title ?? `Day ${d.day_index ?? ""}`.trim()]),
  );

  const instList = (instances ?? []) as any[];
  // Canonical actual schedule: instance date when an instance exists, else the
  // legacy pl_days.scheduled_date. Stale pl_blocks.end_date is fallback only.
  const actualDates: string[] = [];
  for (const d of dayList) {
    const inst = instList.find((i: any) => i.source_day_id === d.id);
    const date = inst?.scheduled_date ?? d.scheduled_date ?? null;
    if (date) actualDates.push(String(date));
  }
  actualDates.sort();
  const actualStart = actualDates[0] ?? null;
  const actualEnd = actualDates.length ? actualDates[actualDates.length - 1] : null;

  return {
    block,
    weeks: weeks ?? [],
    days: dayList,
    instances: instList,
    completedDayIds,
    completedInstanceIds,
    titleByDay,
    actualStart,
    actualEnd,
  };
}

function isCompletedInstance(
  inst: any,
  completedInstanceIds: Set<string>,
  completedDayIds: Set<string>,
) {
  return completedInstanceIds.has(inst.id) || completedDayIds.has(inst.source_day_id);
}

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW — what ending this block on an arbitrary date would change.
// ─────────────────────────────────────────────────────────────────────────────
export const previewEndBlockEarlyFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { blockId: string; newEnd: string }) =>
    z.object({ blockId: z.string().uuid(), newEnd: isoDate }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const loaded = await loadBlockSchedule(ctx.supabase, data.blockId);
    await assertCoachOrAdmin(ctx, loaded.block.client_id);

    const affected: { id: string; date: string; title: string }[] = [];
    let completedPreserved = 0;
    for (const inst of loaded.instances) {
      if (!inst.scheduled_date || inst.scheduled_date <= data.newEnd) continue;
      if (isCompletedInstance(inst, loaded.completedInstanceIds, loaded.completedDayIds)) {
        completedPreserved += 1;
        continue;
      }
      affected.push({
        id: inst.id,
        date: inst.scheduled_date,
        title: loaded.titleByDay.get(inst.source_day_id) ?? "Workout",
      });
    }
    // Legacy days that never got a calendar instance but carry a date.
    let legacyAffected = 0;
    for (const day of loaded.days) {
      if (!day.scheduled_date || day.scheduled_date <= data.newEnd) continue;
      if (loaded.instances.some((i: any) => i.source_day_id === day.id)) continue;
      if (loaded.completedDayIds.has(day.id)) continue;
      legacyAffected += 1;
    }

    affected.sort((a, b) => a.date.localeCompare(b.date));
    return {
      blockName: loaded.block.name as string,
      currentEnd: loaded.actualEnd ?? (loaded.block.end_date as string | null) ?? null,
      newEnd: data.newEnd,
      affectedCount: affected.length + legacyAffected,
      affected: affected.slice(0, 12),
      completedPreserved,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// END BLOCK EARLY — arbitrary calendar date, history untouched.
// ─────────────────────────────────────────────────────────────────────────────
export const endBlockEarlyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { blockId: string; newEnd: string }) =>
    z.object({ blockId: z.string().uuid(), newEnd: isoDate }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const loaded = await loadBlockSchedule(ctx.supabase, data.blockId);
    await assertCoachOrAdmin(ctx, loaded.block.client_id);

    // Execute the schedule cleanup + block completion as ONE database
    // transaction. This prevents a late block-update failure from leaving the
    // client's future schedule partially cleared.
    const { data: result, error } = await ctx.supabase.rpc("pl_end_block_early", {
      _block_id: data.blockId,
      _new_end: data.newEnd,
    });
    if (error) throw new Error(error.message);

    const removed = Number((result as any)?.removed ?? 0);
    const cleared = Number((result as any)?.cleared ?? 0);

    return {
      ok: true as const,
      unscheduled: removed + cleared,
      newEnd: data.newEnd,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// SET BLOCK DATES — move/start a block on any date, shifting FUTURE workouts.
// ─────────────────────────────────────────────────────────────────────────────
export const setBlockScheduleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { blockId: string; startDate: string; endDate?: string | null; shiftWorkouts?: boolean }) =>
      z
        .object({
          blockId: z.string().uuid(),
          startDate: isoDate,
          endDate: isoDate.nullable().optional(),
          shiftWorkouts: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const loaded = await loadBlockSchedule(ctx.supabase, data.blockId);
    await assertCoachOrAdmin(ctx, loaded.block.client_id);

    const dur = Number(loaded.block.week_duration_days ?? 7) || 7;
    const weeks = Number(loaded.block.weeks ?? 0);
    const computedEnd = weeks ? addDaysISO(data.startDate, weeks * dur - 1) : null;
    const endDate = data.endDate ?? computedEnd;
    const oldStart = loaded.block.start_date as string | null;
    const delta = oldStart ? diffDays(oldStart, data.startDate) : 0;

    const now = new Date();
    const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const isActive = data.startDate <= todayISO && (!endDate || endDate >= todayISO);

    const { error: upErr } = await ctx.supabase
      .from("pl_blocks")
      .update({
        start_date: data.startDate,
        end_date: endDate,
        status: isActive ? "Active" : "Draft",
        completed_at: null,
        completion_method: null,
        archived: false,
      })
      .eq("id", data.blockId);
    if (upErr) throw new Error(upErr.message);

    // Recompute auto-dated weeks; manual week dates are preserved.
    for (const w of loaded.weeks as any[]) {
      if (w.date_source === "manual") continue;
      const ws = addDaysISO(data.startDate, ((w.week_index ?? 1) - 1) * dur);
      await ctx.supabase
        .from("pl_weeks")
        .update({ start_date: ws, end_date: addDaysISO(ws, dur - 1), date_source: "auto" })
        .eq("id", w.id);
    }

    // Shift FUTURE, UNCOMPLETED calendar instances by the same delta so the
    // block's workouts follow the block. Past and completed sessions stay on
    // the dates they really happened.
    let moved = 0;
    if (delta !== 0 && data.shiftWorkouts !== false) {
      for (const inst of loaded.instances) {
        if (!inst.scheduled_date || inst.scheduled_date < todayISO) continue;
        if (isCompletedInstance(inst, loaded.completedInstanceIds, loaded.completedDayIds)) continue;
        const next = addDaysISO(inst.scheduled_date, delta);
        const { error } = await ctx.supabase
          .from("pl_scheduled_workouts")
          .update({ scheduled_date: next, schedule_source: "moved" })
          .eq("id", inst.id);
        if (!error) moved += 1;
      }
    }

    return { ok: true as const, startDate: data.startDate, endDate, movedWorkouts: moved };
  });

// ─────────────────────────────────────────────────────────────────────────────
// END CURRENT + START NEXT — one guided transition.
// ─────────────────────────────────────────────────────────────────────────────
export const endAndStartNextFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { currentBlockId: string; newEnd: string; nextBlockId: string; nextStart: string }) =>
      z
        .object({
          currentBlockId: z.string().uuid(),
          newEnd: isoDate,
          nextBlockId: z.string().uuid(),
          nextStart: isoDate,
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ended = await (endBlockEarlyFn as any)({
      data: { blockId: data.currentBlockId, newEnd: data.newEnd },
    });
    const started = await (setBlockScheduleFn as any)({
      data: { blockId: data.nextBlockId, startDate: data.nextStart },
    });
    return { ok: true as const, ended, started };
  });
