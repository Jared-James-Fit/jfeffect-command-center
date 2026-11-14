import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildClientPayments, saleLabels, type ScheduleSale } from "@/lib/payment-schedule";
import { packageGlance } from "@/lib/package-view";
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
    // What the screens say: paying off Package 2, $168 due today by auto-pay; never "paid up".
    expect(packageGlance(p).paying).toMatchObject({ kind: "plan", label: "Package 2", status: "due", next: { cents: 16800, state: "due_today", auto: true } });
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
    expect(packageGlance(p).paying).toMatchObject({ kind: "plan", label: "Package 2", status: "failed" });
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
    expect(packageGlance(p).paying).toEqual({ kind: "unscheduled", saleId: "x", label: "Package 1", leftCents: 64000, packages: 1 });
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
    expect(packageGlance(p).paying).toEqual({ kind: "paid_up", nextCharge: null });
  });

  it("a monthly subscription is never 'owed': its next charge is just the next payment", () => {
    const sub = { id: "s", offer_name: "Online Coaching", currency: "CAD", payment_status: "Active Subscription", payment_frequency: "Monthly subscription", is_recurring: true, full_payable_amount: 130, stripe_subscription_id: "sub", stripe_subscription_status: "active", next_billing_date: "2026-12-06", amount_paid_cents: 27300, amount_tax_paid_cents: 1300, sessions_purchased: 0 } as any;
    const p = buildClientPayments({ sales: [sub], ledger: [pay("s", "2026-10-06", 13650, 650), pay("s", "2026-11-06", 13650, 650)], today: TODAY });
    expect(p.outstandingCents).toBe(0);
    expect(p.recurring).toEqual([{ saleId: "s", name: "Online Coaching", cents: 13650, per: "month", next: "2026-12-06", state: "renews" }]);
    expect(p.next).toMatchObject({ date: "2026-12-06", cents: 13650, recurring: true });
    expect(packageGlance(p).paying).toMatchObject({ kind: "paid_up", nextCharge: { date: "2026-12-06", cents: 13650, recurring: true } });
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
    expect(packageGlance(p).training).toMatchObject({ kind: "past", trained: 2, afterLabel: "Package 1" });
  });
});

