import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  businessEpochSeconds,
  sanitizeSubscriptionParams,
  stripeAnchoredBillingParams,
  stripeFirstPaymentParams,
  installmentDates,
} from "@/lib/billing-schedule";

const TODAY = "2026-09-14";
const src = (p: string) => readFileSync(p, "utf8");

/**
 * Stripe rejects a Checkout Session when subscription_data[proration_behavior]
 * arrives without a billing cycle anchor:
 *   "The `proration_behavior` parameter can only be passed if
 *    `billing_cycle_anchor` or `billing_cycle_anchor_config` exist."
 */
describe("recurring checkout params", () => {
  it("omits proration_behavior for an immediate monthly recurring sale", () => {
    const base = {
      mode: "subscription",
      "line_items[0][price]": "price_123",
      "subscription_data[metadata][purchase_record_id]": "pr_1",
      ...stripeFirstPaymentParams(null, { today: TODAY }),
    };
    const out = sanitizeSubscriptionParams(base);
    expect(out["subscription_data[proration_behavior]"]).toBeUndefined();
    expect(Object.keys(out).some((k) => k.includes("billing_cycle_anchor"))).toBe(false);
    // Normal immediate billing is preserved: no trial, no delay params.
    expect(out["subscription_data[trial_end]"]).toBeUndefined();
    expect(out["mode"]).toBe("subscription");
  });

  it("strips a stray proration_behavior from any entry path", () => {
    const out = sanitizeSubscriptionParams({
      mode: "subscription",
      "subscription_data[proration_behavior]": "none",
      proration_behavior: "create_prorations",
    });
    expect(out["subscription_data[proration_behavior]"]).toBeUndefined();
    expect(out["proration_behavior"]).toBeUndefined();
  });

  it("keeps the intended proration behavior on an anchored monthly sale", () => {
    const anchored = stripeAnchoredBillingParams("2026-10-01", { prorationBehavior: "none" });
    const out = sanitizeSubscriptionParams({ mode: "subscription", ...anchored });
    expect(out["subscription_data[billing_cycle_anchor]"]).toBe(
      String(businessEpochSeconds("2026-10-01")),
    );
    expect(out["subscription_data[proration_behavior]"]).toBe("none");
  });

  it("keeps anchored bi-weekly params valid", () => {
    const out = sanitizeSubscriptionParams({
      mode: "subscription",
      ...stripeAnchoredBillingParams("2026-09-28", { prorationBehavior: "create_prorations" }),
    });
    expect(out["subscription_data[proration_behavior]"]).toBe("create_prorations");
    expect(out["subscription_data[billing_cycle_anchor]"]).toBeTruthy();
  });

  it("keeps anchor_config accompanied proration behavior", () => {
    const out = sanitizeSubscriptionParams({
      "subscription_data[billing_cycle_anchor_config][day_of_month]": "1",
      "subscription_data[proration_behavior]": "none",
    });
    expect(out["subscription_data[proration_behavior]"]).toBe("none");
  });

  it("future first payment stays a no-charge-until-date flow", () => {
    const p = stripeFirstPaymentParams("2026-10-01", { today: TODAY });
    expect(p["subscription_data[trial_end]"]).toBe(String(businessEpochSeconds("2026-10-01")));
    expect(p["subscription_data[metadata][first_payment_at]"]).toBe("2026-10-01");
    expect(p["subscription_data[proration_behavior]"]).toBeUndefined();
    expect(Object.keys(p).some((k) => k.includes("billing_cycle_anchor"))).toBe(false);
  });

  it("leaves one-time checkout params untouched", () => {
    const one = {
      mode: "payment",
      "line_items[0][price]": "price_one",
      "invoice_creation[enabled]": "true",
      "automatic_tax[enabled]": "true",
    };
    expect(sanitizeSubscriptionParams(one)).toEqual(one);
  });

  it("keeps fixed installment scheduling intact", () => {
    expect(installmentDates("2026-10-01", "monthly", 4)).toEqual([
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
  });
});

describe("canonical enforcement across entry paths", () => {
  const checkout = src("src/lib/stripe-checkout.functions.ts");
  const member = src("src/lib/member-checkout.functions.ts");

  it("every checkout session body is sanitized", () => {
    const creations = checkout.match(/formEncode\((sessionParams|params)\)/g) ?? [];
    expect(creations).toHaveLength(0);
    expect(checkout).toContain("sanitizeSubscriptionParams(sessionParams)");
    expect(member).toContain("sanitizeSubscriptionParams(params)");
  });

  it("no entry path hardcodes a raw proration_behavior on a checkout session", () => {
    for (const body of [checkout, member]) {
      expect(body.includes('"subscription_data[proration_behavior]"')).toBe(false);
    }
  });

  it("retry after a failed session creation reuses the existing purchase record", () => {
    // The assignment flow loads an existing purchase_records row and UPDATEs it
    // with the session; it never inserts, so a retry cannot duplicate the sale.
    expect(checkout).toContain('.from("purchase_records")');
    expect(checkout).toContain('.eq("id", data.purchaseRecordId)');
    expect(/from\("purchase_records"\)\s*\.insert/.test(checkout)).toBe(false);
  });
});
