import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildClientPayments, type ScheduleSale } from "@/lib/payment-schedule";
import { coverageWords, dueWords, orderPackages, packageGlance, paymentPlans } from "@/lib/package-view";
import type { MoneyLedgerRow } from "@/lib/sale-money";

// Marc Asugui's real records the evening of Nov 13 2026, once that night's
// auto-pay had landed: package 2 paid in full, the subscription's next charge
// Nov 27 (it now pays package 3, then 4), package 4 with 7 completed and 9 booked.
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
  { ...base, id: "p1", package_number: 1, contract_value_cents: 80000, installment_amount: 200, payment_status: "Paid", term_start_date: "2026-08-10", term_end_date: "2026-09-06", stripe_subscription_id: "sub_old", stripe_subscription_status: "canceled", amount_paid_cents: 84000, amount_tax_paid_cents: 4000 } as any,
  { ...base, id: "p2", package_number: 2, payment_status: "Active Subscription", term_start_date: "2026-09-07", term_end_date: "2026-10-04", is_recurring: true, stripe_subscription_id: "sub_live", stripe_subscription_status: "active", stripe_checkout_session_id: "cs_live", next_billing_date: "2026-11-27", amount_paid_cents: 67200, amount_tax_paid_cents: 3200 } as any,
  { ...base, id: "p3", package_number: 3, renewed_from_id: "p2", payment_status: "Unpaid", term_start_date: "2026-10-05", term_end_date: "2026-11-01", purchased_at: "2026-10-22", amount_paid_cents: 0 } as any,
  { ...base, id: "p4", package_number: 4, renewed_from_id: "p3", payment_status: "Unpaid", term_start_date: "2026-11-02", term_end_date: "2026-11-29", purchased_at: "2026-11-11", amount_paid_cents: 0 } as any,
];
const pay = (pid: string, day: string, cents: number, tax: number): MoneyLedgerRow => ({ purchase_id: pid, txn_type: "payment", amount_minor: cents, tax_minor: tax, transaction_date: day });
const ledger: MoneyLedgerRow[] = [
  pay("p1", "2026-08-22", 21000, 1000), pay("p1", "2026-09-05", 21000, 1000), pay("p1", "2026-09-13", 42000, 2000),
  pay("p2", "2026-10-02", 16800, 800), pay("p2", "2026-10-16", 16800, 800), pay("p2", "2026-10-30", 16800, 800), pay("p2", "2026-11-13", 16800, 800),
];
const bal = (id: string, used: number, reserved: number, remaining = 0) => ({ purchase_id: id, granted: 16, used, reserved, remaining, expired: 0, transferred: 0 });
const balance = [bal("p1", 16, 0), bal("p2", 16, 0), bal("p3", 16, 0), bal("p4", 7, 9)] as any[];
const p = buildClientPayments({ sales: marc, ledger, balance, events: [], today: TODAY });
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const pkg = (n: number) => p.packages.find((x) => x.number === n)!;

