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

  it("shows Marc owing $1,008: $336 left on package 2 and his next 16 ($672), which his training started", () => {
    const s = buildBillingSummary({ sales: [pkg1, pkg2], ledger, balance, events });
    expect(s.taxIncluded).toBe(true);
    expect(s.owedCents).toBe(100800);
    expect(s.paidCents).toBe(117600);
    expect(s.sessions).toEqual({ bought: 32, used: 42, booked: 10 });
    expect(s.lines).toEqual([
      { kind: "sale", id: "p2", name: "Personal Training — 16 Sessions / 4 Weeks", leftCents: 33600, paymentsMade: 2, paymentsTotal: 4, nextPaymentCents: 16800, nextDate: "2026-10-30", pastDue: false, from: null, to: null },
      {
        kind: "renewal", fromSaleId: "p2", name: "Personal Training — 16 Sessions / 4 Weeks", size: 16, count: 1,
        eachCents: 67200, priceCents: 64000, totalCents: 67200, trained: 10, trainedFrom: "2026-10-05", trainedTo: "2026-10-20",
        bookedIn: 6, bookedAfter: 4, bookedAfterFrom: "2026-11-02", bookedAfterTo: "2026-11-06",
      },
    ]);
    expect(s.waiting).toEqual([]);
    expect(s.next).toEqual({ cents: 16800, date: "2026-10-30", name: "Personal Training — 16 Sessions / 4 Weeks" });
  });

  it("once the renewal is added it's a sale like any other, owed while it's trained on", () => {
    const pkg3 = { id: "p3", offer_name: "Personal Training — 16 Sessions / 4 Weeks", payment_status: "Unpaid", is_recurring: false,
      contract_value_cents: 64000, installment_amount: 160, number_of_payments: 4, currency: "CAD", amount_paid_cents: 0, sessions_purchased: 16, purchased_at: "2026-10-22" };
    const after = [
      ...events.filter((e) => !(e.event_type === "used") && !["2026-10-21", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-30"].includes(e.effective_date)),
    ];
    const s = buildBillingSummary({
      sales: [pkg1, pkg2, pkg3], ledger,
      balance: [...balance, { purchase_id: "p3", granted: 16, used: 10, reserved: 6, remaining: 0 }],
      events: after,
    });
    expect(s.owedCents).toBe(33600 + 67200);
    expect(s.waiting).toEqual([]);
    expect(s.lines.map((l) => l.kind)).toEqual(["sale", "sale", "renewal"]);
    // Only bookings run past it now: a heads-up, not owed.
    expect(s.lines[2]).toMatchObject({ kind: "renewal", count: 0, totalCents: 0, bookedAfter: 4 });
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
