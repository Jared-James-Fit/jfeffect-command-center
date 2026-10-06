import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";
import { filterPrimaryProgramBlocks } from "@/lib/at-home-backup";
import { parseISO } from "date-fns";
import { goalsScheduleFromCommitted } from "@/lib/client-goals/schema";
import {
  normalizeCommittedDays,
  planCommittedRealign,
  todayInTimeZone,
  type RealignRole,
} from "@/lib/committed-schedule-realign";

// ───────────────────────────────────────────────────────────────────────────
// Phase 3-5 server fns: bulk reschedules, coach overrides, schedule lock.
// All writes target pl_days.scheduled_date / .schedule_source only — program
// structure & logs stay intact. Every batch shares a batch_id so undo works.
// ───────────────────────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const WEEKDAY_INDEX: Record<WeekDay, number> = {
  Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4,
  Friday: 5, Saturday: 6, Sunday: 0,
};

function weekdayFromDate(dateISO: string): WeekDay | null {
  const dow = parseISO(dateISO).getDay();
  return (WEEK_DAYS.find((wd) => WEEKDAY_INDEX[wd] === dow) ?? null) as WeekDay | null;
}

type Role = "client" | "member" | "coach" | "admin";

async function resolveActorAccess(
  ctx: { supabase: any; userId: string },
  clientId: string,
): Promise<{ role: Role; client: any }> {
  const { supabase, userId } = ctx;
  const { data: client } = await supabase
    .from("clients")
    .select("id, user_id, schedule_locked, assigned_coach_id, full_name, timezone")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) throw new Error("Client not found.");

  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId, _role: "admin",
  });
  if (isAdmin === true) return { role: "admin", client };
  if (client.assigned_coach_id) {
    const { data: coach } = await supabase
      .from("coaches")
      .select("id, user_id")
      .eq("id", client.assigned_coach_id)
      .maybeSingle();
    if (coach?.user_id && coach.user_id === userId) return { role: "coach", client };
  }
  if (client.user_id === userId) {
    if (client.schedule_locked) {
      throw new Error("Schedule editing is locked for this account.");
    }
    return { role: "client", client };
  }
  throw new Error("You don't have permission to change this schedule.");
}

// ───────────────────────────────────────────────────────────────────────────
// getClientSchedule — calendar feed for one client.
// ───────────────────────────────────────────────────────────────────────────

export const getClientSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ clientId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { client } = await resolveActorAccess(
      { supabase, userId }, data.clientId,
    );

    const { data: allBlocks } = await supabase
      .from("pl_blocks")
      .select("id, name, start_date, end_date, status, client_visible, source_template_block_key")
      .eq("client_id", data.clientId)
      .neq("status", "Archived")
      .order("created_at", { ascending: true });
    // Schedule Manager is a primary-program surface: reserved At-Home Backup
    // blocks (definitions + sessions) are excluded entirely.
    const blocks = filterPrimaryProgramBlocks(allBlocks ?? []);
    const blockIds = blocks.map((b: any) => b.id);
    if (!blockIds.length) {
      return { client, blocks: [], weeks: [], days: [], completions: [] };
    }
    const { data: weeks } = await supabase
      .from("pl_weeks").select("id, week_index, block_id, training_days, start_date, end_date")
      .in("block_id", blockIds).order("week_index");
    const weekIds = (weeks ?? []).map((w: any) => w.id);
    const { data: days } = weekIds.length
      ? await supabase
          .from("pl_days")
          .select("id, day_index, title, focus, scheduled_date, schedule_source, schedule_locked, week_id, archived")
          .in("week_id", weekIds)
          .eq("archived", false)
          .order("day_index")
      : { data: [] };
    const dayIds = (days ?? []).map((d: any) => d.id);
    const [completionsRes, scheduledInstancesRes] = dayIds.length
      ? await Promise.all([
          supabase
            .from("pl_day_completions")
            .select("id, day_id, completed_at, in_progress_at, started_at, scheduled_workout_id")
            .in("day_id", dayIds),
          // Phase 2a: canonical instance list scoped to the target client.
          (supabase.from("pl_scheduled_workouts") as any)
            .select("id, client_id, source_day_id, scheduled_date, scheduled_time, order_index, schedule_source, note, created_at")
            .eq("client_id", data.clientId)
            .in("source_day_id", dayIds),
        ])
      : [{ data: [] }, { data: [] }];
    const { data: completions } = completionsRes;
    const { data: scheduledInstances } = scheduledInstancesRes;
    return {
      client,
      blocks: blocks ?? [],
      weeks: weeks ?? [],
      days: days ?? [],
      completions: completions ?? [],
      scheduledInstances: scheduledInstances ?? [],
    };
  });

