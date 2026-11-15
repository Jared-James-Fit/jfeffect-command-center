import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildClientPayments, type ScheduleSale } from "@/lib/payment-schedule";
import { myCoverageWords, myPurchases, packageSessionLog, purchaseDetail, type MyLedgerRow } from "@/lib/my-purchases";
import type { PackageLedgerEvent } from "@/lib/session-packages";

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const pay = (id: string, pid: string, day: string, cents: number, tax: number, extra: Partial<MyLedgerRow> = {}): MyLedgerRow =>
  ({ id, purchase_id: pid, txn_type: "payment", method: "stripe", source: "stripe_subscription", amount_minor: cents, tax_minor: tax, transaction_date: day, receipt_url: `https://pay.stripe.com/receipts/${id}`, ...extra });
const bal = (id: string, used: number, reserved: number, remaining = 0, granted = 16) =>
  ({ purchase_id: id, granted, used, reserved, remaining, expired: 0, transferred: 0 });
const view = (sales: ScheduleSale[], ledger: MyLedgerRow[], balance: any[], today: string) => {
  const payments = buildClientPayments({ sales, ledger, balance, events: [], today });
  return { payments, mine: myPurchases({ payments, sales, ledger, money: fmt }) };
};

// Marc Asugui's records as they are on Nov 15 2026: package 2's 4th auto-pay payment came in
// on Nov 13, so it's paid in full; 3 and 4 are pay-later renewals the same auto-pay pays next.
const TODAY = "2026-11-15";
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
  // The voided, archived "16 Sessions (Final Payment)" sale still holds $400 in amount_outstanding_cents.
  { id: "void", offer_name: "16 Sessions (Final Payment)", payment_status: "Voided", archived_at: "2026-10-01", amount_outstanding_cents: 40000, contract_value_cents: null, full_payable_amount: 400, currency: "CAD", purchased_at: "2026-09-12" } as any,
  { ...base, id: "p2", package_number: 2, payment_status: "Active Subscription", term_start_date: "2026-09-07", term_end_date: "2026-10-04", purchased_at: "2026-10-02", is_recurring: true, stripe_subscription_id: "sub_live", stripe_subscription_status: "active", stripe_checkout_session_id: "cs_live", next_billing_date: "2026-11-27", first_payment_date: "2026-10-02", amount_paid_cents: 67200, amount_tax_paid_cents: 3200 } as any,
  { ...base, id: "p3", package_number: 3, renewed_from_id: "p2", payment_status: "Unpaid", term_start_date: "2026-10-05", term_end_date: "2026-11-01", purchased_at: "2026-10-22", amount_paid_cents: 0 } as any,
  { ...base, id: "p4", package_number: 4, renewed_from_id: "p3", payment_status: "Unpaid", term_start_date: "2026-11-02", term_end_date: "2026-11-29", purchased_at: "2026-11-11", amount_paid_cents: 0 } as any,
];
const marcLedger: MyLedgerRow[] = [
  pay("a", "p1", "2026-08-22", 21000, 1000), pay("b", "p1", "2026-09-05", 21000, 1000), pay("c", "p1", "2026-09-13", 42000, 2000, { receipt_url: null, receipt_fetchable: true }),
  pay("d", "p2", "2026-10-02", 16800, 800),
  pay("e", "p2", "2026-10-02", 16800, 800, { voided: true }),
  pay("f", "p2", "2026-10-16", 16800, 800), pay("g", "p2", "2026-10-30", 16800, 800), pay("h", "p2", "2026-11-13", 16800, 800),
];
const marcBalance = [bal("p1", 16, 0), bal("p2", 16, 0), bal("p3", 16, 0), bal("p4", 7, 9)];

