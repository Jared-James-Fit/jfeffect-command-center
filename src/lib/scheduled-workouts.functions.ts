import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateReorderPayload } from "@/lib/schedule-mutation-guards";
import { isPrimaryProgramBlock } from "@/lib/at-home-backup";

// ─────────────────────────────────────────────────────────────────────────────
// Manual Workout Scheduling — server functions for pl_scheduled_workouts.
//
// pl_scheduled_workouts holds "instances" — placements of an existing
// workout day (pl_days) on a client's calendar. Adding, moving, copying,
// removing, reordering, and re-timing an instance never mutates program
// structure (pl_blocks/pl_weeks/pl_days/pl_exercise_rows) or completions.
//
// Permission tiers (clients.workout_scheduling_permission):
//   off               → client cannot add workouts to the calendar
//   move              → client may reschedule, reorder, or re-time own workouts
//   add_current_block → move + add from client's CURRENT active block
//   full_program      → move + add from any assigned program + copy
//   Every authenticated client may reschedule, reorder, and re-time existing
//   workout instances. Calendar placement never mutates program structure or
//   completion history; add/remove authority remains intentionally restricted.
// ─────────────────────────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const isoTime = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Expected HH:MM")
  .nullable()
  .optional();

type Actor = "admin" | "coach" | "client";

async function resolveActor(
  ctx: { supabase: any; userId: string },
  clientId: string,
): Promise<{ actor: Actor; client: any }> {
  const { supabase, userId } = ctx;
  const { data: client, error } = await supabase
    .from("clients")
    .select(
      "id, user_id, assigned_coach_id, workout_scheduling_permission, full_name",
    )
    .eq("id", clientId)
    .maybeSingle();
  if (error || !client) throw new Error("Client not found.");

  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (isAdmin === true) return { actor: "admin", client };

  if (client.assigned_coach_id) {
    const { data: coach } = await supabase
      .from("coaches")
      .select("id, user_id")
      .eq("id", client.assigned_coach_id)
      .maybeSingle();
    if (coach?.user_id === userId) return { actor: "coach", client };
  }

  if (client.user_id === userId) return { actor: "client", client };
  throw new Error("You don't have permission to change this schedule.");
}

/** Validate that a source_day belongs to a block the client is assigned to. */
async function assertSourceDayAssignedToClient(
  supabase: any,
  sourceDayId: string,
  clientId: string,
): Promise<{ day: any; week: any; block: any }> {
  const { data: day } = await supabase
    .from("pl_days")
    .select("id, week_id, day_index, title, archived")
    .eq("id", sourceDayId)
    .maybeSingle();
  if (!day) throw new Error("Workout not found.");
  if (day.archived) throw new Error("This workout is archived.");

  const { data: week } = await supabase
    .from("pl_weeks")
    .select("id, block_id, week_index")
    .eq("id", day.week_id)
    .maybeSingle();
  if (!week) throw new Error("Workout week missing.");

  const { data: block } = await supabase
    .from("pl_blocks")
    .select("id, client_id, status, name, source_template_block_key")
    .eq("id", week.block_id)
    .maybeSingle();
  if (!block) throw new Error("Workout block missing.");
  if (block.client_id !== clientId) {
    throw new Error("That workout is not assigned to this client.");
  }
  if (!isPrimaryProgramBlock(block)) {
    throw new Error("At-home backup sessions are managed from the dedicated backup workout flow.");
  }
  return { day, week, block };
}

