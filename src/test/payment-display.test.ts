import { describe, expect, it } from "vitest";
import { resolvePaymentDisplay } from "@/lib/payment-display";

const base = { currency: "CAD", is_recurring: false, amount_refunded_cents: 0 };

describe("resolvePaymentDisplay", () => {
  it("never shows a paid sale with no price as a $0 free product", () => {
    // A Stripe backfill: $1,365 received, no contract value or price stored.
    const d = resolvePaymentDisplay({ ...base, payment_status: "Partially Paid", amount_paid_cents: 136500, contract_value_cents: null, full_payable_amount: null });
    expect(d.contractTotal).toBe(1365);
    expect(d.amountOutstanding).toBe(0);
    expect(d.isPaidInFull).toBe(true);
    expect(d.status).toBe("paid");
    expect(d.renewal.kind).toBe("none");
  });

  it("keeps a genuinely free product free", () => {
    const d = resolvePaymentDisplay({ ...base, payment_status: "Paid", amount_paid_cents: 0, contract_value_cents: 0, full_payable_amount: 0 });
    expect(d.contractTotal).toBe(0);
    expect(d.renewal.kind).toBe("free");
  });

  it("compares a pre-tax price with a payment that includes GST", () => {
    // $6,000 package, $6,300 paid with 5% GST.
    const d = resolvePaymentDisplay({ ...base, payment_status: "Paid", amount_paid_cents: 630000, contract_value_cents: 600000 });
    expect(d.contractTotal).toBe(6000);
    expect(d.amountPaid).toBe(6300);
    expect(d.amountOutstanding).toBe(0);
    expect(d.status).toBe("paid");
  });

  it("still shows what is left on an unpaid or partly paid sale", () => {
    expect(resolvePaymentDisplay({ ...base, payment_status: "Unpaid", amount_paid_cents: 0, contract_value_cents: 10000 })).toMatchObject({ status: "unpaid", amountOutstanding: 100 });
    expect(resolvePaymentDisplay({ ...base, payment_status: "Partially Paid", amount_paid_cents: 136500, contract_value_cents: 600000 })).toMatchObject({ status: "partially_paid", amountOutstanding: 4635 });
  });
});
