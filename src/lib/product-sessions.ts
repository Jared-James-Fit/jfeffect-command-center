/**
 * Product session entitlement — the bridge between a catalogue product and the
 * canonical Sessions ledger (`session_ledger_events`).
 *
 * There is exactly ONE session-credit system in JF Effect:
 *   purchase_records.sessions_purchased  →  grant_sessions_if_paid_in_full()
 *   →  session_ledger_events             →  session_balance(client)
 *
 * This module holds only the pure presentation/mapping logic so the product
 * form, the assign-offer dialog and the tests all speak the same language.
 * It never grants anything itself.
 */

/** Matches coaching_products.session_fulfillment / purchase_records.session_fulfillment. */
export type SessionDelivery = "first_payment" | "per_installment" | "manual";

export const SESSION_DELIVERY_LABELS: Record<SessionDelivery, string> = {
  first_payment: "Once on activation",
  per_installment: "After each successful billing cycle",
  manual: "Manually granted by coach",
};

export const SESSION_DELIVERY_HINTS: Record<SessionDelivery, string> = {
  first_payment:
    "All sessions are added once, the first time the purchase is successfully paid or activated.",
  per_installment:
    "Sessions are released in step with how much of the package has actually been paid.",
  manual: "Nothing is added automatically — a coach adds the sessions by hand.",
};

/** Per-cycle delivery only makes sense for recurring / instalment products. */
export function availableDeliveries(isRecurringOrInstalment: boolean): SessionDelivery[] {
  return isRecurringOrInstalment
    ? ["first_payment", "per_installment", "manual"]
    : ["first_payment", "manual"];
}

export function normalizeDelivery(
  value: string | null | undefined,
  isRecurringOrInstalment = true,
): SessionDelivery {
  const v = (value ?? "first_payment") as SessionDelivery;
  const allowed = availableDeliveries(isRecurringOrInstalment);
  return allowed.includes(v) ? v : "first_payment";
}

export type ProductSessionEntitlement = {
  sessions: number;
  delivery: SessionDelivery;
  lengthMinutes: number | null;
  expiryDays: number | null;
};

/** Read entitlement off a coaching_products row (or an offer-shaped object). */
export function readProductEntitlement(product: any): ProductSessionEntitlement {
  const sessions = Math.max(
    Math.trunc(Number(product?.sessions_included ?? product?.sessionsIncluded ?? 0) || 0),
    0,
  );
  const lengthRaw = Number(product?.session_length_minutes ?? 0) || 0;
  const expiryRaw = Number(product?.session_expiry_days ?? 0) || 0;
  return {
    sessions,
    delivery: normalizeDelivery(product?.session_fulfillment),
    lengthMinutes: lengthRaw > 0 ? lengthRaw : null,
    expiryDays: expiryRaw > 0 ? expiryRaw : null,
  };
}

export function hasSessionEntitlement(product: any): boolean {
  return readProductEntitlement(product).sessions > 0;
}

/** "16 personal training sessions (60 min)" — used in the product live summary. */
export function entitlementSummaryLine(e: ProductSessionEntitlement): string | null {
  if (e.sessions <= 0) return null;
  const noun = e.sessions === 1 ? "session" : "sessions";
  const len = e.lengthMinutes ? ` (${e.lengthMinutes} min)` : "";
  return `${e.sessions} ${noun} included${len}`;
}

/** Secondary line explaining WHEN the sessions land. */
export function entitlementDeliveryLine(e: ProductSessionEntitlement): string | null {
  if (e.sessions <= 0) return null;
  switch (e.delivery) {
    case "per_installment":
      return "Released as each billing cycle is paid";
    case "manual":
      return "Added manually by a coach";
    default:
      return "Added once the purchase is paid";
  }
}

/** How an assignment mode affects session credits, for the assign dialog. */
export type AssignGrantMode = "payment_request" | "paid_in_full" | "draft";

export type AssignEntitlementPreview = {
  sessions: number;
  /** Sessions granted at the moment the admin confirms this assignment. */
  grantedNow: number;
  headline: string;
  detail: string;
};

export function assignEntitlementPreview(
  product: any,
  mode: AssignGrantMode,
): AssignEntitlementPreview | null {
  const e = readProductEntitlement(product);
  if (e.sessions <= 0) return null;
  const noun = e.sessions === 1 ? "session" : "sessions";

  if (e.delivery === "manual") {
    return {
      sessions: e.sessions,
      grantedNow: 0,
      headline: `${e.sessions} ${noun}`,
      detail: "This product is set to manual delivery — add the sessions yourself when ready.",
    };
  }

  if (mode === "draft") {
    return {
      sessions: e.sessions,
      grantedNow: 0,
      headline: `${e.sessions} ${noun}`,
      detail: "Nothing is added yet. A draft record does not grant sessions.",
    };
  }

  if (mode === "paid_in_full") {
    return {
      sessions: e.sessions,
      grantedNow: e.sessions,
      headline: `${e.sessions} ${noun}`,
      detail: `Added straight away — this record is marked paid, so the ${noun} land on the client's balance now.`,
    };
  }

  return {
    sessions: e.sessions,
    grantedNow: 0,
    headline: `${e.sessions} ${noun}`,
    detail: `Added automatically after the client completes checkout. Nothing is added when the request is sent.`,
  };
}
