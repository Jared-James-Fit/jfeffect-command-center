/**
 * Dates and date ranges for billing products (sales, packages, coaching
 * terms, payment plans), said one way everywhere:
 *
 *   one date        "Jun 2" this year, "Jun 2, 2027" any other year
 *   a range         "Aug 10 – Sep 4"            both this year
 *                   "Nov 2 – 29"                one month, this year
 *                   "Jan 5 – Mar 2, 2025"       both in another year (said once)
 *                   "Jun 2, 2026 – Jun 2, 2027" across years (both, always)
 *
 * A range across a new year always names both years: "Jun 2 – Jun 2, 2027"
 * read as a range inside one year. A date-only value ("2026-06-02") is that
 * calendar day wherever the phone is (never parsed as UTC midnight, which
 * showed Jun 1 in Manitoba); a timestamp is the phone's own day.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Day = { y: number; m: number; d: number };

/** The calendar day a stored value means. */
export function calendarDay(value: string | null | undefined): Day | null {
  if (!value) return null;
  const s = String(value).trim();
  const only = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (only) return { y: +only[1], m: +only[2], d: +only[3] };
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return null;
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
}

export type DayOptions = {
  /** The year that goes unsaid (default: the phone's). */
  thisYear?: number;
  /** "always" names the year even when it's this year. */
  year?: "auto" | "always";
  /** "Fri, Nov 27". */
  weekday?: boolean;
};

const nowYear = () => new Date().getFullYear();

function say(x: Day, withYear: boolean, weekday: boolean): string {
  const wd = weekday ? `${WEEKDAYS[new Date(Date.UTC(x.y, x.m - 1, x.d)).getUTCDay()]}, ` : "";
  return `${wd}${MONTHS[x.m - 1]} ${x.d}${withYear ? `, ${x.y}` : ""}`;
}

/** "Jun 2" this year, "Jun 2, 2027" otherwise. */
export function billingDay(value: string | null | undefined, opts: DayOptions = {}): string | null {
  const x = calendarDay(value);
  if (!x) return null;
  const thisYear = opts.thisYear ?? nowYear();
  return say(x, opts.year === "always" || x.y !== thisYear, !!opts.weekday);
}

/**
 * A range, its years said once and never dropped across a new year. Only a
 * start reads "from Jun 2"; only an end reads "until Jun 2, 2027".
 */
export function billingRange(from: string | null | undefined, to: string | null | undefined, opts: DayOptions = {}): string | null {
  const a = calendarDay(from);
  const b = calendarDay(to);
  const thisYear = opts.thisYear ?? nowYear();
  const always = opts.year === "always";
  const weekday = !!opts.weekday;
  if (!a && !b) return null;
  if (!b) return `from ${say(a!, always || a!.y !== thisYear, weekday)}`;
  if (!a) return `until ${say(b, always || b.y !== thisYear, weekday)}`;
  if (a.y === b.y && a.m === b.m && a.d === b.d) return say(a, always || a.y !== thisYear, weekday);
  if (a.y !== b.y) return `${say(a, true, weekday)} – ${say(b, true, weekday)}`;
  const tail = always || a.y !== thisYear ? `, ${a.y}` : "";
  if (a.m === b.m && !weekday) return `${MONTHS[a.m - 1]} ${a.d} – ${b.d}${tail}`;
  return `${say(a, false, weekday)} – ${say(b, false, weekday)}${tail}`;
}
