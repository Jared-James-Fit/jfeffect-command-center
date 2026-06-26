import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";
import { addDays, format } from "date-fns";
import { parseLocalDate, todayLocalISO } from "@/lib/today";

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
  const parsed = parseLocalDate(dateISO);
  if (!parsed) return null;
  const dow = parsed.getDay();
  return (WEEK_DAYS.find((wd) => WEEKDAY_INDEX[wd] === dow) ?? null) as WeekDay | null;
}

function committedDatesInWindow(
  weekStart: Date,
  weekDurationDays: number,
  committed: WeekDay[],
): string[] {
  const dates: string[] = [];
  for (let i = 0; i < weekDurationDays; i++) {
    const candidate = addDays(weekStart, i);
    const weekday = (WEEK_DAYS.find((wd) => WEEKDAY_INDEX[wd] === candidate.getDay()) ?? null) as WeekDay | null;
    if (weekday && committed.includes(weekday)) {
      dates.push(format(candidate, "yyyy-MM-dd"));
    }
  }
  return dates;
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
    const { data: completions } = dayIds.length
      ? await supabase
          .from("pl_day_completions")
          .select("id, day_id, completed_at, in_progress_at, started_at")
          .in("day_id", dayIds)
      : { data: [] };
    return {
      client,
      blocks: blocks ?? [],
      weeks: weeks ?? [],
      days: days ?? [],
      completions: completions ?? [],
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
      confirmCompletedMove: z.boolean().optional(),
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

      const { data: completedRows } = await supabase
        .from("pl_day_completions")
        .select("day_id, completed_at").in("day_id", dayIds);
      const anyCompleted = (completedRows ?? []).some((c: any) => c.completed_at);
      if (anyCompleted && !data.confirmCompletedMove) {
        return {
          ok: false as const,
          requiresCompletedConfirmation: true,
          message: "Some workouts are already completed. Confirm to reschedule them — logged sets stay intact.",
        };
      }
    }

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
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: day } = await supabase
      .from("pl_days")
      .select("id, scheduled_date, schedule_source, week_id")
      .eq("id", data.dayId).maybeSingle();
    if (!day) throw new Error("Workout not found.");
    const { data: week } = await supabase
      .from("pl_weeks").select("block_id").eq("id", day.week_id).maybeSingle();
    const { data: block } = await supabase
      .from("pl_blocks").select("client_id").eq("id", week!.block_id).maybeSingle();
    const clientId = block!.client_id;
    const { role } = await resolveActorAccess({ supabase, userId }, clientId);
    if (role !== "coach" && role !== "admin") {
      throw new Error("Only a coach or admin can override a completed workout.");
    }

    const batchId = crypto.randomUUID();
    const { error: upErr } = await supabase
      .from("pl_days")
      .update({ scheduled_date: data.newDate, schedule_source: "coach" })
      .eq("id", data.dayId);
    if (upErr) throw new Error(upErr.message);

    if (data.updateCompletedAt) {
      await supabase
        .from("pl_day_completions")
        .update({ completed_at: `${data.newDate}T12:00:00Z` })
        .eq("day_id", data.dayId);
    }

    await supabase.from("pl_schedule_audit").insert({
      batch_id: batchId,
      day_id: data.dayId,
      client_id: clientId,
      previous_date: day.scheduled_date,
      new_date: data.newDate,
      previous_source: day.schedule_source ?? null,
      new_source: "coach",
      scope: "completed-override",
      changed_by: userId,
      changed_by_role: role,
      note: data.updateCompletedAt
        ? "Override: scheduled_date + completed_at rewritten."
        : "Override: scheduled_date rewritten; completed_at preserved.",
    });

    return { ok: true as const, batchId };
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

    const todayISO = todayLocalISO();

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
      const startDate = parseLocalDate(block.start_date as string);
      if (!startDate) continue;
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

        const committedDates = committedDatesInWindow(weekStart, dur, committed);

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
    const applied: typeof moves = [];
    try {
      for (const m of moves) {
        const { error } = await supabaseAdmin
          .from("pl_days")
          .update({ scheduled_date: m.next, schedule_source: "auto" })
          .eq("id", m.dayId);
        if (error) throw new Error(error.message);
        applied.push(m);
      }
    } catch (err) {
      for (const a of applied) {
        await supabaseAdmin
          .from("pl_days")
          .update({ scheduled_date: a.prev, schedule_source: a.prevSource ?? "auto" })
          .eq("id", a.dayId);
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
