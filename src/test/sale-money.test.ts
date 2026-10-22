import { describe, expect, it } from "vitest";
import { billingPeriod, saleMoney, salePayments } from "@/lib/sale-money";

// Real sales as stored on Oct 22, 2026 (ids shortened).
const pay = (amount: number, tax: number, date: string, extra: Record<string, unknown> = {}) => ({
  id: `l-${date}-${amount}`, txn_type: "payment", method: "stripe", amount_minor: amount, tax_minor: tax, transaction_date: date, voided: false, source: "stripe_checkout", ...extra,
});

const marcP1 = {
  id: "p1", offer_name: "Personal Training — 16 Sessions / 4 Weeks", currency: "CAD", payment_status: "Paid", is_recurring: false,
  payment_structure: "Bi-weekly subscription (every 2 weeks) — 4 payments", contract_value_cents: 80000, full_payable_amount: 800,
  installment_amount: 200, number_of_payments: 4, amount_paid_cents: 84000, amount_tax_paid_cents: 4000,
};
const marcP1Ledger = [pay(21000, 1000, "2026-08-22"), pay(21000, 1000, "2026-09-05"), pay(42000, 2000, "2026-09-13")];

const marcP2 = {
  id: "p2", offer_name: "Personal Training — 16 Sessions / 4 Weeks", currency: "CAD", payment_status: "Active Subscription", is_recurring: true,
  payment_structure: "Bi-weekly subscription (every 2 weeks) — 4 payments", contract_value_cents: 64000, full_payable_amount: 640,
  installment_amount: 160, number_of_payments: 4, amount_paid_cents: 33600, amount_tax_paid_cents: 1600,
  next_billing_date: "2026-10-30", stripe_subscription_status: "active", stripe_subscription_id: "sub_x",
};
const marcP2Ledger = [pay(16800, 800, "2026-10-02"), pay(16800, 800, "2026-10-16")];

const monthly = {
  id: "m", offer_name: "Online Coaching — $130/month", currency: "CAD", payment_status: "Active Subscription", is_recurring: true,
  payment_structure: "Monthly subscription", payment_frequency: "Monthly subscription", contract_value_cents: null, full_payable_amount: 130,
  amount_paid_cents: 13650, amount_tax_paid_cents: 650, next_billing_date: "2026-11-06", stripe_subscription_status: "active", stripe_subscription_id: "sub_y",
};

