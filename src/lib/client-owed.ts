/**
 * What a client owes, before tax: what's left on their sales plus the
 * sessions they've trained beyond what they bought, at their latest
 * package's per-session price. Clients who train first and pay in
 * installments ("financing") show up here instead of looking paid up.
 *
 * Pure: callers pass the rows they already loaded.
 */
import { resolvePaymentDisplay, type PurchaseInput } from "@/lib/payment-display";

type Sale = PurchaseInput & {
  id?: string;
  archived_at?: string | null;
  created_at?: string | null;
  sessions_purchased?: number | null;
};

const SETTLED = new Set(["paid", "paid in full", "completed"]);
const CLOSED = new Set(["cancelled", "refunded", "voided", "draft", "expired"]);

/** What's left to pay on one sale, in cents before tax. */
export function saleOwedCents(sale: Sale): number {
  if (sale.archived_at) return 0;
  const status = String(sale.payment_status ?? "").trim().toLowerCase();
  if (SETTLED.has(status) || CLOSED.has(status)) return 0;
  const d = resolvePaymentDisplay(sale);
  // A subscription that renews until cancelled is billed period by period;
  // only a set number of payments leaves a balance still to come.
  if (status === "active subscription" && !d.installmentPlan) return 0;
  return Math.round(d.amountOutstanding * 100);
}

/** Price of one session on the client's most recent package with a price. */
export function sessionPriceCents(sales: Sale[]): number | null {
  const time = (s: Sale) => new Date(s.purchased_at ?? s.created_at ?? 0).getTime() || 0;
  const latest = sales
    .filter((s) => !s.archived_at && Number(s.sessions_purchased ?? 0) > 0)
    .map((s) => ({ s, price: Math.round(resolvePaymentDisplay(s).contractTotal * 100) }))
    .filter((x) => x.price > 0)
    .sort((a, b) => time(b.s) - time(a.s))[0];
  return latest ? Math.round(latest.price / Number(latest.s.sessions_purchased)) : null;
}

export type ClientOwed = {
  /** Left on sales, before tax. */
  salesCents: number;
  /** Sessions trained beyond what was bought. */
  unbilledSessions: number;
  sessionPriceCents: number | null;
  /** unbilledSessions × sessionPriceCents (0 without a price). */
  unbilledCents: number;
  totalCents: number;
  /** Any sale in the total was taxed, so GST applies on top. */
  taxed: boolean;
};

export function clientOwed(sales: Sale[], overdrawnSessions: number): ClientOwed {
  const salesCents = sales.reduce((sum, s) => sum + saleOwedCents(s), 0);
  const unbilledSessions = Math.max(0, Math.floor(overdrawnSessions || 0));
  const price = unbilledSessions > 0 ? sessionPriceCents(sales) : null;
  const unbilledCents = price ? unbilledSessions * price : 0;
  return {
    salesCents,
    unbilledSessions,
    sessionPriceCents: price,
    unbilledCents,
    totalCents: salesCents + unbilledCents,
    taxed: sales.some((s) => !s.archived_at && Number(s.amount_tax_paid_cents ?? 0) > 0),
  };
}
