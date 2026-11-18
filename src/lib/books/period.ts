/**
 * Reporting periods for the money screens (pure, tested): the presets people
 * reach for (this month, last month, last 30 days, quarters, year to date,
 * last year), a month picked by name, a custom range, stepping back and
 * forward, and the period each one is compared with.
 *
 * Dates are calendar days (YYYY-MM-DD) in the business's own time zone
 * (`businessToday`). A period still running is compared like for like: this
 * month so far (Nov 1 – 16) against the same days of last month (Oct 1 – 16),
 * never against a whole month, which would always look like a drop.
 */
import { billingRange } from "@/lib/date-range";

export type PeriodPreset =
  | "this_month"
  | "last_month"
  | "last_30"
  | "this_quarter"
  | "last_quarter"
  | "ytd"
  | "last_year"
  | "month"
  | "year"
  | "custom";

export type CompareMode = "previous" | "last_year" | "none";

export type Period = {
  preset: PeriodPreset;
  start: string;
  end: string;
  /** "November 2026", "Q4 2026", "2026 so far", "Last 30 days", "Oct 3 – 16". */
  label: string;
  /** What a step back / forward moves by. */
  unit: "month" | "quarter" | "year" | "days";
};

export const PRESETS: Array<{ key: Exclude<PeriodPreset, "month" | "year" | "custom">; label: string }> = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_30", label: "Last 30 days" },
  { key: "this_quarter", label: "This quarter" },
  { key: "last_quarter", label: "Last quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "last_year", label: "Last year" },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));
const pad = (n: number) => String(n).padStart(2, "0");

const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (iso: string) => iso.slice(0, 10).split("-").map(Number) as [number, number, number];
export const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Days from a to b, both counted ("Nov 1 – Nov 16" is 16). */
export function daysIn(start: string, end: string): number {
  const [ay, am, ad] = parts(start);
  const [by, bm, bd] = parts(end);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000) + 1;
}

/** The same calendar day a year earlier (Feb 29 becomes Feb 28). */
export function yearBefore(iso: string, years = 1): string {
  const [y, m, d] = parts(iso);
  return ymd(y - years, m, Math.min(d, lastDay(y - years, m)));
}

/** Months later (or earlier), the day kept inside the month. */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const t = y * 12 + (m - 1) + months;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  return ymd(ny, nm, Math.min(d, lastDay(ny, nm)));
}

const quarterOf = (m: number) => Math.floor((m - 1) / 3) + 1;

export function monthPeriod(ym: string, today: string): Period {
  const [y, m] = ym.split("-").map(Number);
  const start = ymd(y, m, 1);
  const end = ymd(y, m, lastDay(y, m));
  const preset: PeriodPreset = ym === today.slice(0, 7) ? "this_month" : ym === addMonths(today, -1).slice(0, 7) ? "last_month" : "month";
  return { preset, start, end, label: `${MONTHS[m - 1]} ${y}`, unit: "month" };
}

export function quarterPeriod(y: number, q: number, today: string): Period {
  const m1 = (q - 1) * 3 + 1;
  const start = ymd(y, m1, 1);
  const end = ymd(y, m1 + 2, lastDay(y, m1 + 2));
  const [ty, tm] = parts(today);
  const cur = y === ty && q === quarterOf(tm);
  const lastQ = quarterOf(tm) === 1 ? { y: ty - 1, q: 4 } : { y: ty, q: quarterOf(tm) - 1 };
  const preset: PeriodPreset = cur ? "this_quarter" : y === lastQ.y && q === lastQ.q ? "last_quarter" : "custom";
  return { preset, start, end, label: `Q${q} ${y} (${MON[m1 - 1]} – ${MON[m1 + 1]})`, unit: "quarter" };
}

export function yearPeriod(y: number, today: string): Period {
  const ty = Number(today.slice(0, 4));
  if (y === ty) return { preset: "ytd", start: ymd(y, 1, 1), end: today, label: `${y} so far`, unit: "year" };
  return { preset: y === ty - 1 ? "last_year" : "year", start: ymd(y, 1, 1), end: ymd(y, 12, 31), label: String(y), unit: "year" };
}

