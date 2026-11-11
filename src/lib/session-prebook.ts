/**
 * "Book ahead": a client's next sessions placed on the days and times they've
 * been training lately (their last package's worth of booked and done
 * sessions: how many a week, which days, what time), after their last booking.
 * By default it books what's left on their packages; past that they go on the
 * next package (a renewal they pay later). The coach can change the days and
 * times before booking. Manitoba's statutory holidays (and Boxing Day) are
 * skipped, a day that already has a session is left alone, and a Google
 * appointment the coach already made for that day is used instead of making a
 * second one.
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
  /** The days and times the plan follows (the coach's, else the ones read). */
  pattern: PatternSlot[];
  /** The days and times read from their sessions. */
  read: PatternSlot[];
  /** Sessions a week they train, from the same read. */
  perWeek: number;
  /** The sessions the read came from. */
  basis: { sessions: number; from: string | null; to: string | null };
  slots: PlannedSlot[];
  skipped: Array<{ date: string; reason: string }>;
  /** Sessions free to book on their packages. */
  available: number;
  /** How many the plan books. */
  count: number;
  /** Booked through this day already (the plan starts after it). */
  bookedThrough: string | null;
};

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

/** The most common value; a tie goes to the one seen last (xs oldest first). */
function mode<T>(xs: T[]): T {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best = xs[xs.length - 1];
  for (let i = xs.length - 1; i >= 0; i--) if ((counts.get(xs[i]) ?? 0) > (counts.get(best) ?? 0)) best = xs[i];
  return best;
}

const hm = (t: string) => t.slice(0, 5);

/** The Monday of a date's week. */
export function mondayOf(dateISO: string): string {
  return addDaysISO(dateISO, -((weekdayOf(dateISO) + 6) % 7));
}

/** How many sessions the pattern reads from: a package's worth (Marc buys 16). */
export const PATTERN_SESSIONS = 16;

export type PatternRead = {
  pattern: PatternSlot[];
  /** Their last session (booked or done): the plan starts after it. */
  anchor: string | null;
  /** Sessions a week they train. */
  perWeek: number;
  /** The sessions it was read from. */
  basis: { sessions: number; from: string | null; to: string | null };
};

/**
 * The weekly slots the client trains on, read from their last package's worth
 * of sessions (booked and done): how many a week they train (the usual week,
 * the first and last weeks of the window left out as they're often partial),
 * then that many of the weekdays they trained most, a tie going to a day of
 * their last full week, then the one trained most recently. Each day's time is
 * its most common start (a tie: the latest).
 */
export function recentPattern(sessions: PrebookSession[], opts: { lookback?: number } = {}): PatternRead {
  const kept = sessions
    .filter((s) => COUNTS.has(s.status))
    .sort((a, b) => `${a.session_date}${a.start_time}`.localeCompare(`${b.session_date}${b.start_time}`));
  if (!kept.length) return { pattern: [], anchor: null, perWeek: 0, basis: { sessions: 0, from: null, to: null } };
  const anchor = kept[kept.length - 1].session_date;
  const recent = kept.slice(-Math.max(4, opts.lookback ?? PATTERN_SESSIONS));
  const basis = { sessions: recent.length, from: recent[0].session_date, to: anchor };

  const perWeekCounts = new Map<string, number>();
  for (const s of recent) perWeekCounts.set(mondayOf(s.session_date), (perWeekCounts.get(mondayOf(s.session_date)) ?? 0) + 1);
  const weeks = [...perWeekCounts.keys()].sort();
  const inner = (weeks.length >= 3 ? weeks.slice(1, -1) : weeks).map((w) => perWeekCounts.get(w)!).sort((a, b) => a - b);
  const median = inner.length % 2 ? inner[(inner.length - 1) / 2] : (inner[inner.length / 2 - 1] + inner[inner.length / 2]) / 2;
  const lastFullWeek = addDaysISO(mondayOf(anchor), -7);
  const inLastFull = new Set(recent.filter((s) => mondayOf(s.session_date) === lastFullWeek).map((s) => weekdayOf(s.session_date)));

  const byDay = new Map<number, PrebookSession[]>();
  for (const s of recent) {
    const w = weekdayOf(s.session_date);
    byDay.set(w, [...(byDay.get(w) ?? []), s]);
  }
  const ranked = [...byDay.entries()].sort(([wa, a], [wb, b]) =>
    // A day trained twice beats a one-off; then most trained; then their last full week; then most recent.
    Number(b.length >= 2) - Number(a.length >= 2)
    || b.length - a.length
    || Number(inLastFull.has(wb)) - Number(inLastFull.has(wa))
    || b[b.length - 1].session_date.localeCompare(a[a.length - 1].session_date)
    || ((wa + 6) % 7) - ((wb + 6) % 7),
  );
  const perWeek = Math.max(1, Math.min(7, Math.round(median)));
  // Days they repeat come first; a one-off day only fills in when those are fewer than they
  // train a week, and only from enough sessions to read a week from.
  const repeat = ranked.filter(([, list]) => list.length >= 2).length;
  const take = Math.min(perWeek, recent.length >= 4 ? ranked.length : repeat);

  const pattern: PatternSlot[] = ranked.slice(0, take).map(([weekday, list]) => {
    const start = mode(list.map((s) => hm(s.start_time)));
    const atStart = list.filter((s) => hm(s.start_time) === start);
    return {
      weekday,
      start,
      end: mode(atStart.map((s) => hm(s.end_time))),
      location: mode(list.map((s) => s.location ?? null)),
      title: mode(list.map((s) => s.title || "1:1 Training")),
      timezone: mode(list.map((s) => s.timezone || DEFAULT_TZ)),
      seen: list.length,
    };
  });
  // Monday first, Sunday last (how a training week reads).
  pattern.sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
  return { pattern, anchor, perWeek, basis };
}

