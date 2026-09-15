/**
 * CALENDAR DATES — timezone-safe helpers.
 *
 * A coaching start date is a CALENDAR date, not an instant. `new Date("2026-09-20")`
 * parses as UTC midnight and renders as Sep 19 anywhere west of Greenwich, which is
 * exactly how a picked date used to drift a day. Everything here stays in local
 * wall-clock terms: strings are `yyyy-MM-dd`, Dates are local noon.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}

/** `yyyy-MM-dd` → local Date at noon (never crosses a day boundary on DST/UTC shifts). */
export function parseCalendarDate(value?: string | null): Date | undefined {
  if (!isCalendarDate(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Date → `yyyy-MM-dd` using LOCAL parts, so the day the coach tapped is the day stored. */
export function toCalendarDate(date?: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayCalendarDate(now: Date = new Date()): string {
  return toCalendarDate(now);
}

/** "September 20, 2026" — display only; the stored value never changes shape. */
export function formatCalendarDate(value?: string | null, fallback = "Not set"): string {
  const date = parseCalendarDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });
}

/** Round-trip guard used by tests: pick → store → read must be the same day. */
export function calendarRoundTrip(value: string): string {
  return toCalendarDate(parseCalendarDate(value) ?? null);
}
