/**
 * Cleo's read of when clients' workouts are, the way the app reads it (scheduled-instances-merge.ts):
 * a workout with entries in pl_scheduled_workouts is wherever those entries put it; any other dated
 * workout is on its own pl_days.scheduled_date. Most workouts are the second kind (Nov 18 2026: 14 of
 * 14 coaching clients had workouts in the three weeks around today dated only on the workout), so
 * reading the schedule table alone left Cleo saying "nothing scheduled" for clients who train.
 * Done is the workout's own completion (an entry's by its id, a dated workout's by its day).
 * Pure; the reads are in loadDatedWorkouts (cleo-schedule.server.ts).
 */

export type DatedDay = { id: string; clientId: string; title: string | null; focus: string | null; date: string | null; optional: boolean; visible: boolean };
export type ScheduleEntry = { id: string; clientId: string; dayId: string; date: string; time: string | null };
export type DayCompletion = { dayId: string; entryId: string | null; completedAt: string | null; rating: number | null };

export type DatedWorkout = {
  clientId: string;
  dayId: string;
  /** The schedule entry's id, when it's on the schedule table (what Cleo's cards call a workout id). */
  entryId: string | null;
  date: string;
  time: string | null;
  title: string | null;
  focus: string | null;
  optional: boolean;
  /** On a block the client can see. */
  visible: boolean;
  done: boolean;
  rating: number | null;
};

/**
 * Every workout dated in [from, to] (inclusive), in date order. `entries` are the schedule entries
 * in the range; `scheduledDayIds` every day that has an entry on any date (a day moved out of the
 * range is never also shown on its old date). Days outside `days` (an archived or at-home backup
 * block) are left out.
 */
export function datedWorkouts(x: { days: DatedDay[]; entries: ScheduleEntry[]; scheduledDayIds: Set<string>; completions: DayCompletion[]; from: string; to: string }): DatedWorkout[] {
  const dayById = new Map(x.days.map((d) => [d.id, d]));
  const byEntry = new Map<string, DayCompletion>();
  const byDay = new Map<string, DayCompletion>();
  for (const c of x.completions) {
    if (!c.completedAt) continue;
    if (c.entryId) byEntry.set(c.entryId, c);
    // A workout dated on itself is done by any finished completion of it.
    if (!byDay.has(c.dayId) || !c.entryId) byDay.set(c.dayId, c);
  }
  const out: DatedWorkout[] = [];
  for (const e of x.entries) {
    const d = dayById.get(e.dayId);
    if (!d || e.date < x.from || e.date > x.to) continue;
    const c = byEntry.get(e.id);
    out.push({ clientId: e.clientId, dayId: d.id, entryId: e.id, date: e.date, time: e.time, title: d.title, focus: d.focus, optional: d.optional, visible: d.visible, done: !!c, rating: c?.rating ?? null });
  }
  for (const d of x.days) {
    if (!d.date || d.date < x.from || d.date > x.to || x.scheduledDayIds.has(d.id)) continue;
    const c = byDay.get(d.id);
    out.push({ clientId: d.clientId, dayId: d.id, entryId: null, date: d.date, time: null, title: d.title, focus: d.focus, optional: d.optional, visible: d.visible, done: !!c, rating: c?.rating ?? null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
}

/** A past workout nobody logged, the app's way: an optional one is never a miss, and neither is one hidden from the client. */
export function isMissed(w: DatedWorkout, today: string): boolean {
  return w.date < today && !w.done && !w.optional && w.visible;
}
