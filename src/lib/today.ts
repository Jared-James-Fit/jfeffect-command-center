/**
 * Local-date utilities.
 *
 * NEVER use `new Date().toISOString().slice(0, 10)` to get "today" for any
 * value that is stored to the database, compared against a `DATE` column,
 * or shown in the calendar. `toISOString()` formats the moment in UTC, so
 * for any user west of UTC the result rolls forward to the next calendar
 * day every evening (and east of UTC it rolls back early in the morning).
 * That causes off-by-one scheduling — e.g. a program assigned at 7pm CST
 * defaulting its start date to "tomorrow" in UTC.
 *
 * Use `todayLocalISO()` for the user's actual calendar today.
 */

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" in the device's local timezone. */
export function todayLocalISO(): string {
  return toLocalISO(new Date());
}

/** "YYYY-MM-DD" for an arbitrary Date, in the device's local timezone. */
export function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse a database DATE / local ISO string as local midnight, never UTC. */
export function parseLocalDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    const fallback = new Date(value);
    if (isNaN(fallback.getTime())) return null;
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

/** Today at local midnight. */
export function localStartOfToday(): Date {
  return parseLocalDate(new Date())!;
}