// ───────────────────────────────────────────────────────────────────────────
// applyBulkScheduleChange — explicit list of {dayId, newDate}.
// ───────────────────────────────────────────────────────────────────────────

const moveSchema = z.object({
  dayId: z.string().uuid(),
  newDate: isoDate,
});

export const applyBulkScheduleChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      moves: z.array(moveSchema).min(1).max(500),
      scope: z.enum([
        "single","week","pattern","block","program","custom","shift-following",
      ]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const dayIds = data.moves.map((m) => m.dayId);
    const { data: dayRows, error: dayErr } = await supabase
      .from("pl_days")
      .select("id, scheduled_date, schedule_source, schedule_locked, week_id")
      .in("id", dayIds);
    if (dayErr || !dayRows?.length) throw new Error("Workouts not found.");

    const weekIds = Array.from(new Set(dayRows.map((d: any) => d.week_id)));
    const { data: weekRows } = await supabase
      .from("pl_weeks").select("id, block_id").in("id", weekIds);
    const blockIds = Array.from(new Set((weekRows ?? []).map((w: any) => w.block_id)));
    const { data: blockRows } = await supabase
      .from("pl_blocks").select("id, client_id").in("id", blockIds);
    const clientIds = Array.from(new Set((blockRows ?? []).map((b: any) => b.client_id)));
    if (clientIds.length !== 1) {
      throw new Error("Cannot move workouts across multiple clients in one batch.");
    }
    const clientId = clientIds[0];
    const { role } = await resolveActorAccess({ supabase, userId }, clientId);

    if (role !== "coach" && role !== "admin") {
      const locked = dayRows.find((d: any) => d.schedule_locked);
      if (locked) throw new Error("One of these workouts is date-locked by your coach.");
    }

    // Slice 2d: reject the entire batch if any day is instance-backed.
    // Bulk moves write pl_days.scheduled_date; when an instance exists the
    // calendar reads from pl_scheduled_workouts (Slice 2a) and the write
    // would silently desync. Callers must migrate to instance-scoped
    // moves or route through the calendar.
    const { data: batchInstances } = await supabase
      .from("pl_scheduled_workouts")
      .select("source_day_id")
      .eq("client_id", clientId)
      .in("source_day_id", dayIds);
    if ((batchInstances ?? []).length > 0) {
      throw new Error(
        "One or more of these workouts uses the new scheduling system. Move them from the workout calendar instead.",
      );
    }

    // Completed workouts may be re-placed on the calendar: this path only
    // writes pl_days.scheduled_date. Completion rows and logged sets are
    // never modified, so history and analytics stay on the real dates.

    const dayById = new Map<string, any>(dayRows.map((d: any) => [d.id, d]));
    const batchId = crypto.randomUUID();
    const applied: Array<{ dayId: string; prev: string | null; next: string; prevSource: string | null }> = [];

    // pl_days RLS grants UPDATE to admins/assigned coaches only — clients
    // have SELECT. resolveActorAccess() above is the authorization
    // boundary that permits clients to move their own scheduled dates.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    try {
      for (const m of data.moves) {
        const d: any = dayById.get(m.dayId);
        if (!d) continue;
        if (d.scheduled_date === m.newDate) continue;
        const { error } = await supabaseAdmin
          .from("pl_days")
          .update({ scheduled_date: m.newDate, schedule_source: "manual" })
          .eq("id", m.dayId);
        if (error) throw new Error(`Could not update workout: ${error.message}`);
        applied.push({
          dayId: m.dayId,
          prev: d.scheduled_date ?? null,
          next: m.newDate,
          prevSource: d.schedule_source ?? null,
        });
      }
    } catch (err: any) {
      for (const a of applied) {
        await supabaseAdmin
          .from("pl_days")
          .update({ scheduled_date: a.prev, schedule_source: a.prevSource ?? "auto" })
          .eq("id", a.dayId);
      }
      throw err;
    }

    if (applied.length === 0) {
      return { ok: true as const, applied: 0, batchId: null, noop: true };
    }

    const auditRows = applied.map((a) => ({
      batch_id: batchId,
      day_id: a.dayId,
      client_id: clientId,
      previous_date: a.prev,
      new_date: a.next,
      previous_source: a.prevSource,
      new_source: "manual",
      scope: data.scope,
      changed_by: userId,
      changed_by_role: role,
    }));
    const { error: auditErr } = await supabaseAdmin
      .from("pl_schedule_audit").insert(auditRows);
    if (auditErr) {
      for (const a of applied) {
        await supabaseAdmin
          .from("pl_days")
          .update({ scheduled_date: a.prev, schedule_source: a.prevSource ?? "auto" })
          .eq("id", a.dayId);
      }
      throw new Error(`Could not record change history: ${auditErr.message}`);
    }

    return { ok: true as const, applied: applied.length, batchId };
  });

