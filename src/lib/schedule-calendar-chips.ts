/**
 * Pure helper that turns a set of pl_days + pl_scheduled_workouts +
 * pl_day_completions into the exact chip list the calendar renders.
 *
 * Contract (Slice 2c):
 *  - Every scheduled instance becomes its own chip, keyed by
 *    `inst:<pl_scheduled_workouts.id>`. Two instances that share a
 *    source_day_id still produce two independent chips with distinct
 *    drag ids — a move/reorder acts on that instance only.
 *  - A pl_days row with a legacy `scheduled_date` and no matching
 *    instance falls back to a legacy chip keyed by `day:<pl_days.id>`
 *    with `instanceId: null`. Callers use that null to select the
 *    legacy dayId write path; they never touch pl_days.scheduled_date
 *    for an instance chip.
 *  - Completions link instance-first via `scheduled_workout_id`; legacy
 *    completions (`scheduled_workout_id IS NULL`) attach only to legacy
 *    chips. Instance chips never receive a legacy completion.
 */
export interface ChipDay {
  id: string;
  day_index: number;
  title: string | null;
  scheduled_date: string | null;
  week_id: string;
}
export interface ChipInstance {
  id: string;
  source_day_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  order_index: number;
  schedule_source?: string | null;
}
export interface ChipCompletion {
  id?: string;
  day_id: string;
  scheduled_workout_id?: string | null;
  completed_at?: string | null;
  in_progress_at?: string | null;
}
export interface ScheduleChip {
  chipId: string;
  instanceId: string | null;
  dayId: string;
  scheduledDate: string;
  scheduledTime: string | null;
  orderIndex: number;
  completion: ChipCompletion | null;
}

export function buildScheduleChips(opts: {
  days: ChipDay[];
  instances: ChipInstance[];
  completions: ChipCompletion[];
}): ScheduleChip[] {
  const { days, instances, completions } = opts;
  const dayById = new Map(days.map((d) => [d.id, d]));
  const daysWithInstance = new Set(instances.map((i) => i.source_day_id));

  const completionByInstance = new Map<string, ChipCompletion>();
  const legacyCompletionByDay = new Map<string, ChipCompletion>();
  for (const c of completions) {
    if (c.scheduled_workout_id) completionByInstance.set(c.scheduled_workout_id, c);
    else legacyCompletionByDay.set(c.day_id, c);
  }

  const out: ScheduleChip[] = [];
  for (const inst of instances) {
    const d = dayById.get(inst.source_day_id);
    if (!d) continue;
    out.push({
      chipId: `inst:${inst.id}`,
      instanceId: inst.id,
      dayId: d.id,
      scheduledDate: inst.scheduled_date,
      scheduledTime: inst.scheduled_time,
      orderIndex: inst.order_index,
      completion: completionByInstance.get(inst.id) ?? null,
    });
  }
  for (const d of days) {
    if (!d.scheduled_date) continue;
    if (daysWithInstance.has(d.id)) continue;
    out.push({
      chipId: `day:${d.id}`,
      instanceId: null,
      dayId: d.id,
      scheduledDate: d.scheduled_date,
      scheduledTime: null,
      orderIndex: 0,
      completion: legacyCompletionByDay.get(d.id) ?? null,
    });
  }
  return out;
}

/**
 * Given the ordered list of chip drag-ids the user dropped into a date
 * cell, return the ordered scheduled-instance IDs to persist via
 * reorderScheduledWorkouts. Legacy day chips are filtered out — they
 * have no scheduled instance to reorder.
 */
export function chipIdsToInstanceIds(chipIds: string[]): string[] {
  const out: string[] = [];
  for (const id of chipIds) {
    if (id.startsWith("inst:")) out.push(id.slice(5));
  }
  return out;
}
