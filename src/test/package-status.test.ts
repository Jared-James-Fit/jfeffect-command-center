import { describe, expect, it } from "vitest";
import { buildClientPayments, payingOffLine, type ScheduleSale } from "@/lib/payment-schedule";
import { buildSessionPackages } from "@/lib/session-packages";
import { paymentStatus, payingNow, pickTrainingNow, sessionCoverage, trainingStatus } from "@/lib/package-status";
import type { MoneyLedgerRow } from "@/lib/sale-money";

// Marc Asugui's real records at 5:23 PM on Nov 13 2026 (read from the database
// that evening): packages 1-3 trained, package 4 has 7 completed and 9 booked
// (Nov 13 - 27); package 2's 4th auto-pay payment ($168) is due tonight and
// packages 3 and 4 are pay-later renewals the same auto-pay pays after it.
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
  { ...base, id: "p1", package_number: 1, contract_value_cents: 80000, installment_amount: 200, payment_status: "Paid", term_start_date: "2026-08-10", term_end_date: "2026-09-06", purchased_at: "2026-08-22", stripe_subscription_id: "sub_old", stripe_subscription_status: "canceled", amount_paid_cents: 84000, amount_tax_paid_cents: 4000 } as any,
  { ...base, id: "p2", package_number: 2, payment_status: "Active Subscription", term_start_date: "2026-09-07", term_end_date: "2026-10-04", purchased_at: "2026-10-02", is_recurring: true, stripe_subscription_id: "sub_live", stripe_subscription_status: "active", stripe_checkout_session_id: "cs_live", next_billing_date: "2026-11-13", first_payment_date: "2026-10-02", amount_paid_cents: 50400, amount_tax_paid_cents: 2400 } as any,
  { ...base, id: "p3", package_number: 3, renewed_from_id: "p2", payment_status: "Unpaid", term_start_date: "2026-10-05", term_end_date: "2026-11-01", purchased_at: "2026-10-22", amount_paid_cents: 0 } as any,
  { ...base, id: "p4", package_number: 4, renewed_from_id: "p3", payment_status: "Unpaid", term_start_date: "2026-11-02", term_end_date: "2026-11-29", purchased_at: "2026-11-11", amount_paid_cents: 0 } as any,
];
const pay = (pid: string, day: string, cents: number, tax: number, extra: Partial<MoneyLedgerRow> = {}): MoneyLedgerRow =>
  ({ purchase_id: pid, txn_type: "payment", amount_minor: cents, tax_minor: tax, transaction_date: day, ...extra });
const marcLedger: MoneyLedgerRow[] = [
  pay("p1", "2026-08-22", 21000, 1000), pay("p1", "2026-09-05", 21000, 1000), pay("p1", "2026-09-13", 42000, 2000),
  pay("p2", "2026-10-02", 16800, 800),
  pay("p2", "2026-10-02", 16800, 800, { voided: true }),
  pay("p2", "2026-10-16", 16800, 800), pay("p2", "2026-10-30", 16800, 800),
];
const bal = (id: string, used: number, reserved: number, remaining = 0, extra: Record<string, unknown> = {}) =>
  ({ purchase_id: id, granted: 16, used, reserved, remaining, expired: 0, transferred: 0, ...extra });
const marcBalance = [bal("p1", 16, 0), bal("p2", 16, 0), bal("p3", 16, 0), bal("p4", 7, 9)] as any[];
const marcPayments = () => buildClientPayments({ sales: marc, ledger: marcLedger, balance: marcBalance, events: [], today: TODAY });
const pkg = (p: ReturnType<typeof buildClientPayments>, n: number) => p.packages.find((x) => x.number === n)!;
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (iso: string) => iso.slice(5);

// A paid, taxed sale on file gives the client's 5% rate, as for any real client.
const taxed = { id: "z", offer_name: "Coaching", currency: "CAD", sessions_purchased: 0, payment_status: "Paid", contract_value_cents: 1000, amount_paid_cents: 1050, amount_tax_paid_cents: 50 } as any;
const taxedPay = pay("z", "2026-01-01", 1050, 50);

