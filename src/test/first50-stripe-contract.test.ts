import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/stripe-checkout.functions.ts"),
  "utf8",
);
const syncSource = readFileSync(
  resolve(process.cwd(), "src/lib/discount-codes.functions.ts"),
  "utf8",
);

describe("FIRST50 Stripe contract", () => {
  it("attaches the reviewed mode-specific promotion code rather than a raw coupon", () => {
    expect(source).toContain('"discounts[0][promotion_code]": appliedDiscount.promotionCodeId');
    expect(source).not.toContain('"discounts[0][coupon]": appliedDiscount.couponId');
  });

  it("verifies canonical Stripe product and price identity before customer creation", () => {
    const assignmentCheckout = source.slice(
      source.indexOf("export const createCheckoutSessionForAssignment"),
    );
    const canonicalCheck = assignmentCheckout.indexOf("await assertFirst50CanonicalStripePrice");
    const customerCreation = assignmentCheckout.indexOf('stripeFetch("/customers"');
    expect(canonicalCheck).toBeGreaterThan(-1);
    expect(customerCreation).toBeGreaterThan(-1);
    expect(canonicalCheck).toBeLessThan(customerCreation);
  });

  it("restricts the synchronized coupon to its one eligible Stripe Product", () => {
    expect(syncSource).toContain('params["applies_to[products][0]"] = eligibleStripeProductId');
    expect(syncSource).toContain("Discounts synchronized to Stripe must target exactly one eligible coaching product.");
  });

  it("stops on a pre-existing public-code conflict instead of creating a replacement", () => {
    expect(syncSource).toContain("is already linked to a conflicting coupon. Reconciliation was stopped.");
  });
});
