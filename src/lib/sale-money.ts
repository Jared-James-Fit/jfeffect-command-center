/**
 * One sale's money the way a coach reads it, in the dollars the client
 * actually pays (tax included whenever the rate is known): its price, what
 * came in, and what's left or what happens next. The client's Billing tab,
 * its balance card and the sale page all read this, so they never disagree.
 *
 * Prices are stored before tax and payments include it. The rate comes from
 * what was paid on this sale, else the client's own rate, else none.
 *
 * Pure: callers pass the rows they already loaded.
 */
import { resolvePaymentDisplay, methodLabel, type PurchaseInput } from "@/lib/payment-display";
import { saleOwedCents } from "@/lib/client-owed";

export type MoneySale = PurchaseInput & {
  id: string;
  archived_at?: string | null;
  created_at?: string | null;
  sessions_purchased?: number | null;
  payment_structure?: string | null;
};

export type MoneyLedgerRow = {
  id?: string;
  purchase_id?: string | null;
  txn_type: string;
  method?: string | null;
  amount_minor: number | string | null;
  tax_minor?: number | string | null;
  transaction_date?: string | null;
  voided?: boolean | null;
  source?: string | null;
};

export type SaleKind = "one_time" | "plan" | "subscription" | "free";

export type SaleState =
  /** Nothing left to pay. */
  | "paid"
  /** Money still to come on a set price (a plan, or a sale part paid). */
  | "left"
  /** Nothing paid yet: a payment link or request is out. Not a debt yet. */
  | "waiting"
  /** A subscription that charges again on `next.date`. */
  | "renews"
  /** A subscription set to stop on `next.date`. */
  | "cancelling"
  /** A payment failed. */
  | "past_due"
  /** Cancelled, voided or refunded: nothing more will be charged. */
  | "ended"
  | "free";

