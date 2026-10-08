/**
 * Member-built workouts on the pl_* engine. Shared, client-safe pieces: the
 * input shape and how a built workout becomes pl_exercise_rows.
 */
import { z } from "zod";

/** pl_blocks.source_template_block_key of each member's "My workouts" container. */
export const MEMBER_WORKOUTS_KEY = "member_workouts_v1";
export const MEMBER_WORKOUTS_BLOCK_NAME = "My workouts";

export const MemberWorkoutExercise = z.object({
  exerciseId: z.string().uuid(),
  sets: z.number().int().min(1).max(20),
  reps: z.string().trim().min(1).max(20),
  loadKg: z.number().min(0).max(1000).nullable().optional(),
});

export const MemberWorkoutInput = z.object({
  title: z.string().trim().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exercises: z.array(MemberWorkoutExercise).min(1).max(20),
});
export type MemberWorkoutInputT = z.infer<typeof MemberWorkoutInput>;

/** The pl_exercise_rows to insert for a built workout, in the order picked. */
export function memberWorkoutRows(dayId: string, exercises: MemberWorkoutInputT["exercises"]) {
  return exercises.map((e, i) => ({
    day_id: dayId,
    sort_order: i,
    exercise_id: e.exerciseId,
    sets: e.sets,
    reps_text: e.reps,
    load_kg: e.loadKg ?? null,
    load_unit: e.loadKg != null ? "kg" : null,
    measurement_type: "reps",
    tracking_type: "reps_weight",
    time_profile: "accessory_compound",
  }));
}
