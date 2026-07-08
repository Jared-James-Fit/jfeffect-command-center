/**
 * Slice 2d — pure guard/normalization helpers shared by the scheduling
 * server functions. Extracted so their invariants can be tested without
 * booting Supabase, TanStack Start, or auth middleware.
 *
 * Every rule here mirrors a spec bullet from Slice 2d:
 *   - Completed scheduled instances are immutable (move/time/reorder/remove).
 *   - Reorder payloads must contain the EXACT full instance set for a
 *     (client, date), no duplicates, and produce a normalized 0..N-1
 *     order_index sequence.
 *   - Legacy pl_days.scheduled_date writes are forbidden once an instance
 *     exists for that source_day_id.
 *   - `rescheduleFromCommittedDays` routes moves to the instance row when
 *     one exists, and only falls back to pl_days when it doesn't.
 */
export interface CompletionRow {
  scheduled_workout_id?: string | null;
  completed_at?: string | null;
}
export interface InstanceRow {
  id: string;
  source_day_id: string;
  scheduled_date: string;
}

export class ScheduleGuardError extends Error {}

/** Return the subset of instance ids that are marked completed. */
export function completedInstanceIds(comps: CompletionRow[] | null | undefined): Set<string> {
  const set = new Set<string>();
  for (const c of comps ?? []) {
    if (c.completed_at && c.scheduled_workout_id) set.add(c.scheduled_workout_id);
  }
  return set;
}

/** Return the subset of day ids that are marked completed. */
export function completedDayIds(
  comps: Array<{ day_id?: string | null; completed_at?: string | null }> | null | undefined,
): Set<string> {
  const set = new Set<string>();
  for (const c of comps ?? []) {
    if (c.completed_at && c.day_id) set.add(c.day_id);
  }
  return set;
}

/** Throw a Slice 2d guard error when the completion row shows the instance is done. */
export function assertInstanceNotCompleted(comp: CompletionRow | null | undefined): void {
  if (comp?.completed_at) {
    throw new ScheduleGuardError(
      "This workout is already completed and its history is locked. Schedule a new copy on the new date instead of moving the completed one.",
    );
  }
}

/**
 * Validate a reorder payload against the current instance ids stored for a
 * (client, date). Returns the normalized `id → order_index` list.
 *
 * Rules (all enforced):
 *   - No duplicates in the requested list.
 *   - Requested set must equal the existing set (no missing, no foreign ids).
 *   - No id may be completed.
 *   - Output order_index is 0..N-1 in the requested order (no gaps).
 */
export function validateReorderPayload(args: {
  existingIds: string[];
  requestedIds: string[];
  completed: Set<string>;
}): Array<{ id: string; orderIndex: number }> {
  const { existingIds, requestedIds, completed } = args;
  const req = new Set(requestedIds);
  if (req.size !== requestedIds.length) {
    throw new ScheduleGuardError("Reorder payload contains duplicate instance ids.");
  }
  const exist = new Set(existingIds);
  if (exist.size !== req.size || [...req].some((id) => !exist.has(id))) {
    throw new ScheduleGuardError(
      "Reorder payload does not match the current instances for this date. Refresh the schedule and try again.",
    );
  }
  for (const id of requestedIds) {
    if (completed.has(id)) {
      throw new ScheduleGuardError(
        "One of these workouts is already completed and cannot be reordered.",
      );
    }
  }
  return requestedIds.map((id, i) => ({ id, orderIndex: i }));
}

/**
 * Guard for the legacy day-based mutation paths (`moveWorkout`,
 * `swapWorkouts`, `applyBulkScheduleChange`). If ANY of the passed day ids
 * has a scheduled instance for this client, reject — otherwise the write
 * to pl_days.scheduled_date silently desyncs from the canonical calendar.
 */
export function assertNoInstanceForDays(args: {
  instances: Array<{ source_day_id: string }>;
  dayIds: string[];
}): void {
  const set = new Set(args.instances.map((i) => i.source_day_id));
  if (args.dayIds.some((id) => set.has(id))) {
    throw new ScheduleGuardError(
      "One of these workouts uses the new scheduling system. Move it from the workout calendar instead.",
    );
  }
}

/**
 * Route bulk realignment moves. For each (dayId, newDate) move, decide
 * whether to update the instance row (if one exists for this client) or
 * the legacy pl_days row. Ensures pl_days is never mutated when an
 * instance is present.
 */
export function planRealignTargets(args: {
  moves: Array<{ dayId: string; newDate: string; prevDate: string | null }>;
  instances: InstanceRow[];
}): Array<
  | { target: "instance"; dayId: string; instanceId: string; newDate: string; prevDate: string }
  | { target: "day"; dayId: string; newDate: string; prevDate: string | null }
> {
  const instMap = new Map<string, InstanceRow>();
  for (const r of args.instances) {
    const prev = instMap.get(r.source_day_id);
    if (!prev || r.scheduled_date < prev.scheduled_date) instMap.set(r.source_day_id, r);
  }
  return args.moves.map((m) => {
    const inst = instMap.get(m.dayId);
    if (inst) {
      return {
        target: "instance" as const,
        dayId: m.dayId,
        instanceId: inst.id,
        newDate: m.newDate,
        prevDate: inst.scheduled_date,
      };
    }
    return {
      target: "day" as const,
      dayId: m.dayId,
      newDate: m.newDate,
      prevDate: m.prevDate,
    };
  });
}