// ───────────────────────────────────────────────────────────────────────────
// coachOverrideCompletedMove — rewrite completed workout's date.
// ───────────────────────────────────────────────────────────────────────────

export const coachOverrideCompletedMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      dayId: z.string().uuid(),
      newDate: isoDate,
      updateCompletedAt: z.boolean().optional(),
      acknowledge: z.literal(true),
    }).parse(i),
  )
  .handler(async () => {
    // Slice 2d: completed workouts are permanently immutable. Rewriting
    // scheduled_date or completed_at on a completed row corrupts historical
    // reporting and desyncs from logged sets. The only supported flow is
    // to schedule a new future copy of the source day instead of moving
    // the completed original.
    throw new Error(
      "Overriding a completed workout is disabled. Schedule a new copy on the new date instead — the original completion stays as historical record.",
    );
  });

// ───────────────────────────────────────────────────────────────────────────
// setScheduleLock — coach/admin toggles a client's schedule lock.
// ───────────────────────────────────────────────────────────────────────────

export const setScheduleLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ clientId: z.string().uuid(), locked: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { role } = await resolveActorAccess(
      { supabase, userId }, data.clientId,
    );
    if (role !== "coach" && role !== "admin") {
      throw new Error("Only a coach or admin can change the schedule lock.");
    }
    const { error } = await supabase
      .from("clients").update({ schedule_locked: data.locked }).eq("id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true as const, locked: data.locked };
  });

// ───────────────────────────────────────────────────────────────────────────
// rescheduleFromCommittedDays — realign future auto-scheduled workouts onto
// the client's currently committed training days. Canonical instance dates
// win over legacy pl_days dates. Always preserves:
//   • workouts already in the past
//   • workouts that have a completion row (started, in-progress, or completed)
// Coach-locked dates remain protected from client overrides. Manual future
// placements may be explicitly realigned when includePinned=true.
// Preserved workouts consume their ordinal committed-day slot so completed
// history never shifts the remaining workout order within a week.
// ───────────────────────────────────────────────────────────────────────────

export type RealignResult = {
  ok: true;
  applied: number;
  batchId: string | null;
  noop?: boolean;
  pendingPinned: number;
  unplaced: number;
};

/**
 * Shared engine. Callers MUST have authorized the actor first
 * (resolveActorAccess). Reads use the service role on purpose: a client's own
 * RLS view hides unpublished/Draft blocks, which would otherwise never be
 * re-dated when the client changes their schedule.
 */
