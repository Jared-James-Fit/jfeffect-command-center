/**
 * Single source of truth for task cadence labels + calendar date math.
 *
 * Nutrition Review runs on the last Friday of each month
 * (`monthly_last_friday`). `semi_monthly` (15th + 30th) is kept for any
 * custom schedules still using it.
 */

export const SEMI_MONTHLY_LABEL = "15th + 30th of each month";
export const LAST_FRIDAY_LABEL = "Last Friday of each month";

/** Cadence label shown to clients, derived from the schedule frequency. */
export function cadenceLabel(
  frequency: string,
  opts?: { dayName?: string | null; intervalDays?: number | null },
): string | null {
  if (frequency === "semi_monthly") return SEMI_MONTHLY_LABEL;
  if (frequency === "monthly_last_friday") return LAST_FRIDAY_LABEL;
  const base =
    frequency === "weekly" ? "Weekly"
    : frequency === "biweekly" ? "Every 2 weeks"
    : frequency === "monthly" ? "Monthly"
    : frequency === "daily" ? "Daily"
    : frequency === "custom_days" ? `Every ${opts?.intervalDays ?? "few"} days`
    : null;
  if (!base) return null;
  return opts?.dayName ? `${base} · due ${opts.dayName}` : base;
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The second due day of a month: the 30th, or the last day when shorter. */
export function secondDueDay(year: number, month: number): number {
  return Math.min(30, lastDayOfMonth(year, month));
}

/**
 * Next semi-monthly calendar date strictly after (or equal to, when
 * `includeToday`) the given local date.
 */
export function nextSemiMonthlyDate(
  year: number,
  month: number,
  day: number,
  includeToday: boolean,
): { y: number; m: number; d: number } {
  const cmp = (candidate: number) => (includeToday ? candidate >= day : candidate > day);
  if (cmp(15)) return { y: year, m: month, d: 15 };
  const second = secondDueDay(year, month);
  if (cmp(second)) return { y: year, m: month, d: second };
  const y = month === 12 ? year + 1 : year;
  const m = month === 12 ? 1 : month + 1;
  return { y, m, d: 15 };
}

/** Day-of-month of the last Friday in the given month (month is 1-12). */
export function lastFridayOfMonth(year: number, month: number): number {
  const last = lastDayOfMonth(year, month);
  const dow = new Date(Date.UTC(year, month - 1, last)).getUTCDay();
  return last - ((dow - 5 + 7) % 7);
}

/**
 * Next last-Friday-of-month date strictly after (or equal to, when
 * `includeToday`) the given local date. Rolls into next month/year as needed.
 */
export function nextLastFridayDate(
  year: number,
  month: number,
  day: number,
  includeToday: boolean,
): { y: number; m: number; d: number } {
  const thisMonth = lastFridayOfMonth(year, month);
  if (includeToday ? thisMonth >= day : thisMonth > day) return { y: year, m: month, d: thisMonth };
  const y = month === 12 ? year + 1 : year;
  const m = month === 12 ? 1 : month + 1;
  return { y, m, d: lastFridayOfMonth(y, m) };
}
