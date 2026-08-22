import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin archive / restore / safe-delete for the exercise library.
 *
 * Archive is the normal removal action: it flips `archived` so every picker
 * (which filters `archived = false`) stops offering the exercise while all
 * historical prescriptions, logs, PRs and analytics stay intact.
 *
 * Permanent delete is only permitted when the exercise has zero relational
 * references. Several FKs on `public.exercises` are ON DELETE SET NULL, so an
 * unguarded delete would silently orphan real training history — the guard
 * below runs before any delete is issued.
 */

const IdInput = z.object({ exerciseId: z.string().uuid() });

/** Tables whose rows would be orphaned or blocked by a hard delete. */
const REFERENCE_TABLES: { table: string; column: string }[] = [
  { table: "member_set_logs", column: "exercise_id" },
  { table: "pl_exercise_rows", column: "exercise_id" },
  { table: "pl_client_maxes", column: "exercise_id" },
  { table: "pl_exercise_notes", column: "exercise_id" },
  { table: "member_exercise_notes", column: "exercise_id" },
  { table: "member_exercise_swaps", column: "exercise_id" },
  { table: "warmup_assignments", column: "exercise_id" },
];

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Only admins can manage the exercise library.");
}

async function countReferences(exerciseId: string): Promise<Record<string, number>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const counts: Record<string, number> = {};
  for (const ref of REFERENCE_TABLES) {
    const { count, error } = await supabaseAdmin
      .from(ref.table as any)
      .select("id", { count: "exact", head: true })
      .eq(ref.column, exerciseId);
    // A missing/inaccessible table must never be read as "safe to delete".
    if (error) throw new Error(`Reference check failed on ${ref.table}: ${error.message}`);
    counts[ref.table] = count ?? 0;
  }
  return counts;
}

export const getExerciseReferenceCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => IdInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const counts = await countReferences(data.exerciseId);
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return { counts, total, safeToDelete: total === 0 };
  });

export const setExerciseArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    IdInput.extend({ archived: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { data: row, error } = await context.supabase
      .from("exercises")
      .update({
        archived: data.archived,
        archived_at: data.archived ? new Date().toISOString() : null,
        archived_by: data.archived ? context.userId : null,
      })
      .eq("id", data.exerciseId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Exercise not found or you do not have permission to change it.");
    return row as Record<string, unknown>;
  });

export const deleteExercisePermanently = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => IdInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const counts = await countReferences(data.exerciseId);
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (total > 0) {
      throw new Error("This exercise is already used in training history. Archive it instead.");
    }
    const { data: row, error } = await context.supabase
      .from("exercises")
      .delete()
      .eq("id", data.exerciseId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Exercise not found or you do not have permission to delete it.");
    return { id: data.exerciseId };
  });
