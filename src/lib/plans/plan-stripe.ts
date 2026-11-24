/**
 * The Stripe side of a plan change, as data (pure, tested in plan-engine.test.ts).
 * plans.server.ts sends exactly these; nothing here calls Stripe.
 *
 *   - Up a level ("swap_now"): the subscription's one item moves to the new
 *     price with `proration_behavior=always_invoice`, so the unused part of
 *     the month is credited and the rest of the month at the new price is
 *     charged right away, and `payment_behavior=pending_if_incomplete`, so the
 *     price only changes once that charge succeeds (a declined card leaves
 *     them on their plan, never on a plan they haven't paid for).
 *     `proration_date` is the one the preview used, so the charge is the
 *     amount they were shown.
 *   - Down a level ("swap_later"): the price changes with
 *     `proration_behavior=none` (no credit, no charge today), so the next
 *     renewal is billed at the new price; what they get keeps to the plan they
 *     paid for until then (the app's change record decides that, applied at
 *     the period's end).
 *   - To free ("cancel_later"): `cancel_at_period_end=true`. Keeping the plan
 *     is `cancel_at_period_end=false`.
 */

export type SubState = {
  id: string;
  status: string;
  itemId: string | null;
  priceId: string | null;
  /** End of the paid period (unix seconds): the item's since API 2025-03-31, else the subscription's. */
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  /** A change waiting on its payment (pending_if_incomplete). */
  pendingUpdate: boolean;
  /** How many items: a plan subscription has exactly one. */
  itemCount: number;
  customer: string | null;
  latestInvoiceId: string | null;
  automaticTax: boolean;
};

export function subState(sub: any): SubState {
  const items = Array.isArray(sub?.items?.data) ? sub.items.data : [];
  const item = items[0] ?? null;
  const end = Number(item?.current_period_end ?? sub?.current_period_end ?? 0) || null;
  const latest = sub?.latest_invoice;
  return {
    id: String(sub?.id ?? ""),
    status: String(sub?.status ?? ""),
    itemId: item?.id ?? null,
    priceId: (typeof item?.price === "string" ? item.price : item?.price?.id) ?? null,
    periodEnd: end,
    cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
    pendingUpdate: !!sub?.pending_update,
    itemCount: items.length,
    customer: typeof sub?.customer === "string" ? sub.customer : sub?.customer?.id ?? null,
    latestInvoiceId: typeof latest === "string" ? latest : latest?.id ?? null,
    automaticTax: !!sub?.automatic_tax?.enabled,
  };
}

/** Why a subscription can't be changed by the app (null = it can). */
export function subProblem(s: SubState): string | null {
  if (!s.id) return "Couldn't find your subscription";
  if (!["active", "trialing", "past_due"].includes(s.status)) return "Your subscription isn't active";
  if (s.itemCount !== 1 || !s.itemId) return "Your subscription has more than one item, so changes go through your coach";
  if (s.pendingUpdate) return "A change is still waiting on a payment";
  return null;
}

export function unixToDay(unix: number | null | undefined, tz = "America/Winnipeg"): string | null {
  if (!unix) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(unix * 1000));
  } catch {
    return new Date(unix * 1000).toISOString().slice(0, 10);
  }
}

export function swapNowParams(s: SubState, newPriceId: string, prorationDate: number): Record<string, string> {
  return {
    "items[0][id]": s.itemId!,
    "items[0][price]": newPriceId,
    proration_behavior: "always_invoice",
    proration_date: String(prorationDate),
    payment_behavior: "pending_if_incomplete",
    "expand[0]": "latest_invoice",
  };
}

export function swapLaterParams(s: SubState, newPriceId: string): Record<string, string> {
  return {
    "items[0][id]": s.itemId!,
    "items[0][price]": newPriceId,
    proration_behavior: "none",
  };
}

export const CANCEL_LATER_PARAMS: Record<string, string> = { cancel_at_period_end: "true" };
export const KEEP_PARAMS: Record<string, string> = { cancel_at_period_end: "false" };

/** POST /v1/invoices/create_preview for a price change (always_invoice = today's charge; none = the next renewal). */
export function previewParams(
  s: SubState,
  newPriceId: string,
  behavior: "always_invoice" | "none",
  prorationDate?: number,
): Record<string, string> {
  const p: Record<string, string> = {
    subscription: s.id,
    "subscription_details[items][0][id]": s.itemId!,
    "subscription_details[items][0][price]": newPriceId,
    "subscription_details[proration_behavior]": behavior,
  };
  if (s.customer) p.customer = s.customer;
  if (prorationDate) p["subscription_details[proration_date]"] = String(prorationDate);
  return p;
}

export type PreviewMoney = {
  /** What the invoice comes to (tax included, when Stripe charges tax). */
  totalCents: number;
  taxCents: number;
  /** Credit left over for later invoices when the change is worth less than what was paid. */
  creditCents: number;
};

export function readPreview(inv: any): PreviewMoney {
  const total = Math.round(Number(inv?.total ?? inv?.amount_due ?? 0)) || 0;
  const taxes = Array.isArray(inv?.total_taxes)
    ? inv.total_taxes.reduce((s: number, t: any) => s + (Number(t?.amount ?? 0) || 0), 0)
    : Number(inv?.tax ?? 0) || 0;
  return { totalCents: Math.max(0, total), taxCents: Math.max(0, Math.round(taxes)), creditCents: total < 0 ? -total : 0 };
}

/** A proration date the server accepts from a preview: not in the future, at most 20 minutes old. */
export function usableProrationDate(raw: unknown, nowSec: number): number {
  const n = Math.floor(Number(raw ?? 0));
  if (!Number.isFinite(n) || n <= 0 || n > nowSec + 5 || n < nowSec - 20 * 60) return nowSec;
  return n;
}

/** After a swap_now update: did the new price take (paid), or is it waiting on the payment? */
export function upgradeOutcome(sub: any, newPriceId: string): { result: "applied" | "needs_payment" | "failed"; invoiceId: string | null; payUrl: string | null } {
  const s = subState(sub);
  const latest = typeof sub?.latest_invoice === "object" ? sub.latest_invoice : null;
  const invoiceId = s.latestInvoiceId;
  const payUrl = latest?.hosted_invoice_url ?? null;
  if (!s.pendingUpdate && s.priceId === newPriceId) return { result: "applied", invoiceId, payUrl: null };
  // Declined, or the bank wants them to confirm (3-D Secure): the change waits on
  // Stripe's own invoice page, where they can confirm or use another card. Paying it
  // applies the change; leaving it, the change expires (Stripe: 23 hours) and the
  // invoice is voided, so nothing is charged later.
  if (s.pendingUpdate && payUrl && latest?.status === "open") return { result: "needs_payment", invoiceId, payUrl };
  return { result: "failed", invoiceId, payUrl };
}