describe("Marc: the package he trains on and the package he pays off are different", () => {
  const p = marcPayments();

  it("Package 4 is the one he's training on: 7 completed, 9 booked, 0 available", () => {
    expect(p.trainingNowId).toBe("p4");
    expect(pkg(p, 4)).toMatchObject({ trainingNow: true, training: "training", sessions: { completed: 7, booked: 9, available: 0 } });
    expect([1, 2, 3].map((n) => pkg(p, n).training)).toEqual(["completed", "completed", "completed"]);
    expect([1, 2, 3].map((n) => pkg(p, n).trainingNow)).toEqual([false, false, false]);
  });

  it("Package 2 is the one being paid off: tonight's $168 by auto-pay, with 3 and 4 queued behind it", () => {
    expect(p.payingNow).toHaveLength(1);
    expect(p.payingNow[0]).toMatchObject({ saleId: "p2", label: "Package 2", how: "auto_pay", remaining: 1 });
    expect(p.payingNow[0].next).toMatchObject({ date: "2026-11-13", cents: 16800, state: "due_today", auto: true, nth: 4, of: 4 });
    expect(p.payingNow[0].then).toEqual([
      { saleId: "p3", label: "Package 3", first: "2026-11-27" },
      { saleId: "p4", label: "Package 4", first: "2027-01-22" },
    ]);
    expect(p.packages.map((x) => x.payingNow)).toEqual([false, true, false, false]);
  });

  it("each package's payment status, read on its own: none of the balances is overdue", () => {
    expect(p.packages.map((x) => [x.number, x.payment])).toEqual([[1, "paid"], [2, "due"], [3, "scheduled"], [4, "scheduled"]]);
    expect(p.overdueCents).toBe(0);
  });

  it("Package 2: $504 paid, $168 left; Package 3 and 4: $0 paid, $672 left each", () => {
    expect([2, 3, 4].map((n) => [pkg(p, n).paidCents, pkg(p, n).balanceCents, pkg(p, n).totalCents])).toEqual([
      [50400, 16800, 67200], [0, 67200, 67200], [0, 67200, 67200],
    ]);
  });

  it("which sessions payments cover: 12 of package 2's 16, none of 3's, none of 4's 7; package 1 all", () => {
    expect(pkg(p, 1).coverage).toMatchObject({ covered: 16, unpaid: 0, partCents: 0, perSessionCents: 5250 });
    expect(pkg(p, 2).coverage).toMatchObject({ covered: 12, unpaid: 4, partCents: 0, perSessionCents: 4200, aheadCents: 0 });
    expect(pkg(p, 3).coverage).toMatchObject({ covered: 0, unpaid: 16 });
    expect(pkg(p, 4).coverage).toMatchObject({ covered: 0, unpaid: 7 });
    const cells = pkg(p, 4).coverage!.cells;
    expect(cells.filter((c) => c === "unpaid")).toHaveLength(7);
    expect(cells.filter((c) => c === "booked")).toHaveLength(9);
    // The grid and the dollar amount agree: unpaid sessions x $42 = unpaid training delivered.
    for (const n of [2, 3, 4]) expect(pkg(p, n).coverage!.unpaid * 4200).toBe(pkg(p, n).unpaidDeliveredCents);
    expect(p.unpaidDeliveredCents).toBe(16800 + 67200 + 29400);
  });

  it("the Sessions tab's money line names the package being paid", () => {
    expect(payingOffLine(p, fmt, day)).toEqual({ lead: "Paying off Package 2", text: "$168.00 due today by auto-pay", tone: "neutral" });
  });

  it("once tonight's payment lands, Package 2 is paid in full and Package 3 is the one being paid; he still trains on 4", () => {
    const after = marc.map((s) => s.id === "p2" ? { ...s, amount_paid_cents: 67200, amount_tax_paid_cents: 3200, next_billing_date: "2026-11-27" } : s) as ScheduleSale[];
    const q = buildClientPayments({ sales: after, ledger: [...marcLedger, pay("p2", "2026-11-13", 16800, 800)], balance: marcBalance, events: [], today: "2026-11-14" });
    expect(pkg(q, 2)).toMatchObject({ payment: "paid", balanceCents: 0, unpaidDeliveredCents: 0, payingNow: false });
    expect(pkg(q, 2).coverage!.covered).toBe(16);
    expect(q.payingNow.map((x) => [x.saleId, x.next.date, x.next.state])).toEqual([["p3", "2026-11-27", "scheduled"]]);
    expect(q.payingNow[0].then).toEqual([{ saleId: "p4", label: "Package 4", first: "2027-01-22" }]);
    expect(pkg(q, 3).payment).toBe("scheduled");
    expect(q.trainingNowId).toBe("p4");
    expect(q.unpaidDeliveredCents).toBe(67200 + 29400);
  });

  it("the Sessions model agrees on the package being trained", () => {
    const v = buildSessionPackages({ sales: marc, payments: marcLedger, balance: marcBalance, events: [], sessions: [], today: TODAY });
    expect(v.currentId).toBe("p4");
    expect(v.packages.map((x) => [x.number, x.training])).toEqual([[4, "training"], [3, "completed"], [2, "completed"], [1, "completed"]]);
  });
});

