import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";
import { addDays, format, parseISO } from "date-fns";

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
    .select("id, user_id, schedule_locked, assigned_coach_id, full_name")
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

    const { data: blocks } = await supabase
      .from("pl_blocks")
      .select("id, name, start_date, end_date, status, client_visible")
      .eq("client_id", data.clientId)
      .neq("status", "Archived")
      .order("created_at", { ascending: true });
    const blockIds = (blocks ?? []).map((b: any) => b.id);
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
// the client's currently committed training days. Skips:
//   • workouts already in the past
//   • workouts with schedule_locked = true (coach-locked)
//   • workouts with schedule_source = 'manual' (manually moved by anyone)
//   • workouts that have a completion row (started, in-progress, or completed)
// Preserved workouts consume their weekday from the pool, so movable
// workouts in the same week land on the remaining committed days in order.
// ───────────────────────────────────────────────────────────────────────────

export const rescheduleFromCommittedDays = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ clientId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { role } = await resolveActorAccess(
      { supabase, userId }, data.clientId,
    );

    const { data: clientRow } = await supabase
      .from("clients")
      .select("committed_training_days")
      .eq("id", data.clientId)
      .maybeSingle();
    const committed: WeekDay[] = WEEK_DAYS.filter((d) =>
      ((clientRow?.committed_training_days as string[] | null) ?? []).includes(d),
    );
    if (committed.length === 0) {
      return { ok: true as const, applied: 0, batchId: null, noop: true };
    }

    const { data: blocks } = await supabase
      .from("pl_blocks")
      .select("id, start_date, week_duration_days, status")
      .eq("client_id", data.clientId)
      .neq("status", "Archived");
    const blockList = (blocks ?? []).filter((b: any) => b.start_date);
    if (blockList.length === 0) {
      return { ok: true as const, applied: 0, batchId: null, noop: true };
    }

    const blockIds = blockList.map((b: any) => b.id);
    const { data: weeks } = await supabase
      .from("pl_weeks")
      .select("id, week_index, block_id")
      .in("block_id", blockIds)
      .order("week_index");
    const weekList = weeks ?? [];
    const weekIds = weekList.map((w: any) => w.id);
    if (weekIds.length === 0) {
      return { ok: true as const, applied: 0, batchId: null, noop: true };
    }
    const { data: days } = await supabase
      .from("pl_days")
      .select("id, day_index, week_id, scheduled_date, schedule_source, schedule_locked, archived")
      .in("week_id", weekIds)
      .eq("archived", false)
      .order("day_index");
    const dayList = days ?? [];
    const dayIds = dayList.map((d: any) => d.id);
    const { data: completions } = dayIds.length
      ? await supabase
          .from("pl_day_completions")
          .select("day_id, completed_at, in_progress_at, started_at")
          .in("day_id", dayIds)
      : { data: [] as any[] };
    const touchedDayIds = new Set<string>();
    for (const c of (completions ?? []) as any[]) {
      if (c.completed_at || c.in_progress_at || c.started_at) touchedDayIds.add(c.day_id);
    }

    const todayISO = format(new Date(), "yyyy-MM-dd");

    const daysByWeek = new Map<string, any[]>();
    for (const d of dayList) {
      const list = daysByWeek.get(d.week_id) ?? [];
      list.push(d);
      daysByWeek.set(d.week_id, list);
    }

    const moves: Array<{
      dayId: string;
      prev: string | null;
      next: string;
      prevSource: string | null;
    }> = [];

    for (const block of blockList) {
      const dur = (block as any).week_duration_days ?? 7;
      const startDate = parseISO(block.start_date as string);
      const blockWeeks = weekList
        .filter((w: any) => w.block_id === block.id)
        .sort((a: any, b: any) => a.week_index - b.week_index);

      for (const w of blockWeeks) {
        const weekStart = addDays(startDate, Math.max(0, (w.week_index ?? 1) - 1) * dur);
        const weekEndISO = format(addDays(weekStart, 6), "yyyy-MM-dd");
        if (weekEndISO < todayISO) continue; // past week

        const weekDays = (daysByWeek.get(w.id) ?? [])
          .slice()
          .sort((a: any, b: any) => a.day_index - b.day_index);

        const committedDates = committed.map((wd) =>
          format(addDays(weekStart, (WEEKDAY_INDEX[wd] + 6) % 7), "yyyy-MM-dd"),
        );

        // Classify days as preserved vs movable.
        const consumed = new Set<string>();
        const movable: any[] = [];
        for (const d of weekDays) {
          const isLocked = !!d.schedule_locked;
          const isManual = d.schedule_source === "manual";
          const isTouched = touchedDayIds.has(d.id);
          const isPast = d.scheduled_date && d.scheduled_date < todayISO;
          const preserved = isLocked || isManual || isTouched || isPast;
          if (preserved) {
            if (d.scheduled_date) consumed.add(d.scheduled_date);
          } else {
            movable.push(d);
          }
        }

        const pool = committedDates.filter(
          (dt) => !consumed.has(dt) && dt >= todayISO,
        );
        let cursor = 0;
        for (const d of movable) {
          if (cursor >= pool.length) break;
          const next = pool[cursor++];
          if (d.scheduled_date === next) continue;
          moves.push({
            dayId: d.id,
            prev: d.scheduled_date ?? null,
            next,
            prevSource: d.schedule_source ?? null,
          });
        }
      }
    }

    if (moves.length === 0) {
      return { ok: true as const, applied: 0, batchId: null, noop: true };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const batchId = crypto.randomUUID();

    // Slice 2d: any day that has a pl_scheduled_workouts instance for this
    // client is instance-canonical. We update the instance's scheduled_date
    // (schedule_source: "auto") and MUST NOT touch pl_days.scheduled_date —
    // that would desync the visible calendar from the underlying data.
    // Days without an instance stay on the legacy pl_days fallback so
    // brand-new blocks that predate any instance backfill still realign.
    const { data: instRows } = await supabaseAdmin
      .from("pl_scheduled_workouts")
      .select("id, source_day_id, scheduled_date")
      .eq("client_id", data.clientId)
      .in("source_day_id", moves.map((m) => m.dayId));
    const instanceByDayId = new Map<string, { id: string; scheduled_date: string }>();
    for (const r of instRows ?? []) {
      // Duplicate scheduling is guarded elsewhere, so at most one instance
      // per source_day at Slice 2d. If multiple ever exist we take the
      // earliest — the realign write still ends up correct after the guard
      // is removed because the caller supplies one target date per day.
      const prev = instanceByDayId.get((r as any).source_day_id);
      if (!prev || (r as any).scheduled_date < prev.scheduled_date) {
        instanceByDayId.set((r as any).source_day_id, {
          id: (r as any).id,
          scheduled_date: (r as any).scheduled_date,
        });
      }
    }

    type AppliedRow = (typeof moves)[number] & {
      target: "instance" | "day";
      instanceId?: string;
    };
    const applied: AppliedRow[] = [];
    try {
      for (const m of moves) {
        const inst = instanceByDayId.get(m.dayId);
        if (inst) {
          const { error } = await supabaseAdmin
            .from("pl_scheduled_workouts")
            .update({ scheduled_date: m.next, schedule_source: "auto" })
            .eq("id", inst.id);
          if (error) throw new Error(error.message);
          applied.push({ ...m, target: "instance", instanceId: inst.id, prev: inst.scheduled_date });
        } else {
          const { error } = await supabaseAdmin
            .from("pl_days")
            .update({ scheduled_date: m.next, schedule_source: "auto" })
            .eq("id", m.dayId);
          if (error) throw new Error(error.message);
          applied.push({ ...m, target: "day" });
        }
      }
    } catch (err) {
      for (const a of applied) {
        if (a.target === "instance" && a.instanceId) {
          await supabaseAdmin
            .from("pl_scheduled_workouts")
            .update({ scheduled_date: a.prev ?? undefined, schedule_source: "auto" })
            .eq("id", a.instanceId);
        } else {
          await supabaseAdmin
            .from("pl_days")
            .update({ scheduled_date: a.prev, schedule_source: a.prevSource ?? "auto" })
            .eq("id", a.dayId);
        }
      }
      throw err;
    }

    await supabaseAdmin.from("pl_schedule_audit").insert(
      applied.map((a) => ({
        batch_id: batchId,
        day_id: a.dayId,
        client_id: data.clientId,
        previous_date: a.prev,
        new_date: a.next,
        previous_source: a.prevSource,
        new_source: "auto",
        scope: "committed-schedule-change",
        changed_by: userId,
        changed_by_role: role,
        note: "Auto-realigned after committed training days change.",
      })),
    );

    return { ok: true as const, applied: applied.length, batchId };
  });
