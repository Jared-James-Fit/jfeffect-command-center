/**
 * Admin-only Stripe dashboard deep-link helpers.
 *
 * We never expose Stripe secret keys or dashboard links to clients/members;
 * these are for admin/coach role only. Callers decide whether to render.
 *
 * Stripe mode is inferred per record from a stored `stripe_mode` value
 * ("live" | "test"). When missing, we fall back to "live" — do NOT guess
 * from ID prefixes (`pi_`, `cus_`, etc. are identical across modes).
 */

export type StripeMode = "live" | "test";

function base(mode?: string | null): string {
  const m: StripeMode = mode === "test" ? "test" : "live";
  return m === "test"
    ? "https://dashboard.stripe.com/test"
    : "https://dashboard.stripe.com";
}

export function stripeCustomerUrl(id?: string | null, mode?: string | null) {
  return id ? `${base(mode)}/customers/${id}` : null;
}
export function stripePaymentIntentUrl(id?: string | null, mode?: string | null) {
  return id ? `${base(mode)}/payments/${id}` : null;
}
export function stripeChargeUrl(id?: string | null, mode?: string | null) {
  return id ? `${base(mode)}/payments/${id}` : null;
}
export function stripeInvoiceUrl(id?: string | null, mode?: string | null) {
  return id ? `${base(mode)}/invoices/${id}` : null;
}
export function stripeCheckoutSessionUrl(id?: string | null, mode?: string | null) {
  // Checkout sessions live under /payments/sessions/{cs_id} in the dashboard.
  return id ? `${base(mode)}/payments/sessions/${id}` : null;
}
export function stripeSubscriptionUrl(id?: string | null, mode?: string | null) {
  return id ? `${base(mode)}/subscriptions/${id}` : null;
}
export function stripeProductUrl(id?: string | null, mode?: string | null) {
  return id ? `${base(mode)}/products/${id}` : null;
}
export function stripePriceUrl(id?: string | null, mode?: string | null) {
  return id ? `${base(mode)}/prices/${id}` : null;
}