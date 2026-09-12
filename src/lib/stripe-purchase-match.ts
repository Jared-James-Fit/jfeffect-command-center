/**
 * Deterministic Stripe → JF Effect purchase matching.
 *
 * Stripe is authoritative for money; JF Effect owns the canonical sale
 * (`purchase_records`). Every webhook event must answer ONE question:
 * "which purchase_records row does this Stripe object belong to?"
 *
 * Matching order (strongest first):
 *   1. metadata.purchase_record_id — stamped by us on the checkout session AND
 *      on subscription_data, so subscriptions and every future invoice carry it.
 *   2. A stored Stripe object id (subscription / checkout session / payment
 *      intent) that we ourselves wrote onto the row — only when EXACTLY one row
 *      carries it.
 *   3. Customer id — only when the customer maps to exactly one open purchase.
 *
 * Anything ambiguous is flagged for admin reconciliation instead of guessed.
 * Pure module: no I/O, fully unit-testable.
 */

export type MatchRow = {
  id: string;
  client_id?: string | null;
  payment_status?: string | null;
  stripe_subscription_id?: string | null;
  stripe_checkout_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  purchased_at?: string | null;
  /** Purchase rows carry many more columns; matching only needs the above. */
  [key: string]: unknown;
};

export type MatchInput = {
  /** metadata.purchase_record_id resolved to a real row, when present. */
  metaRow?: MatchRow | null;
  /** Rows found by each stamped Stripe id, in priority order. */
  bySubscription?: MatchRow[];
  byCheckoutSession?: MatchRow[];
  byPaymentIntent?: MatchRow[];
  /** All purchases belonging to the Stripe customer. */
  byCustomer?: MatchRow[];
};

export type MatchResult =
  | { matched: MatchRow; via: "metadata" | "subscription" | "checkout_session" | "payment_intent" | "customer" }
  | { matched: null; reason: string; candidates: string[] };

/** Statuses that mean "this sale is still waiting for money". */
const OPEN_STATUSES = new Set([
  "draft",
  "pending",
  "pending payment",
  "payment link sent",
  "not sent",
  "unpaid",
  "partially paid",
  "overdue",
  "failed",
  "payment failed",
]);

export function isOpenPurchase(row: MatchRow): boolean {
  return OPEN_STATUSES.has((row.payment_status ?? "").trim().toLowerCase());
}

function single(
  rows: MatchRow[] | undefined,
  via: "subscription" | "checkout_session" | "payment_intent",
): MatchResult | null {
  const list = rows ?? [];
  if (list.length === 1) return { matched: list[0], via };
  if (list.length > 1) {
    return {
      matched: null,
      reason: `Ambiguous ${via} link — ${list.length} sales carry the same Stripe id.`,
      candidates: list.map((r) => r.id),
    };
  }
  return null;
}

export function matchPurchase(input: MatchInput): MatchResult {
  if (input.metaRow) return { matched: input.metaRow, via: "metadata" };

  for (const [rows, via] of [
    [input.bySubscription, "subscription"],
    [input.byCheckoutSession, "checkout_session"],
    [input.byPaymentIntent, "payment_intent"],
  ] as const) {
    const res = single(rows, via);
    if (res) {
      // An ambiguous stamped id is a hard stop — never fall through to a
      // weaker signal that could silently modify the wrong sale.
      return res;
    }
  }

  const customerRows = input.byCustomer ?? [];
  if (customerRows.length === 1) return { matched: customerRows[0], via: "customer" };
  if (customerRows.length > 1) {
    const open = customerRows.filter(isOpenPurchase);
    if (open.length === 1) return { matched: open[0], via: "customer" };
    return {
      matched: null,
      reason:
        open.length === 0
          ? "Stripe customer has no open sale awaiting payment."
          : `Stripe customer has ${open.length} open sales — cannot tell which one this payment belongs to.`,
      candidates: customerRows.map((r) => r.id),
    };
  }

  return { matched: null, reason: "No JF Effect sale carries this Stripe reference.", candidates: [] };
}

/**
 * Monotonic subscription state.
 *
 * Stripe does not guarantee webhook ordering: a stale `active` can arrive
 * after `canceled`. Once a sale is cancelled/ended, only a NEW subscription id
 * (i.e. a new sale) may reactivate it.
 */
export function shouldApplySubscriptionUpdate(
  existing: { payment_status?: string | null; service_status?: string | null; stripe_subscription_id?: string | null },
  incoming: { subscriptionId: string; status: string },
): boolean {
  const terminal =
    existing.payment_status === "Cancelled" || existing.service_status === "Cancelled";
  if (!terminal) return true;
  if (existing.stripe_subscription_id !== incoming.subscriptionId) return true;
  // Same cancelled subscription: only further terminal states are allowed.
  return incoming.status === "canceled" || incoming.status === "incomplete_expired";
}