describe("training status", () => {
  const s = (completed: number, booked: number, available: number, expired = 0) => ({ purchased: 16, completed, booked, available, expired });
  const o = (trainingNow = false, granted = true, cancelled = false) => ({ trainingNow, granted, cancelled });

  it("upcoming, training, fully booked, completed, expired, cancelled", () => {
    expect(trainingStatus(s(0, 0, 16), o())).toBe("upcoming");
    expect(trainingStatus(s(0, 0, 0), o(false, false))).toBe("upcoming");
    expect(trainingStatus(s(7, 9, 0), o(true))).toBe("training");
    expect(trainingStatus(s(0, 16, 0), o())).toBe("fully_booked");
    expect(trainingStatus(s(16, 0, 0), o())).toBe("completed");
    expect(trainingStatus(s(12, 0, 0, 4), o())).toBe("expired");
    expect(trainingStatus(s(3, 0, 13), o(false, true, true))).toBe("cancelled");
    expect(trainingStatus(s(16, 0, 0), o(false, true, true))).toBe("completed");
    expect(trainingStatus(s(5, 0, 11), o())).toBe("in_progress");
  });

  it("training now is the lowest-numbered package with sessions still to train, never just the newest", () => {
    const xs = [
      { id: "a", number: 1, granted: true, booked: 0, available: 0 },
      { id: "b", number: 2, granted: true, booked: 2, available: 3 },
      { id: "c", number: 3, granted: true, booked: 4, available: 12 },
    ];
    expect(pickTrainingNow(xs)).toBe("b");
    expect(pickTrainingNow(xs.map((x) => ({ ...x, booked: 0, available: 0 })))).toBeNull();
    // Not paid for yet (sessions not granted) or cancelled: never the one being trained.
    expect(pickTrainingNow([{ ...xs[1], granted: false }, xs[2]])).toBe("c");
    expect(pickTrainingNow([{ ...xs[1], cancelled: true }, xs[2]])).toBe("c");
  });

  it("an early renewal: the package with sessions left stays the one being trained, the renewal waits", () => {
    const sales = [
      { ...base, id: "a", package_number: 1, payment_status: "Paid", term_start_date: "2026-10-05", amount_paid_cents: 67200, amount_tax_paid_cents: 3200 },
      { ...base, id: "b", package_number: 2, renewed_from_id: "a", payment_status: "Unpaid", term_start_date: "2026-11-02", amount_paid_cents: 0, first_payment_date: "2026-11-20" },
    ] as any[];
    const balance = [bal("a", 12, 2, 2), bal("b", 0, 3, 13)] as any[];
    const q = buildClientPayments({ sales, ledger: [pay("a", "2026-10-05", 67200, 3200)], balance, events: [], today: TODAY });
    expect(q.trainingNowId).toBe("a");
    expect(pkg(q, 1).training).toBe("training");
    expect(pkg(q, 2).training).toBe("upcoming");
    // Booked only, nothing trained on it: its balance is scheduled (dates set), nothing delivered unpaid.
    expect(pkg(q, 2)).toMatchObject({ payment: "scheduled", unpaidDeliveredCents: 0, payingNow: true });
  });

  it("a package past its use-by date with sessions unused is expired, and the next one is being trained", () => {
    const sales = [
      { ...base, id: "a", package_number: 1, payment_status: "Paid", term_start_date: "2026-09-01", amount_paid_cents: 67200, amount_tax_paid_cents: 3200 },
      { ...base, id: "b", package_number: 2, payment_status: "Paid", term_start_date: "2026-11-01", amount_paid_cents: 67200, amount_tax_paid_cents: 3200 },
    ] as any[];
    const balance = [bal("a", 12, 0, 4, { expires_at: "2026-10-31" }), bal("b", 2, 4, 10)] as any[];
    const q = buildClientPayments({ sales, ledger: [pay("a", "2026-09-01", 67200, 3200), pay("b", "2026-11-01", 67200, 3200)], balance, events: [], today: TODAY });
    expect(pkg(q, 1)).toMatchObject({ training: "expired", trainingNow: false, sessions: { completed: 12, available: 0, expired: 4 } });
    expect(pkg(q, 2)).toMatchObject({ training: "training", trainingNow: true });
    const v = buildSessionPackages({ sales, payments: [], balance, events: [], sessions: [], today: TODAY });
    expect(v.currentId).toBe("b");
    expect(v.packages.find((x) => x.id === "a")!.training).toBe("expired");
  });

  it("cancelled and rescheduled sessions use nothing: they go back to available and the package keeps training", () => {
    // 10 booked, 3 cancelled and banked: 7 used, 0 booked, 9 available.
    const q = buildClientPayments({ sales: [{ ...marc[3] } as any], ledger: [], balance: [bal("p4", 7, 0, 9)] as any, events: [], today: TODAY });
    expect(pkg(q, 4)).toMatchObject({ training: "training", sessions: { completed: 7, booked: 0, available: 9 } });
    expect(pkg(q, 4).coverage).toMatchObject({ unpaid: 7 });
    expect(pkg(q, 4).coverage!.cells.filter((c) => c === "open")).toHaveLength(9);
  });
});

