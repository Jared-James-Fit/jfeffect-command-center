/**
 * Members build and log their own workouts on the pl_* engine, so they get
 * the same logger, completions, PRs and (later) community sharing as
 * coaching clients. Writes go through the service role after checking the
 * caller owns the member athlete profile (ensure_member_athlete), the same
 * way at-home backup sessions are created.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MEMBER_WORKOUTS_BLOCK_NAME, MEMBER_WORKOUTS_KEY, MemberWorkoutInput, memberWorkoutRows } from "@/lib/member-workouts";

/** The caller's member athlete id. Coaching clients train from their program. */
async function memberAthleteId(supabase: any): Promise<string> {
  const { data: clientId, error } = await supabase.rpc("ensure_member_athlete");
  if (error) throw new Error(error.message);
  const { data: row, error: rowErr } = await supabase.from("clients").select("id, athlete_kind").eq("id", clientId).maybeSingle();
  if (rowErr) throw new Error(rowErr.message);
  if (!row || row.athlete_kind !== "member") throw new Error("Coaching clients train from their program; ask your coach to add a workout.");
  return clientId as string;
}

async function ensureContainer(db: any, clientId: string): Promise<{ blockId: string; weekId: string }> {
  const find = () => db.from("pl_blocks").select("id").eq("client_id", clientId).eq("source_template_block_key", MEMBER_WORKOUTS_KEY).maybeSingle();
  let { data: block } = await find();
  if (!block) {
    const { data: created, error } = await db.from("pl_blocks").insert({
      client_id: clientId,
      name: MEMBER_WORKOUTS_BLOCK_NAME,
      client_visible: true,
      status: "Active",
      weeks: 1,
      sort_order: 900,
      source_template_block_key: MEMBER_WORKOUTS_KEY,
      goal: "Member-built workouts",
    }).select("id").single();
    if (error) {
      if ((error as any).code !== "23505") throw new Error(error.message);
      ({ data: block } = await find());
      if (!block) throw new Error(error.message);
    } else {
      block = created;
    }
  }
  let { data: week } = await db.from("pl_weeks").select("id").eq("block_id", block.id).eq("week_index", 1).maybeSingle();
  if (!week) {
    const { data: created, error } = await db.from("pl_weeks")
      .insert({ block_id: block.id, week_index: 1, notes: MEMBER_WORKOUTS_BLOCK_NAME }).select("id").single();
    if (error) {
      ({ data: week } = await db.from("pl_weeks").select("id").eq("block_id", block.id).eq("week_index", 1).maybeSingle());
      if (!week) throw new Error(error.message);
    } else {
      week = created;
    }
  }
  return { blockId: block.id, weekId: week.id };
}

/** Create the day, its rows and a calendar instance. Rolls the day back if rows fail. */
async function createDay(db: any, clientId: string, weekId: string, title: string, date: string, rowsFor: (dayId: string) => any[]) {
  const { data: last } = await db.from("pl_days").select("day_index").eq("week_id", weekId)
    .order("day_index", { ascending: false }).limit(1).maybeSingle();
  const { data: day, error: dayErr } = await db.from("pl_days").insert({
    week_id: weekId,
    day_index: ((last?.day_index as number | undefined) ?? 0) + 1,
    title,
    is_custom: true,
    scheduled_date: date,
    schedule_source: "manual",
  }).select("id").single();
  if (dayErr) throw new Error(dayErr.message);
  const rows = rowsFor(day.id);
  const { error: rowsErr } = await db.from("pl_exercise_rows").insert(rows);
  if (rowsErr) {
    await db.from("pl_days").delete().eq("id", day.id);
    throw new Error(rowsErr.message);
  }
  const { data: inst, error: instErr } = await db.from("pl_scheduled_workouts").insert({
    client_id: clientId, source_day_id: day.id, scheduled_date: date, schedule_source: "manual",
  }).select("id").single();
  if (instErr) throw new Error(instErr.message);
  return { dayId: day.id as string, scheduledWorkoutId: inst.id as string };
}

