import { describe, expect, it } from "vitest";
import { buildBillingSummary, clientTaxRate } from "@/lib/client-billing-summary";

// Marc Asugui on Oct 21, 2026, as stored.
const pkg1 = {
  id: "p1", offer_name: "Personal Training — 16 Sessions / 4 Weeks", payment_status: "Paid", is_recurring: false,
  contract_value_cents: 80000, installment_amount: 200, number_of_payments: 4, currency: "CAD",
  amount_paid_cents: 84000, amount_tax_paid_cents: 4000, sessions_purchased: 16, purchased_at: "2026-08-22",
};
const pkg2 = {
  id: "p2", offer_name: "Personal Training — 16 Sessions / 4 Weeks", payment_status: "Active Subscription", is_recurring: true,
  contract_value_cents: 64000, installment_amount: 160, number_of_payments: 4, currency: "CAD",
  amount_paid_cents: 33600, amount_tax_paid_cents: 1600, sessions_purchased: 16, purchased_at: "2026-10-02",
  next_billing_date: "2026-10-30",
};
const ledger = [
  { purchase_id: "p1", txn_type: "payment", amount_minor: 21000, tax_minor: 1000 },
  { purchase_id: "p1", txn_type: "payment", amount_minor: 21000, tax_minor: 1000 },
  { purchase_id: "p1", txn_type: "payment", amount_minor: 42000, tax_minor: 2000 },
  { purchase_id: "p2", txn_type: "payment", amount_minor: 16800, tax_minor: 800 },
  { purchase_id: "p2", txn_type: "payment", amount_minor: 16800, tax_minor: 800 },
];
const balance = [
  { purchase_id: "p1", granted: 16, used: 16, reserved: 0, remaining: 0 },
  { purchase_id: "p2", granted: 16, used: 16, reserved: 0, remaining: 0 },
];
const day = (d: number, m = 10) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
// Newest first, the way the billing feed returns them.
const events = [
  ...[21, 23, 26, 27, 28, 30].map((d) => ({ id: `h${d}`, purchase_id: null, event_type: "reserved", session_count: -1, source: "reattribute", effective_date: day(d) })),
  ...[2, 3, 4, 6].map((d) => ({ id: `h11-${d}`, purchase_id: null, event_type: "reserved", session_count: -1, source: "reattribute", effective_date: day(d, 11) })),
  ...[5, 6, 7, 8, 12, 13, 14, 16, 19, 20].map((d) => ({ id: `u${d}`, purchase_id: null, event_type: "used", session_count: -1, source: "reattribute", effective_date: day(d) })),
].reverse();

describe("a client's balance in real dollars", () => {
  it("reads the GST rate from what was paid", () => {
    expect(clientTaxRate([pkg1, pkg2])).toBeCloseTo(0.05, 6);
  });

  it("shows Marc owing $756: $336 left on package 2 and 10 sessions not billed", () => {
    const s = buildBillingSummary({ sales: [pkg1, pkg2], ledger, balance, events });
    expect(s.taxIncluded).toBe(true);
    expect(s.owedCents).toBe(75600);
    expect(s.paidCents).toBe(117600);
    expect(s.sessions).toEqual({ bought: 32, used: 42, booked: 10 });
    expect(s.lines).toEqual([
      { kind: "sale", id: "p2", name: "Personal Training — 16 Sessions / 4 Weeks", leftCents: 33600, paymentsMade: 2, paymentsTotal: 4, nextPaymentCents: 16800, nextDate: "2026-10-30", pastDue: false },
      { kind: "unbilled", sessions: 10, from: "2026-10-05", to: "2026-10-20", eachCents: 4200, totalCents: 42000, booked: 10, bookedFrom: "2026-10-21", bookedTo: "2026-11-06" },
    ]);
    expect(s.waiting).toEqual([]);
    expect(s.next).toEqual({ cents: 16800, date: "2026-10-30", name: "Personal Training — 16 Sessions / 4 Weeks" });
  });

  it("is all paid up when nothing is left and no session is past what was bought", () => {
    const s = buildBillingSummary({ sales: [pkg1], ledger: ledger.slice(0, 3), balance: [balance[0]], events: [] });
    expect(s.owedCents).toBe(0);
    expect(s.lines).toEqual([]);
  });

  it("keeps a payment request nothing was paid on out of what's owed", () => {
    const unpaid = { id: "u", offer_name: "PT single", payment_status: "Unpaid", contract_value_cents: 10000, amount_paid_cents: 0, purchased_at: "2026-10-20T10:00:00Z" };
    const s = buildBillingSummary({ sales: [unpaid], ledger: [], balance: [], events: [] });
    expect(s.taxIncluded).toBe(false);
    expect(s.owedCents).toBe(0);
    expect(s.waiting).toEqual([{ kind: "waiting", id: "u", name: "PT single", cents: 10000, since: "2026-10-20" }]);
  });

  it("says before tax when no payment shows a rate", () => {
    const part = { id: "pp", offer_name: "PT 10 pack", payment_status: "Partially Paid", contract_value_cents: 100000, amount_paid_cents: 40000, amount_tax_paid_cents: 0 };
    const s = buildBillingSummary({ sales: [part], ledger: [{ purchase_id: "pp", txn_type: "payment", amount_minor: 40000, tax_minor: 0 }], balance: [], events: [] });
    expect(s.taxIncluded).toBe(false);
    expect(s.owedCents).toBe(60000);
  });
});