export async function realignClientToCommittedDays(args: {
  clientId: string;
  userId: string;
  role: Role;
  includePinned: boolean;
}): Promise<RealignResult> {
  const { clientId, userId, role, includePinned } = args;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const empty: RealignResult = { ok: true, applied: 0, batchId: null, noop: true, pendingPinned: 0, unplaced: 0 };

  const { data: clientRow } = await supabaseAdmin
    .from("clients")
    .select("committed_training_days, timezone")
    .eq("id", clientId)
    .maybeSingle();
  const committed = normalizeCommittedDays(clientRow?.committed_training_days as string[] | null);
  if (committed.length === 0) return empty;

  const { data: blocks } = await supabaseAdmin
    .from("pl_blocks")
    .select("id, start_date, week_duration_days, status, archived, source_template_block_key")
    .eq("client_id", clientId)
    .neq("status", "Archived");
  // Primary program blocks only (reserved At-Home Backup blocks are excluded),
  // including Draft / hidden blocks that haven't started yet.
  const blockList = filterPrimaryProgramBlocks(
    (blocks ?? []).filter((b: any) => b.start_date && !b.archived),
  );
  if (blockList.length === 0) return empty;

  const blockIds = blockList.map((b: any) => b.id);
  const { data: weeks } = await supabaseAdmin
    .from("pl_weeks")
    .select("id, week_index, block_id")
    .in("block_id", blockIds)
    .is("deleted_at", null)
    .order("week_index");
  const weekList = weeks ?? [];
  const weekIds = weekList.map((w: any) => w.id);
  if (weekIds.length === 0) return empty;
  const { data: days } = await supabaseAdmin
    .from("pl_days")
    .select("id, day_index, week_id, scheduled_date, schedule_source, schedule_locked, archived")
    .in("week_id", weekIds)
    .eq("archived", false)
    .is("deleted_at", null)
    .order("day_index");
  const dayList = days ?? [];
  const dayIds = dayList.map((d: any) => d.id);
  const [completionsRes, instancesRes] = dayIds.length
    ? await Promise.all([
        supabaseAdmin
          .from("pl_day_completions")
          .select("day_id, completed_at, in_progress_at, started_at")
          .in("day_id", dayIds),
        // Canonical placement is the scheduled-workout instance whenever one
        // exists; loaded BEFORE planning so a stale pl_days date can't hide a
        // stale instance.
        supabaseAdmin
          .from("pl_scheduled_workouts")
          .select("id, source_day_id, scheduled_date, schedule_source")
          .eq("client_id", clientId)
          .in("source_day_id", dayIds),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }];

  const touchedDayIds = new Set<string>();
  for (const c of (completionsRes.data ?? []) as any[]) {
    if (c.completed_at || c.in_progress_at || c.started_at) touchedDayIds.add(c.day_id);
  }
  const instances = (instancesRes.data ?? []) as any[];
  const instanceByDayId = new Map<string, any>();
  for (const r of instances) {
    const prev = instanceByDayId.get(r.source_day_id);
    if (!prev || r.scheduled_date < prev.scheduled_date) instanceByDayId.set(r.source_day_id, r);
  }
  const dayById = new Map<string, any>(dayList.map((d: any) => [d.id, d]));

  const plan = planCommittedRealign({
    committed,
    blocks: blockList as any[],
    weeks: weekList as any[],
    days: dayList as any[],
    instances,
    touchedDayIds,
    // "Today" in the client's own timezone, not the server's.
    todayISO: todayInTimeZone(clientRow?.timezone as string | null),
    role: role as RealignRole,
    includePinned,
  });
  const { moves, pendingPinned, unplaced } = plan;
  if (moves.length === 0) {
    return { ok: true, applied: 0, batchId: null, noop: true, pendingPinned, unplaced };
  }

  const batchId = crypto.randomUUID();

  // A day with a pl_scheduled_workouts instance is instance-canonical: update
  // the instance with the valid "moved" source AND mirror the new date onto
  // pl_days, so every reader (calendar, week view, cardio placement, Calendar
  // Issue badge) agrees. Legacy-only days update pl_days directly.
  type AppliedRow = (typeof moves)[number] & {
    target: "instance" | "day";
    instanceId?: string;
    prevDay: { scheduled_date: string | null; schedule_source: string | null; schedule_locked: boolean | null };
  };
  const applyOne = async (m: (typeof moves)[number]): Promise<AppliedRow> => {
    const d = dayById.get(m.dayId);
    const prevDay = {
      scheduled_date: d?.scheduled_date ?? null,
      schedule_source: d?.schedule_source ?? null,
      schedule_locked: d?.schedule_locked ?? null,
    };
    const inst = instanceByDayId.get(m.dayId);
    if (inst) {
      const { error } = await supabaseAdmin
        .from("pl_scheduled_workouts")
        .update({ scheduled_date: m.next, schedule_source: "moved" })
        .eq("id", inst.id);
      if (error) throw new Error(error.message);
      const { error: mirrorErr } = await supabaseAdmin
        .from("pl_days")
        .update({ scheduled_date: m.next, schedule_source: "auto", schedule_locked: false })
        .eq("id", m.dayId);
      if (mirrorErr) {
        await supabaseAdmin
          .from("pl_scheduled_workouts")
          .update({ scheduled_date: inst.scheduled_date, schedule_source: inst.schedule_source ?? "manual" })
          .eq("id", inst.id);
        throw new Error(mirrorErr.message);
      }
      return { ...m, target: "instance", instanceId: inst.id, prev: inst.scheduled_date, prevDay };
    }
    const { error } = await supabaseAdmin
      .from("pl_days")
      // A realigned workout is back under automatic scheduling, so the
      // pin is released — otherwise the next change would skip it again.
      .update({ scheduled_date: m.next, schedule_source: "auto", schedule_locked: false })
      .eq("id", m.dayId);
    if (error) throw new Error(error.message);
    return { ...m, target: "day", prevDay };
  };

  const applied: AppliedRow[] = [];
  const BATCH = 8;
  let failure: Error | null = null;
  for (let i = 0; i < moves.length && !failure; i += BATCH) {
    const results = await Promise.allSettled(moves.slice(i, i + BATCH).map(applyOne));
    for (const r of results) {
      if (r.status === "fulfilled") applied.push(r.value);
      else failure = failure ?? (r.reason instanceof Error ? r.reason : new Error(String(r.reason)));
    }
  }
  if (failure) {
    // All-or-nothing: put every already-applied workout back.
    for (const a of applied) {
      if (a.target === "instance" && a.instanceId) {
        await supabaseAdmin
          .from("pl_scheduled_workouts")
          .update({ scheduled_date: a.prev ?? undefined, schedule_source: a.prevSource ?? "manual" })
          .eq("id", a.instanceId);
      }
      await supabaseAdmin
        .from("pl_days")
        .update({
          scheduled_date: a.prevDay.scheduled_date,
          schedule_source: a.prevDay.schedule_source ?? "auto",
          schedule_locked: a.prevDay.schedule_locked ?? a.wasPinned,
        })
        .eq("id", a.dayId);
    }
    throw failure;
  }

  const { error: auditErr } = await supabaseAdmin.from("pl_schedule_audit").insert(
    applied.map((a) => ({
      batch_id: batchId,
      day_id: a.dayId,
      client_id: clientId,
      previous_date: a.prev,
      new_date: a.next,
      previous_source: a.prevSource,
      new_source: a.target === "instance" ? "moved" : "auto",
      scope: "pattern",
      changed_by: userId,
      changed_by_role: role,
      note: "Auto-realigned after committed training days change.",
    })),
  );
  if (auditErr) console.error("[realign] audit insert failed", auditErr.message);

  return { ok: true, applied: applied.length, batchId, pendingPinned, unplaced };
}

