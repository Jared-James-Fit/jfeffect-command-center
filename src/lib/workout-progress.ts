import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

export function useWorkoutProgress(
  dayId?: string | null,
  clientId?: string | null,
) {
  return useQuery({
    queryKey: ["workout-progress", dayId, clientId],
    enabled: !!dayId && !!clientId,
    staleTime: 15_000,
    queryFn: async (): Promise<WorkoutProgress> => {
      const [rowsRes, resultsRes] = await Promise.all([
        supabase.from("pl_exercise_rows").select("id, sets").eq("day_id", dayId!),
        supabase
          .from("pl_row_results")
          .select(
            "row_id, actual_reps, actual_load, completed_duration_seconds, pl_exercise_rows!inner(day_id)",
          )
          .eq("client_id", clientId!)
          .eq("pl_exercise_rows.day_id", dayId!),
      ]);
      return computeWorkoutProgress(
        ((rowsRes.data ?? []) as unknown) as MinRow[],
        ((resultsRes.data ?? []) as unknown) as MinResult[],
      );
    },
  });
}