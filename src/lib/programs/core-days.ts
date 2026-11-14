/**
 * Workouts a week that aren't optional, the most in any week of a template:
 * what a member picks training days for when they start it. An optional
 * session (`is_optional`: Elite Powerlifting's recovery day, the running
 * programs' extra easy runs) never needs a training day of its own; the
 * scheduler puts it on a free day around them (committed-schedule-realign.ts).
 * Pure: reads a v2 template (`blocks_data`) or a single block (`weeks_data`).
 */
/** Every week of a template, across its blocks (a v2 template) or its one block. */
export function payloadWeeks(payload: any): any[] {
  const p = payload || {};
  return Array.isArray(p.blocks_data) && p.blocks_data.length
    ? p.blocks_data.filter((b: any) => b && !b.archived && !b.deleted).flatMap((b: any) => b.weeks_data || [])
    : Array.isArray(p.weeks_data) ? p.weeks_data : [];
}

function mostInAWeek(payload: any, optional: boolean): number {
  let most = 0;
  for (const w of payloadWeeks(payload)) most = Math.max(most, (w?.days || []).filter((d: any) => d && !!d.is_optional === optional).length);
  return most;
}

export function coreDaysPerWeek(tpl: { payload?: any } | null | undefined): number | null {
  return mostInAWeek(tpl?.payload, false) || null;
}

/** The most optional sessions in any week (0 when there are none), for "3 days a week + 2 optional". */
export function optionalDaysPerWeek(payload: any): number {
  return mostInAWeek(payload, true);
}

/** A membership listing's days a week: the core workouts, else what the template says, else 3. */
export function listingDaysPerWeek(tpl: { payload?: any; days_per_week?: number | null } | null | undefined): number {
  return coreDaysPerWeek(tpl) ?? (Number(tpl?.days_per_week) || 3);
}

/** Every workout in a template, across all its blocks (optional ones included). */
export function countPayloadWorkouts(payload: any): number {
  return payloadWeeks(payload).reduce((n, w) => n + (Array.isArray(w?.days) ? w.days.length : 0), 0);
}