function canClientAddFromBlock(
  permission: string,
  block: { status: string | null },
): boolean {
  if (permission === "add_current_block") return block.status === "active";
  if (permission === "full_program") return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST — merged calendar view for a client (used by calendar sources).
// ─────────────────────────────────────────────────────────────────────────────
export const listScheduledWorkouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; from: string; to: string }) =>
    z
      .object({ clientId: z.string().uuid(), from: isoDate, to: isoDate })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await resolveActor(context, data.clientId);
    const { data: rows, error } = await context.supabase
      .from("pl_scheduled_workouts")
      .select(
        "id, client_id, source_day_id, scheduled_date, scheduled_time, order_index, schedule_source, note, created_at",
      )
      .eq("client_id", data.clientId)
      .gte("scheduled_date", data.from)
      .lte("scheduled_date", data.to)
      .order("scheduled_date", { ascending: true })
      .order("order_index", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE — insert N instances on a single date.
// ─────────────────────────────────────────────────────────────────────────────
export const scheduleWorkouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      clientId: string;
      sourceDayIds: string[];
      date: string;
      time?: string | null;
      note?: string | null;
    }) =>
      z
        .object({
          clientId: z.string().uuid(),
          sourceDayIds: z.array(z.string().uuid()).min(1).max(10),
          date: isoDate,
          time: isoTime,
          note: z.string().max(500).nullable().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { actor, client } = await resolveActor(context, data.clientId);

    // Permission gate for client callers.
    if (actor === "client") {
      const perm = client.workout_scheduling_permission ?? "move";
      if (perm === "off" || perm === "move") {
        throw new Error(
          "Your account can only move already-scheduled workouts. Ask your coach to add new workouts.",
        );
      }
      // For each source day, ensure the client is allowed to add from that block.
      for (const dayId of data.sourceDayIds) {
        const { block } = await assertSourceDayAssignedToClient(
          context.supabase,
          dayId,
          data.clientId,
        );
        if (!canClientAddFromBlock(perm, block)) {
          throw new Error(
            "You can only add workouts from your current active block.",
          );
        }
      }
    } else {
      for (const dayId of data.sourceDayIds) {
        await assertSourceDayAssignedToClient(
          context.supabase,
          dayId,
          data.clientId,
        );
      }
    }

    // SAFETY GUARD (Phase 2 pre-instance-completion):
    // Completion tracking is still keyed by source day_id, so scheduling the
    // same source workout twice would let one completion satisfy both cards.
    // Reject any attempt to schedule a source_day_id that already has an
    // existing scheduled instance for this client. Remove this guard once
    // pl_day_completions gains a scheduled_workout_id column.
    {
      const { data: dupes } = await context.supabase
        .from("pl_scheduled_workouts")
        .select("source_day_id")
        .eq("client_id", data.clientId)
        .in("source_day_id", data.sourceDayIds);
      const taken = new Set((dupes ?? []).map((r: any) => r.source_day_id));
      const collide = data.sourceDayIds.filter((id) => taken.has(id));
      if (collide.length) {
        throw new Error(
          "One or more of these workouts is already on this client's schedule. Move the existing one instead of scheduling a duplicate.",
        );
      }
      const uniq = new Set(data.sourceDayIds);
      if (uniq.size !== data.sourceDayIds.length) {
        throw new Error("Cannot schedule the same workout twice in one action.");
      }
    }

    // Find current max order_index on the target date so new rows stack.
    const { data: existing } = await context.supabase
      .from("pl_scheduled_workouts")
      .select("order_index")
      .eq("client_id", data.clientId)
      .eq("scheduled_date", data.date)
      .order("order_index", { ascending: false })
      .limit(1);
    const startIdx =
      (existing?.[0]?.order_index as number | undefined) !== undefined
        ? (existing![0].order_index as number) + 1
        : 0;

    const rows = data.sourceDayIds.map((sourceDayId, i) => ({
      client_id: data.clientId,
      source_day_id: sourceDayId,
      scheduled_date: data.date,
      scheduled_time: data.time ?? null,
      order_index: startIdx + i,
      schedule_source: "manual" as const,
      created_by: context.userId,
      original_date: data.date,
      note: data.note ?? null,
    }));

    const { data: inserted, error } = await context.supabase
      .from("pl_scheduled_workouts")
      .insert(rows)
      .select("id, scheduled_date, order_index");
    if (error) throw new Error(error.message);
    return { ok: true, inserted };
  });

