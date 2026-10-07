import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type WorkoutStatusKey = "not_started" | "in_progress" | "completed";

export function workoutStatusLabel(k: WorkoutStatusKey) {
  return k === "not_started" ? "Not Started" : k === "in_progress" ? "In Progress" : "Completed";
}

type SetStatusResult = {
  snapshot_id: string;
  from_status: WorkoutStatusKey;
  to_status: WorkoutStatusKey;
  cleared_sets: number;
  cleared_warmups: number;
};

const sb = supabase as any;

/** Every cache that renders workout status, logged sets or analytics. */
function invalidateWorkoutSurfaces(qc: QueryClient, clientId: string, extra: readonly (readonly unknown[])[]) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["my-workouts", clientId] }),
    qc.invalidateQueries({ queryKey: ["workouts-experience-client", clientId] }),
    qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey?.[0];
        return typeof k === "string" && (
          k.startsWith("pl-") || k.startsWith("workout-") || k.startsWith("training-analytics")
          || k === "weight-lifted" || k === "day-completion"
        );
      },
    }),
    ...extra.map((k) => qc.invalidateQueries({ queryKey: k as unknown[] })),
  ]);
}

/**
 * Change one workout instance's status through the server (workout_set_status):
 * one transaction, snapshot first. "Not Started" is a reset — it clears that
 * instance's logged sets, warm-ups and review. Every change gets an Undo toast
 * that restores the snapshot exactly (workout_undo_status).
 */
export function useWorkoutStatusChange({
  dayId,
  clientId,
  scheduledWorkoutId = null,
  invalidateKeys = [],
}: {
  dayId: string;
  clientId: string;
  scheduledWorkoutId?: string | null;
  invalidateKeys?: readonly (readonly unknown[])[];
}) {
  const qc = useQueryClient();

  const undo = async (snapshotId: string) => {
    try {
      const { data, error } = await sb.rpc("workout_undo_status", { _snapshot_id: snapshotId });
      if (error) throw error;
      await invalidateWorkoutSurfaces(qc, clientId, invalidateKeys);
      const restored = (data as { status: WorkoutStatusKey; restored_sets: number } | null);
      toast.success(
        restored?.restored_sets
          ? `Restored · ${restored.restored_sets} set${restored.restored_sets === 1 ? "" : "s"} back`
          : `Restored · ${workoutStatusLabel(restored?.status ?? "not_started")}`,
      );
    } catch (err: any) {
      toast.error("Couldn't undo", { description: err?.message });
    }
  };

  const change = async (next: WorkoutStatusKey): Promise<SetStatusResult> => {
    const { data, error } = await sb.rpc("workout_set_status", {
      _client_id: clientId,
      _day_id: dayId,
      _scheduled_workout_id: scheduledWorkoutId,
      _status: next,
    });
    if (error) throw error;
    const res = data as SetStatusResult;
    await invalidateWorkoutSurfaces(qc, clientId, invalidateKeys);
    const cleared = res.cleared_sets + res.cleared_warmups;
    toast.success(
      next === "not_started" && cleared > 0
        ? `Workout reset · ${res.cleared_sets} set${res.cleared_sets === 1 ? "" : "s"} cleared`
        : `Status: ${workoutStatusLabel(next)}`,
      { duration: 10_000, action: { label: "Undo", onClick: () => void undo(res.snapshot_id) } },
    );
    return res;
  };

  return { change, undo };
}
