/**
 * When a Stripe subscription renews, to the minute, and when the card is
 * actually charged.
 *
 * Stripe renews a subscription at the exact instant its period ends (the time
 * of day it started: a checkout at 6:47 PM renews at 6:47 PM), opens the
 * renewal invoice as a draft and charges it about an hour later (it finalizes
 * the invoice then). So a client checking their bank in the morning sees
 * nothing until the evening of their renewal day.
 *
 * `purchase_records.next_billing_at` keeps Stripe's instant; `next_billing_date`
 * is that instant's calendar day in Winnipeg (never the UTC day, which is a
 * day late for anything after 7 PM). Every writer goes through
 * `renewalColumns`, and a write that changes only the date clears the time
 * (`purchase_records_next_billing_at_follows_date`), so a time is never shown
 * against a date it doesn't belong to.
 */
import { businessToday } from "@/lib/billing-schedule";

/** How long after a renewal Stripe charges the card. */
export const RENEWAL_CHARGE_DELAY_MS = 60 * 60 * 1000;

/**
 * A subscription's current period end in Unix seconds: on the subscription
 * itself before Stripe's 2025-03-31 API, on its items after.
 */
type PeriodEndSource =
  | {
      current_period_end?: number | string | null;
      items?: { data?: Array<{ current_period_end?: number | string | null }> | null } | null;
    }
  | null
  | undefined;

export function subscriptionPeriodEnd(sub: PeriodEndSource): number | null {
  const v = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/** The renewal columns for a period end (Unix seconds), or both null. */
export function renewalColumns(unixSeconds: number | null | undefined): {
  next_billing_at: string | null;
  next_billing_date: string | null;
} {
  if (!unixSeconds || !Number.isFinite(unixSeconds))
    return { next_billing_at: null, next_billing_date: null };
  const at = new Date(unixSeconds * 1000);
  return { next_billing_at: at.toISOString(), next_billing_date: businessToday(at) };
}

/** The stored renewal instant, when it's a real time. */
export function renewalInstant(nextBillingAt: string | null | undefined): Date | null {
  if (!nextBillingAt) return null;
  const d = new Date(nextBillingAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The stored time for a renewal day, only when it falls on that day in
 * Winnipeg (the pair `renewalColumns` writes); anything else is no time.
 */
export function renewalTimeFor(
  date: string | null | undefined,
  nextBillingAt: string | null | undefined,
): string | null {
  const at = renewalInstant(nextBillingAt);
  return date && at && businessToday(at) === date ? (nextBillingAt ?? null) : null;
}

/** Two stored instants are the same moment (null and missing alike). */
export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = renewalInstant(a);
  const y = renewalInstant(b);
  return x == null || y == null ? x == null && y == null : x.getTime() === y.getTime();
}

/** When Stripe charges the card for a renewal at `renewsAt`. */
export function renewalChargeAt(renewsAt: Date): Date {
  return new Date(renewsAt.getTime() + RENEWAL_CHARGE_DELAY_MS);
}

/** "6:47 PM" in the viewer's time zone (or the one given). */
export function clockTime(d: Date, timeZone?: string): string {
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

function dayKey(d: Date, timeZone?: string): string {
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

/**
 * When the card is charged, as a coach reads it: "around 7:47 PM", or with
 * the day when the hour after a late renewal crosses midnight
 * ("around 12:30 AM Nov 7").
 */
export function chargeTimeText(renewsAt: Date, timeZone?: string): string {
  const charge = renewalChargeAt(renewsAt);
  const time = clockTime(charge, timeZone);
  if (dayKey(charge, timeZone) === dayKey(renewsAt, timeZone)) return `around ${time}`;
  const day = charge.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    ...(timeZone ? { timeZone } : {}),
  });
  return `around ${time} ${day}`;
}
