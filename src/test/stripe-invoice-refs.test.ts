import { describe, it, expect } from "vitest";
import {
  invoiceSubscriptionId,
  invoicePaymentIntentId,
  invoiceChargeId,
  invoiceTaxMinor,
} from "@/lib/stripe-invoice-refs";

describe("stripe invoice refs", () => {
  it("reads legacy top-level fields", () => {
    const inv = { subscription: "sub_1", payment_intent: "pi_1", charge: "ch_1", tax: 1000 };
    expect(invoiceSubscriptionId(inv)).toBe("sub_1");
    expect(invoicePaymentIntentId(inv)).toBe("pi_1");
    expect(invoiceChargeId(inv)).toBe("ch_1");
    expect(invoiceTaxMinor(inv)).toBe(1000);
  });

  it("reads the new nested API shape (Marc's live invoice)", () => {
    const inv = {
      subscription: null,
      payment_intent: null,
      charge: null,
      tax: null,
      total: 21000,
      subtotal: 20000,
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_1U75Do", metadata: {} },
      },
      payments: {
        data: [{ payment: { payment_intent: "pi_3U75Dl", charge: "ch_3U75Dl" } }],
      },
    };
    expect(invoiceSubscriptionId(inv)).toBe("sub_1U75Do");
    expect(invoicePaymentIntentId(inv)).toBe("pi_3U75Dl");
    expect(invoiceChargeId(inv)).toBe("ch_3U75Dl");
    expect(invoiceTaxMinor(inv)).toBe(1000);
  });

  it("handles expanded objects and missing data", () => {
    expect(
      invoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: "sub_x" } } } }),
    ).toBe("sub_x");
    expect(invoiceSubscriptionId(null)).toBeNull();
    expect(invoicePaymentIntentId({})).toBeNull();
    expect(invoiceChargeId({})).toBeNull();
    expect(invoiceTaxMinor({})).toBe(0);
  });

  it("sums itemised taxes", () => {
    expect(invoiceTaxMinor({ total_taxes: [{ amount: 500 }, { amount: 250 }] })).toBe(750);
  });
});
