/**
 * A Stripe subscription's next charge date, the one rule the webhook, the
 * daily sync and Reconcile with Stripe all write to
 * purchase_records.next_billing_date.
 *
 *  - Since Stripe API 2025-03-31 the billing period sits on the
 *    subscription's item, not the subscription itself, so both are read.
 *  - Stripe opens the new period (and sends customer.subscription.updated)
 *    when it creates the renewal invoice, about an hour before it charges it.
 *    Until that charge is recorded the next charge is still the period's
 *    first day, so a stored date equal to the new period's start is kept;
 *    invoice.paid then rolls it on to the period's end.
 *  - An event that carries no period never wipes a date already known.
 *  - Only a subscription that will charge again has one (active or trialing,
 *    not set to stop).
 *
 * Pure.
 */
type SubLike = {
  status?: string | null;
  cancel_at_period_end?: boolean | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_start?: number | null; current_period_end?: number | null }> } | null;
};

const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

export function subscriptionNextCharge(sub: SubLike | null | undefined, stored?: string | null): string | null {
  if (!sub) return stored ? String(stored).slice(0, 10) : null;
  const live = sub.status === "active" || sub.status === "trialing";
  if (!live || sub.cancel_at_period_end) return null;
  const item = sub.items?.data?.[0];
  const end = sub.current_period_end ?? item?.current_period_end ?? null;
  const start = sub.current_period_start ?? item?.current_period_start ?? null;
  const kept = stored ? String(stored).slice(0, 10) : null;
  if (!end) return kept;
  if (kept && start && kept === day(start)) return kept;
  return day(end);
}
