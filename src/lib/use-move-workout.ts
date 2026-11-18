/**
 * ONE canonical client-side reschedule mutation, shared by drag/drop on the
 * calendar and by the Reschedule sheet.
 *
 * - patches the loaded calendar cache optimistically (instant visual move)
 * - persists in the background through the existing server functions
 * - rolls back on failure
 * - invalidates ONLY schedule/calendar keys (never programs / analytics)
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { moveScheduledWorkout } from "@/lib/scheduled-workouts.functions";
import { moveWorkout, undoScheduleChange } from "@/lib/schedule-manager.functions";
import type { WorkoutItem } from "@/lib/workout-today";
import {
  applyOptimisticMove,
  applyOptimisticScheduleInstanceMove,
  movedToLabel,
  scheduleQueryKeys,
  type MoveTarget,
} from "@/lib/workout-move";

export type MoveWorkoutVars = {
  target: MoveTarget;
  /** yyyy-mm-dd */
  newDate: string;
  time?: string | null;
  orderIndex?: number | null;
};

export function useMoveWorkout(clientId?: string | null) {
  const qc = useQueryClient();
  const moveInstanceFn = useServerFn(moveScheduledWorkout);
  const moveLegacyFn = useServerFn(moveWorkout);

  return useMutation({
    mutationFn: async ({ target, newDate, time, orderIndex }: MoveWorkoutVars) => {
      if (target.scheduledWorkoutId) {
        const res = await moveInstanceFn({
          data: {
            instanceId: target.scheduledWorkoutId,
            newDate,
            ...(time !== undefined ? { time } : {}),
            ...(orderIndex !== undefined ? { orderIndex } : {}),
          },
        });
        return { ...(res as any), __instance: true as const };
      }
      const res = await moveLegacyFn({ data: { dayId: target.dayId, newDate } });
      return { ...(res as any), __instance: false as const };
    },
    onMutate: async ({ target, newDate }) => {
      // Stop only the affected calendar reads from clobbering the optimistic
      // placement before the canonical instance mutation returns.
      await Promise.all([
        qc.cancelQueries({ queryKey: ["my-workouts"] }),
        ...(clientId ? [qc.cancelQueries({ queryKey: ["client-schedule", clientId] })] : []),
      ]);
      const workoutSnapshots = qc.getQueriesData<WorkoutItem[]>({ queryKey: ["my-workouts"] });
      const scheduleSnapshots = clientId
        ? qc.getQueriesData({ queryKey: ["client-schedule", clientId] })
        : [];

      qc.setQueriesData<WorkoutItem[]>({ queryKey: ["my-workouts"] }, (old) =>
        Array.isArray(old) ? applyOptimisticMove(old, target, newDate) : old,
      );
      if (clientId) {
        qc.setQueriesData({ queryKey: ["client-schedule", clientId] }, (old) =>
          applyOptimisticScheduleInstanceMove(old as any, target.scheduledWorkoutId, newDate),
        );
      }
      return { workoutSnapshots, scheduleSnapshots };
    },
    onError: (error: any, _vars, ctx) => {
      for (const [key, data] of [
        ...(ctx?.workoutSnapshots ?? []),
        ...(ctx?.scheduleSnapshots ?? []),
      ]) {
        qc.setQueryData(key, data);
      }
      toast.error(error?.message ?? "Could not move that workout — put it back.");
    },
    onSettled: () => {
      // Background, minimal: only the schedule/calendar surfaces.
      for (const key of scheduleQueryKeys(clientId)) {
        void qc.invalidateQueries({ queryKey: key, refetchType: "active" });
      }
    },
  });
}

/**
 * A drag's move, said out loud: "Moved to Sat, Nov 21" with Undo, so a
 * workout never changes day without the person seeing it (a press-and-hold
 * on the calendar is easy to start by accident). Undo puts it back exactly:
 * the change's own batch for a program day, the instance's previous date,
 * time and place for a scheduled instance.
 */
export function useMoveWithUndo(clientId?: string | null) {
  const qc = useQueryClient();
  const move = useMoveWorkout(clientId);
  const undoFn = useServerFn(undoScheduleChange);

  return (vars: MoveWorkoutVars) =>
    move.mutate(vars, {
      onSuccess: (res: any) => {
        if (!res?.ok || res.noop) return;
        const undo = async () => {
          try {
            if (res.__instance && vars.target.scheduledWorkoutId && res.previous) {
              await move.mutateAsync({
                target: { ...vars.target, fromDate: vars.newDate },
                newDate: res.previous.scheduledDate,
                time: res.previous.scheduledTime,
                orderIndex: res.previous.orderIndex,
              });
            } else if (res.batchId) {
              await undoFn({ data: { batchId: res.batchId } });
              for (const key of scheduleQueryKeys(clientId)) {
                void qc.invalidateQueries({ queryKey: key });
              }
            } else {
              return;
            }
            toast.success("Moved back.");
          } catch (e: any) {
            toast.error(e?.message ?? "Could not undo.");
          }
        };
        const canUndo = (res.__instance && !!res.previous) || !!res.batchId;
        toast.success(movedToLabel(vars.newDate), {
          action: canUndo ? { label: "Undo", onClick: () => void undo() } : undefined,
          duration: 7000,
        });
      },
    });
}