describe("Marc: what he owes, what he's paid, what he trains on", () => {
  const { payments, mine } = view(marc, marcLedger, marcBalance, TODAY);

  it("owes $1,344 on packages 3 and 4, nothing overdue, next $168 on Nov 27 by auto-pay; no action needed", () => {
    expect(mine.summary).toMatchObject({ outstandingCents: 134400, overdueCents: 0, noDatesCents: 0, paidCents: 151200, state: "on_plan", actions: [] });
    expect(mine.summary.next).toMatchObject({ cents: 16800, date: "2026-11-27", auto: true, label: "Package 3" });
  });

  it("matches the coach's Billing to the cent (one model)", () => {
    expect(mine.summary.outstandingCents).toBe(payments.outstandingCents);
    expect(mine.summary.paidCents).toBe(payments.paidCents);
    expect(mine.packages.map((x) => [x.label, x.leftCents])).toEqual(
      payments.packages.filter((x) => x.balanceCents > 0 || x.trainingNow).map((x) => [x.label, x.balanceCents]).sort((a, b) => (a[0] === "Package 4" ? -1 : b[0] === "Package 4" ? 1 : 0)),
    );
  });

  it("the voided, archived sale (with $400 still on its record) is nowhere: not owed, not listed", () => {
    expect([...mine.packages.map((x) => x.saleId), ...mine.past.map((x) => x.saleId), ...mine.open.map((x) => x.saleId)]).not.toContain("void");
    expect(mine.summary.outstandingCents).toBe(134400);
  });

  it("Package 4 first (training now: 7 completed, 9 booked), then Package 3 (balance); 1 and 2 are past", () => {
    expect(mine.packages.map((x) => x.label)).toEqual(["Package 4", "Package 3"]);
    expect(mine.packages[0]).toMatchObject({ now: true, sessions: { purchased: 16, completed: 7, booked: 9, available: 0 }, training: { text: "Training now" }, payment: { text: "Payment plan" }, paidCents: 0, leftCents: 67200 });
    expect(mine.packages[1]).toMatchObject({ now: false, training: { text: "Completed" }, payment: { text: "Payment plan" }, leftCents: 67200, renewedFromLabel: "Package 2" });
    expect(mine.past.map((x) => [x.saleId, x.line])).toEqual([
      ["p2", "Completed · 16 of 16 sessions · Paid in full"],
      ["p1", "Completed · 16 of 16 sessions · Paid in full"],
    ]);
  });

  it("his payments: 7 real ones newest first (the voided duplicate isn't one), each with what it was for and a receipt", () => {
    expect(mine.payments.map((x) => x.id)).toEqual(["h", "g", "f", "d", "c", "b", "a"]);
    expect(mine.payments[0]).toMatchObject({ forLabel: "Package 2", method: "Card", byHand: false, cents: 16800, taxCents: 800, receipt: { kind: "url" } });
    expect(mine.payments.find((x) => x.id === "c")!.receipt).toEqual({ kind: "fetch" });
  });

  it("Package 4's detail: its schedule and how the unpaid sessions sit in its balance (never on top of it)", () => {
    const d = purchaseDetail({ payments, sales: marc, ledger: marcLedger, saleId: "p4", money: fmt })!;
    expect(d).toMatchObject({ kind: "package", title: "Package 4", subtitle: base.offer_name });
    expect(d.upcoming.map((i) => i.date)).toEqual(["2027-01-22", "2027-02-05", "2027-02-19", "2027-03-05"]);
    expect(d.coverage).toEqual([
      "$42.00 a session ($672.00 for 16).",
      "Nothing's been paid on it yet, so the 7 completed aren't paid for yet.",
      "That $294.00 is part of this package's $672.00 balance, paid on its payment dates, never an extra charge.",
    ]);
    expect(purchaseDetail({ payments, sales: marc, ledger: marcLedger, saleId: "void", money: fmt })).toBeNull();
  });
});

