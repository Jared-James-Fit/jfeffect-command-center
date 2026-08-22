/**
 * Purchase-intent idempotency.
 *
 * Root cause of Marc Asugui's duplicate sales: every "Assign offer" /
 * "Generate payment link" run inserted a brand-new purchase_records row, so
 * repeated checkout attempts for the SAME intended purchase produced multiple
 * permanent sale rows.
 *
 * Rule: a payment REQUEST is not a SALE. An existing pending/draft row for the
 * same client + offer that has no Stripe money attached is the same purchase
 * intent and must be reused. Only rows with real Stripe evidence (completed
 * checkout, payment intent, subscription, or money paid) are sales and are
 * never reused or overwritten.
 *
 * Pure — no I/O.
 */

export type PurchaseIntentRow = {
  id: string;
  client_id?: string | null;
  offer_id?: string | null;
  payment_status?: string | null;
  amount_paid?: number | string | null;
  amount_paid_cents?: number | null;
  stripe_subscription_id?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_checkout_session_id?: string | null;
  created_at?: string | null;
};

const REUSABLE_STATUSES = new Set([
  "draft",
  "pending payment",
  "payment link sent",
  "not sent",
  "unpaid",
]);

/** True when the row is a completed/known sale that must never be reused. */
export function isSettledSale(row: PurchaseIntentRow): boolean {
  const paid =
    (row.amount_paid_cents ?? 0) > 0 || Number(row.amount_paid ?? 0) > 0;
  return (
    paid ||
    !!row.stripe_subscription_id ||
    !!row.stripe_payment_intent_id ||
    !!row.stripe_checkout_session_id
  );
}

/** True when this row represents an open, unpaid purchase intent. */
export function isReusablePurchaseIntent(row: PurchaseIntentRow): boolean {
  if (isSettledSale(row)) return false;
  const status = (row.payment_status ?? "").trim().toLowerCase();
  return REUSABLE_STATUSES.has(status);
}

/**
 * Picks the row an assignment should update instead of inserting a new one.
 * Returns null when a fresh sale row is required.
 */
export function findReusablePurchaseIntent(
  rows: PurchaseIntentRow[],
  match: { clientId: string; offerId: string | null },
): PurchaseIntentRow | null {
  const candidates = rows.filter(
    (r) =>
      r.client_id === match.clientId &&
      (r.offer_id ?? null) === (match.offerId ?? null) &&
      isReusablePurchaseIntent(r),
  );
  if (candidates.length === 0) return null;
  // Most recent intent wins — it carries the latest admin configuration.
  return candidates
    .slice()
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0]!;
}