describe("payment status", () => {
  const sched = (...states: Array<"failed" | "overdue" | "unconfirmed" | "due_today" | "scheduled">) =>
    ({ how: "manual", installments: states.map((state, i) => ({ date: `2026-11-${10 + i}`, state, auto: false })) });

  it("each status, by what's most urgent first", () => {
    expect(paymentStatus({ state: "paid", paidCents: 67200, balanceCents: 0, schedule: null })).toBe("paid");
    expect(paymentStatus({ state: "left", paidCents: 16800, balanceCents: 50400, schedule: sched("scheduled", "scheduled") })).toBe("partial");
    expect(paymentStatus({ state: "left", paidCents: 0, balanceCents: 67200, schedule: sched("scheduled") })).toBe("scheduled");
    expect(paymentStatus({ state: "left", paidCents: 0, balanceCents: 67200, schedule: sched("due_today", "scheduled") })).toBe("due");
    expect(paymentStatus({ state: "left", paidCents: 16800, balanceCents: 50400, schedule: sched("overdue", "scheduled") })).toBe("overdue");
    expect(paymentStatus({ state: "past_due", paidCents: 16800, balanceCents: 50400, schedule: sched("failed") })).toBe("failed");
    expect(paymentStatus({ state: "left", paidCents: 16800, balanceCents: 50400, schedule: { how: "none", installments: [] } })).toBe("unscheduled");
    expect(paymentStatus({ state: "waiting", paidCents: 0, balanceCents: 67200, schedule: null })).toBe("link_out");
    expect(paymentStatus({ state: "ended", paidCents: 0, balanceCents: 0, schedule: null })).toBe("cancelled");
    expect(paymentStatus({ state: "free", paidCents: 0, balanceCents: 0, schedule: null })).toBe("free");
    expect(paymentStatus({ state: "renews", paidCents: 16800, balanceCents: 0, schedule: null })).toBe("scheduled");
  });

  it("a plan collected by hand: partly paid on its dates, then overdue once a date passes with nothing in", () => {
    const sale = { ...base, id: "h", package_number: 1, payment_status: "Partially Paid", term_start_date: "2026-10-01", first_payment_date: "2026-10-01", amount_paid_cents: 16800, amount_tax_paid_cents: 800 } as any;
    const ledger = [pay("h", "2026-10-01", 16800, 800)];
    const on = buildClientPayments({ sales: [sale], ledger, balance: [bal("h", 8, 4, 4)] as any, events: [], today: "2026-10-10" });
    expect(pkg(on, 1).payment).toBe("partial");
    expect(on.payingNow[0]).toMatchObject({ saleId: "h", how: "manual", next: { date: "2026-10-15", state: "scheduled" } });
    const late = buildClientPayments({ sales: [sale], ledger, balance: [bal("h", 8, 4, 4)] as any, events: [], today: "2026-10-20" });
    expect(pkg(late, 1).payment).toBe("overdue");
    expect(late.overdueCents).toBe(16800);
  });

  it("a balance with no dates: no payment schedule, not overdue, and not being paid off", () => {
    const sale = { ...base, id: "n", package_number: 1, payment_status: "Unpaid", term_start_date: "2026-10-01", amount_paid_cents: 0 } as any;
    const q = buildClientPayments({ sales: [taxed, sale], ledger: [taxedPay], balance: [bal("n", 16, 0)] as any, events: [], today: TODAY });
    expect(pkg(q, 1)).toMatchObject({ payment: "unscheduled", payingNow: false, unpaidDeliveredCents: 67200 });
    expect(q.payingNow).toEqual([]);
    expect(q.overdueCents).toBe(0);
    expect(payingOffLine(q, fmt, day)).toEqual({ lead: null, text: "$672.00 left · no payment dates set", tone: "attention" });
  });

  it("a payment link out: not owed yet, its sessions start once it's paid", () => {
    const sale = { ...base, id: "w", package_number: 1, payment_status: "Payment Link Sent", term_start_date: "2026-11-20", stripe_payment_link: "https://buy.stripe.com/x", amount_paid_cents: 0 } as any;
    const q = buildClientPayments({ sales: [sale], ledger: [], balance: [], events: [], today: TODAY });
    expect(pkg(q, 1)).toMatchObject({ training: "upcoming", payment: "link_out", balanceCents: 64000, unpaidDeliveredCents: 0 });
    expect(q.outstandingCents).toBe(0);
  });

  it("a cancelled sale: cancelled both ways, and no paid-session split", () => {
    const sale = { ...base, id: "c", package_number: 1, payment_status: "Cancelled", term_start_date: "2026-10-01", amount_paid_cents: 0 } as any;
    const q = buildClientPayments({ sales: [sale], ledger: [], balance: [bal("c", 3, 0, 0)] as any, events: [], today: TODAY });
    expect(pkg(q, 1)).toMatchObject({ training: "cancelled", payment: "cancelled", coverage: null });
  });
});