describe("every kind of purchase", () => {
  it("a fully paid 16-session package mid-way: paid in full, 10 done, 6 left, nothing owed", () => {
    const sale = { ...base, id: "x", package_number: 1, contract_value_cents: 64000, payment_status: "Paid", purchased_at: "2026-11-01", amount_paid_cents: 67200, amount_tax_paid_cents: 3200, number_of_payments: null, installment_amount: null, payment_structure: "One-time payment", payment_frequency: "One-time payment" } as any;
    const { mine } = view([sale], [pay("1", "x", "2026-11-01", 67200, 3200, { source: "stripe_checkout" })], [bal("x", 10, 0, 6)], TODAY);
    expect(mine.summary).toMatchObject({ state: "clear", outstandingCents: 0, actions: [] });
    expect(mine.packages[0]).toMatchObject({ payment: { text: "Paid in full" }, sessions: { purchased: 16, completed: 10, available: 6 } });
  });

  it("a partly paid package collected by hand: what's paid, what's left, the next date", () => {
    const sale = { ...base, id: "x", package_number: 1, payment_status: "Partially Paid", purchased_at: "2026-11-01", first_payment_date: "2026-11-01", amount_paid_cents: 33600, amount_tax_paid_cents: 1600, installment_amount: 320, number_of_payments: 2, payment_frequency: "monthly", payment_structure: "Installment plan" } as any;
    const { mine } = view([sale], [pay("1", "x", "2026-11-01", 33600, 1600, { source: "manual", method: "etransfer", receipt_url: null })], [bal("x", 4, 2, 10)], TODAY);
    expect(mine.summary).toMatchObject({ state: "on_plan", outstandingCents: 33600 });
    expect(mine.summary.next).toMatchObject({ cents: 33600, date: "2026-12-01", auto: false });
    expect(mine.packages[0]).toMatchObject({ payment: { text: "Partly paid" }, paidCents: 33600, leftCents: 33600 });
    expect(mine.payments[0]).toMatchObject({ method: "E-transfer", byHand: true, receipt: { kind: "none" } });
  });

  it("an unpaid package with sessions already done and no payment dates: a balance owing, never an action or an overdue", () => {
    const sale = { ...base, id: "x", package_number: 1, payment_status: "Unpaid", purchased_at: "2026-11-01", amount_paid_cents: 0, number_of_payments: null, installment_amount: null, payment_structure: "One-time payment", payment_frequency: "One-time payment" } as any;
    const taxed = { id: "t", offer_name: "Coaching", currency: "CAD", sessions_purchased: 0, payment_status: "Paid", contract_value_cents: 1000, amount_paid_cents: 1050, amount_tax_paid_cents: 50, purchased_at: "2026-01-01" } as any;
    const { mine, payments } = view([taxed, sale], [pay("t1", "t", "2026-01-01", 1050, 50)], [bal("x", 5, 2, 9)], TODAY);
    expect(mine.summary).toMatchObject({ state: "on_plan", outstandingCents: 67200, noDatesCents: 67200, overdueCents: 0, actions: [] });
    expect(mine.packages[0].payment).toEqual({ text: "Balance owing", tone: "attention" });
    // The 5 done ($210) are inside the $672 balance: the page never adds them on top.
    expect(payments.unpaidDeliveredCents).toBe(21000);
    expect(mine.summary.outstandingCents).toBe(67200);
  });

  it("an active subscription is not a payment problem: no action, its next charge, nothing owed", () => {
    const sub = { id: "s", offer_name: "Online Coaching — $130/month", currency: "CAD", full_payable_amount: 130, payment_status: "Active Subscription", payment_structure: "Monthly subscription", is_recurring: true, sessions_purchased: 0, stripe_subscription_id: "sub_1", stripe_subscription_status: "active", next_billing_date: "2026-12-06", amount_paid_cents: 27300, amount_tax_paid_cents: 1300, purchased_at: "2026-10-05" } as any;
    const { mine } = view([sub], [pay("1", "s", "2026-10-06", 13650, 650), pay("2", "s", "2026-11-06", 13650, 650)], [], TODAY);
    expect(mine.summary).toMatchObject({ state: "clear", outstandingCents: 0, actions: [] });
    expect(mine.summary.next).toMatchObject({ cents: 13650, date: "2026-12-06", recurring: true, auto: true });
    expect(mine.plans[0].plan).toMatchObject({ kind: "subscription", state: "renews", cents: 13650 });
  });

  it("a failed subscription charge is the one action: update the card", () => {
    const sub = { id: "s", offer_name: "Online Coaching — $130/month", currency: "CAD", full_payable_amount: 130, payment_status: "Past Due", payment_structure: "Monthly subscription", is_recurring: true, sessions_purchased: 0, stripe_subscription_id: "sub_1", stripe_subscription_status: "past_due", next_billing_date: "2026-11-10", amount_paid_cents: 13650, amount_tax_paid_cents: 650, purchased_at: "2026-10-05" } as any;
    const { mine } = view([sub], [pay("1", "s", "2026-10-06", 13650, 650)], [], TODAY);
    expect(mine.summary.state).toBe("action");
    expect(mine.summary.actions).toEqual([expect.objectContaining({ kind: "card", saleId: "s" })]);
    expect(mine.plans[0].plan.state).toBe("past_due");
  });

  it("a payment link waiting is an action (Ready to pay), not money owed", () => {
    const link = { id: "l", offer_name: "Personal Training — Single Session", currency: "CAD", contract_value_cents: 10000, payment_status: "Payment Link Sent", stripe_payment_link: "https://buy.stripe.com/x", sessions_purchased: 0, purchased_at: "2026-11-14", amount_paid_cents: 0 } as any;
    const { mine } = view([link], [], [], TODAY);
    expect(mine.summary).toMatchObject({ state: "action", outstandingCents: 0 });
    expect(mine.summary.actions).toEqual([{ kind: "pay", saleId: "l", name: "Personal Training — Single Session", cents: 10000 }]);
    // Said once: the action is its listing, not a second "open purchase" card.
    expect(mine.open).toEqual([]);
    expect(mine.past).toEqual([]);
  });

  it("a refund shows as a refund and comes off what's been paid", () => {
    const sale = { id: "r", offer_name: "Online Coaching — Legacy", currency: "CAD", contract_value_cents: 117972, payment_status: "Paid", payment_structure: "One-time payment", sessions_purchased: 0, purchased_at: "2026-07-06", amount_paid_cents: 117972, amount_tax_paid_cents: 5472, term_duration_text: "6 Months" } as any;
    const ledger = [pay("1", "r", "2026-07-06", 117972, 5472, { source: "stripe_checkout" }), { id: "2", purchase_id: "r", txn_type: "partial_refund", method: "stripe", source: "stripe_webhook", amount_minor: 20000, tax_minor: 0, transaction_date: "2026-07-20" } as MyLedgerRow];
    const { mine } = view([sale], ledger, [], TODAY);
    expect(mine.payments.map((x) => [x.kind, x.cents])).toEqual([["refund", 20000], ["payment", 117972]]);
    expect(mine.summary.paidCents).toBe(97972);
  });

  it("a cancelled subscription and a paid one-off are past purchases, worded as what they were", () => {
    const old = { id: "o", offer_name: "Online Coaching — Legacy $130", currency: "CAD", contract_value_cents: 13000, payment_status: "Cancelled", payment_structure: "Monthly subscription", sessions_purchased: 0, stripe_subscription_id: "sub_x", stripe_subscription_status: "canceled", purchased_at: "2026-07-01", amount_paid_cents: 27300, amount_tax_paid_cents: 1300 } as any;
    const dep = { id: "d", offer_name: "Personal Training — Deposit", currency: "CAD", contract_value_cents: 10000, payment_status: "Paid", sessions_purchased: 0, purchased_at: "2026-06-19", amount_paid_cents: 10000 } as any;
    const { mine } = view([old, dep], [pay("1", "o", "2026-07-03", 13650, 650), pay("2", "o", "2026-08-03", 13650, 650), pay("3", "d", "2026-06-19", 10000, 0)], [], TODAY);
    expect(mine.summary.state).toBe("clear");
    expect(mine.past.map((x) => [x.saleId, x.line])).toEqual([
      ["o", "Subscription ended · $273.00 paid"],
      ["d", "Paid in full · $100.00"],
    ]);
  });

  it("a prepaid coaching term (Alexander's year) is an active plan, paid by hand, with no online receipt", () => {
    const term = { id: "t", offer_name: "Online Coaching — Legacy", currency: "CAD", contract_value_cents: 304762, full_payable_amount: 3047.62, payment_status: "Paid", payment_structure: "One-time payment", sessions_purchased: 0, term_start_date: "2026-06-02", term_end_date: "2027-06-02", service_start_date: "2026-06-02", term_duration_text: "12 Months", purchased_at: "2026-05-21", amount_paid_cents: 320000, amount_tax_paid_cents: 15238 } as any;
    const { mine } = view([term], [pay("1", "t", "2026-05-20", 320000, 15238, { source: "manual", receipt_url: null })], [], TODAY);
    expect(mine.summary).toMatchObject({ state: "clear", outstandingCents: 0, paidCents: 320000 });
    expect(mine.plans[0].plan).toMatchObject({ kind: "term", timing: "active", end: "2027-06-02" });
    expect(mine.payments[0]).toMatchObject({ byHand: true, method: "Card", receipt: { kind: "none" }, taxCents: 15238 });
  });

  it("no purchases at all: nothing to show", () => {
    const { mine } = view([], [], [], TODAY);
    expect(mine.summary.state).toBe("nothing");
    expect([mine.packages, mine.plans, mine.open, mine.past, mine.payments].every((l) => l.length === 0)).toBe(true);
  });
});

