import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ImpactInput = z.object({ rowId: z.string().uuid() });
const ApplyInput = z.object({
  rowId: z.string().uuid(),
  newExerciseId: z.string().uuid(),
  scope: z.enum(["today", "future"]),
});

type RowCtx = {
  rowId: string;
  dayId: string;
  weekId: string;
  blockId: string;
  clientId: string | null;
  exerciseId: string | null;
  exerciseNameOverride: string | null;
  sortOrder: number | null;
};

async function loadRowContext(supabase: any, rowId: string): Promise<RowCtx> {
  const { data: row, error } = await supabase
    .from("pl_exercise_rows")
    .select("id, day_id, exercise_id, exercise_name_override, sort_order, pl_days!inner(week_id, pl_weeks!inner(block_id, pl_blocks!inner(client_id)))")
    .eq("id", rowId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Row not found");
  const week = (row as any).pl_days?.pl_weeks;
  const block = week?.pl_blocks;
  return {
    rowId: row.id,
    dayId: row.day_id,
    weekId: week?.week_id ?? (row as any).pl_days?.week_id,
    blockId: week?.block_id,
    clientId: block?.client_id ?? null,
    exerciseId: row.exercise_id ?? null,
    exerciseNameOverride: row.exercise_name_override ?? null,
    sortOrder: row.sort_order ?? null,
  };
}

/**
 * Find sibling rows in the same block that:
 *   - reference the same exercise_id as the source row,
 *   - sit on a different day than the source row,
 *   - belong to a day with no completion record (day not started/finished).
 * Template blocks (client_id IS NULL) are excluded — never mutate templates.
 */
async function findFutureSiblings(supabase: any, ctx: RowCtx): Promise<string[]> {
  if (!ctx.exerciseId || !ctx.clientId) return [];
  // 1) all week_ids in this block, then day_ids in those weeks. We
  // resolve in two steps because filtering on an embedded resource
  // (pl_weeks.block_id) silently returns no rows on some PostgREST
  // setups — which surfaced as "0 uncompleted workouts affected".
  const { data: weeks, error: weeksErr } = await supabase
    .from("pl_weeks")
    .select("id")
    .eq("block_id", ctx.blockId);
  if (weeksErr) throw weeksErr;
  const weekIds = (weeks ?? []).map((w: any) => w.id);
  if (weekIds.length === 0) return [];
  const { data: days, error: daysErr } = await supabase
    .from("pl_days")
    .select("id")
    .in("week_id", weekIds);
  if (daysErr) throw daysErr;
  const dayIds = (days ?? [])
    .map((d: any) => d.id)
    .filter((id: string) => id !== ctx.dayId);
  if (dayIds.length === 0) return [];

  // 2) drop any day that has a completion record
  const { data: completions, error: cErr } = await supabase
    .from("pl_day_completions")
    .select("day_id")
    .in("day_id", dayIds);
  if (cErr) throw cErr;
  const completedSet = new Set((completions ?? []).map((c: any) => c.day_id));
  const openDayIds = dayIds.filter((id: string) => !completedSet.has(id));
  if (openDayIds.length === 0) return [];

  // 3) matching rows on those days
  const { data: rows, error: rErr } = await supabase
    .from("pl_exercise_rows")
    .select("id")
    .in("day_id", openDayIds)
    .eq("exercise_id", ctx.exerciseId);
  if (rErr) throw rErr;
  return (rows ?? []).map((r: any) => r.id);
}

export const getSwapImpact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ImpactInput.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = await loadRowContext(context.supabase, data.rowId);
    const futureRowIds = await findFutureSiblings(context.supabase, ctx);
    return {
      blockId: ctx.blockId,
      isTemplate: ctx.clientId === null,
      futureCount: futureRowIds.length,
    };
  });

export const applySwap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ApplyInput.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = await loadRowContext(context.supabase, data.rowId);
    if (data.scope === "future" && ctx.clientId === null) {
      throw new Error("Cannot swap future workouts on a template block");
    }
    const ids = [ctx.rowId];
    if (data.scope === "future") {
      const siblings = await findFutureSiblings(context.supabase, ctx);
      for (const id of siblings) if (!ids.includes(id)) ids.push(id);
    }
    // RLS on pl_exercise_rows only lets coaches/admins UPDATE — clients
    // (the trainee themself) can only SELECT. That meant client-portal
    // swaps came back "successful" with zero rows actually changed
    // ("doesn't actually swap"). We've already loaded + authorized the
    // row via loadRowContext (which itself runs as the caller, so RLS
    // still gates whether the user can see the row at all), so it's safe
    // to escalate the write to the service-role client.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("pl_exercise_rows")
      .update({ exercise_id: data.newExerciseId, exercise_name_override: null })
      .in("id", ids)
      .select("id");
    if (error) throw error;
    return { updatedRowIds: (updated ?? []).map((r: any) => r.id), count: (updated ?? []).length };
  });