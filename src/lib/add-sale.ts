/**
 * Add Sale — canonical product eligibility + search for the client profile
 * "Add sale" workflow.
 *
 * ROOT CAUSE THIS REPLACES: the client-profile picker queried the legacy
 * `offers` table, which holds zero rows. The real catalogue lives in
 * `coaching_products`, so the picker always rendered "No active products".
 *
 * Eligibility for MANUAL assignment by a coach/admin is deliberately NOT the
 * same as "available for public self-purchase". A product that is hidden from
 * the public sales page must still be assignable by staff.
 */

import {
  blankBillingSchedule,
  resolveFirstPaymentDate,
  resolveServiceStartDate,
  validateBillingSchedule,
  type BillingScheduleDraft,
} from "@/lib/billing-schedule";

export type AssignEligibility =
  | { assignable: true; reason: null }
  | { assignable: false; reason: string };

function statusOf(p: any): string {
  return String(p?.status ?? (p?.active ? "Active" : "Draft"));
}

/** Catalogue state rules: Active → assignable, Draft/Archived → not. */
export function productAssignEligibility(p: any): AssignEligibility {
  if (p?.archived === true || statusOf(p) === "Archived") {
    return { assignable: false, reason: "Archived" };
  }
  if (statusOf(p) !== "Active") return { assignable: false, reason: "Draft" };
  if (!p?.stripe_price_id && !p?.payment_link_url) {
    return { assignable: false, reason: "Missing Stripe pricing setup" };
  }
  return { assignable: true, reason: null };
}

export function isAssignableProduct(p: any): boolean {
  return productAssignEligibility(p).assignable;
}

/** Products that belong in the picker at all (one-off custom sales are hidden). */
export function pickableProducts<T extends Record<string, any>>(items: T[]): T[] {
  return (items ?? []).filter((p) => !p?.is_one_off && statusOf(p) !== "Archived" && p?.archived !== true);
}

/** Search by name / description / type. Exact name match ranks first. */
export function searchProducts<T extends Record<string, any>>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  const score = (p: any): number => {
    const name = String(p.name ?? "").toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    if (String(p.product_type ?? "").toLowerCase().includes(q)) return 3;
    if (String(p.description ?? "").toLowerCase().includes(q)) return 4;
    if (String(p.details ?? "").toLowerCase().includes(q)) return 5;
    return 99;
  };
  return items
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.p);
}

/**
 * Shape a coaching_products row for AssignOfferDialog + snapshotOfferForPurchase.
 * Both the Existing Product flow and the Custom Sale flow go through here, so
 * they end in exactly one purchase pipeline.
 */
export function productToOfferLike(p: any) {
  return {
    id: p.id,
    name: p.name,
    offer_type: p.product_type ?? "Custom Offer",
    short_description: p.description ?? null,
    description: p.details ?? null,
    currency: String(p.currency ?? "cad").toUpperCase(),
    price: Number(p.price_cents ?? 0) / 100,
    full_payable_amount: Number(p.price_cents ?? 0) / 100,
    payment_structure: p.payment_structure ?? null,
    payment_frequency: p.payment_structure ?? null,
    number_of_payments: p.number_of_payments ?? null,
    term_duration: p.term_length ?? null,
    term_duration_unit: p.term_unit ?? null,
    included_features: p.included_features ?? [],
    excluded_features: [],
    stripe_payment_link: p.payment_link_url ?? null,
    stripe_price_id: p.stripe_price_id ?? null,
    stripe_product_id: p.stripe_product_id ?? null,
    mode: p.mode ?? null,
    sessions_included: p.sessions_included ?? 0,
    session_fulfillment: p.session_fulfillment ?? "first_payment",
    session_length_minutes: p.session_length_minutes ?? null,
    requires_agreement: !!p.agreement_required,
    agreement_before_service: !!p.agreement_before_service,
    default_agreement_template_id: p.agreement_template_id ?? null,
    is_recurring: /subscription|recurring|weekly|monthly|annual/i.test(String(p.payment_structure ?? "")),
    version: 1,
  };
}

export type CustomSaleDraft = {
  /** Payment dates: first payment, billing anchor and service start. */
  schedule: BillingScheduleDraft;
  name: string;
  description: string;
  paymentType: "one_time" | "recurring" | "free";
  priceText: string;
  currency: string;
  interval: "weekly" | "biweekly" | "monthly" | "yearly";
  durationMode: "until_cancelled" | "fixed";
  numberOfPayments: string;
  sessionsIncluded: string;
  sessionType: string;
  sessionDelivery: "first_payment" | "per_installment" | "manual";
  termLength: string;
  termUnit: string;
  saveAsProduct: boolean;
};