export function customPeriod(start: string, end: string, today: string): Period {
  const [a, b] = start <= end ? [start, end] : [end, start];
  const thisYear = Number(today.slice(0, 4));
  return { preset: "custom", start: a, end: b, label: billingRange(a, b, { thisYear }) ?? `${a} – ${b}`, unit: "days" };
}

export function periodFor(preset: PeriodPreset, today: string, opts: { month?: string; year?: number; start?: string; end?: string } = {}): Period {
  const [y, m] = parts(today);
  switch (preset) {
    case "this_month":
      return monthPeriod(today.slice(0, 7), today);
    case "last_month":
      return monthPeriod(addMonths(ymd(y, m, 1), -1).slice(0, 7), today);
    case "month":
      return monthPeriod(opts.month ?? today.slice(0, 7), today);
    case "last_30":
      return { preset, start: addDays(today, -29), end: today, label: "Last 30 days", unit: "days" };
    case "this_quarter":
      return quarterPeriod(y, quarterOf(m), today);
    case "last_quarter":
      return quarterOf(m) === 1 ? quarterPeriod(y - 1, 4, today) : quarterPeriod(y, quarterOf(m) - 1, today);
    case "ytd":
      return yearPeriod(y, today);
    case "last_year":
      return yearPeriod(y - 1, today);
    case "year":
      return yearPeriod(opts.year ?? y, today);
    case "custom":
      return customPeriod(opts.start ?? ymd(y, m, 1), opts.end ?? today, today);
  }
}

/** One step back (-1) or forward (+1): a month to the next month, a quarter to the next quarter, a year to the next year, a range by its own length. */
export function stepPeriod(p: Period, dir: -1 | 1, today: string): Period {
  if (p.unit === "month") return monthPeriod(addMonths(p.start, dir).slice(0, 7), today);
  if (p.unit === "quarter") {
    const [y, m] = parts(p.start);
    const t = y * 4 + (quarterOf(m) - 1) + dir;
    return quarterPeriod(Math.floor(t / 4), (t % 4) + 1, today);
  }
  if (p.unit === "year") return yearPeriod(Number(p.start.slice(0, 4)) + dir, today);
  const len = daysIn(p.start, p.end);
  const start = addDays(p.start, dir * len);
  const end = addDays(p.end, dir * len);
  if (p.preset === "last_30" && end === today) return { ...p, start, end };
  return customPeriod(start, end, today);
}

/** Never step into a period that hasn't started. */
export const canStepForward = (p: Period, today: string) => p.end < today;

/** The days of a period that have happened (a running period stops at today). */
export function elapsed(p: Period, today: string): { start: string; end: string } {
  return { start: p.start, end: p.end > today ? today : p.end };
}

export const isRunning = (p: Period, today: string) => p.start <= today && p.end >= today;

/**
 * What a period is compared with. "previous": the period before it, of the
 * same kind (the month before, the quarter before; a running period the
 * same number of days from that one's start). Year to date and a whole year
 * compare with the same days a year earlier. "last_year": the same days a year
 * earlier. Null for "none".
 */
export function comparisonFor(p: Period, mode: CompareMode, today: string): { start: string; end: string; label: string } | null {
  if (mode === "none") return null;
  const thisYear = Number(today.slice(0, 4));
  const seen = elapsed(p, today);
  const span = daysIn(seen.start, seen.end);
  let start: string;
  let end: string;
  if (mode === "last_year" || p.unit === "year") {
    start = yearBefore(seen.start);
    end = yearBefore(seen.end);
  } else if (p.unit === "month" || p.unit === "quarter") {
    const months = p.unit === "month" ? 1 : 3;
    start = addMonths(p.start, -months);
    const full = addMonths(p.start, -months).slice(0, 7);
    const [fy, fm] = full.split("-").map(Number);
    const fullEnd = p.unit === "month" ? ymd(fy, fm, lastDay(fy, fm)) : addDays(p.start, -1);
    // A running month or quarter: the same number of days into the one before.
    end = isRunning(p, today) ? (addDays(start, span - 1) < fullEnd ? addDays(start, span - 1) : fullEnd) : fullEnd;
  } else {
    end = addDays(seen.start, -1);
    start = addDays(end, -(span - 1));
  }
  return { start, end, label: comparisonLabel(start, end, Number(p.start.slice(0, 4)), thisYear) };
}