/** A coach's own weekly days and times, used in place of the ones read. */
export type PatternOverride = Array<{ weekday: number; start: string; end: string }>;

/** The read pattern with the coach's days and times put in (place, title and zone kept from the read). */
export function withPatternOverride(read: PatternSlot[], override: PatternOverride | null | undefined, fallback: Partial<PatternSlot> = {}): PatternSlot[] {
  if (!override) return read;
  const base = read[0] ?? null;
  return override
    .filter((o, i, all) => o.weekday >= 0 && o.weekday <= 6 && /^\d{2}:\d{2}/.test(o.start) && /^\d{2}:\d{2}/.test(o.end) && hm(o.end) > hm(o.start)
      && all.findIndex((x) => x.weekday === o.weekday) === i)
    .map((o) => {
      const same = read.find((r) => r.weekday === o.weekday) ?? base;
      return {
        weekday: o.weekday,
        start: hm(o.start),
        end: hm(o.end),
        location: same?.location ?? fallback.location ?? null,
        title: same?.title ?? fallback.title ?? "1:1 Training",
        timezone: same?.timezone ?? fallback.timezone ?? DEFAULT_TZ,
        seen: read.find((r) => r.weekday === o.weekday)?.seen ?? 0,
      };
    })
    .sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
}

export function planPrebook(opts: {
  sessions: PrebookSession[];
  /** Sessions free to book on their packages. */
  available: number;
  today: string;
  /** How many to book (default: what's free). Past `available` they go on the next package. */
  count?: number;
  /** Last day a credit can be used on (the package's expiry), if any. */
  until?: string | null;
  google?: GoogleSlot[];
  /** The coach's own days and times. */
  pattern?: PatternOverride | null;
}): PrebookPlan {
  const read = recentPattern(opts.sessions);
  const pattern = withPatternOverride(read.pattern, opts.pattern);
  const available = Math.max(0, Math.floor(opts.available));
  const count = Math.max(0, Math.floor(opts.count ?? available));
  const plan: PrebookPlan = {
    pattern,
    read: read.pattern,
    perWeek: read.perWeek,
    basis: read.basis,
    slots: [],
    skipped: [],
    available,
    count,
    bookedThrough: read.anchor,
  };
  if (!pattern.length || count === 0) return plan;
  // A package's last day only limits the sessions it pays for.
  const until = count <= available ? opts.until ?? null : null;

  const taken = new Set(opts.sessions.filter((s) => s.status !== "Cancelled" && s.status !== "Rescheduled").map((s) => s.session_date));
  const googleByDay = new Map<string, GoogleSlot>();
  for (const g of opts.google ?? []) if (!googleByDay.has(g.date)) googleByDay.set(g.date, g);
  const byWeekday = new Map(pattern.map((p) => [p.weekday, p]));

  // After their last booking, never before tomorrow (a time today may already be gone).
  let day = addDaysISO(read.anchor && read.anchor >= opts.today ? read.anchor : opts.today, 1);
  for (let i = 0; i < LOOKAHEAD_DAYS && plan.slots.length < count; i++, day = addDaysISO(day, 1)) {
    if (until && day > until) break;
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

/** Where the sessions a run books come from, in one line. */
export function prebookCountNote(o: { count: number; available: number; size: number | null; first: string }): string {
  const plural = (n: number) => `${n} session${n === 1 ? "" : "s"}`;
  const next = o.size ? `${o.first}'s next ${o.size}` : "their next package";
  if (o.count <= 0) return "Nothing to book.";
  if (o.count <= o.available) return o.count === o.available ? `Books the ${o.available} left on their package.` : `Uses ${o.count} of the ${plural(o.available)} left.`;
  const past = o.count - o.available;
  const tail = `Renew to bill ${o.size ? "it" : "them"}: nothing is charged now.`;
  if (o.available > 0) return `Uses the ${o.available} left, then ${past === 1 ? "1 goes" : `${past} go`} on ${next}. ${tail}`;
  return `${o.count === 1 ? "It goes" : "They go"} on ${next}. ${tail}`;
}
