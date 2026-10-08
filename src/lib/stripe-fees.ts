/**
 * Turns Stripe balance transactions into monthly "Stripe fees" expenses.
 *
 * What Stripe charges shows up three ways:
 *   - processing fees on each charge/payment (fee_details type "stripe_fee")
 *   - its own service fees (Billing, Stripe Tax, invoicing) as balance
 *     transactions of type "stripe_fee", where -amount is the fee
 *   - instant payout fees on payout rows
 * Sales tax Stripe adds to its fees is in fee_details type "tax". In Manitoba
 * that is GST 5% + RST 7% (12%), and only the GST part is an input tax credit;
 * the RST stays in the cost.
 */

export type StripeBalanceTxn = {
  id: string;
  amount: number;
  created: number;
  currency: string;
  fee: number;
  fee_details?: Array<{ amount: number; type: string }>;
  type: string;
};

export type MonthlyStripeFees = {
  /** YYYY-MM in the business timezone. */
  month: string;
  currency: string;
  /** Total paid to Stripe, tax included. */
  totalMinor: number;
  /** GST/HST part of the tax Stripe charged (claimable). */
  gstMinor: number;
  processingMinor: number;
  serviceMinor: number;
  payoutMinor: number;
  salesTaxMinor: number;
  count: number;
};

const SERVICE_FEE_TYPES = new Set(["stripe_fee", "tax_fee"]);

/** GST share of a sales tax amount, from the rate it was charged at. */
export function gstShareOfTax(taxMinor: number, preTaxMinor: number): number {
  if (taxMinor <= 0) return 0;
  const rate = preTaxMinor > 0 ? taxMinor / preTaxMinor : 0;
  // GST + Manitoba RST (12%): only the 5% GST is claimable.
  if (Math.abs(rate - 0.12) < 0.02) return Math.round((taxMinor * 5) / 12);
  // GST + another province's PST (e.g. BC 12%, SK 11%) would need the same
  // split; anything near 5% or an HST rate is all claimable.
  return taxMinor;
}

export function monthKeyInZone(unixSeconds: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(
    new Date(unixSeconds * 1000),
  );
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

export function aggregateStripeFees(txns: StripeBalanceTxn[], timeZone = "America/Winnipeg"): MonthlyStripeFees[] {
  const map = new Map<string, MonthlyStripeFees>();
  for (const t of txns) {
    const details = t.fee_details ?? [];
    const tax = details.filter((d) => d.type === "tax").reduce((s, d) => s + d.amount, 0);
    const nonTax = details.filter((d) => d.type !== "tax").reduce((s, d) => s + d.amount, 0);
    const service = SERVICE_FEE_TYPES.has(t.type) ? -t.amount : 0;
    const processing = t.type === "payout" ? 0 : nonTax;
    const payout = t.type === "payout" ? nonTax : 0;
    const preTax = service + processing + payout;
    if (preTax === 0 && tax === 0) continue;

    const month = monthKeyInZone(t.created, timeZone);
    const currency = (t.currency ?? "cad").toUpperCase();
    const key = `${month}:${currency}`;
    const cur = map.get(key) ?? {
      month, currency, totalMinor: 0, gstMinor: 0, processingMinor: 0, serviceMinor: 0, payoutMinor: 0, salesTaxMinor: 0, count: 0,
    };
    cur.processingMinor += processing;
    cur.serviceMinor += service;
    cur.payoutMinor += payout;
    cur.salesTaxMinor += tax;
    cur.gstMinor += gstShareOfTax(tax, preTax);
    cur.totalMinor += preTax + tax;
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()]
    .map((m) => ({ ...m, totalMinor: Math.max(0, m.totalMinor), gstMinor: Math.max(0, Math.min(m.gstMinor, m.totalMinor)) }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
}

export function stripeFeesExternalKey(month: string, currency: string): string {
  return `stripe-fees:${month}:${currency.toLowerCase()}`;
}