// ─────────────────────────────────────────────────────────────────────────────
// MOVE — change scheduled_date (and optional time/order) of one instance.
// ─────────────────────────────────────────────────────────────────────────────
export const moveScheduledWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      instanceId: string;
      newDate: string;
      time?: string | null;
      orderIndex?: number | null;
    }) =>
      z
        .object({
          instanceId: z.string().uuid(),
          newDate: isoDate,
          time: isoTime,
          orderIndex: z.number().int().nullable().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: instance } = await context.supabase
      .from("pl_scheduled_workouts")
      .select(
        "id, client_id, scheduled_date, scheduled_time, order_index, schedule_source",
      )
      .eq("id", data.instanceId)
      .maybeSingle();
    if (!instance) throw new Error("Scheduled workout not found.");
    // Every authenticated client may reschedule an existing workout. The actor
    // resolution still enforces ownership/coach/admin authorization; program
    // additions and removals remain governed by their separate permissions.
    await resolveActor(context, instance.client_id);

    // Calendar placement is separate from completion history. A completed
    // instance MAY be moved: we only write scheduled_date/time/order on
    // pl_scheduled_workouts. pl_day_completions.completed_at, logged sets,
    // and their timestamps are never touched, so analytics keep attributing
    // performance to the real completion date.
    const { data: comp } = await context.supabase
      .from("pl_day_completions")
      .select("completed_at")
      .eq("scheduled_workout_id", data.instanceId)
      .maybeSingle();
    const wasCompleted = !!comp?.completed_at;

    // Compute next order_index if not provided → append.
    let orderIndex = data.orderIndex;
    if (orderIndex == null) {
      const { data: existing } = await context.supabase
        .from("pl_scheduled_workouts")
        .select("order_index")
        .eq("client_id", instance.client_id)
        .eq("scheduled_date", data.newDate)
        .neq("id", data.instanceId)
        .order("order_index", { ascending: false })
        .limit(1);
      orderIndex =
        (existing?.[0]?.order_index as number | undefined) !== undefined
          ? (existing![0].order_index as number) + 1
          : 0;
    }

    const { error } = await context.supabase
      .from("pl_scheduled_workouts")
      .update({
        scheduled_date: data.newDate,
        scheduled_time: data.time ?? undefined,
        order_index: orderIndex,
        schedule_source:
          instance.schedule_source === "program"
            ? "moved"
            : instance.schedule_source,
      })
      .eq("id", data.instanceId);
    if (error) throw new Error(error.message);
    return {
      ok: true as const,
      wasCompleted,
      previous: {
        scheduledDate: instance.scheduled_date as string,
        scheduledTime: (instance.scheduled_time as string | null) ?? null,
        orderIndex: (instance.order_index as number) ?? 0,
      },
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// REMOVE — coach/admin only.
// ─────────────────────────────────────────────────────────────────────────────
export const removeScheduledWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { instanceId: string }) =>
    z.object({ instanceId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: instance } = await context.supabase
      .from("pl_scheduled_workouts")
      .select("id, client_id")
      .eq("id", data.instanceId)
      .maybeSingle();
    if (!instance) throw new Error("Scheduled workout not found.");
    const { actor } = await resolveActor(context, instance.client_id);
    if (actor === "client") {
      throw new Error("Only your coach can remove a scheduled workout.");
    }
    // Block removal of a completed instance — logged sets stay attached to
    // the instance and would be orphaned by delete. Coach must undo the
    // completion first if they really need to remove it.
    const { data: comp } = await context.supabase
      .from("pl_day_completions")
      .select("completed_at")
      .eq("scheduled_workout_id", data.instanceId)
      .maybeSingle();
    if (comp?.completed_at) {
      throw new Error(
        "This workout instance is already completed. Reset the completion before removing it.",
      );
    }
    const { error } = await context.supabase
      .from("pl_scheduled_workouts")
      .delete()
      .eq("id", data.instanceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─────────────────────────────────────────────────────────────────────────────
// REORDER — set order_index for all instances on a given date.
// ─────────────────────────────────────────────────────────────────────────────
export const reorderScheduledWorkouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { clientId: string; date: string; orderedInstanceIds: string[] }) =>
      z
        .object({
          clientId: z.string().uuid(),
          date: isoDate,
          orderedInstanceIds: z.array(z.string().uuid()).min(1),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Reordering is a calendar-placement operation. Resolve actor ownership,
    // but let every authenticated client reorder their own scheduled workouts.
    await resolveActor(context, data.clientId);

    // Load every instance for this (client, date). The caller MUST send
    // the exact full set of ids in the intended order — no missing ids
    // and no foreign ids. This prevents partial re-orders that would
    // leave stale/duplicate order_index values behind.
    const { data: existing, error: exErr } = await context.supabase
      .from("pl_scheduled_workouts")
      .select("id")
      .eq("client_id", data.clientId)
      .eq("scheduled_date", data.date);
    if (exErr) throw new Error(exErr.message);
    const plan = validateReorderPayload({
      existingIds: (existing ?? []).map((r: any) => r.id),
      requestedIds: data.orderedInstanceIds,
      // Order is calendar placement, not history: completed instances may be
      // reordered on their date without touching completion records.
      completed: new Set<string>(),
    });

    // Normalize order_index to 0..N-1 in a single pass — no duplicates,
    // no gaps. We write every row (even if its target index is unchanged)
    // to keep the outcome deterministic and easy to test.
    for (const { id, orderIndex } of plan) {
      const { error } = await context.supabase
        .from("pl_scheduled_workouts")
        .update({ order_index: orderIndex })
        .eq("id", id)
        .eq("client_id", data.clientId)
        .eq("scheduled_date", data.date);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const, normalizedCount: plan.length };
  });

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE TIME — clear or set optional scheduled_time.
// ─────────────────────────────────────────────────────────────────────────────
export const updateScheduledWorkoutTime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { instanceId: string; time: string | null }) =>
    z
      .object({
        instanceId: z.string().uuid(),
        time: z
          .string()
          .regex(/^\d{2}:\d{2}(:\d{2})?$/)
          .nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: instance } = await context.supabase
      .from("pl_scheduled_workouts")
      .select("id, client_id")
      .eq("id", data.instanceId)
      .maybeSingle();
    if (!instance) throw new Error("Scheduled workout not found.");
    // Re-timing is also calendar placement. Authorization is still checked,
    // while every authenticated client may modify their own scheduled time.
    await resolveActor(context, instance.client_id);

    // Scheduled time is calendar placement only — completed instances may
    // have their time changed; completed_at and logged sets stay untouched.

    const { error } = await context.supabase
      .from("pl_scheduled_workouts")
      .update({ scheduled_time: data.time })
      .eq("id", data.instanceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─────────────────────────────────────────────────────────────────────────────
// COPY — coach/admin (or full_program client) duplicates one instance to a new date.
// ─────────────────────────────────────────────────────────────────────────────
export const copyScheduledWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { instanceId: string; newDate: string }) =>
    z
      .object({ instanceId: z.string().uuid(), newDate: isoDate })
      .parse(d),
  )
  .handler(async () => {
    // Disabled until pl_day_completions is instance-scoped. A copy creates a
    // second scheduled instance of the same source_day_id, which today would
    // share completion state with the original — completing one would mark
    // both done. See Phase 2 spec: "either make completions instance-specific
    // now, or disable duplicate scheduling/copying until that part is safe".
    throw new Error(
      "Copy Workout is temporarily disabled while we finish per-instance completion tracking. Use Move, or schedule a different workout on that date.",
    );
  });

// ─────────────────────────────────────────────────────────────────────────────
// PROGRAM PICKER — list the client's assigned programs, blocks, and days so
// the scheduling UI can show them ordered: current active block first, then
// other blocks in the active program, then other programs, then archived
// (admin/coach only).
// ─────────────────────────────────────────────────────────────────────────────
export const getSchedulableWorkouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; includeArchived?: boolean }) =>
    z
      .object({
        clientId: z.string().uuid(),
        includeArchived: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { actor } = await resolveActor(context, data.clientId);
    const showArchived = data.includeArchived && actor !== "client";

    let blocksQ = context.supabase
      .from("pl_blocks")
      .select("id, name, status, start_date, end_date, archived_at, source_template_block_key")
      .eq("client_id", data.clientId);
    if (!showArchived) blocksQ = blocksQ.is("archived_at", null);
    const { data: blocks, error: bErr } = await blocksQ;
    if (bErr) throw new Error(bErr.message);

    const primaryBlocks = (blocks ?? []).filter(isPrimaryProgramBlock);
    const blockIds = primaryBlocks.map((b: any) => b.id);
    if (!blockIds.length) return { blocks: [] };

    const { data: weeks } = await context.supabase
      .from("pl_weeks")
      .select("id, block_id, week_index")
      .in("block_id", blockIds);

    const weekIds = (weeks ?? []).map((w: any) => w.id);
    const { data: days } = weekIds.length
      ? await context.supabase
          .from("pl_days")
          .select(
            "id, week_id, day_index, title, focus, duration_estimate_min, archived",
          )
          .in("week_id", weekIds)
          .is("archived", false)
      : { data: [] as any[] };

    const weekById = new Map(
      (weeks ?? []).map((w: any) => [w.id, w] as const),
    );
    const daysByBlock = new Map<string, any[]>();
    for (const d of days ?? []) {
      const w = weekById.get(d.week_id);
      if (!w) continue;
      const arr = daysByBlock.get(w.block_id) ?? [];
      arr.push({ ...d, week_index: w.week_index });
      daysByBlock.set(w.block_id, arr);
    }

    const enriched = primaryBlocks.map((b: any) => ({
      id: b.id,
      name: b.name,
      program_name: b.name,
      status: b.status,
      start_date: b.start_date,
      end_date: b.end_date,
      archived: !!b.archived_at,
      days: (daysByBlock.get(b.id) ?? []).sort((a, b) =>
        a.week_index === b.week_index
          ? a.day_index - b.day_index
          : a.week_index - b.week_index,
      ),
    }));

    // Sort: active first, then non-archived by start_date desc, then archived last.
    enriched.sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
      return (b.start_date ?? "").localeCompare(a.start_date ?? "");
    });

    return { blocks: enriched };
  });

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSION — update per-client workout_scheduling_permission (admin/coach).
// ─────────────────────────────────────────────────────────────────────────────
export const setClientSchedulingPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      clientId: string;
      permission: "off" | "move" | "add_current_block" | "full_program";
    }) =>
      z
        .object({
          clientId: z.string().uuid(),
          permission: z.enum([
            "off",
            "move",
            "add_current_block",
            "full_program",
          ]),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { actor } = await resolveActor(context, data.clientId);
    if (actor === "client") throw new Error("Not allowed.");
    const { error } = await context.supabase
      .from("clients")
      .update({ workout_scheduling_permission: data.permission })
      .eq("id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Editor → schedule write path (canonical fix for editor/calendar desync).
 *
 * The program editor's Training Date field must write to the SAME source of
 * truth the calendar reads: `pl_scheduled_workouts` instances. This function:
 *  - Refuses to move/clear COMPLETED days (history is immutable).
 *  - When the day has instance(s): updates the earliest instance's date (or
 *    deletes incomplete instances when clearing) AND mirrors
 *    `pl_days.scheduled_date` so the legacy fallback can never drift again.
 *  - When the day has no instance: updates only `pl_days.scheduled_date`
 *    (legacy fallback path — the calendar picks it up as before).
 */
export const syncProgramDaySchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { clientId: string; dayId: string; newDate: string | null }) =>
      z
        .object({
          clientId: z.string().uuid(),
          dayId: z.string().uuid(),
          newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { actor } = await resolveActor(context, data.clientId);
    if (actor === "client") throw new Error("Not allowed.");

    // Completed days are movable: only scheduled placement is written here.
    const [{ data: dayInstances }] = await Promise.all([
      context.supabase
        .from("pl_scheduled_workouts")
        .select("id, scheduled_date")
        .eq("client_id", data.clientId)
        .eq("source_day_id", data.dayId)
        .order("scheduled_date", { ascending: true }),
    ]);
    const instances = (dayInstances ?? []) as Array<{ id: string; scheduled_date: string }>;

    if (instances.length > 0) {
      const ids = instances.map((i) => i.id);
      if (data.newDate) {
        // Move the earliest (primary) instance; leave repeat sessions alone.
        const { error } = await context.supabase
          .from("pl_scheduled_workouts")
          .update({ scheduled_date: data.newDate })
          .eq("id", instances[0].id);
        if (error) throw new Error(error.message);
      } else {
        // Clearing the date removes only INCOMPLETE instances so the day
        // disappears from the calendar without destroying logged history.
        const { data: doneRows } = await context.supabase
          .from("pl_day_completions")
          .select("scheduled_workout_id")
          .in("scheduled_workout_id", ids)
          .not("completed_at", "is", null);
        const done = new Set((doneRows ?? []).map((r: any) => r.scheduled_workout_id));
        const removable = ids.filter((id) => !done.has(id));
        if (removable.length > 0) {
          const { error } = await context.supabase
            .from("pl_scheduled_workouts")
            .delete()
            .in("id", removable);
          if (error) throw new Error(error.message);
        }
      }
      // Mirror the legacy field so every surface agrees.
      await context.supabase
        .from("pl_days")
        .update({ scheduled_date: data.newDate, schedule_source: "manual" })
        .eq("id", data.dayId);
      return { ok: true as const, mode: "instance" as const, date: data.newDate };
    }

    // Legacy fallback path: no instance exists, so pl_days is the source.
    const { error } = await context.supabase
      .from("pl_days")
      .update({ scheduled_date: data.newDate, schedule_source: "manual" })
      .eq("id", data.dayId);
    if (error) throw new Error(error.message);
    return { ok: true as const, mode: "legacy" as const, date: data.newDate };
  });

/**
 * One-click "Fix" for a Calendar Issue badge: aligns the legacy
 * `pl_days.scheduled_date` mirror to the canonical instance date. Never
 * creates duplicates and never rewrites history.
 */
export const reconcileDayScheduleMirror = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; dayId: string }) =>
    z
      .object({ clientId: z.string().uuid(), dayId: z.string().uuid() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { actor } = await resolveActor(context, data.clientId);
    if (actor === "client") throw new Error("Not allowed.");

    const { data: instances } = await context.supabase
      .from("pl_scheduled_workouts")
      .select("id, scheduled_date")
      .eq("client_id", data.clientId)
      .eq("source_day_id", data.dayId)
      .order("scheduled_date", { ascending: true })
      .limit(1);
    const primary = (instances ?? [])[0] as { id: string; scheduled_date: string } | undefined;
    if (!primary) {
      return { ok: false as const, reason: "no-instance" as const };
    }
    const { error } = await context.supabase
      .from("pl_days")
      .update({ scheduled_date: primary.scheduled_date })
      .eq("id", data.dayId);
    if (error) throw new Error(error.message);
    return { ok: true as const, date: primary.scheduled_date };
  });