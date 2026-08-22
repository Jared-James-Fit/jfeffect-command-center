import { describe, expect, it } from "vitest";
import { paymentTotals, packageValueWithTax, packageValue } from "@/lib/sessions-inventory";

describe("stripe tax separation", () => {
  it("splits gross charges into net + tax", () => {
    const t = paymentTotals([
      { txn_type: "payment", amount_minor: 21000, tax_minor: 1000 },
      { txn_type: "payment", amount_minor: 10000, tax_minor: 0 },
      { txn_type: "payment", amount_minor: 5000, tax_minor: 250, voided: true },
    ]);
    expect(t).toEqual({ grossMinor: 31000, taxMinor: 1000, netMinor: 30000, refundedMinor: 0, hasTax: true });
  });

  it("nets refunds out of gross and tax", () => {
    const t = paymentTotals([
      { txn_type: "payment", amount_minor: 21000, tax_minor: 1000 },
      { txn_type: "refund", amount_minor: 10500, tax_minor: 500 },
    ]);
    expect(t.grossMinor).toBe(10500);
    expect(t.netMinor).toBe(10000);
    expect(t.refundedMinor).toBe(10500);
  });

  it("counts only pre-tax dollars toward a package contract", () => {
    const v = packageValueWithTax(
      { sessions_purchased: 16, contract_value_cents: 80000, amount_paid_cents: 21000, amount_outstanding_cents: 59000, currency: "CAD" },
      [{ txn_type: "payment", amount_minor: 21000, tax_minor: 1000 }],
    );
    expect(v.netPaidMinor).toBe(20000);
    expect(v.taxPaidMinor).toBe(1000);
    expect(v.grossPaidMinor).toBe(21000);
    expect(v.outstandingMinor).toBe(60000);
    expect(v.paidRatePerSessionMinor).toBe(1250);
  });

  it("falls back to purchase totals when no ledger rows exist", () => {
    const base = { sessions_purchased: 10, contract_value_cents: 50000, amount_paid_cents: 25000, currency: "CAD" };
    const v = packageValueWithTax(base, []);
    expect(v.netPaidMinor).toBe(packageValue(base).amountPaidMinor);
    expect(v.taxSeparated).toBe(false);
  });
});