describe("the glance: what Marc trains on, and what he's paying off", () => {
  const g = packageGlance(p);

  it("training: Package 4, fully booked, 7 done · 9 booked · 0 left", () => {
    expect(g.training).toMatchObject({ kind: "package", label: "Package 4", now: true, fullyBooked: true, completed: 7, booked: 9, available: 0, size: 16 });
  });

  it("paying off: Package 3, $0 of $672 paid, next $168 on Nov 27 by auto-pay, then Package 4", () => {
    expect(g.paying).toMatchObject({ kind: "plan", label: "Package 3", status: "scheduled", paidCents: 0, totalCents: 67200, leftCents: 67200, then: ["Package 4"], more: 0 });
    expect(g.paying.kind === "plan" && g.paying.next).toMatchObject({ date: "2026-11-27", cents: 16800, auto: true, state: "scheduled" });
  });

  it("the money under it: $1,344 left to pay, $966 trained and not paid for, nothing overdue", () => {
    expect(p.outstandingCents).toBe(134400);
    expect(p.unpaidDeliveredCents).toBe(67200 + 29400);
    expect(p.overdueCents).toBe(0);
    expect(p.paidCents).toBe(84000 + 67200);
  });

  it("a balance with no dates reads as that, never as a plan", () => {
    const sales = [{ ...base, id: "n", package_number: 1, payment_status: "Unpaid", term_start_date: "2026-10-01", amount_paid_cents: 0 } as any];
    const q = buildClientPayments({ sales, ledger: [], balance: [bal("n", 16, 0)] as any, events: [], today: TODAY });
    expect(packageGlance(q).paying).toMatchObject({ kind: "unscheduled", label: "Package 1", leftCents: 64000, packages: 1 });
  });

  it("paid up, and trained past every package", () => {
    const sales = [marc[0]];
    const q = buildClientPayments({ sales, ledger: ledger.filter((l) => l.purchase_id === "p1"), balance: [bal("p1", 16, 0)] as any, events: [], today: TODAY });
    expect(packageGlance(q)).toMatchObject({ training: { kind: "package", label: "Package 1", now: false, status: "completed" }, paying: { kind: "paid_up" } });
    const past = buildClientPayments({
      sales,
      ledger: ledger.filter((l) => l.purchase_id === "p1"),
      balance: [bal("p1", 16, 0)] as any,
      events: [{ id: "u1", purchase_id: null, event_type: "used", session_count: -1, effective_date: "2026-11-10" }] as any,
      today: TODAY,
    });
    expect(packageGlance(past).training).toMatchObject({ kind: "past", trained: 1, afterLabel: "Package 1" });
  });

  it("due words", () => {
    const day = (iso: string) => iso.slice(5);
    expect(dueWords({ date: "2026-11-27", state: "scheduled" } as any, day)).toBe("11-27");
    expect(dueWords({ date: "2026-11-13", state: "due_today" } as any, day)).toBe("today");
    expect(dueWords({ date: "2026-11-01", state: "overdue" } as any, day)).toBe("overdue since 11-01");
    expect(dueWords({ date: "2026-11-01", state: "failed" } as any, day)).toBe("failed");
  });
});

describe("the package list's order", () => {
  it("the one being trained first, then the ones with money left, then the settled ones folded; numbers in order within each", () => {
    const { open, settled } = orderPackages(p.packages);
    expect(open.map((x) => x.number)).toEqual([4, 3]);
    expect(settled.map((x) => x.number)).toEqual([1, 2]);
  });

  it("several owing: chronological after the one being trained", () => {
    const shuffled = [pkg(3), pkg(1), pkg(4), pkg(2)].map((x) => (x.number === 2 ? { ...x, balanceCents: 16800 } : x));
    expect(orderPackages(shuffled).open.map((x) => x.number)).toEqual([4, 2, 3]);
  });
});

describe("payment plans: how money comes in and which package it pays", () => {
  it("Marc's one auto-pay pays Package 3 (Nov 27 – Jan 8) then Package 4 (Jan 22 – Mar 5)", () => {
    const plans = paymentPlans(p.balances);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ how: "auto_pay", eachCents: 16800, ends: "2027-03-05", late: false });
    expect(plans[0].steps).toEqual([
      { saleId: "p3", label: "Package 3", payments: 4, first: "2026-11-27", last: "2027-01-08", cents: 67200 },
      { saleId: "p4", label: "Package 4", payments: 4, first: "2027-01-22", last: "2027-03-05", cents: 67200 },
    ]);
  });

  it("two plans collected by hand at once are two plans, earliest first; a balance with no dates is none", () => {
    const sales = [
      { ...base, id: "a", package_number: 1, payment_status: "Partially Paid", term_start_date: "2026-10-01", first_payment_date: "2026-11-20", amount_paid_cents: 0 },
      { ...base, id: "b", package_number: 2, payment_status: "Partially Paid", term_start_date: "2026-11-01", first_payment_date: "2026-11-16", amount_paid_cents: 0 },
      { ...base, id: "c", package_number: 3, payment_status: "Unpaid", term_start_date: "2026-11-05", amount_paid_cents: 0 },
    ] as any[];
    const q = buildClientPayments({ sales, ledger: [], balance: [bal("a", 4, 0, 12), bal("b", 2, 0, 14), bal("c", 1, 0, 15)] as any, events: [], today: TODAY });
    const plans = paymentPlans(q.balances);
    expect(plans.map((x) => [x.how, x.steps.map((s) => s.label)])).toEqual([["manual", ["Package 2"]], ["manual", ["Package 1"]]]);
    expect(packageGlance(q).paying).toMatchObject({ kind: "plan", label: "Package 2", more: 1 });
  });
});

