import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Member exercise swap persistence.
 *
 * Membership plans live in `member_plans.published_payload` (read-only
 * JSON shared across members) so we can't mutate the plan to record a
 * swap. Instead each (enrollment, week, day, exercise_index) gets a row
 * in `member_exercise_swaps`. The member adapter overlays these on the
 * way out so `WorkoutDayView` renders the swapped exercise everywhere
 * (today's workout AND any future occurrences) and survives refresh.
 */

const ApplyInput = z.object({
  enrollmentId: z.string().uuid(),
  weekIndex: z.number().int().min(1),
  dayIndex: z.number().int().min(1),
  exerciseIndex: z.number().int().min(0),
  newExerciseId: z.string().uuid(),
  scope: z.enum(["today", "future"]),
});

const ImpactInput = z.object({
  enrollmentId: z.string().uuid(),
  weekIndex: z.number().int().min(1),
  dayIndex: z.number().int().min(1),
  exerciseIndex: z.number().int().min(0),
});

async function ensureEnrollmentOwned(supabase: any, enrollmentId: string, userId: string) {
  const { data, error } = await supabase
    .from("member_plan_enrollments")
    .select("id, member_id, app_members!inner(user_id)")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const ownerUserId = (data as any)?.app_members?.user_id ?? null;
  if (!data || ownerUserId !== userId) {
    throw new Error("Enrollment not found or not owned by caller");
  }
}

export const getMemberSwapImpact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ImpactInput.parse(d))
  .handler(async ({ data, context }) => {
    await ensureEnrollmentOwned(context.supabase, data.enrollmentId, context.userId);
    // Pull plan payload to count how many future days reference the same
    // slot. Members' plans typically repeat the same week template, so a
    // "future" scope swap should match by exercise_id on every matching
    // (day_index, exerciseIndex) across week_index >= current.
    const { data: enr, error } = await context.supabase
      .from("member_plan_enrollments")
      .select("member_plans(published_payload)")
      .eq("id", data.enrollmentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const weeks = ((enr as any)?.member_plans?.published_payload?.weeks_data ?? []) as any[];
    let futureCount = 0;
    const srcDay = weeks[data.weekIndex - 1]?.days?.[data.dayIndex - 1] ?? null;
    const srcExerciseId = srcDay?.rows?.[data.exerciseIndex]?.exercise_id ?? null;
    if (srcExerciseId) {
      for (const w of weeks) {
        if ((w.week_index ?? 0) < data.weekIndex) continue;
        for (const d of w.days ?? []) {
          if ((d.day_index ?? 0) !== data.dayIndex) continue;
          const r = d.rows?.[data.exerciseIndex];
          if (!r) continue;
          if (
            w.week_index === data.weekIndex &&
            d.day_index === data.dayIndex
          ) {
            continue;
          }
          if (r.exercise_id === srcExerciseId) futureCount++;
        }
      }
    }
    return { futureCount, isTemplate: false };
  });

export const applyMemberSwap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ApplyInput.parse(d))
  .handler(async ({ data, context }) => {
    await ensureEnrollmentOwned(context.supabase, data.enrollmentId, context.userId);

    // Upsert the "today" row first.
    const baseRows: Array<{
      enrollment_id: string;
      week_index: number;
      day_index: number;
      exercise_index: number;
      exercise_id: string;
      scope: "today" | "future";
      created_by: string;
    }> = [
      {
        enrollment_id: data.enrollmentId,
        week_index: data.weekIndex,
        day_index: data.dayIndex,
        exercise_index: data.exerciseIndex,
        exercise_id: data.newExerciseId,
        scope: data.scope,
        created_by: context.userId,
      },
    ];

    if (data.scope === "future") {
      const { data: enr } = await context.supabase
        .from("member_plan_enrollments")
        .select("member_plans(published_payload)")
        .eq("id", data.enrollmentId)
        .maybeSingle();
      const weeks = ((enr as any)?.member_plans?.published_payload?.weeks_data ?? []) as any[];
      const srcDay = weeks[data.weekIndex - 1]?.days?.[data.dayIndex - 1] ?? null;
      const srcExerciseId = srcDay?.rows?.[data.exerciseIndex]?.exercise_id ?? null;
      if (srcExerciseId) {
        for (const w of weeks) {
          if ((w.week_index ?? 0) <= data.weekIndex) continue;
          for (const d of w.days ?? []) {
            if ((d.day_index ?? 0) !== data.dayIndex) continue;
            const r = d.rows?.[data.exerciseIndex];
            if (!r || r.exercise_id !== srcExerciseId) continue;
            baseRows.push({
              enrollment_id: data.enrollmentId,
              week_index: w.week_index,
              day_index: d.day_index,
              exercise_index: data.exerciseIndex,
              exercise_id: data.newExerciseId,
              scope: "future",
              created_by: context.userId,
            });
          }
        }
      }
    }

    const { error } = await context.supabase
      .from("member_exercise_swaps")
      .upsert(baseRows, {
        onConflict: "enrollment_id,week_index,day_index,exercise_index",
      });
    if (error) throw new Error(error.message);

    return { count: baseRows.length };
  });

export const clearMemberSwap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        enrollmentId: z.string().uuid(),
        weekIndex: z.number().int().min(1),
        dayIndex: z.number().int().min(1),
        exerciseIndex: z.number().int().min(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureEnrollmentOwned(context.supabase, data.enrollmentId, context.userId);
    const { error } = await context.supabase
      .from("member_exercise_swaps")
      .delete()
      .eq("enrollment_id", data.enrollmentId)
      .eq("week_index", data.weekIndex)
      .eq("day_index", data.dayIndex)
      .eq("exercise_index", data.exerciseIndex);
    if (error) throw new Error(error.message);
    return { ok: true };
  });