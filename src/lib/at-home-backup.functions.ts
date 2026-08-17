import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  AT_HOME_BACKUP_DEFINITIONS_KEY,
  AT_HOME_BACKUP_SESSIONS_BLOCK_NAME,
  AT_HOME_BACKUP_SESSIONS_KEY,
  AT_HOME_BACKUP_SUBTITLE,
  backupSessionTitle,
  cloneBackupRow,
  isAtHomeBackupClient,
  summarizeBackupDefinition,
} from "@/lib/at-home-backup";

// ─────────────────────────────────────────────────────────────────────────────
// At-Home Backup Workouts — server functions.
//
// Reads/writes go through the privileged client AFTER the caller is
// authorized, because the definitions block is client_visible = false and
// therefore invisible to the client's own RLS policies by design.
// Every write is scoped to the authorized client_id.
// ─────────────────────────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

async function authorize(ctx: { supabase: any; userId: string }, clientId: string) {
  if (!isAtHomeBackupClient(clientId)) {
    throw new Error("At-home backup workouts are not enabled for this client.");
  }
  const { data: client } = await ctx.supabase
    .from("clients")
    .select("id, user_id, assigned_coach_id, full_name")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) throw new Error("Client not found.");

  if (client.user_id === ctx.userId) return client;

  const { data: isAdmin } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (isAdmin === true) return client;

  if (client.assigned_coach_id) {
    const { data: coach } = await ctx.supabase
      .from("coaches")
      .select("id, user_id")
      .eq("id", client.assigned_coach_id)
      .maybeSingle();
    if (coach?.user_id === ctx.userId) return client;
  }
  throw new Error("You don't have permission to use these backup workouts.");
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function loadDefinitionsBlock(db: any, clientId: string) {
  const { data: block } = await db
    .from("pl_blocks")
    .select("id")
    .eq("client_id", clientId)
    .eq("source_template_block_key", AT_HOME_BACKUP_DEFINITIONS_KEY)
    .maybeSingle();
  return block ?? null;
}

/** List the coach-authored at-home backup templates for a client. */
export const listAtHomeBackupDefinitions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await authorize(context as any, data.clientId);
    const db = await admin();

    const block = await loadDefinitionsBlock(db, data.clientId);
    if (!block) return { definitions: [] as any[] };

    const { data: weeks } = await db.from("pl_weeks").select("id").eq("block_id", block.id);
    const weekIds = (weeks ?? []).map((w: any) => w.id);
    if (!weekIds.length) return { definitions: [] as any[] };

    const { data: days } = await db
      .from("pl_days")
      .select("id, day_index, title, subtitle, notes")
      .in("week_id", weekIds)
      .eq("archived", false)
      .order("day_index");
    const dayIds = (days ?? []).map((d: any) => d.id);
    if (!dayIds.length) return { definitions: [] as any[] };

    const { data: rows } = await db
      .from("pl_exercise_rows")
      .select("id, day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, duration_seconds, measurement_type, notes")
      .in("day_id", dayIds)
      .order("sort_order");

    const exerciseIds = Array.from(
      new Set((rows ?? []).map((r: any) => r.exercise_id).filter(Boolean)),
    ) as string[];
    const nameById = new Map<string, string>();
    if (exerciseIds.length) {
      const { data: exercises } = await db.from("exercises").select("id, name").in("id", exerciseIds);
      for (const e of (exercises ?? []) as any[]) nameById.set(e.id, e.name);
    }

    const rowsByDay = new Map<string, any[]>();
    for (const r of (rows ?? []) as any[]) {
      const list = rowsByDay.get(r.day_id) ?? [];
      list.push(r);
      rowsByDay.set(r.day_id, list);
    }

    return {
      definitions: (days ?? []).map((d: any) => {
        const dayRows = rowsByDay.get(d.id) ?? [];
        return {
          dayId: d.id as string,
          title: backupSessionTitle(d.title),
          notes: (d.notes ?? null) as string | null,
          summary: summarizeBackupDefinition(dayRows),
          exercises: dayRows.map((r: any) => ({
            id: r.id as string,
            name: (r.exercise_name_override ?? nameById.get(r.exercise_id) ?? "Exercise") as string,
            sets: (r.sets ?? null) as number | null,
            reps: (r.reps_text ?? null) as string | null,
            durationSeconds: (r.duration_seconds ?? null) as number | null,
          })),
        };
      }),
    };
  });

/**
 * Instantiate a backup definition as a dated, loggable session.
 *
 * Idempotent: any session for the same definition + date is reused instead
 * of creating a duplicate, including a completed historical session.
 */
