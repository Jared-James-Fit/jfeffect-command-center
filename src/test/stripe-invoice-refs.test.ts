import { describe, it, expect } from "vitest";
import {
  invoiceSubscriptionId,
  invoicePaymentIntentId,
  invoiceChargeId,
  invoiceTaxMinor,
  invoiceIdByPaymentRef,
  invoicePaymentRecordId,
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

  it("indexes invoices by their payment refs (charges have no invoice field)", () => {
    const idx = invoiceIdByPaymentRef([
      { id: "in_1", payments: { data: [{ payment: { payment_intent: "pi_1" } }] } },
      { id: "in_2", payments: { data: [{ payment: { payment_intent: "pi_2", charge: "ch_2" } }] } },
      { id: "in_3" },
      null,
    ]);
    expect(idx.get("pi:pi_1")).toBe("in_1");
    expect(idx.get("pi:pi_2")).toBe("in_2");
    expect(idx.get("charge:ch_2")).toBe("in_2");
    expect(idx.size).toBe(3);
  });

  it("ignores cancelled attempts and reads payment records (invoice paid outside Stripe)", () => {
    // Shape of Colten's e-transfer invoice: a record payment plus an abandoned card attempt.
    const inv = {
      id: "in_colten",
      payments: {
        data: [
          { status: "paid", payment: { type: "payment_record", payment_record: "pr_1" } },
          { status: "canceled", payment: { type: "payment_intent", payment_intent: "pi_abandoned" } },
        ],
      },
    };
    expect(invoicePaymentIntentId(inv)).toBeNull();
    expect(invoiceChargeId(inv)).toBeNull();
    expect(invoicePaymentRecordId(inv)).toBe("pr_1");
    expect(invoiceIdByPaymentRef([inv]).size).toBe(0);
    expect(invoicePaymentRecordId({ payments: { data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_1" } }] } })).toBeNull();
  });
});