describe("one sale's money, in the dollars the client pays", () => {
  it("Marc's package 2: $672 with tax, $336 in, $336 left, next $168 on Oct 30", () => {
    const m = saleMoney(marcP2, marcP2Ledger);
    expect(m).toMatchObject({
      kind: "plan", state: "left", priceCents: 67200, priceNote: "$640.00 + tax", paidCents: 33600, payments: 2,
      leftCents: 33600, plan: { made: 2, total: 4 }, next: { cents: 16800, date: "2026-10-30" },
    });
  });

  it("Marc's package 1: paid in full in 3 payments, never '4 of 4'", () => {
    const m = saleMoney(marcP1, marcP1Ledger);
    expect(m).toMatchObject({ kind: "plan", state: "paid", priceCents: 84000, priceNote: "incl. $40.00 tax", paidCents: 84000, payments: 3, leftCents: 0, plan: null, next: null });
  });

  it("a monthly subscription: $136.50 a month, renews Nov 6", () => {
    const m = saleMoney(monthly, [pay(13650, 650, "2026-10-06")]);
    expect(m).toMatchObject({ kind: "subscription", state: "renews", per: "month", priceCents: 13650, priceNote: "$130.00 + tax", leftCents: 0, next: { cents: 13650, date: "2026-11-06" } });
  });

  it("a cancelled monthly subscription has ended, with what came in", () => {
    const vicky = {
      id: "v", offer_name: "Online Coaching — Legacy $130", currency: "CAD", payment_status: "Cancelled", is_recurring: false,
      payment_structure: "Monthly subscription", contract_value_cents: 13000, full_payable_amount: 130, amount_paid_cents: 27300, amount_tax_paid_cents: 1300,
      stripe_subscription_status: "canceled", stripe_subscription_id: "sub_z",
    };
    const m = saleMoney(vicky, [pay(13650, 650, "2026-07-03"), pay(13650, 650, "2026-08-03")]);
    expect(m).toMatchObject({ kind: "subscription", state: "ended", paidCents: 27300, payments: 2, leftCents: 0, next: null });
  });

  it("a price entered with the tax in it shows what was really paid", () => {
    const ashley = {
      id: "a", offer_name: "Online Coaching — Legacy", currency: "CAD", payment_status: "Paid", is_recurring: false, payment_structure: "One-time payment",
      contract_value_cents: 117972, full_payable_amount: 1179.72, amount_paid_cents: 117972, amount_tax_paid_cents: 5472,
    };
    const ledger = [pay(120000, 0, "2026-07-05", { voided: true, source: "manual" }), pay(117972, 5472, "2026-07-06")];
    const m = saleMoney(ashley, ledger);
    expect(m).toMatchObject({ kind: "one_time", state: "paid", priceCents: 117972, priceNote: "incl. $54.72 tax", payments: 1 });
  });

  it("a deposit with no tax says so", () => {
    const deposit = { id: "d", offer_name: "Personal Training — Deposit", currency: "CAD", payment_status: "Paid", contract_value_cents: 10000, full_payable_amount: 100, amount_paid_cents: 10000, amount_tax_paid_cents: 0 };
    expect(saleMoney(deposit, [pay(10000, 0, "2026-06-19")])).toMatchObject({ state: "paid", priceCents: 10000, priceNote: "No tax" });
  });

  it("a payment link with nothing paid is waiting, not owed", () => {
    const sent = { id: "w", offer_name: "Private Coaching", currency: "CAD", payment_status: "Pending Payment", payment_structure: "One-time payment", contract_value_cents: 100000, amount_paid_cents: 0 };
    expect(saleMoney(sent, [], 0.05)).toMatchObject({ state: "waiting", priceCents: 105000, leftCents: 105000, paidCents: 0 });
  });

  it("a renewal being trained on is owed before its first payment, never waiting", () => {
    const renewal = { id: "p3", offer_name: "Personal Training — 16 Sessions / 4 Weeks", currency: "CAD", payment_status: "Unpaid", is_recurring: false,
      payment_structure: "Bi-weekly subscription (every 2 weeks) — 4 payments", contract_value_cents: 64000, installment_amount: 160, number_of_payments: 4, amount_paid_cents: 0 };
    expect(saleMoney(renewal, [], 0.05).state).toBe("waiting");
    expect(saleMoney(renewal, [], 0.05, { sessionsUsed: 10 })).toMatchObject({
      state: "left", priceCents: 67200, leftCents: 67200, plan: { made: 0, total: 4 }, next: { cents: 16800, date: null },
    });
  });

  it("a free session credit is free", () => {
    const credit = { id: "f", offer_name: "PT Session Credit", currency: "CAD", payment_status: "Paid", contract_value_cents: 0, full_payable_amount: 0, amount_paid_cents: 0 };
    expect(saleMoney(credit)).toMatchObject({ kind: "free", state: "free", priceCents: 0 });
  });

  it("refunds come off what was paid", () => {
    const s = { id: "r", offer_name: "PT", currency: "CAD", payment_status: "Paid", contract_value_cents: 10000, amount_paid_cents: 10500, amount_tax_paid_cents: 500 };
    const m = saleMoney(s, [pay(10500, 500, "2026-01-01"), { id: "x", txn_type: "refund", amount_minor: 5250, transaction_date: "2026-01-05" }]);
    expect(m).toMatchObject({ paidCents: 5250, refundedCents: 5250 });
  });
});

describe("a sale's payments list", () => {
  it("lists money in and out newest first, leaving out the bookkeeping reversal", () => {
    const rows = salePayments([
      pay(120000, 0, "2026-07-05", { voided: true, source: "manual", id: "old" }),
      { id: "rev", txn_type: "reversal", amount_minor: -120000, transaction_date: "2026-07-06" },
      pay(117972, 5472, "2026-07-06", { id: "new" }),
      pay(16800, 800, "2026-07-01", { id: "hand", method: "etransfer", source: "manual" }),
    ]);
    // Only a payment recorded by hand can be voided here; Stripe's are fixed in Stripe.
    expect(rows.map((r) => [r.id, r.cents, r.voided, r.canVoid])).toEqual([
      ["new", 117972, false, false], ["old", 120000, true, false], ["hand", 16800, false, true],
    ]);
    expect(rows[0].method).toBe("Credit card (Stripe)");
  });
});

describe("billing period", () => {
  it("reads how often a subscription charges", () => {
    expect(billingPeriod({ payment_structure: "Monthly subscription" })).toBe("month");
    expect(billingPeriod({ payment_frequency: "biweekly" })).toBe("2 weeks");
    expect(billingPeriod({ payment_structure: "Bi-weekly subscription (every 2 weeks) — 4 payments" })).toBe("2 weeks");
    expect(billingPeriod({ payment_structure: "One-time payment" })).toBeNull();
  });
});
