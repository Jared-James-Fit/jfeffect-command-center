/**
 * A client's balance the way a coach reads it: what they owe in real
 * dollars (GST included), broken into the payments still scheduled on each
 * sale and the sessions they've trained beyond what they've bought.
 *
 * Prices are stored before tax and payments include it. The rate comes from
 * what the client has actually paid (tax / paid before tax), per sale, else
 * the client's own rate, else none (amounts are then "before tax").
 *
 * Pure: callers pass the rows they already loaded.
 */
import { resolvePaymentDisplay, type PurchaseInput } from "@/lib/payment-display";
import { saleOwedCents, sessionPriceCents } from "@/lib/client-owed";
import { isUseReversal, summarizeSessions, type SessionBalanceRow } from "@/lib/sessions-inventory";

export type BillingSale = PurchaseInput & {
  id: string;
  archived_at?: string | null;
  created_at?: string | null;
  sessions_purchased?: number | null;
};

export type BillingLedgerRow = {
  purchase_id?: string | null;
  txn_type: string;
  amount_minor: number | string | null;
  tax_minor?: number | string | null;
  voided?: boolean | null;
};

export type BillingSessionEvent = {
  id: string;
  purchase_id: string | null;
  event_type: string;
  session_count: number | null;
  source?: string | null;
  effective_date?: string | null;
  related_event_id?: string | null;
};

export type SaleOwedLine = {
  kind: "sale";
  id: string;
  name: string;
  /** What's left, tax included when the rate is known. */
  leftCents: number;
  paymentsMade: number | null;
  paymentsTotal: number | null;
  nextPaymentCents: number | null;
  nextDate: string | null;
};

export type UnbilledLine = {
  kind: "unbilled";
  sessions: number;
  from: string | null;
  to: string | null;
  /** Price of one session, tax included when the rate is known. */
  eachCents: number | null;
  totalCents: number;
  /** Bookings ahead that no package covers. */
  booked: number;
  bookedFrom: string | null;
  bookedTo: string | null;
};

export type BillingSummary = {
  owedCents: number;
  lines: Array<SaleOwedLine | UnbilledLine>;
  /** True when every amount includes tax; false = before tax (rate unknown). */
  taxIncluded: boolean;
  /** Paid so far: what was charged (tax included), less refunds. */
  paidCents: number;
  sessions: { bought: number; used: number; booked: number };
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const PAID_TYPES = new Set(["payment", "deposit", "legacy_backfill"]);

/** Tax as a share of the price, from what was paid on this sale. */
function saleRate(s: BillingSale): number | null {
  const tax = n(s.amount_tax_paid_cents);
  const beforeTax = n(s.amount_paid_cents) - tax;
  return tax > 0 && beforeTax > 0 ? tax / beforeTax : null;
}

/** The client's own rate across every taxed sale (GST 5%, HST 13–15%...). */
export function clientTaxRate(sales: BillingSale[]): number | null {
  let tax = 0;
  let beforeTax = 0;
  for (const s of sales) {
    if (s.archived_at) continue;
    const t = n(s.amount_tax_paid_cents);
    if (t <= 0) continue;
    tax += t;
    beforeTax += n(s.amount_paid_cents) - t;
  }
  return tax > 0 && beforeTax > 0 ? tax / beforeTax : null;
}

const withTax = (cents: number, rate: number | null) => Math.round(cents * (1 + (rate ?? 0)));

function span(dates: Array<string | null | undefined>): { from: string | null; to: string | null } {
  const ds = dates.filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  return { from: ds[0] ?? null, to: ds[ds.length - 1] ?? null };
}

export function buildBillingSummary(input: {
  sales: BillingSale[];
  ledger: BillingLedgerRow[];
  balance: SessionBalanceRow[];
  events: BillingSessionEvent[];
}): BillingSummary {
  const sales = input.sales.filter((s) => !s.archived_at);
  const rate = clientTaxRate(sales);
  const lines: BillingSummary["lines"] = [];

  for (const s of sales) {
    const left = saleOwedCents(s);
    if (left <= 0) continue;
    const r = saleRate(s) ?? rate;
    const plan = resolvePaymentDisplay(s).installmentPlan;
    lines.push({
      kind: "sale",
      id: s.id,
      name: s.offer_name ?? "Sale",
      leftCents: withTax(left, r),
      paymentsMade: plan ? plan.paymentsMade : null,
      paymentsTotal: plan ? plan.numberOfPayments : null,
      nextPaymentCents: plan ? withTax(Math.round(plan.installmentAmount * 100), r) : null,
      nextDate: s.next_billing_date ?? null,
    });
  }

  // Sessions trained past what was bought: the use events no package holds.
  const reversed = new Set(input.events.filter(isUseReversal).map((e) => e.related_event_id).filter(Boolean) as string[]);
  const released = new Set(input.events.filter((e) => e.event_type === "released").map((e) => e.related_event_id).filter(Boolean) as string[]);
  const loose = input.events.filter((e) => !e.purchase_id);
  const byDate = (a: BillingSessionEvent, b: BillingSessionEvent) => String(a.effective_date ?? "").localeCompare(String(b.effective_date ?? ""));
  const looseUsed = loose.filter((e) => e.event_type === "used" && !reversed.has(e.id) && n(e.session_count) < 0).sort(byDate);
  const looseHolds = loose.filter((e) => e.event_type === "reserved" && !released.has(e.id));
  const summary = summarizeSessions(input.balance, loose as any);
  const over = summary.overdrawn;
  if (over > 0) {
    const price = sessionPriceCents(sales);
    const each = price ? withTax(price, rate) : null;
    const usedSpan = span(looseUsed.slice(-over).map((e) => e.effective_date));
    const bookedSpan = span(looseHolds.map((e) => e.effective_date));
    lines.push({
      kind: "unbilled",
      sessions: over,
      from: usedSpan.from,
      to: usedSpan.to,
      eachCents: each,
      totalCents: each ? each * over : 0,
      booked: looseHolds.length,
      bookedFrom: bookedSpan.from,
      bookedTo: bookedSpan.to,
    });
  }

  const paidCents = input.ledger.reduce((sum, l) => {
    if (l.voided) return sum;
    if (PAID_TYPES.has(l.txn_type)) return sum + n(l.amount_minor);
    if (l.txn_type === "refund" || l.txn_type === "partial_refund") return sum - Math.abs(n(l.amount_minor));
    return sum;
  }, 0);

  return {
    owedCents: lines.reduce((sum, l) => sum + (l.kind === "sale" ? l.leftCents : l.totalCents), 0),
    lines,
    taxIncluded: rate != null,
    paidCents,
    sessions: { bought: summary.purchased, used: summary.used, booked: summary.scheduled },
  };
}
