/**
 * Single source of truth for task cadence labels + semi-monthly date math.
 *
 * Nutrition Review runs on the 15th and the 30th of each month. Months with no
 * 30th (February) fall back to the LAST day of that month.
 */

export const SEMI_MONTHLY_LABEL = "15th + 30th of each month";

/** Cadence label shown to clients, derived from the schedule frequency. */
export function cadenceLabel(
  frequency: string,
  opts?: { dayName?: string | null; intervalDays?: number | null },
): string | null {
  if (frequency === "semi_monthly") return SEMI_MONTHLY_LABEL;
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