describe("currently paying off", () => {
  const inst = (date: string, state: "scheduled" | "due_today" | "overdue" = "scheduled", auto = false) => ({ date, state, auto });

  it("two plans collected by hand at once are both being paid off, earliest first, never one picked arbitrarily", () => {
    const x = payingNow([
      { saleId: "b", label: "Package 2", how: "manual", installments: [inst("2026-11-20"), inst("2026-12-04")] },
      { saleId: "a", label: "Package 1", how: "manual", installments: [inst("2026-11-16"), inst("2026-11-30")] },
    ]);
    expect(x.map((y) => [y.saleId, y.next.date, y.remaining, y.then.length])).toEqual([["a", "2026-11-16", 2, 0], ["b", "2026-11-20", 2, 0]]);
  });

  it("one auto-pay pays one package at a time: the rest are queued behind it", () => {
    const x = payingNow([
      { saleId: "p3", label: "Package 3", how: "auto_pay", installments: [inst("2026-11-27", "scheduled", true)] },
      { saleId: "p2", label: "Package 2", how: "auto_pay", installments: [inst("2026-11-13", "due_today", true)] },
      { saleId: "m", label: "Package 5", how: "manual", installments: [inst("2026-11-01", "overdue")] },
      { saleId: "nd", label: "Package 6", how: "none", installments: [] },
    ]);
    expect(x.map((y) => y.saleId)).toEqual(["m", "p2"]);
    expect(x[1].then).toEqual([{ saleId: "p3", label: "Package 3", first: "2026-11-27" }]);
  });

  it("the Sessions tab's line leads with an overdue payment when there is one", () => {
    const sale = { ...base, id: "h", package_number: 1, payment_status: "Partially Paid", term_start_date: "2026-10-01", first_payment_date: "2026-10-01", amount_paid_cents: 16800, amount_tax_paid_cents: 800 } as any;
    const q = buildClientPayments({ sales: [sale], ledger: [pay("h", "2026-10-01", 16800, 800)], balance: [bal("h", 8, 4, 4)] as any, events: [], today: "2026-10-20" });
    expect(payingOffLine(q, fmt, day)).toEqual({ lead: "Paying off Package 1", text: "$168.00 overdue since 10-15", tone: "error" });
  });
});

