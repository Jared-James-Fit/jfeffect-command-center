import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cardioRowDone, isPlanCardioRow } from "@/lib/workouts/workout-cardio";

/**
 * Workout completion summary for a single day, calculated from
 * prescribed sets on `pl_exercise_rows` vs a client's logged
 * `pl_row_results`. Extra sets performed above what was programmed
 * are capped so completion never exceeds 100%.
 */

export type WorkoutProgressStatus = "not_started" | "in_progress" | "completed";

export type WorkoutProgress = {
  completedSets: number;
  prescribedSets: number;
  pct: number;
  status: WorkoutProgressStatus;
  /**
   * The day's cardio (the cardio plan's row, workout-cardio.ts): done, not yet,
   * or null when the day has none. Never part of the sets above, which are the
   * lifts only, the same reading as the logger and the workouts list.
   */
  cardioDone?: boolean | null;
};

type MinRow = { id: string; sets: number | null };
type MinResult = {
  row_id: string;
  actual_reps: number | null;
  actual_load: number | null;
  completed_duration_seconds: number | null;
};

export function computeWorkoutProgress(
  rows: MinRow[],
  results: MinResult[],
): WorkoutProgress {
  const resultsByRow = new Map<string, MinResult[]>();
  for (const r of results) {
    const list = resultsByRow.get(r.row_id) ?? [];
    list.push(r);
    resultsByRow.set(r.row_id, list);
  }
  let prescribed = 0;
  let completed = 0;
  for (const row of rows) {
    const p = Math.max(0, Number(row.sets) || 0);
    prescribed += p;
    const logged = (resultsByRow.get(row.id) ?? []).filter(
      (r) =>
        (r.actual_reps != null && Number(r.actual_reps) > 0) ||
        (r.actual_load != null && Number(r.actual_load) > 0) ||
        (r.completed_duration_seconds != null &&
          Number(r.completed_duration_seconds) > 0),
    ).length;
    completed += Math.min(logged, p);
  }
  const pct = prescribed > 0 ? Math.round((completed / prescribed) * 100) : 0;
  const clamped = Math.max(0, Math.min(100, pct));
  const status: WorkoutProgressStatus =
    prescribed > 0 && completed >= prescribed
      ? "completed"
      : completed > 0
        ? "in_progress"
        : "not_started";
  return { completedSets: completed, prescribedSets: prescribed, pct: clamped, status };
}

type DayRow = MinRow & { cardio_target_id?: string | null };
type DayResult = MinResult & { completed_at?: string | null };

/**
 * One day's progress as every screen reads it: the lifts' sets (the cardio
 * plan's row never counts toward them) and, apart, whether the day's cardio is
 * done. Pure, so the list (getClientWorkouts) and this per-day read agree.
 */
export function dayProgress(rows: readonly DayRow[], results: readonly DayResult[]): WorkoutProgress {
  const lifts = rows.filter((r) => !isPlanCardioRow(r));
  const cardio = rows.find((r) => isPlanCardioRow(r)) ?? null;
  return {
    ...computeWorkoutProgress(lifts as MinRow[], results as MinResult[]),
    cardioDone: cardio ? cardioRowDone(cardio.id, results) : null,
  };
}

export function useWorkoutProgress(
  dayId?: string | null,
  clientId?: string | null,
  /**
   * The same numbers from the workouts list (getClientWorkouts): painted at
   * once, then confirmed by this day's own small read, every time. The list is
   * the whole program and can be the copy from before a set was logged (or
   * from a read that went wrong); this read is what the card trusts, so a
   * logged set or cardio shows the moment the day is on screen.
   */
  fromList?: { progress?: WorkoutProgress | null; updatedAt?: number } | null,
) {
  const seeded = fromList?.progress ?? null;
  return useQuery({
    queryKey: ["workout-progress", dayId, clientId],
    enabled: !!dayId && !!clientId,
    staleTime: 15_000,
    initialData: seeded ?? undefined,
    // seeded as already stale: shown, and asked again straight away
    initialDataUpdatedAt: seeded ? 0 : undefined,
    queryFn: async (): Promise<WorkoutProgress> => {
      const [rowsRes, resultsRes] = await Promise.all([
        supabase.from("pl_exercise_rows").select("id, sets, cardio_target_id").eq("day_id", dayId!),
        supabase
          .from("pl_row_results")
          .select(
            "row_id, actual_reps, actual_load, completed_duration_seconds, completed_at, pl_exercise_rows!inner(day_id)",
          )
          .eq("client_id", clientId!)
          .eq("pl_exercise_rows.day_id", dayId!),
      ]);
      // A failed read is an error, never "nothing logged" (the card keeps what it had).
      if (rowsRes.error) throw rowsRes.error;
      if (resultsRes.error) throw resultsRes.error;
      return dayProgress(
        ((rowsRes.data ?? []) as unknown) as DayRow[],
        ((resultsRes.data ?? []) as unknown) as DayResult[],
      );
    },
  });
}