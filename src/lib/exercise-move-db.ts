/**
 * Database side of "move this exercise in future workouts too".
 *
 * Takes the (service-role) client as a parameter so it can be exercised
 * without a server. The caller must already have authorised access to
 * `input.dayId`; everything else is derived from the database, never from
 * the client.
 */
import { exerciseKey, planMove, withOccurrence } from "@/lib/exercise-move";

export type MoveInFutureInput = {
  dayId: string;
  rowId: string;
  /** Rows directly above / below the moved row, as they were when it was moved. */
  prevRowId: string | null;
  nextRowId: string | null;
};

export async function moveExerciseInFutureDays(
  supabaseAdmin: any,
  data: MoveInFutureInput,
): Promise<{ updatedDays: number; matchedDays: number }> {
  // Source day -> week -> block (stepwise: embedded filters are unreliable here).
  const { data: day, error: dayErr } = await supabaseAdmin
    .from("pl_days")
    .select("id, week_id, day_index")
    .eq("id", data.dayId)
    .maybeSingle();
  if (dayErr) throw dayErr;
  if (!day) throw new Error("Workout not found");
  const { data: week, error: weekErr } = await supabaseAdmin
    .from("pl_weeks")
    .select("id, block_id, week_index")
    .eq("id", (day as any).week_id)
    .maybeSingle();
  if (weekErr) throw weekErr;
  if (!week) throw new Error("Workout not found");
  const { data: block, error: blockErr } = await supabaseAdmin
    .from("pl_blocks")
    .select("id, client_id")
    .eq("id", (week as any).block_id)
    .maybeSingle();
  if (blockErr) throw blockErr;
  if (!block || !(block as any).client_id) {
    throw new Error("Future workouts can't be changed on a template block");
  }

  // Identify the moved exercise and its neighbours inside the source day.
  const ROW_COLS = "id, day_id, sort_order, exercise_id, exercise_name_override, exercises(name)";
  const { data: srcRows, error: srcErr } = await supabaseAdmin
    .from("pl_exercise_rows")
    .select(ROW_COLS)
    .eq("day_id", data.dayId)
    .order("sort_order")
    .order("created_at")
    .order("id");
  if (srcErr) throw srcErr;
  const srcKeys = withOccurrence(((srcRows ?? []) as any[]).map(exerciseKey));
  const keyOf = (rowId: string | null) => {
    if (rowId === null) return null;
    const i = ((srcRows ?? []) as any[]).findIndex((r) => r.id === rowId);
    if (i < 0) throw new Error("Workout order changed. Refresh and try again.");
    return srcKeys[i];
  };
  const moved = keyOf(data.rowId)!;
  const prev = keyOf(data.prevRowId);
  const next = keyOf(data.nextRowId);

  // Same slot, later weeks, not yet completed.
  const { data: laterWeeks, error: lwErr } = await supabaseAdmin
    .from("pl_weeks")
    .select("id")
    .eq("block_id", (week as any).block_id)
    .gt("week_index", (week as any).week_index);
  if (lwErr) throw lwErr;
  const weekIds = (laterWeeks ?? []).map((w: any) => w.id);
  if (weekIds.length === 0) return { updatedDays: 0, matchedDays: 0 };
  const { data: laterDays, error: ldErr } = await supabaseAdmin
    .from("pl_days")
    .select("id")
    .in("week_id", weekIds)
    .eq("day_index", (day as any).day_index);
  if (ldErr) throw ldErr;
  const dayIds = (laterDays ?? []).map((d: any) => d.id);
  if (dayIds.length === 0) return { updatedDays: 0, matchedDays: 0 };
  const { data: done, error: doneErr } = await supabaseAdmin
    .from("pl_day_completions")
    .select("day_id")
    .in("day_id", dayIds);
  if (doneErr) throw doneErr;
  const completed = new Set((done ?? []).map((c: any) => c.day_id));
  const openDayIds = dayIds.filter((id: string) => !completed.has(id));
  if (openDayIds.length === 0) return { updatedDays: 0, matchedDays: 0 };

  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from("pl_exercise_rows")
    .select(ROW_COLS)
    .in("day_id", openDayIds)
    .order("sort_order")
    .order("created_at")
    .order("id");
  if (rowsErr) throw rowsErr;
  const byDay = new Map<string, any[]>();
  for (const r of (rows ?? []) as any[]) {
    const list = byDay.get(r.day_id) ?? [];
    list.push(r);
    byDay.set(r.day_id, list);
  }

  let matchedDays = 0;
  let updatedDays = 0;
  for (const dayRows of byDay.values()) {
    const keys = withOccurrence(dayRows.map(exerciseKey));
    if (!keys.includes(moved)) continue;
    matchedDays += 1;
    const plan = planMove(keys, moved, prev, next);
    if (!plan) continue;
    const rowByKey = new Map(keys.map((k, i) => [k, dayRows[i]]));
    for (let i = 0; i < plan.length; i += 1) {
      const row = rowByKey.get(plan[i])!;
      const { error } = await supabaseAdmin
        .from("pl_exercise_rows")
        .update({ sort_order: i })
        .eq("id", row.id)
        .eq("day_id", row.day_id);
      if (error) throw error;
    }
    updatedDays += 1;
  }
  return { updatedDays, matchedDays };
}