export type SaleMoney = {
  currency: string;
  kind: SaleKind;
  state: SaleState;
  /** Tax as a share of the price; null when no payment shows one. */
  rate: number | null;
  /** The whole price (one-time / plan) or one payment (subscription). */
  priceCents: number;
  /** "$640.00 + tax" (still to pay), "incl. $40.00 tax" (paid), "No tax", or null. */
  priceNote: string | null;
  /** "month", "2 weeks", "week" for a subscription; null otherwise. */
  per: string | null;
  /** What came in, tax included, less refunds. */
  paidCents: number;
  /** Payments that came in (voided ones left out). */
  payments: number;
  refundedCents: number;
  /** Left to pay, tax included when the rate is known (0 unless "left" / "waiting"). */
  leftCents: number;
  /** A plan's progress. */
  plan: { made: number; total: number } | null;
  /** The next charge, when one is scheduled. */
  next: { cents: number | null; date: string | null } | null;
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const IN = new Set(["payment", "deposit", "legacy_backfill"]);
const OUT = new Set(["refund", "partial_refund"]);
const WAITING = new Set(["pending", "pending payment", "payment link sent", "unpaid", "draft", ""]);

export const withTax = (cents: number, rate: number | null) => Math.round(cents * (1 + (rate ?? 0)));

/** Tax as a share of the price, from what was paid on this sale. */
export function saleTaxRate(s: { amount_paid_cents?: number | null; amount_tax_paid_cents?: number | null }): number | null {
  const tax = n(s.amount_tax_paid_cents);
  const beforeTax = n(s.amount_paid_cents) - tax;
  return tax > 0 && beforeTax > 0 ? tax / beforeTax : null;
}

/** How often a subscription charges, from what the sale says about it. */
export function billingPeriod(s: { payment_frequency?: string | null; payment_structure?: string | null }): string | null {
  const text = `${s.payment_frequency ?? ""} ${s.payment_structure ?? ""}`.toLowerCase();
  if (/bi-?weekly|every 2 weeks|fortnight/.test(text)) return "2 weeks";
  if (/weekly|every week/.test(text)) return "week";
  if (/month/.test(text)) return "month";
  if (/year|annual/.test(text)) return "year";
  return null;
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

/**
 * `sessionsUsed`: sessions already trained on this sale. A package the client
 * is training on is owed even before its first payment (a renewal they're
 * financing), so it's never "waiting".
 */
export function saleMoney(
  sale: MoneySale,
  ledger: MoneyLedgerRow[] = [],
  clientRate: number | null = null,
  opts: { sessionsUsed?: number | null } = {},
): SaleMoney {
  const inUse = Number(opts.sessionsUsed ?? 0) > 0;
  const d = resolvePaymentDisplay(sale);
  const currency = d.currency;
  const status = String(sale.payment_status ?? "").trim().toLowerCase();
  const rows = ledger.filter((l) => !l.voided);
  const inRows = rows.filter((l) => IN.has(l.txn_type));
  const gross = inRows.reduce((s, l) => s + n(l.amount_minor), 0);
  const refundedCents = rows.filter((l) => OUT.has(l.txn_type)).reduce((s, l) => s + Math.abs(n(l.amount_minor)), 0);
  // Older sales were recorded without ledger rows: trust the sale's own total.
  const paidGross = inRows.length > 0 ? gross : n(sale.amount_paid_cents ?? Math.round(n(sale.amount_paid) * 100));
  const paidCents = Math.max(0, paidGross - refundedCents);
  const taxPaid = inRows.length > 0 ? inRows.reduce((s, l) => s + n(l.tax_minor), 0) : n(sale.amount_tax_paid_cents);
  const payments = inRows.length > 0 ? inRows.length : paidGross > 0 ? 1 : 0;

  const own = saleTaxRate({ amount_paid_cents: paidGross, amount_tax_paid_cents: taxPaid });
  const rate = own ?? clientRate;
  const plan = d.installmentPlan;
  const structure = String(sale.payment_structure ?? sale.payment_frequency ?? "").toLowerCase();
  const recurring = !plan && (d.isRecurring || /subscription/.test(structure));
  const contractCents = Math.round(d.contractTotal * 100);

  const kind: SaleKind = plan ? "plan" : recurring ? "subscription" : contractCents <= 0 ? "free" : "one_time";

  const base = {
    currency, kind, rate, paidCents, payments, refundedCents,
    per: null as string | null, plan: null as SaleMoney["plan"], next: null as SaleMoney["next"], leftCents: 0,
  };

  if (kind === "free") {
    return { ...base, state: "free", priceCents: 0, priceNote: null };
  }

  if (kind === "subscription") {
    // One payment: the price as stored, else what the last payment was.
    const last = inRows.length ? n(inRows[inRows.length - 1].amount_minor) : 0;
    const stored = Math.round(n(sale.full_payable_amount) * 100) || n(sale.contract_value_cents);
    const priceCents = stored > 0 ? withTax(stored, rate) : last;
    const priceNote = stored > 0 && rate ? `${money(stored, currency)} + tax` : null;
    const r = d.renewal;
    const per = billingPeriod(sale);
    const stopped = ["voided", "refunded", "cancelled", "expired"].includes(status)
      || /cancel|expired/.test(String(sale.stripe_subscription_status ?? "").toLowerCase());
    const state: SaleState =
      stopped || r.kind === "cancelled" ? "ended"
      : r.kind === "cancels" ? "cancelling"
      : r.kind === "retry" || r.kind === "past_due" ? "past_due"
      : paidGross <= 0 && WAITING.has(status) ? "waiting"
      : "renews";
    const next = state === "renews" || state === "past_due" ? { cents: priceCents, date: r.date }
      : state === "cancelling" ? { cents: null, date: r.date }
      : null;
    return { ...base, per, state, priceCents, priceNote, next, leftCents: state === "waiting" ? priceCents : 0 };
  }

  // A set price, paid at once or over a plan.
  const owedBeforeTax = saleOwedCents(sale);
  const ended = status === "voided" || status === "refunded" || status === "cancelled" || status === "expired";
  const nothingPaid = paidGross <= 0 && !inUse;
  const state: SaleState =
    ended ? "ended"
    : nothingPaid && WAITING.has(status) ? "waiting"
    : status === "past due" || status === "failed" || status === "overdue" ? (owedBeforeTax > 0 ? "past_due" : "paid")
    : owedBeforeTax > 0 ? "left"
    : "paid";

  // Once it's paid, the real total is what came in (some older prices were
  // entered with the tax already in them).
  const settled = state === "paid" && paidGross > 0;
  const priceCents = settled ? paidGross : withTax(contractCents, rate);
  const priceNote = settled
    ? taxPaid > 0 ? `incl. ${money(taxPaid, currency)} tax` : "No tax"
    : rate ? `${money(contractCents, currency)} + tax` : null;

  const leftCents = state === "left" || state === "past_due" ? withTax(owedBeforeTax, rate)
    : state === "waiting" ? priceCents
    : 0;
  const next = plan && (state === "left" || state === "past_due")
    ? { cents: withTax(Math.round(plan.installmentAmount * 100), rate), date: sale.next_billing_date ?? null }
    : null;

  return {
    ...base,
    state,
    priceCents,
    priceNote,
    leftCents,
    // A plan paid off in fewer, bigger payments reads as paid, not "3 of 4".
    plan: plan && state !== "paid" ? { made: plan.paymentsMade, total: plan.numberOfPayments } : null,
    next,
  };
}

export type PaymentRow = {
  id: string;
  date: string | null;
  kind: "payment" | "refund";
  /** Tax included; refunds are positive here and labelled as refunds. */
  cents: number;
  taxCents: number;
  method: string | null;
  voided: boolean;
  /**
   * Only payments recorded by hand can be voided here. A Stripe payment is
   * corrected in Stripe (a refund there comes back on its own).
   */
  canVoid: boolean;
};

/** A sale's money in and out, newest first, without the bookkeeping rows. */
export function salePayments(ledger: MoneyLedgerRow[]): PaymentRow[] {
  return ledger
    .filter((l) => IN.has(l.txn_type) || OUT.has(l.txn_type))
    .map((l) => {
      const refund = OUT.has(l.txn_type);
      return {
        id: String(l.id ?? ""),
        date: l.transaction_date ? String(l.transaction_date).slice(0, 10) : null,
        kind: refund ? "refund" as const : "payment" as const,
        cents: Math.abs(n(l.amount_minor)),
        taxCents: Math.abs(n(l.tax_minor)),
        method: methodLabel(l.method ?? null),
        voided: !!l.voided,
        canVoid: !l.voided && !refund && l.source === "manual",
      };
    })
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}
