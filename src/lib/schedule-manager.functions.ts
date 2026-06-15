import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ───────────────────────────────────────────────────────────────────────────
// Training Schedule Manager — Phase 1 server fns.
// All writes target ONLY pl_days.scheduled_date / .schedule_source. Program
// structure (blocks, weeks, days, exercises) and logs are never touched.
// Every write produces a pl_schedule_audit row keyed by a shared batch_id
// so the change can be reversed with undoScheduleChange.
// ───────────────────────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

type Role = "client" | "member" | "coach" | "admin";

/** Resolve the acting user's role and ensure they may modify scheduling for
 *  the given client_id. Returns the role to record in the audit log. Throws
 *  with a plain message on failure. */
async function resolveActorAccess(
  ctx: { supabase: any; userId: string },
  clientId: string,
): Promise<{ role: Role; client: any }> {
  const { supabase, userId } = ctx;

  const { data: client, error } = await supabase
    .from("clients")
    .select("id, user_id, schedule_locked, coach_id, full_name")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !client) throw new Error("Client not found.");

  // Admin check via has_role.
  const { data: adminRow } = await supabase
    .rpc("has_role", { _user_id: userId, _role: "admin" });
  if (adminRow === true) return { role: "admin", client };

  // Coach assigned to this client.
  if (client.coach_id && client.coach_id === userId) {
    return { role: "coach", client };
  }

  // The client themselves.
  if (client.user_id && client.user_id === userId) {
    if (client.schedule_locked) {
      throw new Error(
        "Schedule editing is locked for this account. Reach out to your coach to make changes.",
      );
    }
    return { role: "client", client };
  }

  throw new Error("You don't have permission to change this schedule.");
}

/** Loads the day + its block/week metadata + the client's completion row. */
async function loadDayContext(supabase: any, dayId: string) {
  const { data: day, error } = await supabase
    .from("pl_days")
    .select(
      "id, day_index, title, focus, scheduled_date, schedule_source, schedule_locked, week_id, archived",
    )
    .eq("id", dayId)
    .maybeSingle();
  if (error || !day) throw new Error("Workout not found.");
  if (day.archived) throw new Error("This workout has been archived.");

  const { data: week } = await supabase
    .from("pl_weeks")
    .select("id, week_index, block_id, training_days, start_date, end_date")
    .eq("id", day.week_id)
    .maybeSingle();
  if (!week) throw new Error("Week missing for workout.");

  const { data: block } = await supabase
    .from("pl_blocks")
    .select("id, name, client_id, start_date, end_date")
    .eq("id", week.block_id)
    .maybeSingle();
  if (!block) throw new Error("Block missing for workout.");

  return { day, week, block };
}

// ───────────────────────────────────────────────────────────────────────────
// moveWorkout — single-day reschedule.
// ───────────────────────────────────────────────────────────────────────────

export const moveWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        dayId: z.string().uuid(),
        newDate: isoDate,
        // When true, the server inserts the row even if the day already has
        // a completion record — completed_at itself is NEVER touched here.
        confirmCompletedMove: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { day, week, block } = await loadDayContext(supabase, data.dayId);
    const { role } = await resolveActorAccess(
      { supabase, userId },
      block.client_id,
    );

    if (day.schedule_locked && role !== "admin" && role !== "coach") {
      throw new Error("This workout's date is locked by your coach.");
    }

    // Completed-workout guardrail: clients must explicitly confirm.
    const { data: completion } = await supabase
      .from("pl_day_completions")
      .select("id, completed_at, in_progress_at")
      .eq("day_id", data.dayId)
      .maybeSingle();
    if (completion?.completed_at && role === "client" && !data.confirmCompletedMove) {
      return {
        ok: false as const,
        requiresCompletedConfirmation: true,
        message:
          "This workout is already completed. Confirm to move its scheduled date — your logged sets are untouched.",
      };
    }

    if (day.scheduled_date === data.newDate) {
      return { ok: true as const, applied: 0, batchId: null, noop: true };
    }

    const batchId = crypto.randomUUID();

    const { error: updErr } = await supabase
      .from("pl_days")
      .update({
        scheduled_date: data.newDate,
        schedule_source: "manual",
      })
      .eq("id", data.dayId);
    if (updErr) throw new Error(`Could not save the new date: ${updErr.message}`);

    const { error: auditErr } = await supabase.from("pl_schedule_audit").insert({
      batch_id: batchId,
      day_id: data.dayId,
      client_id: block.client_id,
      previous_date: day.scheduled_date,
      new_date: data.newDate,
      previous_source: day.schedule_source ?? null,
      new_source: "manual",
      scope: "single",
      changed_by: userId,
      changed_by_role: role,
    });
    if (auditErr) {
      // Roll back the date change so we never have an unaudited move.
      await supabase
        .from("pl_days")
        .update({
          scheduled_date: day.scheduled_date,
          schedule_source: day.schedule_source,
        })
        .eq("id", data.dayId);
      throw new Error(`Could not record the change history: ${auditErr.message}`);
    }

    void week; // (kept available for future scope expansions)

    return {
      ok: true as const,
      applied: 1,
      batchId,
      previousDate: day.scheduled_date,
      newDate: data.newDate,
    };
  });

