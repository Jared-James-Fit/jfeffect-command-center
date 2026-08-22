/**
 * Canonical recurring billing cadence for JF Effect.
 *
 * ONE representation only. Everything (product form, Stripe price creation,
 * Stripe → app reverse sync, admin display, client display, checkout summary)
 * must go through this module rather than assuming week|month|year.
 *
 * BI-WEEKLY means ONCE EVERY 2 WEEKS (Stripe: interval "week", count 2).
 */

export type BillingFrequency = "weekly" | "biweekly" | "monthly" | "yearly";

export type StripeRecurring = {
  interval: "day" | "week" | "month" | "year";
  interval_count: number;
};

export const BILLING_FREQUENCIES: BillingFrequency[] = [
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
];

export const BILLING_FREQUENCY_OPTIONS: {
  value: BillingFrequency;
  label: string;
  hint: string;
}[] = [
  { value: "weekly", label: "Weekly", hint: "Every week" },
  { value: "biweekly", label: "Bi-weekly", hint: "Every 2 weeks" },
  { value: "monthly", label: "Monthly", hint: "Every month" },
  { value: "yearly", label: "Yearly", hint: "Every year" },
];

export function isBillingFrequency(v: unknown): v is BillingFrequency {
  return typeof v === "string" && (BILLING_FREQUENCIES as string[]).includes(v);
}

/** Canonical → Stripe recurring params. */
export function toStripeRecurring(freq: BillingFrequency): StripeRecurring {
  switch (freq) {
    case "weekly":
      return { interval: "week", interval_count: 1 };
    case "biweekly":
      return { interval: "week", interval_count: 2 };
    case "monthly":
      return { interval: "month", interval_count: 1 };
    case "yearly":
      return { interval: "year", interval_count: 1 };
  }
}

/** Stripe recurring params → canonical (null when Stripe uses a cadence we don't model). */
export function fromStripeRecurring(
  recurring: { interval?: string | null; interval_count?: number | null } | null | undefined,
): BillingFrequency | null {
  if (!recurring?.interval) return null;
  const interval = String(recurring.interval).toLowerCase();
  const count =
    typeof recurring.interval_count === "number" && recurring.interval_count > 0
      ? recurring.interval_count
      : 1;
  if (interval === "week" && count === 1) return "weekly";
  if (interval === "week" && count === 2) return "biweekly";
  if (interval === "month" && count === 1) return "monthly";
  if (interval === "year" && count === 1) return "yearly";
  return null;
}

/** Admin-facing short label ("Bi-weekly"). */
export function billingFrequencyLabel(freq: BillingFrequency): string {
  return BILLING_FREQUENCY_OPTIONS.find((o) => o.value === freq)?.label ?? "—";
}

/** Client-facing unambiguous cadence phrase ("every 2 weeks"). */
export function billingCadencePhrase(freq: BillingFrequency): string {
  switch (freq) {
    case "weekly":
      return "every week";
    case "biweekly":
      return "every 2 weeks";
    case "monthly":
      return "every month";
    case "yearly":
      return "every year";
  }
}

/**
 * Cadence phrase straight from raw Stripe recurring data. Falls back to a
 * generic "every N units" phrase for cadences outside our canonical set so a
 * week × 2 price is NEVER rendered as "weekly".
 */
export function stripeRecurringPhrase(
  recurring: { interval?: string | null; interval_count?: number | null } | null | undefined,
): string {
  const canonical = fromStripeRecurring(recurring);
  if (canonical) return billingCadencePhrase(canonical);
  if (!recurring?.interval) return "—";
  const unit = String(recurring.interval).toLowerCase();
  const count =
    typeof recurring.interval_count === "number" && recurring.interval_count > 0
      ? recurring.interval_count
      : 1;
  return count > 1 ? `every ${count} ${unit}s` : `every ${unit}`;
}

/** "$800.00 CAD every 2 weeks" */
export function formatRecurringPrice(money: string, freq: BillingFrequency): string {
  return `${money} ${billingCadencePhrase(freq)}`;
}

/** Stored `payment_structure` label used on products / purchase records. */
export function paymentStructureLabel(
  freq: BillingFrequency,
  fixedPaymentCount?: number | null,
): string {
  const base = `${billingFrequencyLabel(freq)} subscription (${billingCadencePhrase(freq)})`;
  return fixedPaymentCount && fixedPaymentCount > 0
    ? `${base} — ${fixedPaymentCount} payments`
    : base;
}

/**
 * Best-effort parse of legacy/stored cadence text or legacy interval values
 * ("week", "Monthly subscription", "Bi-weekly subscription", "every 2 weeks").
 */
export function parseBillingFrequency(raw: string | null | undefined): BillingFrequency | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (isBillingFrequency(s)) return s;
  if (/bi[-\s]?weekly|every\s*2\s*weeks|fortnight/.test(s)) return "biweekly";
  if (/^week$/.test(s) || /weekly|every week/.test(s)) return "weekly";
  if (/^month$/.test(s) || /monthly|every month/.test(s)) return "monthly";
  if (/^year$/.test(s) || /yearly|annual|every year/.test(s)) return "yearly";
  return null;
}

/**
 * Total span (in days, approximate for month/year) of a fixed-length
 * subscription — used for term projections. Never assumes month-only.
 */
export function approxDaysPerCycle(freq: BillingFrequency): number {
  switch (freq) {
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
      return 30;
    case "yearly":
      return 365;
  }
}
