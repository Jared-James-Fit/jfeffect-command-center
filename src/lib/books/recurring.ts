/**
 * Repeating bills set up on purpose (business_recurring_expenses), pure and
 * tested. The database adds each one to the books on its day as an expense to
 * check (books_add_recurring_expenses); these are the same dates, worked out
 * on the phone so the form can say what saving will add before it's tapped.
 *
 * The rhythm is the database's books_recurring_next: the next month (or the
 * same month next year) on the bill's day, the month's last day when it's
 * shorter (a bill on the 31st lands on Feb 28 and Apr 30), never drifting:
 * Mar 31 follows Feb 28.
 */
import type { RecurringExpenseRow } from "@/lib/business-books";

export type Every = RecurringExpenseRow["every"];

/** Catch-up limit per bill, the same as the database's. */
export const RECURRING_CATCH_UP_MAX = 24;

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The bill's day in a month (its day, or the month's last). */
export function dayIn(y: number, m: number, day: number): string {
  return `${y}-${pad(m)}-${pad(Math.min(day, lastDay(y, m)))}`;
}

/** The date after `from` in the bill's rhythm. */
export function nextRecurringDate(from: string, every: Every, day: number): string {
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  if (every === "year") y += 1;
  else if (m === 12) { y += 1; m = 1; }
  else m += 1;
  return dayIn(y, m, day);
}

/**
 * The first date on or after `on` that falls on the bill's day: what a new
 * bill's "next" is when someone picks a start (Nov 17 for a bill on the 5th
 * is Dec 5).
 */
export function firstOnOrAfter(on: string, every: Every, day: number): string {
  const y = Number(on.slice(0, 4));
  const m = Number(on.slice(5, 7));
  const here = dayIn(y, m, day);
  if (here >= on) return here;
  return every === "year" ? dayIn(y + 1, m, day) : nextRecurringDate(here, "month", day);
}

/** Every date a bill adds when the books catch up to `today` (none when it's ahead). */
export function datesDue(nextOn: string, every: Every, day: number, today: string): string[] {
  const out: string[] = [];
  let on = nextOn;
  while (on <= today && out.length < RECURRING_CATCH_UP_MAX) {
    out.push(on);
    on = nextRecurringDate(on, every, day);
  }
  return out;
}

/** What the bill costs a year at its amount. */
export function yearlyCost(r: Pick<RecurringExpenseRow, "amount_minor" | "every">): number {
  return Number(r.amount_minor) * (r.every === "year" ? 1 : 12);
}

/** Active bills first, soonest next first; stopped ones after, by vendor. */
export function sortBills(rows: RecurringExpenseRow[]): RecurringExpenseRow[] {
  return [...rows].sort((a, b) => Number(b.active) - Number(a.active) || (a.active ? a.next_on.localeCompare(b.next_on) : a.vendor.localeCompare(b.vendor)));
}

/**
 * Saving an edit can't move a bill back over days it already added (that
 * would add the same month twice under another date). Null when it's fine.
 */
export function nextOnProblem(nextOn: string, lastAddedOn: string | null): string | null {
  if (lastAddedOn && nextOn <= lastAddedOn) return `It was last added on ${lastAddedOn}. Pick a next date after that.`;
  return null;
}