describe("which sessions payments cover (a display split, never the ledger)", () => {
  const cov = (completed: number, booked: number, available: number, paidCents: number, balanceCents = 67200 - paidCents) => {
    const total = 67200;
    const delivered = Math.round((total * completed) / 16);
    const unpaid = Math.min(balanceCents, Math.max(0, delivered - paidCents));
    return sessionCoverage({ sessions: { purchased: 16, completed, booked, available, expired: 0 }, totalCents: total, paidCents, deliveredCents: delivered, unpaidDeliveredCents: unpaid, valued: true })!;
  };

  it("paid ahead: every completed session covered, the rest said as money, booked sessions never delivered", () => {
    const c = cov(4, 2, 10, 50400);
    expect(c).toMatchObject({ covered: 4, unpaid: 0, partCents: 0, aheadCents: 33600 });
    expect(c.cells.filter((x) => x === "booked")).toHaveLength(2);
    expect(c.cells.filter((x) => x === "paid")).toHaveLength(4);
  });

  it("a payment that covers part of a session says so (one part-paid session), never rounds it to paid", () => {
    // $483 paid ($504 less a $21 refund) over 16 completed at $42: 11 covered, $21 of the 12th, 4 not.
    const c = cov(16, 0, 0, 48300);
    expect(c).toMatchObject({ covered: 11, partCents: 2100, unpaid: 4 });
    expect(c.cells.slice(10, 13)).toEqual(["paid", "part", "unpaid"]);
  });

  it("fully paid: all completed sessions covered", () => {
    expect(cov(16, 0, 0, 67200)).toMatchObject({ covered: 16, unpaid: 0, aheadCents: 0 });
  });

  it("a credit that lowered the balance covers training too (the balance, not the list price, is what's owed)", () => {
    // $672 package, nothing paid, $100 off: $572 left. 16 done: $572 unpaid, the rest covered by the credit.
    const c = cov(16, 0, 0, 0, 57200);
    expect(c.unpaid * 4200 + (c.partCents > 0 ? 4200 - c.partCents : 0)).toBe(57200);
  });

  it("no price to share out (a subscription, free or cancelled sale): no split at all", () => {
    expect(sessionCoverage({ sessions: { purchased: 8, completed: 4, booked: 0, available: 4, expired: 0 }, totalCents: 20000, paidCents: 20000, deliveredCents: 0, unpaidDeliveredCents: 0, valued: false })).toBeNull();
  });
});