export const startAtHomeBackupSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        definitionDayId: z.string().uuid(),
        date: isoDate,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await authorize(context as any, data.clientId);
    const db = await admin();

    // 1) Validate the definition belongs to THIS client's definitions block.
    const defBlock = await loadDefinitionsBlock(db, data.clientId);
    if (!defBlock) throw new Error("No at-home backup workouts are set up yet.");
    const { data: defDay } = await db
      .from("pl_days")
      .select("id, title, notes, week_id, pl_weeks!inner(block_id)")
      .eq("id", data.definitionDayId)
      .maybeSingle();
    if (!defDay || (defDay as any).pl_weeks?.block_id !== defBlock.id) {
      throw new Error("That backup workout is not available.");
    }

    // 2) Ensure the sessions block + week exist (created lazily, once).
    let { data: sessBlock } = await db
      .from("pl_blocks")
      .select("id")
      .eq("client_id", data.clientId)
      .eq("source_template_block_key", AT_HOME_BACKUP_SESSIONS_KEY)
      .maybeSingle();
    if (!sessBlock) {
      const { data: created, error } = await db
        .from("pl_blocks")
        .insert({
          client_id: data.clientId,
          name: AT_HOME_BACKUP_SESSIONS_BLOCK_NAME,
          // See src/lib/at-home-backup.ts for why sessions are visible.
          client_visible: true,
          status: "Active",
          weeks: 1,
          sort_order: 901,
          source_template_block_key: AT_HOME_BACKUP_SESSIONS_KEY,
          goal: "At-home backup",
        })
        .select("id")
        .single();
      if (error) throw error;
      sessBlock = created;
    }
    let { data: sessWeek } = await db
      .from("pl_weeks")
      .select("id")
      .eq("block_id", sessBlock!.id)
      .eq("week_index", 1)
      .maybeSingle();
    if (!sessWeek) {
      const { data: created, error } = await db
        .from("pl_weeks")
        .insert({ block_id: sessBlock!.id, week_index: 1, notes: "At-home backup sessions" })
        .select("id")
        .single();
      if (error) throw error;
      sessWeek = created;
    }

    // 3) Reuse any existing session for the same definition+date. A retry
    // after completion must reopen the historical session instead of creating
    // a duplicate calendar item or second workout log.
    const { data: existingDays } = await db
      .from("pl_days")
      .select("id")
      .eq("week_id", sessWeek!.id)
      .eq("source_day_id", data.definitionDayId)
      .eq("scheduled_date", data.date)
      .eq("archived", false)
      .order("created_at", { ascending: true })
      .limit(1);
    const existing = (existingDays ?? [])[0] as any;
    if (existing) {
      const { data: inst } = await db
        .from("pl_scheduled_workouts")
        .select("id")
        .eq("client_id", data.clientId)
        .eq("source_day_id", existing.id)
        .maybeSingle();
      return { dayId: existing.id as string, scheduledWorkoutId: (inst?.id ?? null) as string | null, reused: true };
    }

    // 4) Create the session day.
    const { data: lastDay } = await db
      .from("pl_days")
      .select("day_index")
      .eq("week_id", sessWeek!.id)
      .order("day_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextIndex = ((lastDay?.day_index as number | undefined) ?? 0) + 1;

    const { data: newDay, error: dayErr } = await db
      .from("pl_days")
      .insert({
        week_id: sessWeek!.id,
        day_index: nextIndex,
        title: backupSessionTitle((defDay as any).title),
        subtitle: AT_HOME_BACKUP_SUBTITLE,
        notes: (defDay as any).notes ?? null,
        notes_client_visible: true,
        is_custom: true,
        scheduled_date: data.date,
        schedule_source: "manual",
        source_day_id: data.definitionDayId,
      })
      .select("id")
      .single();
    if (dayErr) throw dayErr;

    // 5) Clone prescription rows (never any logged result).
    const { data: defRows } = await db
      .from("pl_exercise_rows")
      .select("*")
      .eq("day_id", data.definitionDayId)
      .order("sort_order");
    const payload = (defRows ?? []).map((r: any, i: number) => ({
      day_id: newDay!.id,
      ...cloneBackupRow(r, i),
    }));
    if (payload.length) {
      const { error: rowsErr } = await db.from("pl_exercise_rows").insert(payload);
      if (rowsErr) {
        // Roll back the half-created day so the client never sees an empty session.
        await db.from("pl_days").delete().eq("id", newDay!.id);
        throw rowsErr;
      }
    }

    // 6) Place it on the calendar as a normal scheduled instance.
    const { data: instance, error: instErr } = await db
      .from("pl_scheduled_workouts")
      .insert({
        client_id: data.clientId,
        source_day_id: newDay!.id,
        scheduled_date: data.date,
        schedule_source: "manual",
        note: AT_HOME_BACKUP_SUBTITLE,
      })
      .select("id")
      .single();
    if (instErr) throw instErr;

    return { dayId: newDay!.id as string, scheduledWorkoutId: instance!.id as string, reused: false };
  });

/** Coach view: recent instantiated backup sessions with completion state. */
export const listAtHomeBackupSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ clientId: z.string().uuid(), limit: z.number().int().min(1).max(50).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await authorize(context as any, data.clientId);
    const db = await admin();

    const { data: block } = await db
      .from("pl_blocks")
      .select("id")
      .eq("client_id", data.clientId)
      .eq("source_template_block_key", AT_HOME_BACKUP_SESSIONS_KEY)
      .maybeSingle();
    if (!block) return { sessions: [] as any[] };

    const { data: weeks } = await db.from("pl_weeks").select("id").eq("block_id", block.id);
    const weekIds = (weeks ?? []).map((w: any) => w.id);
    if (!weekIds.length) return { sessions: [] as any[] };

    const { data: days } = await db
      .from("pl_days")
      .select("id, title, scheduled_date")
      .in("week_id", weekIds)
      .eq("archived", false)
      .order("scheduled_date", { ascending: false })
      .limit(data.limit ?? 10);
    const dayIds = (days ?? []).map((d: any) => d.id);
    if (!dayIds.length) return { sessions: [] as any[] };

    const { data: completions } = await db
      .from("pl_day_completions")
      .select("day_id, completed_at")
      .eq("client_id", data.clientId)
      .in("day_id", dayIds);
    const doneById = new Map<string, string>();
    for (const c of (completions ?? []) as any[]) {
      if (c.completed_at) doneById.set(c.day_id, c.completed_at);
    }

    return {
      sessions: (days ?? []).map((d: any) => ({
        dayId: d.id as string,
        title: d.title as string,
        date: (d.scheduled_date ?? null) as string | null,
        completedAt: doneById.get(d.id) ?? null,
      })),
    };
  });