export const createMemberWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MemberWorkoutInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const clientId = await memberAthleteId(supabase);
    // Library exercises only, so PRs and demo videos line up with everyone else's.
    const ids = Array.from(new Set(data.exercises.map((e) => e.exerciseId)));
    const { data: found, error: exErr } = await supabase.from("exercises").select("id").in("id", ids).eq("archived", false);
    if (exErr) throw new Error(exErr.message);
    if ((found ?? []).length !== ids.length) throw new Error("One of those exercises isn't in the library any more. Pick it again.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { weekId } = await ensureContainer(supabaseAdmin, clientId);
    return createDay(supabaseAdmin, clientId, weekId, data.title, data.date, (dayId) => memberWorkoutRows(dayId, data.exercises));
  });

export const repeatMemberWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ dayId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const clientId = await memberAthleteId(supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { weekId } = await ensureContainer(supabaseAdmin, clientId);
    // Only a workout from this member's own container can be repeated.
    const { data: src } = await supabaseAdmin.from("pl_days").select("id, title, week_id").eq("id", data.dayId).maybeSingle();
    if (!src || src.week_id !== weekId) throw new Error("That workout isn't one of yours.");
    const { data: rows } = await supabaseAdmin.from("pl_exercise_rows").select("*").eq("day_id", data.dayId).order("sort_order");
    if (!rows?.length) throw new Error("That workout has no exercises.");
    return createDay(supabaseAdmin, clientId, weekId, src.title ?? "Workout", data.date, (dayId) =>
      rows.map((r: any, i: number) => ({
        day_id: dayId, sort_order: i, exercise_id: r.exercise_id, exercise_name_override: r.exercise_name_override,
        sets: r.sets, reps_text: r.reps_text, load_kg: r.load_kg, load_unit: r.load_unit,
        measurement_type: r.measurement_type, tracking_type: r.tracking_type, time_profile: r.time_profile,
      })));
  });

export type MyMemberWorkout = { dayId: string; title: string; date: string | null; scheduledWorkoutId: string | null; completedAt: string | null };

export const listMyMemberWorkouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ athleteId: string | null; workouts: MyMemberWorkout[] }> => {
    const { supabase, userId } = context as any;
    const { data: athlete } = await supabase.from("clients").select("id").eq("user_id", userId).eq("athlete_kind", "member").maybeSingle();
    if (!athlete) return { athleteId: null, workouts: [] };
    const { data: block } = await supabase.from("pl_blocks").select("id").eq("client_id", athlete.id)
      .eq("source_template_block_key", MEMBER_WORKOUTS_KEY).maybeSingle();
    if (!block) return { athleteId: athlete.id, workouts: [] };
    const { data: days } = await supabase.from("pl_days").select("id, title, scheduled_date, pl_weeks!inner(block_id)")
      .eq("pl_weeks.block_id", block.id).order("scheduled_date", { ascending: false }).limit(50);
    const dayIds = (days ?? []).map((d: any) => d.id);
    const { data: insts } = dayIds.length
      ? await supabase.from("pl_scheduled_workouts").select("id, source_day_id").eq("client_id", athlete.id).in("source_day_id", dayIds)
      : { data: [] as any[] };
    const instIds = (insts ?? []).map((i: any) => i.id);
    const { data: comps } = instIds.length
      ? await supabase.from("pl_day_completions").select("scheduled_workout_id, completed_at").in("scheduled_workout_id", instIds)
      : { data: [] as any[] };
    const instByDay = new Map((insts ?? []).map((i: any) => [i.source_day_id, i.id]));
    const doneByInst = new Map((comps ?? []).filter((c: any) => c.completed_at).map((c: any) => [c.scheduled_workout_id, c.completed_at]));
    return {
      athleteId: athlete.id,
      workouts: (days ?? []).map((d: any) => {
        const inst = (instByDay.get(d.id) as string | undefined) ?? null;
        return { dayId: d.id, title: d.title, date: d.scheduled_date, scheduledWorkoutId: inst, completedAt: inst ? ((doneByInst.get(inst) as string | undefined) ?? null) : null };
      }),
    };
  });
