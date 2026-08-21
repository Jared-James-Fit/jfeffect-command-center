/**
 * Canonical helpers for rescheduling ONE workout instance.
 *
 * Canonical rule (unchanged): `pl_scheduled_workouts` = WHEN,
 * `source_day_id -> pl_days` = WHICH. A move only ever writes
 * `scheduled_date` / `scheduled_time` / `order_index` on the instance.
 * Prescriptions, logs, completions and identity are never touched.
 *
 * This module is pure so both entry points — drag/drop on the calendar and
 * the Reschedule sheet — share one optimistic + validation implementation.
 */
import type { WorkoutItem } from "@/lib/workout-today";

export type MoveTarget = {
  /** pl_scheduled_workouts.id when the item is a canonical instance. */
  scheduledWorkoutId: string | null;
  /** pl_days.id — always present for a real workout card. */
  dayId: string;
  /** yyyy-mm-dd the card currently renders on. */
  fromDate: string | null;
};

export function isCompletedItem(item: Pick<WorkoutItem, "completion">): boolean {
  return !!(item?.completion as any)?.completed_at;
}

/**
 * Completed workouts keep their history safeguards: they are never casually
 * drag-rescheduled. The explicit Reschedule sheet still allows it (with its
 * existing warnings) because that path is a deliberate coach action.
 */
export function canDragRescheduleItem(item: WorkoutItem): boolean {
  if (!item?.day?.id) return false;
  if (isCompletedItem(item)) return false;
  return true;
}

export function moveTargetFromItem(
  item: WorkoutItem,
  fromDate: string | null,
): MoveTarget | null {
  if (!item?.day?.id) return null;
  return {
    scheduledWorkoutId: item.scheduledWorkoutId ?? null,
    dayId: String(item.day.id),
    fromDate: item.scheduledDate ?? fromDate ?? null,
  };
}

function matches(item: WorkoutItem, target: MoveTarget): boolean {
  if (target.scheduledWorkoutId) {
    return (item.scheduledWorkoutId ?? null) === target.scheduledWorkoutId;
  }
  // Legacy (no instance): identify by day id, and by the date it rendered on
  // when several legacy rows share a day id.
  if (String(item.day?.id ?? "") !== target.dayId) return false;
  if (!target.fromDate) return true;
  const current = item.scheduledDate ?? item.day?.scheduled_date ?? null;
  return !current || current === target.fromDate;
}

/**
 * Immutably patch a loaded workout list so the moved instance renders on its
 * destination date immediately. Preserves the exact object identity fields
 * (scheduledWorkoutId, day, completion, logs) — nothing is cloned or removed,
 * and unrelated workouts on the destination date are untouched.
 */
export function applyOptimisticMove(
  items: WorkoutItem[] | undefined | null,
  target: MoveTarget,
  newDate: string,
): WorkoutItem[] {
  const list = items ?? [];
  let hit = false;
  const next = list.map((item) => {
    if (hit || !matches(item, target)) return item;
    hit = true;
    const patched: WorkoutItem = { ...item, scheduledDate: newDate };
    if (!target.scheduledWorkoutId && item.day?.scheduled_date) {
      patched.day = { ...item.day, scheduled_date: newDate };
    }
    return patched;
  });
  return hit ? next : list;
}

/**
 * Minimal invalidation set. A date change must NOT refetch programs,
 * prescriptions, exercise history or analytics — only the schedule/calendar
 * surfaces that read `scheduled_date`.
 */
export function scheduleQueryKeys(clientId: string | null | undefined) {
  const id = clientId ?? undefined;
  return [
    ["my-workouts", id],
    ["scheduled-workouts", id],
    ["client-schedule", id],
    ["week-sched-data"],
    ["schedule-manager"],
    ["today-dashboard", id],
  ].map((k) => k.filter((p) => p !== undefined));
}

/**
 * Realtime / refetch reconciliation is idempotent: once the server confirms
 * the destination date, an echo carrying the OLD date for the same instance
 * is ignored until the fetch that actually contains the new value arrives.
 */
export function reconcileMovedDate(
  serverDate: string | null | undefined,
  optimisticDate: string | null | undefined,
  confirmed: boolean,
): string | null {
  if (!optimisticDate) return serverDate ?? null;
  if (!serverDate) return optimisticDate;
  if (serverDate === optimisticDate) return serverDate;
  // Server still reports the pre-move date while our move is confirmed →
  // keep the optimistic value so the card never flashes back.
  return confirmed ? optimisticDate : serverDate;
}

/**
 * Patch the Schedule Manager cache for an exact canonical instance. This is
 * deliberately narrower than a refetch: moving an instance changes only its
 * placement, so its source day, completion, prescriptions, and all other
 * cached schedule records keep their identities.
 */
type ScheduleInstanceCache = {
  id: string;
  scheduled_date: string;
  [key: string]: unknown;
};

type ClientScheduleCache = {
  scheduledInstances?: ScheduleInstanceCache[];
  [key: string]: unknown;
};

export function applyOptimisticScheduleInstanceMove(
  schedule: ClientScheduleCache | undefined | null,
  scheduledWorkoutId: string | null,
  newDate: string,
): ClientScheduleCache | undefined | null {
  if (!schedule || !scheduledWorkoutId || !Array.isArray(schedule.scheduledInstances)) {
    return schedule;
  }

  let hit = false;
  const scheduledInstances = schedule.scheduledInstances.map((instance) => {
    if (hit || instance.id !== scheduledWorkoutId) return instance;
    hit = true;
    return { ...instance, scheduled_date: newDate };
  });

  return hit ? { ...schedule, scheduledInstances } : schedule;
}