describe("how payments cover a package's training, in words", () => {
  it("Package 3: nothing paid, all 16 completed not paid for yet", () => {
    expect(coverageWords(pkg(3), fmt)).toEqual([
      "$42.00 a session ($672.00 for 16).",
      "Nothing paid yet, so the 16 completed ($672.00) aren't paid for yet.",
    ]);
  });

  it("Package 4: 7 completed not paid for, booked ones not counted", () => {
    expect(coverageWords(pkg(4), fmt)).toEqual([
      "$42.00 a session ($672.00 for 16).",
      "Nothing paid yet, so the 7 completed ($294.00) aren't paid for yet.",
      "Booked sessions aren't counted until they're done.",
    ]);
  });

  it("Package 2 before its last payment: $504 covers 12 of the 16; 4 aren't paid for", () => {
    const before = buildClientPayments({
      sales: marc.map((s) => (s.id === "p2" ? { ...s, amount_paid_cents: 50400, amount_tax_paid_cents: 2400, next_billing_date: "2026-11-13" } : s)) as any,
      ledger: ledger.slice(0, -1),
      balance,
      events: [],
      today: TODAY,
    });
    expect(coverageWords(before.packages.find((x) => x.number === 2)!, fmt)).toEqual([
      "$42.00 a session ($672.00 for 16).",
      "The $504.00 paid covers 12 of the 16 completed; 4 aren't paid for yet ($168.00).",
    ]);
  });

  it("paid in full covers everything; paid ahead says so", () => {
    expect(coverageWords(pkg(2), fmt)).toEqual(["$42.00 a session ($672.00 for 16).", "The $672.00 paid covers all 16 completed sessions."]);
    const ahead = buildClientPayments({
      sales: [{ ...base, id: "x", package_number: 1, payment_status: "Partially Paid", term_start_date: "2026-11-01", amount_paid_cents: 50400, amount_tax_paid_cents: 2400 } as any],
      ledger: [pay("x", "2026-11-01", 50400, 2400)],
      balance: [bal("x", 4, 2, 10)] as any,
      events: [],
      today: TODAY,
    }).packages[0];
    expect(coverageWords(ahead, fmt)).toEqual([
      "$42.00 a session ($672.00 for 16).",
      "The $504.00 paid covers all 4 completed sessions.",
      "$336.00 is paid ahead of the training so far.",
      "Booked sessions aren't counted until they're done.",
    ]);
  });
});

describe("the screens use them", () => {
  it("one glance on Summary, Sessions and Billing; one package list on Sessions and Billing", () => {
    const summary = readFileSync("src/route-pages/_authenticated/admin/clients.$id.tsx", "utf8");
    expect(summary).toContain("<ClientPackageSnapshot");
    const sessions = readFileSync("src/components/sessions/client-sessions-panel.tsx", "utf8");
    expect(sessions).toContain("<PackageSnapshot");
    expect(sessions).toContain('mode="sessions"');
    const billing = readFileSync("src/components/admin/client-billing-panel.tsx", "utf8");
    expect(billing).toContain("<ClientPackageSnapshot");
    expect(billing).toContain('mode="billing"');
    expect(billing).toContain("<PaymentPlans");
  });

  it("collapsed package rows draw one thin bar each, never a cell per session", () => {
    const list = readFileSync("src/components/billing/package-list.tsx", "utf8");
    const row = list.slice(list.indexOf('aria-expanded={open} onClick={() => setOpen((o) => !o)} className="w-full space-y-2'), list.indexOf("{open && ("));
    expect(row).toContain("<SegmentBar");
    expect(row).not.toContain("<SessionBar");
    expect(row).not.toContain("<CoverageBar");
  });

  it("the client tabs are plain words with a line under the one you're on, kept in view", () => {
    const tabs = readFileSync("src/components/clients/client-workspace-tabs.tsx", "utf8");
    expect(tabs).not.toContain("backdrop-blur");
    expect(tabs).not.toContain("item.icon");
    expect(tabs).toContain("row.scrollTo");
  });
});
