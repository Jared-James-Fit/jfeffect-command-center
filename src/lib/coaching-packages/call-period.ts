/**
 * Included coaching calls (Coaching Plus): how many a client has in a billing
 * period, read the same way the database enforces it
 * (coaching_call_period / coaching_call_usage, 20270505090000_coaching_packages.sql).
 * Pure and tested (coaching-packages.test.ts).
 *
 * A period runs a month from the client's billing anchor (their subscription's
 * billing date, else the day their package started), never the calendar month:
 * an anchor on the 31st runs to the last day of a short month and back to the
 * 31st after it. A call counts against the period its date falls in; a
 * cancelled call goes back to them, a completed, missed or late-cancelled one
 * (Missed) is used. Unused calls don't carry over.
 */

/** Statuses that use an included call. */
export const CALL_USES = ["Scheduled", "Completed", "Missed"] as const;

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y!, m!, d!];
}

function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The anchor's day in a given month, clamped to that month (31 → Feb 28). */
export function anchorIn(y: number, m: number, anchorDay: number): string {
  return iso(y, m, Math.min(anchorDay, daysIn(y, m)));
}

function addMonths(y: number, m: number, n: number): [number, number] {
  const t = y * 12 + (m - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
}

/** The billing period [start, end) holding `on`, for an anchor date. */
export function callPeriod(anchorISO: string, onISO: string): { start: string; end: string } {
  const [, , ad] = parts(anchorISO);
  const [y, m] = parts(onISO);
  let start = anchorIn(y, m, ad);
  let sy = y;
  let sm = m;
  if (onISO.slice(0, 10) < start) {
    [sy, sm] = addMonths(y, m, -1);
    start = anchorIn(sy, sm, ad);
  }
  const [ey, em] = addMonths(sy, sm, 1);
  return { start, end: anchorIn(ey, em, ad) };
}

/** The last day of a period, for "Nov 4 – Dec 3". */
export function lastDay(endISO: string): string {
  const d = new Date(`${endISO.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export type CallUsage = {
  included: number;
  used: number;
  left: number;
  periodStart: string;
  periodEnd: string;
};

/** How many calls are left, from the calls in the period. */
export function callUsage(
  included: number,
  calls: ReadonlyArray<{ session_date: string; status: string }>,
  anchorISO: string,
  onISO: string,
): CallUsage {
  const { start, end } = callPeriod(anchorISO, onISO);
  const used = calls.filter(
    (c) => (CALL_USES as readonly string[]).includes(c.status) && c.session_date >= start && c.session_date < end,
  ).length;
  return { included, used, left: Math.max(0, included - used), periodStart: start, periodEnd: end };
}

/**
 * The anchor a client's periods run from: their subscription's next billing
 * date when there is one, else the anchor set on their package, else the day
 * it started.
 */
export function periodAnchor(e: {
  next_billing_date?: string | null;
  period_anchor?: string | null;
  starts_on: string;
}): string {
  return (e.next_billing_date || e.period_anchor || e.starts_on).slice(0, 10);
}

/** Can a call this far ahead still be cancelled with the call given back? */
export function canGiveBack(startsAtISO: string, nowISO: string, cancelHours: number): boolean {
  return new Date(startsAtISO).getTime() - new Date(nowISO).getTime() >= cancelHours * 3_600_000;
}