describe("a package's sessions", () => {
  const sessions = [
    { id: "s1", session_date: "2026-11-03", start_time: "15:30:00", status: "Completed" },
    { id: "s2", session_date: "2026-11-05", start_time: "15:30:00", status: "Missed" },
    { id: "s3", session_date: "2026-11-07", start_time: "10:00:00", status: "Cancelled" },
    { id: "s4", session_date: "2026-11-20", start_time: "15:30:00", status: "Scheduled" },
    { id: "s5", session_date: "2026-11-21", start_time: "15:30:00", status: "Completed" },
  ];
  const ev = (id: string, sid: string, pid: string, type: string, at: string, extra: Partial<PackageLedgerEvent> = {}): PackageLedgerEvent =>
    ({ id, pt_session_id: sid, purchase_id: pid, event_type: type, session_count: -1, created_at: at, ...extra });
  const events = [
    ev("e1", "s1", "p4", "used", "2026-11-03T22:00:00Z"),
    ev("e2", "s2", "p4", "used", "2026-11-05T22:00:00Z"),
    ev("e3", "s3", "p4", "reserved", "2026-11-01T10:00:00Z"),
    ev("e4", "s3", "p4", "released", "2026-11-06T10:00:00Z", { related_event_id: "e3", session_count: 1 }),
    ev("e5", "s4", "p4", "reserved", "2026-11-10T10:00:00Z"),
    ev("e6", "s5", "p3", "used", "2026-11-21T22:00:00Z"),
  ];

  it("completed, missed-and-counted, cancelled (credit back) and booked, each said as it is; another package's session isn't listed", () => {
    expect(packageSessionLog(sessions, events, "p4").map((x) => [x.id, x.kind, x.label])).toEqual([
      ["s1", "completed", "Completed"],
      ["s2", "counted", "Missed · counted"],
      ["s3", "returned", "Cancelled · not counted"],
      ["s4", "booked", "Booked"],
    ]);
    expect(packageSessionLog(sessions, events, "p3").map((x) => x.id)).toEqual(["s5"]);
  });

  it("a counted session hidden from the client's calendar is still listed (its day), so the log matches the count", () => {
    // Colten's Sep 28 2026: a no-show counted against his package, hidden from his calendar.
    const hidden = [...events, ev("h1", "hid", "p4", "used", "2026-09-28T22:00:00Z", { effective_date: "2026-09-28" })];
    const log = packageSessionLog(sessions, hidden, "p4");
    expect(log[0]).toEqual({ id: "hid", date: "2026-09-28", start: "", kind: "counted", label: "Counted · not on your calendar", tone: "neutral" });
    expect(log.filter((x) => x.kind === "completed" || x.kind === "counted")).toHaveLength(3);
  });

  it("a booked session is never counted as completed", () => {
    expect(packageSessionLog(sessions, events, "p4").find((x) => x.id === "s4")!.kind).toBe("booked");
  });
});

