import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { billingStatusLine, buildClientPayments, saleLabels, type ScheduleSale } from "@/lib/payment-schedule";
import type { MoneyLedgerRow } from "@/lib/sale-money";

// Marc Asugui's real records on Nov 13 2026: package 1 paid ($840), package 2 on
// a Stripe subscription ($160 + 5% GST every 2 weeks, 3 of 4 paid, the 4th due
// today), packages 3 and 4 pay-later renewals the same subscription pays next.
const TODAY = "2026-11-13";
const base = {
  offer_name: "Personal Training — 16 Sessions / 4 Weeks",
  sessions_purchased: 16,
  contract_value_cents: 64000,
  installment_amount: 160,
  number_of_payments: 4,
  currency: "CAD",
  payment_frequency: "biweekly",
  payment_structure: "Bi-weekly subscription (every 2 weeks) — 4 payments",
};
const marc: ScheduleSale[] = [
  { ...base, id: "p1", contract_value_cents: 80000, installment_amount: 200, payment_status: "Paid", term_start_date: "2026-08-10", stripe_subscription_id: "sub_old", stripe_subscription_status: "canceled", amount_paid_cents: 84000, amount_tax_paid_cents: 4000 } as any,
  { ...base, id: "p2", payment_status: "Active Subscription", term_start_date: "2026-09-07", is_recurring: true, stripe_subscription_id: "sub_live", stripe_subscription_status: "active", stripe_checkout_session_id: "cs_live", next_billing_date: "2026-11-13", first_payment_date: "2026-10-02", amount_paid_cents: 50400, amount_tax_paid_cents: 2400 } as any,
  { ...base, id: "p3", payment_status: "Unpaid", term_start_date: "2026-10-05", amount_paid_cents: 0 } as any,
  { ...base, id: "p4", payment_status: "Unpaid", term_start_date: "2026-11-02", amount_paid_cents: 0 } as any,
];
const pay = (pid: string, day: string, cents: number, tax: number, extra: Partial<MoneyLedgerRow> = {}): MoneyLedgerRow =>
  ({ purchase_id: pid, txn_type: "payment", amount_minor: cents, tax_minor: tax, transaction_date: day, ...extra });
const marcLedger: MoneyLedgerRow[] = [
  pay("p1", "2026-08-22", 21000, 1000), pay("p1", "2026-09-05", 21000, 1000), pay("p1", "2026-09-13", 42000, 2000),
  pay("p2", "2026-10-02", 16800, 800),
  // The duplicate the Nov 12 sync wrote, voided the same night: never counts.
  pay("p2", "2026-10-02", 16800, 800, { voided: true }),
  pay("p2", "2026-10-16", 16800, 800), pay("p2", "2026-10-30", 16800, 800),
];
// session_balance() for him that day: packages 1-3 trained, package 4 has 6 done and 10 booked.
const marcBalance = [
  { purchase_id: "p1", granted: 16, used: 16, reserved: 0, remaining: 0, expired: 0, transferred: 0 },
  { purchase_id: "p2", granted: 16, used: 16, reserved: 0, remaining: 0, expired: 0, transferred: 0 },
  { purchase_id: "p3", granted: 16, used: 16, reserved: 0, remaining: 0, expired: 0, transferred: 0 },
  { purchase_id: "p4", granted: 16, used: 6, reserved: 10, remaining: 0, expired: 0, transferred: 0 },
] as any[];
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (iso: string) => iso.slice(5);
const dates = (p: ReturnType<typeof buildClientPayments>, id: string) =>
  p.balances.find((b) => b.saleId === id)!.installments.map((i) => `${i.date} ${i.cents} ${i.state}`);

