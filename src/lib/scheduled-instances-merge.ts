/**
 * Canonical merge between the workout prescription tree (pl_days) and the
 * new instance-level scheduling table (pl_scheduled_workouts).
 *
 * Rules — read these before changing:
 *
 * 1. `pl_scheduled_workouts` is the canonical source for WHEN a workout
 *    happens (date, time, order). `pl_days` remains the source of the
 *    prescription CONTENT (exercises, sets, reps).
 * 2. When a pl_days row has one or more instances, we emit ONE calendar
 *    card per instance. We DO NOT also emit a legacy card from
 *    `day.scheduled_date` — the migration backfilled every existing
 *    `scheduled_date` into an instance, so re-emitting the day itself
 *    would double-render the workout.
 * 3. When a pl_days row has `scheduled_date` set but NO matching
 *    instance (edge case — a row created after backfill that skipped
 *    the scheduled-workouts writer), we fall back to emitting the day
 *    once as `scheduleSource: 'legacy'`. Do not silently drop it.
 * 4. Completions are linked instance-first via
 *    `completion.scheduled_workout_id`. Legacy items fall back to the
 *    `(client_id, day_id)` completion where `scheduled_workout_id IS
 *    NULL` — the 14 historical unlinked completions surface exactly
 *    once through this path and are never guess-linked.
 * 5. This helper is pure — no I/O — so it is unit-testable and can be
 *    reused by every calendar surface (WorkoutsExperience, dashboard,
 *    admin POV, mobile).
 */

import type { WorkoutItem } from "@/lib/workout-today";

export type ScheduleSource = "program" | "manual" | "moved" | "copied" | "legacy";

export interface ScheduledInstanceRow {
  id: string;
  client_id: string;
  source_day_id: string;
  scheduled_date: string; // yyyy-mm-dd
  scheduled_time: string | null;
  order_index: number;
  schedule_source: string; // 'program' | 'manual' | 'moved' | 'copied'
  note?: string | null;
  created_at?: string;
}

export interface CompletionRow {
  id: string;
  day_id: string;
  client_id?: string;
  scheduled_workout_id?: string | null;
  completed_at?: string | null;
  [k: string]: unknown;
}

export interface MergeInput {
  /**
   * The pre-existing "one card per pl_days row" items produced by the
   * existing readers (getClientWorkouts, getClientTodayItems, etc.).
   * Items with no `day` are passed through untouched (e.g. empty weeks
   * that render a placeholder).
   */
  items: WorkoutItem[];
  /** All scheduled instances for this client, spanning any of the dayIds. */
  instances: ScheduledInstanceRow[];
  /** All completions for these days (both instance-linked and legacy). */
  completions: CompletionRow[];
  /**
   * When true, feedback-presence is attached to `completion.has_feedback`
   * from `feedbackCompletionIds`. Only `getClientWorkouts` uses this.
   */
  feedbackCompletionIds?: Set<string>;
  /** Optional per-day count of logged sets, from `getClientWorkouts`. */
  loggedSetsByDay?: Map<string, number>;
}

/**
 * Merge scheduled instances onto the prescription items.
 *
 * The returned array has one entry per rendered calendar card. When two
 * instances share the same source_day_id, two entries come back — each
 * with its own `scheduledWorkoutId` and (potentially) its own completion.
 */
export function mergeScheduledInstances({
  items,
  instances,
  completions,
  feedbackCompletionIds,
  loggedSetsByDay,
}: MergeInput): WorkoutItem[] {
  // Index instances by source_day_id, ordered by (scheduled_date, order_index)
  const instancesByDay = new Map<string, ScheduledInstanceRow[]>();
  for (const inst of instances) {
    const list = instancesByDay.get(inst.source_day_id) ?? [];
    list.push(inst);
    instancesByDay.set(inst.source_day_id, list);
  }
  for (const list of instancesByDay.values()) {
    list.sort((a, b) => {
      const dc = a.scheduled_date.localeCompare(b.scheduled_date);
      if (dc !== 0) return dc;
      return (a.order_index ?? 0) - (b.order_index ?? 0);
    });
  }

  // Index completions by instance and by (day, legacy)
  const completionByInstance = new Map<string, CompletionRow>();
  const legacyCompletionByDay = new Map<string, CompletionRow>();
  for (const c of completions) {
    if (c.scheduled_workout_id) {
      completionByInstance.set(c.scheduled_workout_id, c);
    } else {
      // Only rows with scheduled_workout_id IS NULL count as legacy.
      legacyCompletionByDay.set(c.day_id, c);
    }
  }

  const attachCompletion = (raw: CompletionRow | undefined | null) => {
    if (!raw) return null;
    if (!feedbackCompletionIds) return raw;
    return { ...raw, has_feedback: feedbackCompletionIds.has(raw.id) };
  };

  const out: WorkoutItem[] = [];
  for (const item of items) {
    // Preserve placeholder items (empty weeks) untouched.
    const day = item.day;
    if (!day || !day.id) {
      out.push(item);
      continue;
    }

    const dayInstances = instancesByDay.get(day.id) ?? [];

    if (dayInstances.length > 0) {
      // Rule 2: emit one card per instance, do NOT also emit the legacy card.
      for (const inst of dayInstances) {
        const comp = attachCompletion(completionByInstance.get(inst.id));
        out.push({
          ...item,
          scheduledWorkoutId: inst.id,
          scheduledDate: inst.scheduled_date,
          scheduledTime: inst.scheduled_time ?? null,
          scheduleOrderIndex: inst.order_index ?? 0,
          scheduleSource: (inst.schedule_source as ScheduleSource) ?? "program",
          completion: comp,
          logged_sets_count: loggedSetsByDay?.get(day.id) ?? item.logged_sets_count ?? 0,
        });
      }
      continue;
    }

    // Rule 3: no instance for this day.
    //   a. Day has legacy `scheduled_date` → emit as `legacy` fallback.
    //   b. Day has no schedule at all → pass through untouched (unscheduled
    //      prescription card that some surfaces render).
    const legacyDate: string | null = day.scheduled_date ?? null;
    const legacyComp = attachCompletion(legacyCompletionByDay.get(day.id));
    out.push({
      ...item,
      scheduledWorkoutId: null,
      scheduledDate: legacyDate,
      scheduledTime: null,
      scheduleOrderIndex: 0,
      scheduleSource: legacyDate ? "legacy" : null,
      completion: legacyComp ?? item.completion ?? null,
      logged_sets_count: loggedSetsByDay?.get(day.id) ?? item.logged_sets_count ?? 0,
    });
  }
  return out;
}