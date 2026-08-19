export const FIRST50_CODE = "FIRST50";
export const FIRST50_AMOUNT_CAD = 50;
export const FIRST50_CANONICAL_MONTHLY_PRICE_CAD = 180;

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