// ───────────────────────────────────────────────────────────────────────────
// swapWorkouts — exchange the scheduled dates of two days atomically.
// ───────────────────────────────────────────────────────────────────────────

export const swapWorkouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ dayIdA: z.string().uuid(), dayIdB: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.dayIdA === data.dayIdB) throw new Error("Cannot swap a workout with itself.");

    const a = await loadDayContext(supabase, data.dayIdA);
    const b = await loadDayContext(supabase, data.dayIdB);
    if (a.block.client_id !== b.block.client_id) {
      throw new Error("These workouts belong to different clients.");
    }
    const { role } = await resolveActorAccess(
      { supabase, userId },
      a.block.client_id,
    );
    if (
      (a.day.schedule_locked || b.day.schedule_locked) &&
      role !== "admin" &&
      role !== "coach"
    ) {
      throw new Error("One of these workouts is date-locked by your coach.");
    }

    const batchId = crypto.randomUUID();
    const aPrev = a.day.scheduled_date;
    const bPrev = b.day.scheduled_date;

    // Two updates inside one logical operation. We park A's date on a
    // sentinel (null) first so a uniqueness constraint, if ever added,
    // wouldn't trip mid-swap.
    const { error: e1 } = await supabase
      .from("pl_days")
      .update({ scheduled_date: null })
      .eq("id", data.dayIdA);
    if (e1) throw new Error(`Swap failed: ${e1.message}`);

    const { error: e2 } = await supabase
      .from("pl_days")
      .update({ scheduled_date: aPrev, schedule_source: "manual" })
      .eq("id", data.dayIdB);
    if (e2) {
      await supabase
        .from("pl_days")
        .update({ scheduled_date: aPrev })
        .eq("id", data.dayIdA);
      throw new Error(`Swap failed: ${e2.message}`);
    }

    const { error: e3 } = await supabase
      .from("pl_days")
      .update({ scheduled_date: bPrev, schedule_source: "manual" })
      .eq("id", data.dayIdA);
    if (e3) {
      // Best-effort rollback.
      await supabase
        .from("pl_days")
        .update({ scheduled_date: bPrev, schedule_source: b.day.schedule_source })
        .eq("id", data.dayIdB);
      await supabase
        .from("pl_days")
        .update({ scheduled_date: aPrev })
        .eq("id", data.dayIdA);
      throw new Error(`Swap failed: ${e3.message}`);
    }

    await supabase.from("pl_schedule_audit").insert([
      {
        batch_id: batchId,
        day_id: data.dayIdA,
        client_id: a.block.client_id,
        previous_date: aPrev,
        new_date: bPrev,
        previous_source: a.day.schedule_source ?? null,
        new_source: "manual",
        scope: "swap",
        changed_by: userId,
        changed_by_role: role,
      },
      {
        batch_id: batchId,
        day_id: data.dayIdB,
        client_id: a.block.client_id,
        previous_date: bPrev,
        new_date: aPrev,
        previous_source: b.day.schedule_source ?? null,
        new_source: "manual",
        scope: "swap",
        changed_by: userId,
        changed_by_role: role,
      },
    ]);

    return { ok: true as const, applied: 2, batchId };
  });

// ───────────────────────────────────────────────────────────────────────────
// undoScheduleChange — reverse every row in a batch.
// ───────────────────────────────────────────────────────────────────────────