/**
 * A comparison in the words people use: a whole month by its name ("June",
 * "December 2025" when it's in another year than the period), a whole quarter
 * ("Q2"), a whole year ("2025"), anything else by its dates ("Oct 1 – 16").
 */
export function comparisonLabel(start: string, end: string, periodYear: number, thisYear: number): string {
  const [y, m, d] = parts(start);
  const other = y !== periodYear;
  if (d === 1 && end === ymd(y, m, lastDay(y, m))) return other ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];
  if (d === 1 && m === 1 && end === ymd(y, 12, 31)) return String(y);
  if (d === 1 && (m - 1) % 3 === 0 && end === ymd(y, m + 2, lastDay(y, m + 2))) return other ? `Q${quarterOf(m)} ${y}` : `Q${quarterOf(m)}`;
  return billingRange(start, end, { thisYear }) ?? `${start} – ${end}`;
}

/** "YYYY-MM" for every month a range touches, oldest first. */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start.slice(0, 7);
  const last = end.slice(0, 7);
  while (cur <= last && out.length < 240) {
    out.push(cur);
    cur = addMonths(`${cur}-01`, 1).slice(0, 7);
  }
  return out;
}

/**
 * The months a period's chart shows, never before the books' first month
 * (`firstDay`: months the business didn't exist yet are no data, not zeros).
 * A period of 3+ months shows its own months. A shorter one is seen in the
 * months around it: up to 12, ending with it, or, when there are fewer than
 * 12 months on the books before it, reaching on past it up to this month (a
 * past July is seen against what came after it too).
 */
export function chartMonths(p: Period, today: string, firstDay?: string | null): string[] {
  const first = firstDay ? firstDay.slice(0, 7) : null;
  const seenEnd = elapsed(p, today).end;
  const own = monthsBetween(p.start, seenEnd);
  if (own.length >= 3) {
    const kept = first ? own.filter((m) => m >= first) : own;
    return kept.length ? kept : own;
  }
  const periodFirst = p.start.slice(0, 7);
  const periodLast = seenEnd.slice(0, 7);
  const thisMonth = today.slice(0, 7);
  let start = addMonths(`${periodLast}-01`, -11).slice(0, 7);
  if (first && start < first) start = first < periodFirst ? first : periodFirst;
  const room = addMonths(`${start}-01`, 11).slice(0, 7);
  const end = room < thisMonth ? room : thisMonth > periodLast ? thisMonth : periodLast;
  return monthsBetween(`${start}-01`, `${end < periodLast ? periodLast : end}-01`);
}

/** "Oct", for an axis. */
export const shortMonthOf = (ym: string) => MON[Number(ym.slice(5, 7)) - 1] ?? ym;

/** Every month that has a year in [from, to], newest first, for the month picker. */
export function pickableMonths(firstDay: string, today: string): string[] {
  return monthsBetween(firstDay, today).reverse();
}

/** URL-safe period: "m:2026-11", "q:2026-4", "y:2026", "r:2026-10-03..2026-11-16", or a preset key. */
export function encodePeriod(p: Period): string {
  if (p.preset !== "month" && p.preset !== "custom" && p.preset !== "year") return p.preset;
  if (p.unit === "month") return `m:${p.start.slice(0, 7)}`;
  if (p.unit === "quarter") return `q:${p.start.slice(0, 4)}-${quarterOf(Number(p.start.slice(5, 7)))}`;
  if (p.unit === "year") return `y:${p.start.slice(0, 4)}`;
  return `r:${p.start}..${p.end}`;
}

export function decodePeriod(code: string | null | undefined, today: string): Period | null {
  if (!code) return null;
  if (PRESETS.some((x) => x.key === code)) return periodFor(code as PeriodPreset, today);
  let m = /^m:(\d{4})-(\d{2})$/.exec(code);
  if (m && +m[2] >= 1 && +m[2] <= 12) return monthPeriod(`${m[1]}-${m[2]}`, today);
  m = /^q:(\d{4})-([1-4])$/.exec(code);
  if (m) return quarterPeriod(+m[1], +m[2], today);
  m = /^y:(\d{4})$/.exec(code);
  if (m) return yearPeriod(+m[1], today);
  m = /^r:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(code);
  if (m) return customPeriod(m[1], m[2], today);
  return null;
}
