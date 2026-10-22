/**
 * "Book the rest": the sessions a client still has credits for, placed on the
 * days and times they've been training lately (their last 8 weeks of booked
 * and done sessions), after their last booking. Manitoba's statutory holidays
 * (and Boxing Day) are skipped, a day that already has a session is left
 * alone, and a Google appointment the coach already made for that day is
 * used instead of making a second one.
 * Pure: the server reads sessions, credits and Google, and writes bookings.
 */
import { DEFAULT_TZ, addDaysISO } from "@/lib/schedule-time";

export type PrebookSession = {
  session_date: string;
  start_time: string;
  end_time: string;
  status: string;
  location?: string | null;
  title?: string | null;
  timezone?: string | null;
};

export type PatternSlot = {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  start: string;
  end: string;
  location: string | null;
  title: string;
  timezone: string;
  /** Sessions on this weekday in the window. */
  seen: number;
};

export type GoogleSlot = { date: string; start: string; end: string; eventId: string; calendarId: string; summary: string; location: string | null; timezone: string };

export type PlannedSlot = {
  date: string;
  start: string;
  end: string;
  location: string | null;
  title: string;
  timezone: string;
  /** The coach's own Google appointment for that day, linked instead of adding another. */
  google: GoogleSlot | null;
};

export type PrebookPlan = {
  pattern: PatternSlot[];
  slots: PlannedSlot[];
  skipped: Array<{ date: string; reason: string }>;
  available: number;
  /** Booked through this day already (the plan starts after it). */
  bookedThrough: string | null;
};

const WINDOW_DAYS = 56;
const LOOKAHEAD_DAYS = 400;
const COUNTS = new Set(["Scheduled", "Completed", "Missed"]);

export function weekdayOf(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The nth (1-based) given weekday of a month. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return isoOf(y, m, day);
}

function easterSunday(y: number): string {
  // Anonymous Gregorian algorithm.
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoOf(y, month, day);
}

/** Manitoba's general holidays, plus Boxing Day. */
export function holidayOn(dateISO: string): string | null {
  const y = Number(dateISO.slice(0, 4));
  const md = dateISO.slice(5);
  const fixed: Record<string, string> = {
    "01-01": "New Year's Day",
    "07-01": "Canada Day",
    "09-30": "Truth and Reconciliation Day",
    "11-11": "Remembrance Day",
    "12-25": "Christmas Day",
    "12-26": "Boxing Day",
  };
  if (fixed[md]) return fixed[md];
  if (dateISO === nthWeekday(y, 2, 1, 3)) return "Louis Riel Day";
  if (dateISO === addDaysISO(easterSunday(y), -2)) return "Good Friday";
  // Victoria Day: the Monday before May 25.
  const may24 = isoOf(y, 5, 24);
  if (dateISO === addDaysISO(may24, -((weekdayOf(may24) + 6) % 7))) return "Victoria Day";
  if (dateISO === nthWeekday(y, 9, 1, 1)) return "Labour Day";
  if (dateISO === nthWeekday(y, 10, 1, 2)) return "Thanksgiving";
  return null;
}

function mode<T>(xs: T[]): T {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best = xs[0];
  for (const [x, n] of counts) if (n > (counts.get(best) ?? 0)) best = x;
  return best;
}

const hm = (t: string) => t.slice(0, 5);

/** The weekly slots the client trains on: weekdays booked in at least half of their last 8 weeks. */
export function recentPattern(sessions: PrebookSession[]): { pattern: PatternSlot[]; anchor: string | null } {
  const kept = sessions.filter((s) => COUNTS.has(s.status)).sort((a, b) => a.session_date.localeCompare(b.session_date));
  if (!kept.length) return { pattern: [], anchor: null };
  const anchor = kept[kept.length - 1].session_date;
  const from = addDaysISO(anchor, -(WINDOW_DAYS - 1));
  const recent = kept.filter((s) => s.session_date >= from);
  const weeks = new Set(recent.map((s) => addDaysISO(s.session_date, -((weekdayOf(s.session_date) + 6) % 7)))).size;
  const need = Math.max(2, Math.ceil(weeks / 2));
  const byDay = new Map<number, PrebookSession[]>();
  for (const s of recent) {
    const w = weekdayOf(s.session_date);
    byDay.set(w, [...(byDay.get(w) ?? []), s]);
  }
  const pattern: PatternSlot[] = [];
  for (const [weekday, list] of byDay) {
    if (list.length < need) continue;
    const start = mode(list.map((s) => hm(s.start_time)));
    const atStart = list.filter((s) => hm(s.start_time) === start);
    pattern.push({
      weekday,
      start,
      end: mode(atStart.map((s) => hm(s.end_time))),
      location: mode(list.map((s) => s.location ?? null)),
      title: mode(list.map((s) => s.title || "1:1 Training")),
      timezone: mode(list.map((s) => s.timezone || DEFAULT_TZ)),
      seen: list.length,
    });
  }
  // Monday first, Sunday last (how a training week reads).
  pattern.sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
  return { pattern, anchor };
}

export function planPrebook(opts: {
  sessions: PrebookSession[];
  available: number;
  today: string;
  /** Last day a credit can be used on (the package's expiry), if any. */
  until?: string | null;
  google?: GoogleSlot[];
}): PrebookPlan {
  const { pattern, anchor } = recentPattern(opts.sessions);
  const available = Math.max(0, Math.floor(opts.available));
  const plan: PrebookPlan = { pattern, slots: [], skipped: [], available, bookedThrough: anchor };
  if (!pattern.length || available === 0) return plan;

  const taken = new Set(opts.sessions.filter((s) => s.status !== "Cancelled" && s.status !== "Rescheduled").map((s) => s.session_date));
  const googleByDay = new Map<string, GoogleSlot>();
  for (const g of opts.google ?? []) if (!googleByDay.has(g.date)) googleByDay.set(g.date, g);
  const byWeekday = new Map(pattern.map((p) => [p.weekday, p]));

  let day = addDaysISO(anchor && anchor >= opts.today ? anchor : addDaysISO(opts.today, -1), 1);
  for (let i = 0; i < LOOKAHEAD_DAYS && plan.slots.length < available; i++, day = addDaysISO(day, 1)) {
    if (opts.until && day > opts.until) break;
    const slot = byWeekday.get(weekdayOf(day));
    if (!slot || taken.has(day)) continue;
    const holiday = holidayOn(day);
    if (holiday) {
      plan.skipped.push({ date: day, reason: holiday });
      continue;
    }
    const google = googleByDay.get(day) ?? null;
    plan.slots.push({
      date: day,
      start: google?.start ?? slot.start,
      end: google?.end ?? slot.end,
      location: google?.location ?? slot.location,
      title: slot.title,
      timezone: google?.timezone ?? slot.timezone,
      google,
    });
  }
  return plan;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon, Wed & Fri" */
export function patternDays(pattern: PatternSlot[]): string {
  const names = pattern.map((p) => DAY_NAMES[p.weekday]);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}
