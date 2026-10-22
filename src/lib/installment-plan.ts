/**
 * Fixed-installment contract resolver.
 *
 * A "fixed installment plan" is a recurring purchase that stops after a known
 * number of payments (e.g. Personal Training — 16 Sessions / 4 Weeks:
 * 4 × CA$200 = CA$800 total, billing ends after payment #4).
 *
 * The bug this fixes: `full_payable_amount` on legacy rows sometimes stores the
 * INSTALLMENT amount, so a $800 contract rendered as "CA$200 · CA$200
 * outstanding". Whenever a payment count > 1 exists, the contract total is
 * derived as installment × count so the true contract value is displayed.
 *
 * Pure — no I/O, no side effects.
 */

export type InstallmentPlanInput = {
  full_payable_amount?: number | string | null;
  installment_amount?: number | string | null;
  number_of_payments?: number | null;
  contract_value_cents?: number | null;
  amount_paid?: number | string | null;
  amount_paid_cents?: number | null;
  /** GST/HST inside amount_paid_cents (prices are stored before tax). */
  amount_tax_paid_cents?: number | null;
  is_recurring?: boolean | null;
};

export type InstallmentPlan = {
  /** Number of scheduled payments (always >= 2 for a plan). */
  numberOfPayments: number;
  /** Amount per payment, major units. */
  installmentAmount: number;
  /** Full contract value, major units (installment × count). */
  contractTotal: number;
  /** Verified paid so far, major units (what was charged, tax included). */
  amountPaid: number;
  /** Contract total minus what was paid before tax, clamped at 0. */
  amountRemaining: number;
  /** How many installments have been collected (clamped to the plan length). */
  paymentsMade: number;
  /** e.g. "4 × 200" — caller formats currency. */
  progressLabel: string;
};

function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Returns the plan when the row describes a fixed number of payments (>1),
 * otherwise null (one-time purchase or renews-until-cancelled subscription).
 */
export function resolveInstallmentPlan(p: InstallmentPlanInput): InstallmentPlan | null {
  const count = p.number_of_payments ?? 0;
  if (!Number.isFinite(count) || count < 2) return null;

  const storedTotal =
    p.contract_value_cents != null && Number.isFinite(p.contract_value_cents)
      ? p.contract_value_cents / 100
      : null;

  const explicitInstallment = num(p.installment_amount, 0);
  const perPayment =
    explicitInstallment > 0
      ? explicitInstallment
      : storedTotal != null && storedTotal > 0
        ? storedTotal / count
        : num(p.full_payable_amount, 0);

  const contractTotal =
    storedTotal != null && storedTotal > 0 ? storedTotal : round2(perPayment * count);

  const amountPaid =
    p.amount_paid_cents != null && Number.isFinite(p.amount_paid_cents)
      ? p.amount_paid_cents / 100
      : num(p.amount_paid, 0);

  const paidBeforeTax = Math.max(0, amountPaid - Math.max(0, num(p.amount_tax_paid_cents, 0)) / 100);
  const remaining = round2(outstandingBeforeTax(contractTotal, amountPaid, paidBeforeTax));
  const paymentsMade =
    perPayment > 0 ? Math.min(count, Math.floor(round2(paidBeforeTax) / perPayment + 1e-6)) : 0;

  return {
    numberOfPayments: count,
    installmentAmount: round2(perPayment),
    contractTotal,
    amountPaid: round2(amountPaid),
    amountRemaining: remaining,
    paymentsMade,
    progressLabel: `${count} × ${round2(perPayment)}`,
  };
}

/**
 * What's left on a sale. Prices are stored before tax and payments include it,
 * so compare like for like: price minus what was paid before tax. A sale paid
 * at least its price counts as settled (older sales stored a tax-included
 * price).
 */
export function outstandingBeforeTax(price: number, paid: number, paidBeforeTax: number): number {
  if (price <= 0 || paid >= price) return 0;
  return Math.max(0, price - paidBeforeTax);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
