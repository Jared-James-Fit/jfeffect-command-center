/**
 * The Analytics page's period (Nov 25 2026): a range of the business's own calendar days
 * (America/Winnipeg, the same clock every report reads), and the period it's compared with, the
 * same number of days just before it. Pure.
 */

export const BI_TZ = "America/Winnipeg";

export const PERIOD_PRESETS = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "12m", label: "12 months", days: 365 },
] as const;
export type PresetKey = (typeof PERIOD_PRESETS)[number]["key"] | "custom";

export type BiRange = { from: string; to: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

/** Today on the business's clock, "YYYY-MM-DD". */
export function businessDay(at: Date = new Date(), tz = BI_TZ): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The hour (0–23) on the business's clock. */
export function businessHour(at: Date = new Date(), tz = BI_TZ): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(at)) % 24;
}

/** Monday at `hour` on the business's clock: when the weekly business summary goes out. */
export function isWeeklySummaryTime(at: Date, hour: number, tz = BI_TZ): boolean {
  return new Date(`${businessDay(at, tz)}T12:00:00Z`).getUTCDay() === 1 && businessHour(at, tz) === hour;
}

export function addDays(iso: string, n: number): string {
  const t = Date.parse(`${iso}T12:00:00Z`) + n * DAY;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY) + 1;
}

export function isIsoDay(s: unknown): s is string {
  return typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
}

/** The longest range a report reads (the visit records are kept 400 days). */
export const MAX_DAYS = 400;

/** A preset's range ending today, or a custom one checked: in order, never past today, at most MAX_DAYS. */
export function rangeFor(preset: PresetKey, today: string, custom?: Partial<BiRange>): BiRange {
  if (preset === "custom" && isIsoDay(custom?.from) && isIsoDay(custom?.to)) {
    let from = custom!.from!;
    let to = custom!.to!;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    if (from > to) from = to;
    if (daysBetween(from, to) > MAX_DAYS) from = addDays(to, -(MAX_DAYS - 1));
    return { from, to };
  }
  const p = PERIOD_PRESETS.find((x) => x.key === preset) ?? PERIOD_PRESETS[1];
  return { from: addDays(today, -(p.days - 1)), to: today };
}

/** A range the reports will read: real days, in order, never past today, at most MAX_DAYS long; else the last 30 days. */
export function checkedRange(from: unknown, to: unknown, today = businessDay()): BiRange {
  if (!isIsoDay(from) || !isIsoDay(to)) return rangeFor("30d", today);
  return rangeFor("custom", today, { from, to });
}

/** The same number of days just before. */
export function previousRange(r: BiRange): BiRange {
  const n = daysBetween(r.from, r.to);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

export function rangeLabel(r: BiRange): string {
  const y1 = r.from.slice(0, 4);
  const y2 = r.to.slice(0, 4);
  if (r.from === r.to) return `${short(r.from)}, ${y1}`;
  return y1 === y2 ? `${short(r.from)} – ${short(r.to)}, ${y2}` : `${short(r.from)}, ${y1} – ${short(r.to)}, ${y2}`;
}

/** A change as a whole percent, or null when there's nothing to compare with. */
export function pctChange(now: number | null | undefined, before: number | null | undefined): number | null {
  const a = Number(now);
  const b = Number(before);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return Math.round(((a - b) / Math.abs(b)) * 100);
}

/** A share as a whole percent of its base, or null with no base. */
export function pct(part: number | null | undefined, whole: number | null | undefined, digits = 0): number | null {
  const a = Number(part);
  const b = Number(whole);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  const f = 10 ** digits;
  return Math.round((a / b) * 100 * f) / f;
}

/** The last complete Monday-to-Sunday week before `today`, and the one before it. */
export function lastFullWeek(today: string): { week: BiRange; before: BiRange } {
  const d = new Date(`${today}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday 0
  const lastSunday = addDays(today, -(dow + 1));
  const week = { from: addDays(lastSunday, -6), to: lastSunday };
  return { week, before: previousRange(week) };
}
