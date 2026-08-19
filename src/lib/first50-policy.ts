export const FIRST50_CODE = "FIRST50";
export const FIRST50_AMOUNT_CAD = 50;
export const FIRST50_CANONICAL_MONTHLY_PRICE_CAD = 180;
export const FIRST50_CANONICAL_PRODUCT_NAME = "Online Coaching";

export type First50DiscountRecord = {
  public_code: string;
  category: string;
  discount_type: string;
  discount_value: number | string;
  subscription_duration: string;
  status: string;
  eligible_product_ids: string[] | null;
  applies_to_all_products: boolean | null;
  pairing_allowed: boolean | null;
};

export type First50Assignment = {
  offer_id: string | null;
  currency: string | null;
  price_cents: number | string | null;
  payment_structure: string | null;
};

/**
 * Stripe returns immutable Price objects. This normalized snapshot is supplied
 * by the server after it reads the selected Price from the active Stripe mode.
 * It deliberately does not trust browser-provided currency, price, or product
 * identity.
 */
export type First50CanonicalStripeSnapshot = {
  expected_product_id: string | null;
  expected_price_id: string | null;
  stripe_product_id: string | null;
  stripe_product_name: string | null;
  stripe_product_active: boolean | null;
  stripe_price_id: string | null;
  stripe_price_active: boolean | null;
  currency: string | null;
  unit_amount: number | null;
  recurring_interval: string | null;
  recurring_interval_count: number | null;
};

/**
 * Enforces the approved FIRST50 contract before a checkout session can be
 * created. This is deliberately independent of browser state and Stripe API
 * responses: the caller supplies only server-read purchase and discount rows.
 */
export function assertFirst50Assignment(
  discount: First50DiscountRecord,
  purchase: First50Assignment,
): void {
  if (discount.public_code.trim().toUpperCase() !== FIRST50_CODE) {
    throw new Error("Only the approved FIRST50 discount can be attached to this checkout.");
  }
  if (discount.status !== "active") {
    throw new Error("FIRST50 is not active.");
  }
  if (
    discount.category !== "promotion" ||
    discount.discount_type !== "fixed" ||
    Number(discount.discount_value) !== FIRST50_AMOUNT_CAD ||
    discount.subscription_duration !== "once"
  ) {
    throw new Error("FIRST50 configuration is invalid. Stripe synchronization is required.");
  }
  if (discount.pairing_allowed) {
    throw new Error("FIRST50 configuration permits stacking. Stripe synchronization is required.");
  }
  if (
    discount.applies_to_all_products ||
    !purchase.offer_id ||
    !(discount.eligible_product_ids ?? []).includes(purchase.offer_id)
  ) {
    throw new Error("FIRST50 is not eligible for this coaching product.");
  }
  if ((purchase.currency ?? "").toUpperCase() !== "CAD") {
    throw new Error("FIRST50 is available only for the canonical CAD coaching subscription.");
  }
  if (Math.round(Number(purchase.price_cents)) !== FIRST50_CANONICAL_MONTHLY_PRICE_CAD * 100) {
    throw new Error(
      "FIRST50 is available only for the canonical CAD $180 monthly coaching subscription.",
    );
  }
  if (!/monthly/i.test(purchase.payment_structure ?? "")) {
    throw new Error("FIRST50 is available only for the canonical monthly coaching subscription.");
  }
}

/**
 * Validates the authoritative Stripe object read by the server before FIRST50
 * can be attached. A local product row is not enough: Stripe must confirm the
 * same active Online Coaching Product and active CAD $180 monthly Price.
 */
export function assertFirst50CanonicalStripeSnapshot(
  snapshot: First50CanonicalStripeSnapshot,
): void {
  if (!snapshot.expected_product_id || !snapshot.expected_price_id) {
    throw new Error("Canonical Online Coaching Stripe synchronization is required.");
  }
  if (
    snapshot.stripe_product_id !== snapshot.expected_product_id ||
    snapshot.stripe_price_id !== snapshot.expected_price_id
  ) {
    throw new Error("Canonical Online Coaching Stripe identity does not match JF Effect.");
  }
  if (
    snapshot.stripe_product_name !== FIRST50_CANONICAL_PRODUCT_NAME ||
    !snapshot.stripe_product_active ||
    !snapshot.stripe_price_active
  ) {
    throw new Error("Canonical Online Coaching Stripe product or price is not active.");
  }
  if (
    (snapshot.currency ?? "").toUpperCase() !== "CAD" ||
    snapshot.unit_amount !== FIRST50_CANONICAL_MONTHLY_PRICE_CAD * 100 ||
    snapshot.recurring_interval !== "month" ||
    snapshot.recurring_interval_count !== 1
  ) {
    throw new Error("Canonical Online Coaching Stripe Price must be active CAD $180 monthly.");
  }
}