describe("Marc's payments (the reference account)", () => {
  const p = buildClientPayments({ sales: marc, ledger: marcLedger, today: TODAY , balance: marcBalance, events: [] });

  it("totals match his ledger: $1,512 left, $1,344 paid, nothing overdue", () => {
    expect(p.outstandingCents).toBe(151200);
    expect(p.paidCents).toBe(134400);
    expect(p.overdueCents).toBe(0);
    expect(p.overdue).toEqual([]);
    expect(p.dueNowCents).toBe(16800);
    expect(p.scheduledCents).toBe(134400);
    expect(p.unscheduledCents).toBe(0);
    expect(p.taxIncluded).toBe(true);
  });

  it("the next payment is today's $168 on package 2, by auto-pay", () => {
    expect(p.next).toMatchObject({ saleId: "p2", label: "Package 2", date: "2026-11-13", cents: 16800, auto: true, state: "due_today", nth: 4, of: 4 });
  });

  it("each package keeps its own payments, oldest owed first, on Stripe's own dates", () => {
    expect(dates(p, "p2")).toEqual(["2026-11-13 16800 due_today"]);
    expect(dates(p, "p3")).toEqual([
      "2026-11-27 16800 scheduled", "2026-12-11 16800 scheduled", "2026-12-25 16800 scheduled", "2027-01-08 16800 scheduled",
    ]);
    expect(dates(p, "p4").at(0)).toBe("2027-01-22 16800 scheduled");
    expect(dates(p, "p4").at(-1)).toBe("2027-03-05 16800 scheduled");
    expect(p.balances.map((b) => [b.label, b.how])).toEqual([["Package 2", "auto_pay"], ["Package 3", "auto_pay"], ["Package 4", "auto_pay"]]);
    expect(p.upcoming).toHaveLength(9);
  });

  it("auto-pay is on, and its last scheduled payment is never called 'paid up'", () => {
    expect(p.autoPay).toMatchObject({ state: "on", cents: 16800, per: "2 weeks", next: "2026-11-13", lastScheduled: "2027-03-05", uncoveredCents: 0 });
    const line = billingStatusLine(p, fmt, day);
    expect(line).toEqual({ text: "$168.00 due today by auto-pay · $1512.00 left", tone: "neutral" });
    expect(line.text).not.toMatch(/paid up/i);
  });

  it("packages are numbered the way the Sessions tab numbers them", () => {
    expect([...saleLabels(marc).entries()].slice(0, 4)).toEqual([["p1", "Package 1"], ["p2", "Package 2"], ["p3", "Package 3"], ["p4", "Package 4"]]);
  });
});

