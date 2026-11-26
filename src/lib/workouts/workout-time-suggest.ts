/**
 * When to train on a day the program already put a workout on (Nov 25 2026).
 * Pure and deterministic, tested in workout-time-suggest.test.ts; no model.
 *
 * It only ever picks a TIME on the workout's own day: the program's days are
 * never moved, a confirmed time (`pl_scheduled_workouts.scheduled_time`) is
 * never moved, and a clash with a confirmed time is said, never fixed by code.
 *
 *  - busy: the athlete's own Google events (read live, never stored), their
 *    sessions and appointments, and other workouts with a confirmed time block;
 *    an all-day event or one marked "free" in Google is information, never busy;
 *  - length: the personal prediction's upper end (session-duration.ts), so a
 *    session that runs long still fits;
 *  - habit: when they usually start, this weekday first, else any day; with no
 *    history, early evening;
 *  - today: nothing in the past (15 min from now at the earliest).
 * With no room on the day it says so ("No open time"), never squeezes one in.
 */

export type BusyBlock = {
  /** minutes from the day's midnight; may run past 1440 */
  start: number;
  end: number;
  /** informational (all-day, "free" in Google): never blocks */
  informational?: boolean;
};

export type SuggestInput = {
  busy: readonly BusyBlock[];
  /** expected minutes (the prediction's middle) */
  durationMin: number;
  /** the upper end of the prediction; a slot must fit this */
  durationHighMin?: number | null;
  /** usual start, minutes of day */
  habitStartMin?: number | null;
  /** earliest start (today: now + lead); minutes of day */
  notBeforeMin?: number | null;
  window?: { from: number; to: number };
};

export type Suggestion = { startMin: number; endMin: number; basis: "habit" | "default" };

/** Earliest start and latest end a suggestion uses. */
export const DEFAULT_WINDOW = { from: 6 * 60, to: 22 * 60 } as const;
/** With no history: early evening, when most people train. */
export const DEFAULT_PREFERRED_START = 17 * 60;
/** Minutes kept clear before and after something busy (getting there, changing). */
export const BUFFER_MIN = 15;
export const GRID_MIN = 15;
/** Today: the earliest suggestion is this far from now. */
export const TODAY_LEAD_MIN = 15;

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

export function suggestWorkoutTime(input: SuggestInput): Suggestion | null {
  const win = input.window ?? DEFAULT_WINDOW;
  const length = Math.max(input.durationMin, input.durationHighMin ?? 0);
  if (!(length > 0)) return null;
  const blocks = input.busy.filter((b) => !b.informational && b.end > b.start);
  const preferred = input.habitStartMin ?? DEFAULT_PREFERRED_START;
  const floor = Math.max(win.from, input.notBeforeMin ?? 0);
  const first = Math.ceil(floor / GRID_MIN) * GRID_MIN;
  let best: { s: number; cost: number } | null = null;
  for (let s = first; s + length <= win.to; s += GRID_MIN) {
    const e = s + length;
    if (blocks.some((b) => overlaps(s - BUFFER_MIN, e + BUFFER_MIN, b.start, b.end))) continue;
    // nearest the habit; a tie goes to the earlier time
    const cost = Math.abs(s - preferred);
    if (!best || cost < best.cost) best = { s, cost };
  }
  if (!best) return null;
  return { startMin: best.s, endMin: best.s + Math.round(input.durationMin), basis: input.habitStartMin != null ? "habit" : "default" };
}

/* -------------------------------------------------------------------------- */
/*  Habit                                                                      */
/* -------------------------------------------------------------------------- */

export type StartHistory = { weekday: number; startMin: number };

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** When they usually start: this weekday's median from 2+, else every day's from 3+, else null. */
export function habitStart(history: readonly StartHistory[], weekday: number): number | null {
  const same = history.filter((h) => h.weekday === weekday).map((h) => h.startMin);
  if (same.length >= 2) return Math.round(median(same) / GRID_MIN) * GRID_MIN;
  if (history.length >= 3) return Math.round(median(history.map((h) => h.startMin)) / GRID_MIN) * GRID_MIN;
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Clock text and parsing                                                     */
/* -------------------------------------------------------------------------- */

/** 750 → "12:30 PM" */
export function clockLabel(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h >= 12 ? "PM" : "AM"}`;
}

/** 750 → "12:30" (pl_scheduled_workouts.scheduled_time) */
export function timeValue(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "12:30" / "12:30:00" → 750; null when it isn't a time */
export function parseTimeValue(v: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}

/** A timed thing on a date (ISO instants) as minutes of that local day; all-day → informational. */
export function busyOnDay(
  dayStart: Date,
  item: { start: string | null | undefined; end?: string | null; allDay?: boolean; free?: boolean },
  defaultMin = 60,
): BusyBlock | null {
  if (!item.start) return null;
  if (item.allDay) return { start: 0, end: 1440, informational: true };
  const s = new Date(item.start).getTime();
  if (!Number.isFinite(s)) return null;
  const eRaw = item.end ? new Date(item.end).getTime() : NaN;
  const e = Number.isFinite(eRaw) && eRaw > s ? eRaw : s + defaultMin * 60_000;
  const base = dayStart.getTime();
  const start = Math.round((s - base) / 60_000);
  const end = Math.round((e - base) / 60_000);
  if (end <= 0 || start >= 1440) return null;
  return { start: Math.max(0, start), end: Math.min(1440, end), informational: !!item.free };
}

/** A confirmed workout time clashing with something busy: said, never moved. */
export function confirmedClash(startMin: number, durationMin: number, busy: readonly BusyBlock[]): boolean {
  return busy.some((b) => !b.informational && overlaps(startMin, startMin + durationMin, b.start, b.end));
}
