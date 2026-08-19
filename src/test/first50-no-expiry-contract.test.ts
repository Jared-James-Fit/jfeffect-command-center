import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpcSource = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260621083929_be330f9f-0ca2-433d-959d-5db3fbef9ac5.sql"),
  "utf8",
);
const noExpiryMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260819050000_allow_non_expiring_discount_codes.sql"),
  "utf8",
);
const mappingMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260819051000_map_canonical_online_coaching_first50.sql"),
  "utf8",
);
const adminSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/admin/discount-codes.tsx"),
  "utf8",
);
const checkoutSource = readFileSync(
  resolve(process.cwd(), "src/lib/stripe-checkout.functions.ts"),
  "utf8",
);
const policySource = readFileSync(
  resolve(process.cwd(), "src/lib/first50-policy.ts"),
  "utf8",
);

describe("non-expiring FIRST50 contract", () => {
  it("allows active discounts with NULL expiry without weakening dated-expiry validation", () => {
    expect(noExpiryMigration).toContain("expires_at IS NULL is intentionally valid and means no expiration.");
    expect(noExpiryMigration).toContain("DROP TRIGGER IF EXISTS trg_discount_codes_require_expiry_before_active");
    expect(noExpiryMigration).not.toContain("promotion codes require expires_at before activation");
    expect(rpcSource).toContain("IF rec.expires_at IS NOT NULL AND rec.expires_at < now() THEN");
  });

  it("keeps inactive and expired codes rejected by the canonical validation RPC", () => {
    expect(rpcSource).toContain("IF rec.status <> 'active' THEN");
    expect(rpcSource).toContain("This code is not currently active.");
    expect(rpcSource).toContain("This code has expired.");
  });

  it("keeps wrong-product and stacking combinations rejected", () => {
    expect(rpcSource).toContain("_product_id = ANY(rec.eligible_product_ids)");
    expect(rpcSource).toContain("Only one promotion code allowed.");
    expect(rpcSource).toContain("This code cannot be combined with others.");
  });

  it("renders null expiry as No expiration and does not force a coach to enter one", () => {
    expect(adminSource).toContain("No expiration");
    expect(adminSource).toContain("Optional — leave blank for no expiration.");
    expect(adminSource).not.toContain("promotion codes require an expiration date before they can be activated.");
  });

  it("preserves CAD 180 as the canonical recurring price and FIRST50 as a once-only CAD 50 discount", () => {
    expect(policySource).toContain("FIRST50_CANONICAL_MONTHLY_PRICE_CAD = 180");
    expect(policySource).toContain("FIRST50_AMOUNT_CAD = 50");
    expect(policySource).toContain('subscription_duration !== "once"');
    expect(checkoutSource).toContain("assertFirst50CanonicalStripePrice");
  });

  it("maps only the verified canonical Stripe identities and never persists CAD 130 as recurring price", () => {
    expect(mappingMigration).toContain("prod_V6DXyDNiHWBpUg");
    expect(mappingMigration).toContain("price_1U616UPwmHNsdfMLcSuG7LYs");
    expect(mappingMigration).toContain("h4MvrqqK");
    expect(mappingMigration).toContain("promo_1U617DPwmHNsdfMLXzmOHqn9");
    expect(mappingMigration).toContain("price_cents = 18000");
    expect(mappingMigration).not.toContain("price_cents = 13000");
  });
});