describe("what happens next (scenarios)", () => {
  it("auto-pay succeeds: package 2 is paid and the next charge goes to package 3", () => {
    const sales = marc.map((s) => (s.id === "p2" ? { ...s, amount_paid_cents: 67200, amount_tax_paid_cents: 3200, next_billing_date: "2026-11-27" } : s));
    const p = buildClientPayments({ sales, ledger: [...marcLedger, pay("p2", "2026-11-13", 16800, 800)], balance: marcBalance, events: [], today: TODAY });
    expect(p.paidCents).toBe(151200);
    expect(p.outstandingCents).toBe(134400);
    expect(p.balances.map((b) => b.saleId)).toEqual(["p3", "p4"]);
    expect(p.next).toMatchObject({ saleId: "p3", date: "2026-11-27", state: "scheduled" });
    expect(p.autoPay?.lastScheduled).toBe("2027-03-05");
  });

  it("renewing early: the next package its auto-pay pays is billed and scheduled after the others, never 'waiting'", () => {
    const p5 = { ...base, id: "p5", payment_status: "Unpaid", term_start_date: "2026-11-30", amount_paid_cents: 0 } as any;
    const p = buildClientPayments({ sales: [...marc, p5], ledger: marcLedger, balance: marcBalance, events: [], today: TODAY });
    expect(p.waiting).toEqual([]);
    expect(p.outstandingCents).toBe(151200 + 67200);
    expect(dates(p, "p5")[0]).toBe("2027-03-19 16800 scheduled");
    expect(p.balances.find((b) => b.saleId === "p5")?.label).toBe("Package 5");
  });

  it("auto-pay fails: that payment is overdue (failed), the rest stay scheduled", () => {
    const sales = marc.map((s) => (s.id === "p2" ? { ...s, payment_status: "Past Due", stripe_subscription_status: "past_due" } : s));
    const p = buildClientPayments({ sales, ledger: marcLedger, today: TODAY , balance: marcBalance, events: [] });
    expect(p.autoPay?.state).toBe("failing");
    expect(p.overdue.map((i) => [i.saleId, i.state, i.cents])).toEqual([["p2", "failed", 16800]]);
    expect(p.overdueCents).toBe(16800);
    expect(p.scheduledCents).toBe(134400);
    expect(billingStatusLine(p, fmt, day)).toEqual({ text: "Overdue $168.00", tone: "error" });
  });

  it("a manual payment pays down the oldest owed and auto-pay finishes sooner (nothing extra is charged)", () => {
    const ledger = [...marcLedger, pay("p3", "2026-11-13", 16800, 800, { method: "etransfer", source: "manual" })];
    const sales = marc.map((s) => (s.id === "p3" ? { ...s, amount_paid_cents: 16800, amount_tax_paid_cents: 800 } : s));
    const p = buildClientPayments({ sales, ledger, today: TODAY , balance: marcBalance, events: [] });
    expect(dates(p, "p3")).toHaveLength(3);
    expect(p.autoPay?.lastScheduled).toBe("2027-02-19");
    expect(p.outstandingCents).toBe(134400);
  });

  it("auto-pay set to end with packages still owed: what's left has no dates, never overdue", () => {
    const sales = marc.map((s) => (s.id === "p2" ? { ...s, cancel_at_period_end: true } : s));
    const p = buildClientPayments({ sales, ledger: marcLedger, today: TODAY , balance: marcBalance, events: [] });
    // Ending at the period's end means today's charge doesn't happen either: all $1,512 is uncovered.
    expect(p.autoPay).toMatchObject({ state: "ending", lastScheduled: null, uncoveredCents: 151200 });
    expect(p.overdueCents).toBe(0);
    expect(p.unscheduledCents).toBe(151200);
    // Packages 3 and 4 are collected by hand now, so their dates can be set.
    expect(p.balances.filter((b) => b.canSetDates).map((b) => b.saleId)).toEqual(["p3", "p4"]);
  });

  it("an auto-pay date that just passed with no word from Stripe is unconfirmed, not overdue; days later it is", () => {
    const soon = buildClientPayments({ sales: marc, ledger: marcLedger, today: "2026-11-14" , balance: marcBalance, events: [] });
    expect(soon.next?.state).toBe("unconfirmed");
    expect(soon.overdueCents).toBe(0);
    expect(soon.dueNowCents).toBe(16800);
    const late = buildClientPayments({ sales: marc, ledger: marcLedger, today: "2026-11-20" , balance: marcBalance, events: [] });
    expect(late.overdue.map((i) => i.saleId)).toEqual(["p2"]);
  });

  it("a package with no schedule says so and is never overdue", () => {
    const sales: ScheduleSale[] = [{ ...base, id: "x", payment_status: "Unpaid", term_start_date: "2026-10-01", amount_paid_cents: 0 } as any];
    const used = [{ purchase_id: "x", offer_name: "", granted: 16, used: 16, expired: 0, transferred: 0, reserved: 0, remaining: 0, expires_at: null }];
    const p = buildClientPayments({ sales, ledger: [], balance: used as any, events: [], today: TODAY });
    // No tax paid on file yet, so it reads before tax and says so (never a made-up rate).
    expect(p.taxIncluded).toBe(false);
    expect(p.balances[0]).toMatchObject({ how: "none", unscheduledCents: 64000, canSetDates: true, installments: [] });
    expect(p.overdueCents).toBe(0);
    expect(p.outstandingCents).toBe(64000);
    expect(billingStatusLine(p, fmt, day)).toEqual({ text: "$640.00 left · no payment dates set", tone: "attention" });
  });

  it("all sessions used but money still owed: owed and scheduled, not overdue", () => {
    const sales: ScheduleSale[] = [{ ...base, id: "x", payment_status: "Partially Paid", term_start_date: "2026-10-01", first_payment_date: "2026-10-01", amount_paid_cents: 33600, amount_tax_paid_cents: 1600 } as any];
    const ledger = [pay("x", "2026-10-01", 16800, 800), pay("x", "2026-10-15", 16800, 800)];
    const p = buildClientPayments({ sales, ledger, today: "2026-10-20" });
    expect(dates(p, "x")).toEqual(["2026-10-29 16800 scheduled", "2026-11-12 16800 scheduled"]);
    expect(p.balances[0].how).toBe("manual");
    expect(p.overdueCents).toBe(0);
  });

  it("a hand-collected plan whose date passed with nothing paid is overdue; a payment recorded moves it along", () => {
    const sale = { ...base, id: "x", payment_status: "Partially Paid", term_start_date: "2026-10-01", first_payment_date: "2026-10-01", amount_paid_cents: 16800, amount_tax_paid_cents: 800 } as any;
    const p = buildClientPayments({ sales: [sale], ledger: [pay("x", "2026-10-01", 16800, 800)], today: TODAY });
    expect(p.overdue.map((i) => `${i.date} ${i.state} ${i.nth}/${i.of}`)).toEqual(["2026-10-15 overdue 2/4", "2026-10-29 overdue 3/4", "2026-11-12 overdue 4/4"]);
    const after = buildClientPayments({
      sales: [{ ...sale, amount_paid_cents: 33600, amount_tax_paid_cents: 1600 }],
      ledger: [pay("x", "2026-10-01", 16800, 800), pay("x", "2026-11-13", 16800, 800)],
      today: TODAY,
    });
    expect(after.overdue.map((i) => i.nth)).toEqual([3, 4]);
  });

  it("two plans at once each keep their own dates", () => {
    const a = { ...base, id: "a", payment_status: "Unpaid", term_start_date: "2026-11-02", first_payment_date: "2026-11-20", amount_paid_cents: 0 } as any;
    const b = { ...base, id: "b", offer_name: "Nutrition coaching", sessions_purchased: 0, payment_status: "Unpaid", term_start_date: "2026-11-05", first_payment_date: "2026-11-15", payment_frequency: "monthly", payment_structure: "Monthly — 3 payments", number_of_payments: 3, installment_amount: 100, contract_value_cents: 30000, amount_paid_cents: 0 } as any;
    const used = [{ purchase_id: "a", granted: 16, used: 2, reserved: 0, remaining: 14 }];
    const p = buildClientPayments({ sales: [a, b], ledger: [pay("z", "2026-01-01", 1050, 50)], balance: used as any, events: [], today: TODAY });
    expect(p.upcoming.slice(0, 3).map((i) => `${i.label} ${i.date}`)).toEqual(["Nutrition coaching 2026-11-15", "Package 1 2026-11-20", "Package 1 2026-12-04"]);
    expect(dates(p, "b").at(-1)).toMatch(/^2027-01-15 /);
  });

  it("paid in full with sessions left: nothing owed", () => {
    const p = buildClientPayments({ sales: [marc[0]], ledger: marcLedger.filter((l) => l.purchase_id === "p1"), today: TODAY });
    expect(p.outstandingCents).toBe(0);
    expect(p.paidCents).toBe(84000);
    expect(billingStatusLine(p, fmt, day)).toEqual({ text: "Paid up", tone: "done" });
  });

  it("a monthly subscription is never 'owed': its next charge is just the next payment", () => {
    const sub = { id: "s", offer_name: "Online Coaching", currency: "CAD", payment_status: "Active Subscription", payment_frequency: "Monthly subscription", is_recurring: true, full_payable_amount: 130, stripe_subscription_id: "sub", stripe_subscription_status: "active", next_billing_date: "2026-12-06", amount_paid_cents: 27300, amount_tax_paid_cents: 1300, sessions_purchased: 0 } as any;
    const p = buildClientPayments({ sales: [sub], ledger: [pay("s", "2026-10-06", 13650, 650), pay("s", "2026-11-06", 13650, 650)], today: TODAY });
    expect(p.outstandingCents).toBe(0);
    expect(p.recurring).toEqual([{ saleId: "s", name: "Online Coaching", cents: 13650, per: "month", next: "2026-12-06", state: "renews" }]);
    expect(p.next).toMatchObject({ date: "2026-12-06", cents: 13650, recurring: true });
    expect(billingStatusLine(p, fmt, day).text).toBe("Paid up · next $136.50 on 12-06 by auto-pay");
  });

  it("a payment link nobody has paid is waiting, not owed", () => {
    const s = { id: "w", offer_name: "12M Full", currency: "CAD", payment_status: "Unpaid", payment_frequency: "Paid in Full", contract_value_cents: 3000000, amount_paid_cents: 0, stripe_payment_link: "https://buy.stripe.com/x" } as any;
    const p = buildClientPayments({ sales: [s], ledger: [], today: TODAY });
    expect(p.outstandingCents).toBe(0);
    expect(p.waiting).toHaveLength(1);
  });

  it("training past every package that no sale bills yet is said separately (not in what's owed)", () => {
    const events = [
      { id: "u1", purchase_id: null, event_type: "used", session_count: -1, effective_date: "2026-11-10" },
      { id: "u2", purchase_id: null, event_type: "used", session_count: -1, effective_date: "2026-11-12" },
    ];
    const balance = [{ purchase_id: "p1", granted: 16, used: 16, reserved: 0, remaining: 0, expired: 0, transferred: 0 }];
    const p = buildClientPayments({ sales: [marc[0]], ledger: marcLedger.filter((l) => l.purchase_id === "p1"), balance: balance as any, events: events as any, today: TODAY });
    expect(p.outstandingCents).toBe(0);
    expect(p.notBilled).toMatchObject({ kind: "renewal", count: 1, trained: 2 });
    expect(billingStatusLine(p, fmt, day).tone).toBe("attention");
  });
});

describe("the server keeps payments single and auto-pay honest", () => {
  const billing = readFileSync("src/lib/billing.functions.ts", "utf8");
  const sql = (() => { try { return readFileSync("supabase/migrations/20270314090000_billing_safeguards.sql", "utf8"); } catch { return ""; } })();

  it("a manual payment tapped twice is recorded once", () => {
    expect(billing).toMatch(/findRecentDuplicatePayment/);
    expect(billing).toMatch(/duplicate: true/);
  });

  it("a manual payment that clears every package stops auto-pay at the end of its period (never charges)", () => {
    expect(billing).toMatch(/endAutoPayIfPaidUp/);
  });

  it("a second untouched renewal is refused, and a renewal follows on after the last package", () => {
    expect(sql).toMatch(/already has an untouched package/i);
    expect(sql).toMatch(/GREATEST/);
  });
});