export const rescheduleFromCommittedDays = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        // When true, upcoming MANUAL placements are realigned onto the new
        // committed days. Started/completed and past workouts are never moved.
        // Coach-locked days remain protected for clients; only coach/admin can
        // override those locks.
        includePinned: z.boolean().optional().default(false),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { role } = await resolveActorAccess({ supabase, userId }, data.clientId);
    return realignClientToCommittedDays({
      clientId: data.clientId, userId, role, includePinned: data.includePinned,
    });
  });

// ───────────────────────────────────────────────────────────────────────────
// saveCommittedSchedule — ONE call that saves the committed training days and
// re-dates every future, unstarted workout (all blocks, including Draft ones)
// onto them. Replaces the old two-step "client updates row, then calls a
// separate realign" flow, which could leave the calendar stale if the app was
// closed or the network dropped between the steps. The save is durable first;
// if only the realign fails the response says so and the same call can be
// retried (the engine is idempotent).
// ───────────────────────────────────────────────────────────────────────────

export const saveCommittedSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        frequency: z.number().int().min(1).max(7),
        days: z.array(z.string()).min(1).max(7),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { role } = await resolveActorAccess({ supabase, userId }, data.clientId);

    const days = normalizeCommittedDays(data.days);
    if (days.length !== data.days.length || days.length !== data.frequency) {
      throw new Error(`Select exactly ${data.frequency} valid training day${data.frequency === 1 ? "" : "s"}.`);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: saveErr } = await supabaseAdmin
      .from("clients")
      .update({
        committed_training_frequency: data.frequency,
        committed_training_days: days,
        training_schedule_completed: true,
        training_schedule_last_updated: new Date().toISOString(),
        training_schedule_updated_by: userId,
      })
      .eq("id", data.clientId);
    if (saveErr) throw new Error(saveErr.message);

    await supabaseAdmin.from("client_activity_log").insert({
      client_id: data.clientId,
      actor_user_id: userId,
      actor_role: role,
      action: "training_schedule_updated",
      details: { committed_training_frequency: data.frequency, committed_training_days: days },
    });

    // Keep the Goals & Setup schedule answers equal to these days (the goals summary and
    // program matching read them). Update only: saving Goals copies them in for a new row.
    const goalsSchedule = goalsScheduleFromCommitted({ committed_training_frequency: data.frequency, committed_training_days: days });
    if (goalsSchedule) {
      const { error: goalsErr } = await supabaseAdmin
        .from("client_goals_setup")
        .update(goalsSchedule)
        .eq("client_id", data.clientId);
      if (goalsErr) console.error("[saveCommittedSchedule] goals schedule sync failed", goalsErr.message);
    }

    try {
      // Changing the committed schedule is the explicit instruction to realign
      // every FUTURE, unstarted workout. Coach-locked workouts stay protected
      // for clients; coach/admin saves may override them.
      const res = await realignClientToCommittedDays({
        clientId: data.clientId, userId, role, includePinned: true,
      });
      return { ...res, saved: true as const, realignError: null as string | null };
    } catch (e: any) {
      return {
        ok: true as const, saved: true as const, applied: 0, batchId: null,
        pendingPinned: 0, unplaced: 0,
        realignError: (e?.message as string) || "Could not update your workout calendar.",
      };
    }
  });