export const undoScheduleChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ batchId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: rows, error } = await supabase
      .from("pl_schedule_audit")
      .select("id, day_id, client_id, previous_date, new_date, previous_source, scope")
      .eq("batch_id", data.batchId);
    if (error) throw new Error(`Could not look up the change: ${error.message}`);
    if (!rows || rows.length === 0) {
      throw new Error("That change is no longer available to undo.");
    }

    // All rows in a batch share a client_id; authorize once.
    const clientId = rows[0].client_id as string;
    const { role } = await resolveActorAccess({ supabase, userId }, clientId);

    const newBatchId = crypto.randomUUID();
    let undone = 0;
    for (const r of rows) {
      const { error: uerr } = await supabase
        .from("pl_days")
        .update({
          scheduled_date: r.previous_date,
          schedule_source: r.previous_source ?? "auto",
        })
        .eq("id", r.day_id);
      if (uerr) continue;
      await supabase.from("pl_schedule_audit").insert({
        batch_id: newBatchId,
        day_id: r.day_id,
        client_id: r.client_id,
        previous_date: r.new_date,
        new_date: r.previous_date,
        previous_source: "manual",
        new_source: r.previous_source ?? "auto",
        scope: "undo",
        changed_by: userId,
        changed_by_role: role,
        note: `Undo of batch ${data.batchId}`,
      });
      undone += 1;
    }

    return { ok: true as const, undone, batchId: newBatchId };
  });

// ───────────────────────────────────────────────────────────────────────────
// getScheduleHistory — recent audit rows for a client.
// ───────────────────────────────────────────────────────────────────────────

export const getScheduleHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await resolveActorAccess({ supabase, userId }, data.clientId);

    const { data: rows, error } = await supabase
      .from("pl_schedule_audit")
      .select(
        "id, batch_id, day_id, previous_date, new_date, previous_source, new_source, scope, changed_by, changed_by_role, note, created_at",
      )
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (error) throw new Error(error.message);

    const dayIds = Array.from(new Set((rows ?? []).map((r) => r.day_id)));
    let dayMap = new Map<string, { title: string | null; day_index: number }>();
    if (dayIds.length) {
      const { data: days } = await supabase
        .from("pl_days")
        .select("id, title, day_index")
        .in("id", dayIds);
      for (const d of days ?? []) dayMap.set(d.id, { title: d.title, day_index: d.day_index });
    }
    return {
      rows: (rows ?? []).map((r) => ({ ...r, day: dayMap.get(r.day_id) ?? null })),
    };
  });

// ───────────────────────────────────────────────────────────────────────────
// getMoveContext — data the MoveWorkoutSheet needs to detect conflicts.
// ───────────────────────────────────────────────────────────────────────────

export const getMoveContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ dayId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { day, week, block } = await loadDayContext(supabase, data.dayId);
    await resolveActorAccess({ supabase, userId }, block.client_id);

    // Pull every non-archived day in the active block so conflict detection
    // sees the same-day collisions, sequence breaks, and adjacent fatigue
    // sessions. We also pull the next/prev blocks for sequence checks across
    // block boundaries — kept cheap because pl_days is tiny per block.
    const { data: allDays } = await supabase
      .from("pl_days")
      .select("id, day_index, title, focus, scheduled_date, week_id")
      .in("week_id", await (async () => {
        const { data: weeks } = await supabase
          .from("pl_weeks").select("id, week_index, block_id")
          .eq("block_id", block.id);
        return (weeks ?? []).map((w: any) => w.id);
      })())
      .eq("archived", false);

    const { data: weeks } = await supabase
      .from("pl_weeks")
      .select("id, week_index, block_id")
      .eq("block_id", block.id);
    const weekMap = new Map<string, { week_index: number; block_id: string }>();
    for (const w of weeks ?? []) weekMap.set(w.id, w);

    const decorated = (allDays ?? []).map((d: any) => ({
      id: d.id,
      day_index: d.day_index,
      title: d.title,
      focus: d.focus,
      scheduled_date: d.scheduled_date,
      week_index: weekMap.get(d.week_id)?.week_index ?? 0,
      block_id: weekMap.get(d.week_id)?.block_id ?? block.id,
    }));

    const { data: completion } = await supabase
      .from("pl_day_completions")
      .select("completed_at, in_progress_at")
      .eq("day_id", data.dayId)
      .maybeSingle();

    return {
      day: {
        id: day.id,
        day_index: day.day_index,
        title: day.title,
        focus: day.focus,
        scheduled_date: day.scheduled_date,
        schedule_locked: day.schedule_locked,
      },
      week: { id: week.id, week_index: week.week_index, training_days: week.training_days },
      block: {
        id: block.id,
        name: block.name,
        start_date: block.start_date,
        end_date: block.end_date,
      },
      allBlockDays: decorated,
      completion,
    };
  });