describe("coverage in a client's words", () => {
  it("all covered says so; part covered names the balance it belongs to", () => {
    const { payments } = view(marc, marcLedger, marcBalance, TODAY);
    expect(myCoverageWords(payments.packages.find((x) => x.number === 1)!, fmt)).toEqual([
      "$52.50 a session ($840.00 for 16).",
      "Your payments cover all 16 completed sessions.",
    ]);
  });
});

describe("the pages read the client's own model, never the coach's notes", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  it("the list and detail use the shared model through the client-safe read", () => {
    for (const src of [read("src/routes/_authenticated/portal/purchases.tsx"), read("src/routes/_authenticated/portal/purchases.$id.tsx")]) {
      expect(src).toContain("useMyBilling");
      expect(src).not.toMatch(/from\("purchase_records"\)\.select\("\*"\)/);
      expect(src).not.toContain("Action needed</Badge>");
    }
  });
  it("the read never sends a coach's private notes or the archived and voided rows", () => {
    const fn = read("src/lib/my-billing.functions.ts");
    expect(fn).toContain("PRIVATE_SALE_FIELDS");
    expect(fn).toMatch(/"admin_notes"/);
    expect(fn).not.toMatch(/internal_note/);
    expect(fn).toMatch(/\.is\("archived_at", null\)/);
    expect(fn).toMatch(/\.eq\("voided", false\)/);
  });
});
