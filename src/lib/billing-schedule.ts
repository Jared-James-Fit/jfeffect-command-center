/**
 * Canonical payment-date model for JF Effect sales.
 *
 * THREE SEPARATE CONCEPTS — never collapsed into one "start date":
 *   A. SERVICE START     — when coaching / access / sessions begin (app concept).
 *   B. FIRST PAYMENT     — when Stripe actually collects money for the first time.
 *   C. BILLING ANCHOR    — the recurring date every later payment lands on.
 *
 * STRIPE MECHANISM (deliberate):
 *   A future first payment is implemented with `subscription_data[trial_end]`
 *   on the Checkout Session. Stripe collects and stores the payment method at
 *   checkout, charges NOTHING at that moment, and issues the first real invoice
 *   exactly at trial_end. Because the subscription's billing cycle is anchored
 *   to the trial end, every later invoice falls on that same calendar day and
 *   NO proration is ever generated.
 *
 *   We deliberately do NOT use a raw future `billing_cycle_anchor`, which can
 *   bill a prorated amount immediately.
 *
 *   Fixed-payment-count plans continue to use the existing Stripe Subscription
 *   Schedule wrap (created by the webhook from number_of_payments) — this module
 *   only decides WHEN payment 1 lands; the schedule decides when billing ENDS.
 *
 * Stripe remains the financial source of truth once the subscription exists:
 * these values describe the agreed plan at sale time and are snapshotted onto
 * the purchase, while `next_billing_date` is always reconciled from Stripe.
 */

import { tzWallToUtcMs } from "@/lib/tz";
import type { BillingFrequency } from "@/lib/billing-frequency";
import { billingCadencePhrase } from "@/lib/billing-frequency";

export const BUSINESS_TZ = "America/Winnipeg";
/** Charges are anchored at 09:00 business time, never midnight UTC (which shifts the day). */
const BILLING_HOUR = "09:00";

export type FirstPaymentMode = "immediate" | "on_date";
export type ServiceStartMode = "immediate" | "with_first_payment" | "on_date";

export type BillingScheduleDraft = {
  firstPaymentMode: FirstPaymentMode;
  /** YYYY-MM-DD in business timezone. */
  firstPaymentDate: string;
  /** Monthly/yearly only: 1–28 friendly billing day. Empty = use the first payment date. */
  billingDay: string;
  serviceStartMode: ServiceStartMode;
  serviceStartDate: string;
};

export function blankBillingSchedule(): BillingScheduleDraft {
  return {
    firstPaymentMode: "immediate",
    firstPaymentDate: "",
    billingDay: "",
    serviceStartMode: "immediate",
    serviceStartDate: "",
  };
}

/* ─────────────────────────────────────────────────────────────
   Product-level service start defaults
   A reusable product stores WHEN coaching starts for new sales.
   "admin_choice" forces the coach to pick a real date at assign
   time — a sale must never be saved with an undecided start.
   These values never touch Stripe billing dates.
   ───────────────────────────────────────────────────────────── */

export type ProductServiceStartMode = ServiceStartMode | "admin_choice";

export type ProductStartDefaults = {
  service_start_mode?: string | null;
  service_start_date?: string | null;
};

export function productServiceStartMode(product?: ProductStartDefaults | null): ProductServiceStartMode {
  const mode = String(product?.service_start_mode ?? "").trim();
  if (mode === "with_first_payment" || mode === "on_date" || mode === "admin_choice") return mode;
  return "immediate";
}

/** True when the coach MUST choose a start date before the sale can be sent. */
export function productRequiresStartDecision(product?: ProductStartDefaults | null): boolean {
  return productServiceStartMode(product) === "admin_choice";
}

/** The schedule a new sale starts from, before any client-specific override. */
export function productDefaultSchedule(product?: ProductStartDefaults | null): BillingScheduleDraft {
  const base = blankBillingSchedule();
  const mode = productServiceStartMode(product);
  if (mode === "admin_choice") {
    return { ...base, serviceStartMode: "on_date", serviceStartDate: "" };
  }
  if (mode === "on_date") {
    return {
      ...base,
      serviceStartMode: "on_date",
      serviceStartDate: isDateString(product?.service_start_date) ? product!.service_start_date! : "",
    };
  }
  if (mode === "with_first_payment") return { ...base, serviceStartMode: "with_first_payment" };
  return base;
}