describe("the server keeps payments single and auto-pay honest", () => {
  const billing = readFileSync("src/lib/billing.functions.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20270314100000_billing_safeguards.sql", "utf8");

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

describe("unpaid training delivered (one method: a package's price spread over its sessions)", () => {
  // Marc on Nov 13 2026 as the database has him: package 4 has 7 completed and 9 booked.
  const now = [
    { purchase_id: "p1", granted: 16, used: 16, reserved: 0, remaining: 0, expired: 0 },
    { purchase_id: "p2", granted: 16, used: 16, reserved: 0, remaining: 0, expired: 0 },
    { purchase_id: "p3", granted: 16, used: 16, reserved: 0, remaining: 0, expired: 0 },
    { purchase_id: "p4", granted: 16, used: 7, reserved: 9, remaining: 0, expired: 0 },
  ] as any[];
  const numbered = marc.map((s, i) => ({ ...s, package_number: i + 1, renewed_from_id: i >= 2 ? marc[i - 1].id : null }));
  const p = buildClientPayments({ sales: numbered, ledger: marcLedger, balance: now, events: [], today: TODAY });
  const pk = (id: string) => p.packages.find((x) => x.saleId === id)!;

  it("Marc: $168 + $672 + $294 = $1,134 delivered and unpaid, inside the $1,512 outstanding", () => {
    expect(pk("p1")).toMatchObject({ number: 1, totalCents: 84000, paidCents: 84000, balanceCents: 0, deliveredCents: 84000, unpaidDeliveredCents: 0 });
    expect(pk("p2")).toMatchObject({ number: 2, totalCents: 67200, paidCents: 50400, balanceCents: 16800, deliveredCents: 67200, unpaidDeliveredCents: 16800 });
    expect(pk("p3")).toMatchObject({ number: 3, totalCents: 67200, paidCents: 0, balanceCents: 67200, deliveredCents: 67200, unpaidDeliveredCents: 67200 });
    expect(pk("p4")).toMatchObject({ number: 4, totalCents: 67200, paidCents: 0, balanceCents: 67200, deliveredCents: 29400, unpaidDeliveredCents: 29400 });
    expect(p.unpaidDeliveredCents).toBe(113400);
    expect(p.outstandingCents).toBe(151200);
    expect(p.unpaidDeliveredCents).toBeLessThanOrEqual(p.outstandingCents);
  });

  it("each package keeps its own sessions and renewal link, numbered 1 → 4", () => {
    expect(p.packages.map((x) => x.label)).toEqual(["Package 1", "Package 2", "Package 3", "Package 4"]);
    expect(pk("p4").sessions).toEqual({ purchased: 16, completed: 7, booked: 9, available: 0, expired: 0 });
    expect(pk("p3").renewedFrom).toEqual({ saleId: "p2", number: 2 });
    expect(pk("p4").renewedFrom).toEqual({ saleId: "p3", number: 3 });
    expect(pk("p2").renewedFrom).toBeNull();
    expect(pk("p4").schedule?.how).toBe("auto_pay");
  });

  it("once tonight's $168 lands, package 2 has nothing unpaid and the total drops to $966", () => {
    const sales = numbered.map((s) => (s.id === "p2" ? { ...s, amount_paid_cents: 67200, amount_tax_paid_cents: 3200, next_billing_date: "2026-11-27" } : s));
    const after = buildClientPayments({ sales, ledger: [...marcLedger, pay("p2", "2026-11-13", 16800, 800)], balance: now, events: [], today: TODAY });
    expect(after.packages.find((x) => x.saleId === "p2")?.unpaidDeliveredCents).toBe(0);
    expect(after.unpaidDeliveredCents).toBe(96600);
  });

  // A paid, taxed sale on file tells the model the client's tax rate (5% here), as for any real client.
  const taxed = { id: "z", offer_name: "Coaching", currency: "CAD", sessions_purchased: 0, payment_status: "Paid", contract_value_cents: 1000, amount_paid_cents: 1050, amount_tax_paid_cents: 50 } as any;
  const one = (overrides: Record<string, unknown>, used: number, ledger: MoneyLedgerRow[]) => {
    const sale = { ...base, id: "x", payment_status: "Partially Paid", term_start_date: "2026-10-01", ...overrides } as any;
    const balance = [{ purchase_id: "x", granted: 16, used, reserved: 0, remaining: 16 - used, expired: 0 }] as any[];
    return buildClientPayments({ sales: [taxed, sale], ledger, balance, events: [], today: TODAY }).packages[0];
  };
  const paid = (cents: number) => [pay("x", "2026-10-01", cents, Math.round(cents / 21)), pay("z", "2026-01-01", 1050, 50)];

  it("the spec's own examples: 16 done with $504 paid, 16 done with none, 7 done with none", () => {
    expect(one({ amount_paid_cents: 50400, amount_tax_paid_cents: 2400 }, 16, paid(50400)).unpaidDeliveredCents).toBe(16800);
    expect(one({ amount_paid_cents: 0, payment_status: "Unpaid" }, 16, [pay("z", "2026-01-01", 1050, 50)]).unpaidDeliveredCents).toBe(67200);
    expect(one({ amount_paid_cents: 0, payment_status: "Unpaid" }, 7, [pay("z", "2026-01-01", 1050, 50)]).unpaidDeliveredCents).toBe(29400);
  });

  it("paid ahead of the training: nothing unpaid", () => {
    const a = one({ amount_paid_cents: 50400, amount_tax_paid_cents: 2400 }, 4, paid(50400));
    expect(a.deliveredCents).toBe(16800);
    expect(a.unpaidDeliveredCents).toBe(0);
    expect(a.balanceCents).toBe(16800);
  });

  it("fully paid with sessions left: nothing unpaid, nothing owed", () => {
    const a = one({ amount_paid_cents: 67200, amount_tax_paid_cents: 3200, payment_status: "Paid" }, 5, paid(67200));
    expect(a).toMatchObject({ state: "paid", balanceCents: 0, unpaidDeliveredCents: 0 });
    expect(a.sessions.available).toBe(11);
  });

  it("a refund counts against what was paid, never twice", () => {
    const ledger = [...paid(67200), { purchase_id: "x", txn_type: "refund", amount_minor: 16800, tax_minor: 800, transaction_date: "2026-10-20" } as MoneyLedgerRow];
    const a = one({ amount_paid_cents: 50400, amount_tax_paid_cents: 2400 }, 16, ledger);
    expect(a.paidCents).toBe(50400);
    expect(a.unpaidDeliveredCents).toBe(16800);
  });

  it("free sessions added on top never push the value past the price", () => {
    const sale = { ...base, id: "x", payment_status: "Unpaid", term_start_date: "2026-10-01", amount_paid_cents: 0 } as any;
    const balance = [{ purchase_id: "x", granted: 18, used: 18, reserved: 0, remaining: 0, expired: 0 }] as any[];
    const a = buildClientPayments({ sales: [taxed, sale], ledger: [pay("z", "2026-01-01", 1050, 50)], balance, events: [], today: TODAY }).packages[0];
    expect(a.deliveredCents).toBe(67200);
    expect(a.unpaidDeliveredCents).toBe(67200);
  });

  it("with no tax paid on file yet it reads before tax (never a guessed rate)", () => {
    const sale = { ...base, id: "x", payment_status: "Unpaid", amount_paid_cents: 0 } as any;
    const balance = [{ purchase_id: "x", granted: 16, used: 16, reserved: 0, remaining: 0, expired: 0 }] as any[];
    const q = buildClientPayments({ sales: [sale], ledger: [], balance, events: [], today: TODAY });
    expect(q.taxIncluded).toBe(false);
    expect(q.packages[0].unpaidDeliveredCents).toBe(64000);
  });

  it("cancelled sessions use nothing, so they deliver nothing (the ledger's used count leaves them out)", () => {
    // 10 booked, 3 of them cancelled and banked: 7 used.
    expect(one({ amount_paid_cents: 0, payment_status: "Unpaid" }, 7, [pay("z", "2026-01-01", 1050, 50)]).deliveredCents).toBe(29400);
  });

  it("a package past its use-by date shows no sessions available", () => {
    const sale = { ...base, id: "x", payment_status: "Paid", amount_paid_cents: 67200, amount_tax_paid_cents: 3200 } as any;
    const balance = [{ purchase_id: "x", granted: 16, used: 12, reserved: 0, remaining: 4, expired: 0, expires_at: "2026-10-31" }] as any[];
    const a = buildClientPayments({ sales: [sale], ledger: paid(67200), balance, events: [], today: TODAY }).packages[0];
    expect(a.sessions).toMatchObject({ completed: 12, available: 0 });
  });

  it("training past every package that isn't billed yet is counted, at the next package's per-session price", () => {
    const events = [
      { id: "u1", purchase_id: null, event_type: "used", session_count: -1, effective_date: "2026-11-10" },
      { id: "u2", purchase_id: null, event_type: "used", session_count: -1, effective_date: "2026-11-12" },
    ];
    const balance = [{ purchase_id: "p1", granted: 16, used: 16, reserved: 0, remaining: 0, expired: 0, transferred: 0 }];
    const q = buildClientPayments({ sales: [marc[0]], ledger: marcLedger.filter((l) => l.purchase_id === "p1"), balance: balance as any, events: events as any, today: TODAY });
    // The next package is package 1 again: $800 + 5% = $840 for 16, so 2 sessions = $105.
    expect(q.notBilledDeliveredCents).toBe(10500);
    expect(q.unpaidDeliveredCents).toBe(10500);
    expect(q.outstandingCents).toBe(0);
  });

  it("a stored package number stays, whatever is sold around it", () => {
    const sales = [
      { ...marc[0], package_number: 1 },
      { ...marc[1], package_number: 2 },
      // Sold later but dated earlier: it takes the next number, never shuffles the others.
      { ...marc[2], id: "late", term_start_date: "2026-07-01", package_number: null },
    ] as any[];
    expect([...saleLabels(sales).entries()].filter(([id]) => id !== "late").map(([, l]) => l)).toEqual(["Package 1", "Package 2"]);
    expect(saleLabels(sales).get("late")).toBe("Package 3");
  });
});

describe("package identity in the database", () => {
  const sql = readFileSync("supabase/migrations/20270315090000_package_identity.sql", "utf8");

  it("numbers each client's packages once, in running order, unique, and the next one on insert", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS package_number integer/);
    expect(sql).toMatch(/row_number\(\) OVER \(\s*PARTITION BY client_id/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS purchase_records_client_package_number/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF sessions_purchased/);
  });

  it("links renewals from the record they carry, never a guess, and renew_session_package sets the link", () => {
    expect(sql).toMatch(/Renewal of the package bought \(\[A-Z\]/);
    expect(sql).toMatch(/m\.hits = 1/);
    expect(sql).toMatch(/admin_notes, renewed_from_id/);
  });

  it("writes only the two new columns", () => {
    const updates = sql.match(/UPDATE public\.purchase_records p\s+SET (\w+)/g) ?? [];
    expect(updates.map((u) => u.split("SET ")[1])).toEqual(["package_number", "renewed_from_id"]);
  });
});