export function blankCustomSale(): CustomSaleDraft {
  return {
    schedule: blankBillingSchedule(),
    name: "",
    description: "",
    paymentType: "one_time",
    priceText: "",
    currency: "CAD",
    interval: "monthly",
    durationMode: "until_cancelled",
    numberOfPayments: "",
    sessionsIncluded: "0",
    sessionType: "Personal Training",
    sessionDelivery: "first_payment",
    termLength: "",
    termUnit: "Months",
    saveAsProduct: false,
  };
}

const INTERVAL_LABEL: Record<CustomSaleDraft["interval"], string> = {
  weekly: "Weekly subscription",
  biweekly: "Bi-weekly subscription (every 2 weeks)",
  monthly: "Monthly subscription",
  yearly: "Annual subscription",
};

export function customSalePriceCents(d: CustomSaleDraft): number {
  if (d.paymentType === "free") return 0;
  const n = Number(String(d.priceText).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function customSalePaymentStructure(d: CustomSaleDraft): string {
  if (d.paymentType === "free") return "Free / no payment";
  if (d.paymentType === "one_time") return "One-time payment";
  const base = INTERVAL_LABEL[d.interval];
  if (d.durationMode === "fixed") {
    const n = Math.max(1, Math.trunc(Number(d.numberOfPayments) || 0));
    return `${base} — ${n} payments`;
  }
  return base;
}

export function validateCustomSale(d: CustomSaleDraft): string | null {
  if (!d.name.trim()) return "Give the sale a name.";
  if (d.paymentType !== "free") {
    const cents = customSalePriceCents(d);
    if (cents <= 0) return "Enter a price.";
    if (cents < 50) return "Stripe requires at least $0.50.";
  }
  if (d.paymentType === "recurring" && d.durationMode === "fixed") {
    const n = Math.trunc(Number(d.numberOfPayments) || 0);
    if (n < 1) return "Enter how many payments.";
  }
  const sessions = Math.trunc(Number(d.sessionsIncluded) || 0);
  if (sessions < 0 || sessions > 500) return "Sessions included must be between 0 and 500.";
  if (d.paymentType !== "free") {
    const scheduleProblem = validateBillingSchedule(d.schedule ?? blankBillingSchedule());
    if (scheduleProblem) return scheduleProblem;
  }
  return null;
}

/** The agreed payment/access dates for this sale, snapshotted onto the purchase. */
export function customSaleScheduleSnapshot(d: CustomSaleDraft) {
  const schedule = d.schedule ?? blankBillingSchedule();
  const frequency = d.paymentType === "recurring" ? d.interval : null;
  const firstPaymentDate = d.paymentType === "free" ? null : resolveFirstPaymentDate(schedule, { frequency });
  return {
    first_payment_date: firstPaymentDate,
    billing_anchor_day: firstPaymentDate ? Number(firstPaymentDate.slice(8, 10)) : null,
    service_start_date: resolveServiceStartDate(schedule, firstPaymentDate),
    billing_schedule_source: "client_override" as const,
  };
}

/** Input for createCoachingProduct built from a custom-sale draft. */
export function customSaleToProductInput(d: CustomSaleDraft, opts: { idempotencyKey?: string } = {}) {
  const priceCents = customSalePriceCents(d);
  const recurring = d.paymentType === "recurring";
  const sessions = Math.max(0, Math.trunc(Number(d.sessionsIncluded) || 0));
  return {
    name: d.name.trim(),
    description: d.description.trim() || null,
    priceCents,
    currency: d.currency.toLowerCase(),
    productType: sessions > 0 ? d.sessionType : "Custom Offer",
    paymentStructure: customSalePaymentStructure(d),
    termLength: d.termLength ? Math.trunc(Number(d.termLength) || 0) : null,
    termUnit: d.termLength ? d.termUnit : null,
    status: "Active" as const,
    // A free sale has nothing to charge — never create a Stripe price for it.
    generateStripeLink: d.paymentType !== "free" && priceCents >= 50,
    checkoutMode: (recurring ? "subscription" : "payment") as "subscription" | "payment",
    billingFrequency: recurring ? d.interval : null,
    sessionsIncluded: sessions,
    sessionFulfillment: d.sessionDelivery,
    isOneOff: !d.saveAsProduct,
    idempotencyKey: opts.idempotencyKey ?? null,
  };
}