export function productStartLabel(product?: ProductStartDefaults | null): string {
  switch (productServiceStartMode(product)) {
    case "with_first_payment":
      return "Starts on the first payment date";
    case "on_date":
      return isDateString(product?.service_start_date)
        ? `Starts ${formatBusinessDate(product!.service_start_date!)}`
        : "Starts on a set date";
    case "admin_choice":
      return "Start date chosen when assigning";
    default:
      return "Starts immediately";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(v: unknown): v is string {
  return typeof v === "string" && DATE_RE.test(v);
}

/** Today's calendar date in the business timezone (no UTC day-shift). */
export function businessToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** Unix seconds for 09:00 business time on the given calendar date. */
export function businessEpochSeconds(date: string): number {
  return Math.floor(tzWallToUtcMs(date, BILLING_HOUR, BUSINESS_TZ) / 1000);
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y!, m!, d!];
}

function toDateString(y: number, m0: number, d: number): string {
  const dt = new Date(Date.UTC(y, m0, d));
  return dt.toISOString().slice(0, 10);
}

/** Add one billing cycle to a calendar date. Month/year clamp to the month end. */
export function addCycle(date: string, freq: BillingFrequency, cycles = 1): string {
  const [y, m, d] = parts(date);
  if (freq === "weekly" || freq === "biweekly") {
    const days = (freq === "weekly" ? 7 : 14) * cycles;
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
  }
  const monthStep = freq === "monthly" ? 1 : 12;
  const target = new Date(Date.UTC(y, m - 1 + monthStep * cycles, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return toDateString(ty, tm, Math.min(d, lastDay));
}

/** Next occurrence of a friendly billing day (1–28) strictly after `from`. */
export function nextMonthlyAnchor(from: string, day: number): string {
  const [y, m, d] = parts(from);
  const safeDay = Math.min(Math.max(1, Math.trunc(day)), 28);
  if (safeDay > d) return toDateString(y, m - 1, safeDay);
  return toDateString(y, m, safeDay); // rolls into next month
}

/**
 * The agreed calendar date of payment 1. `null` means "charged immediately at
 * checkout" — Stripe's normal behaviour, no trial, no anchor override.
 */
export function resolveFirstPaymentDate(
  draft: BillingScheduleDraft,
  opts: { frequency: BillingFrequency | null; today?: string },
): string | null {
  const today = opts.today ?? businessToday();
  if (draft.firstPaymentMode === "immediate") {
    // A friendly monthly billing day still shifts payment 1 to that day.
    const day = Math.trunc(Number(draft.billingDay) || 0);
    if (day >= 1 && (opts.frequency === "monthly" || opts.frequency === "yearly")) {
      return nextMonthlyAnchor(today, day);
    }
    return null;
  }
  return isDateString(draft.firstPaymentDate) && draft.firstPaymentDate > today
    ? draft.firstPaymentDate
    : null;
}

/** Service/access start date. `null` = starts as soon as the sale is set up. */
export function resolveServiceStartDate(
  draft: BillingScheduleDraft,
  firstPaymentDate: string | null,
  opts: { today?: string } = {},
): string | null {
  const today = opts.today ?? businessToday();
  if (draft.serviceStartMode === "immediate") return null;
  if (draft.serviceStartMode === "with_first_payment") return firstPaymentDate ?? today;
  return isDateString(draft.serviceStartDate) ? draft.serviceStartDate : null;
}

export function validateBillingSchedule(
  draft: BillingScheduleDraft,
  opts: { today?: string } = {},
): string | null {
  const today = opts.today ?? businessToday();
  if (draft.firstPaymentMode === "on_date") {
    if (!isDateString(draft.firstPaymentDate)) return "Pick the first payment date.";
    if (draft.firstPaymentDate <= today) return "The first payment date must be in the future.";
    // Stripe caps a trial (our delayed-start mechanism) well beyond a year;
    // keep sales sane and inside that window.
    const maxDate = addCycle(today, "yearly");
    if (draft.firstPaymentDate > maxDate) return "The first payment date must be within a year.";
  }
  if (draft.billingDay) {
    const day = Math.trunc(Number(draft.billingDay) || 0);
    if (day < 1 || day > 28) return "Billing day must be between 1 and 28.";
  }
  if (draft.serviceStartMode === "on_date" && !isDateString(draft.serviceStartDate)) {
    return "Pick the service start date.";
  }
  return null;
}

/** Every scheduled payment date for a fixed-length installment plan. */
export function installmentDates(
  firstDate: string,
  frequency: BillingFrequency,
  count: number,
): string[] {
  const n = Math.max(1, Math.trunc(count));
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(i === 0 ? firstDate : addCycle(firstDate, frequency, i));
  return out;
}

/**
 * Stripe Checkout Session params implementing the agreed first payment.
 *
 * Returns `{}` for "charge at checkout" — never emits a raw future
 * billing_cycle_anchor, which is the parameter that can trigger a surprise
 * prorated charge before the intended date.
 */
export function stripeFirstPaymentParams(
  firstPaymentDate: string | null,
  opts: { today?: string } = {},
): Record<string, string> {
  const today = opts.today ?? businessToday();
  if (!firstPaymentDate || !isDateString(firstPaymentDate) || firstPaymentDate <= today) return {};
  return {
    // No charge until this instant; the billing cycle then anchors to it, so
    // every later invoice lands on the same calendar day with no proration.
    "subscription_data[trial_end]": String(businessEpochSeconds(firstPaymentDate)),
    "subscription_data[proration_behavior]": "none",
    "subscription_data[metadata][first_payment_at]": firstPaymentDate,
  };
}

export function formatBusinessDate(date: string | null | undefined): string {
  if (!isDateString(date)) return "—";
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function ordinal(day: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = day % 100;
  return `${day}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export type ScheduleSummary = {
  firstPayment: string;
  recurring: string | null;
  anchor: string | null;
  duration: string | null;
  finalPayment: string | null;
  serviceStart: string;
};

/** Plain-language schedule shown live in the form and on the review screen. */
export function scheduleSummary(input: {
  draft: BillingScheduleDraft;
  paymentType: "one_time" | "recurring" | "free";
  frequency: BillingFrequency | null;
  numberOfPayments?: number | null;
  today?: string;
}): ScheduleSummary {
  const today = input.today ?? businessToday();
  const first = resolveFirstPaymentDate(input.draft, {
    frequency: input.frequency,
    today,
  });
  const serviceStart = resolveServiceStartDate(input.draft, first, { today });

  const summary: ScheduleSummary = {
    firstPayment: first ? formatBusinessDate(first) : "When the client completes checkout",
    recurring: null,
    anchor: null,
    duration: null,
    finalPayment: null,
    serviceStart: serviceStart ? formatBusinessDate(serviceStart) : "As soon as the sale is set up",
  };

  if (input.paymentType !== "recurring" || !input.frequency) return summary;

  summary.recurring = `Billed ${billingCadencePhrase(input.frequency)}`;
  if (input.frequency === "monthly" || input.frequency === "yearly") {
    const anchorDay = first ? parts(first)[2] : null;
    summary.anchor = anchorDay
      ? `${ordinal(anchorDay)} of every ${input.frequency === "monthly" ? "month" : "year"}`
      : "Same calendar day each cycle, from checkout";
  } else {
    summary.anchor = first
      ? `${billingCadencePhrase(input.frequency)} from ${formatBusinessDate(first)}`
      : `${billingCadencePhrase(input.frequency)} from checkout`;
  }

  const count = Math.trunc(Number(input.numberOfPayments) || 0);
  if (count > 0) {
    summary.duration = `${count} payments, then billing ends`;
    const start = first ?? today;
    const dates = installmentDates(start, input.frequency, count);
    summary.finalPayment = formatBusinessDate(dates[dates.length - 1]!);
  } else {
    summary.duration = "Renews until cancelled";
  }
  return summary;
}
