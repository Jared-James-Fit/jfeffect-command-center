import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildClientPayments, type ScheduleSale } from "@/lib/payment-schedule";
import { coachingPlans, termRange, timeLeftWords, ENDING_SOON_DAYS } from "@/lib/coaching-plan";

const TODAY = "2026-11-15";

// Alexander Rozbacher's sale as it is in the database (Nov 15 2026): 12 months of
// legacy online coaching, $3,200 paid in full on May 20 through the other Stripe
// account, GST treated as included.
const alexander = {
  id: "alex",
  client_id: "c",
  offer_name: "Online Coaching — Legacy",
  currency: "CAD",
  full_payable_amount: 3047.62,
  contract_value_cents: 304762,
  amount_paid_cents: 320000,
  amount_tax_paid_cents: 15238,
  amount_outstanding_cents: 0,
  payment_status: "Paid",
  payment_structure: "One-time payment",
  payment_frequency: "One-time payment",
  is_recurring: false,
  sessions_purchased: 0,
  term_start_date: "2026-06-02",
  term_end_date: "2027-06-02",
  service_start_date: "2026-06-02",
  term_duration_text: "12 Months",
  purchased_at: "2026-05-21T02:38:00Z",
  status: "Active",
} as unknown as ScheduleSale;
const alexPay = { id: "l1", purchase_id: "alex", txn_type: "payment", amount_minor: 320000, tax_minor: 15238, transaction_date: "2026-05-20", voided: false };

// Ashley: 6 months paid in full in July, no dates on the sale.
const ashley = {
  ...alexander, id: "ash", contract_value_cents: 117972, full_payable_amount: 1179.72, amount_paid_cents: 117972, amount_tax_paid_cents: 5472,
  term_start_date: null, term_end_date: null, service_start_date: null, term_duration_text: "6 Months", purchased_at: "2026-07-06T01:31:09Z",
} as unknown as ScheduleSale;
const ashPay = { id: "l2", purchase_id: "ash", txn_type: "payment", amount_minor: 117972, tax_minor: 5472, transaction_date: "2026-07-06", voided: false };

// A $130/month subscription Stripe charges.
const monthly = {
  id: "sub", client_id: "c", offer_name: "Online Coaching — $130/month", currency: "CAD", full_payable_amount: 130, payment_status: "Active Subscription",
  payment_structure: "Monthly subscription", is_recurring: true, sessions_purchased: 0, stripe_subscription_id: "sub_1", stripe_subscription_status: "active",
  next_billing_date: "2026-12-06", amount_paid_cents: 27300, amount_tax_paid_cents: 1300, purchased_at: "2026-10-05T00:00:00Z", status: "Active",
} as unknown as ScheduleSale;
const subPays = [
  { id: "s1", purchase_id: "sub", txn_type: "payment", amount_minor: 13650, tax_minor: 650, transaction_date: "2026-10-06", voided: false },
  { id: "s2", purchase_id: "sub", txn_type: "payment", amount_minor: 13650, tax_minor: 650, transaction_date: "2026-11-06", voided: false },
];

// A deposit: one-off, no term.
const deposit = {
  id: "dep", client_id: "c", offer_name: "Personal Training — Deposit", currency: "CAD", contract_value_cents: 10000, amount_paid_cents: 10000,
  payment_status: "Paid", sessions_purchased: 0, purchased_at: "2026-06-19T00:00:00Z", status: "Active",
} as unknown as ScheduleSale;
const depPay = { id: "l3", purchase_id: "dep", txn_type: "payment", amount_minor: 10000, tax_minor: 0, transaction_date: "2026-06-19", voided: false };

const build = (sales: ScheduleSale[], ledger: any[], today = TODAY) => buildClientPayments({ sales, ledger, balance: [], events: [], today });

describe("coaching plans", () => {
  it("Alexander: 12 months paid in full, Jun 2 2026 – Jun 2 2027, about half gone, 6 months left", () => {
    const p = build([alexander], [alexPay]);
    expect(p.packages).toEqual([]);
    expect(p.outstandingCents).toBe(0);
    expect(p.coaching).toHaveLength(1);
    const plan = p.coaching[0];
    expect(plan).toMatchObject({
      saleId: "alex", kind: "term", name: "Online Coaching — Legacy", state: "paid", cents: 320000, paidCents: 320000, leftCents: 0,
      start: "2026-06-02", end: "2027-06-02", duration: "12 Months", timing: "active", daysLeft: 199,
    });
    expect(plan.elapsed!).toBeGreaterThan(0.45);
    expect(plan.elapsed!).toBeLessThan(0.47);
    expect(termRange(plan.start, plan.end)).toBe("Jun 2, 2026 – Jun 2, 2027");
    expect(timeLeftWords(plan, TODAY)).toBe("6 months left");
  });

  it("flags the last month, then the end, and keeps an ended term only to renew it", () => {
    const soon = build([alexander], [alexPay], "2027-05-10").coaching[0];
    expect(soon.timing).toBe("ending_soon");
    expect(soon.daysLeft).toBeLessThanOrEqual(ENDING_SOON_DAYS);
    expect(timeLeftWords(soon, "2027-05-10")).toBe("3 weeks left");
    expect(timeLeftWords(build([alexander], [alexPay], "2027-05-30").coaching[0], "2027-05-30")).toBe("3 days left");
    expect(timeLeftWords(build([alexander], [alexPay], "2027-06-02").coaching[0], "2027-06-02")).toBe("Ends today");
    const ended = build([alexander], [alexPay], "2027-06-12").coaching[0];
    expect(ended).toMatchObject({ timing: "ended", daysLeft: -10 });
    expect(timeLeftWords(ended, "2027-06-12")).toBe("Ended 10 days ago");
    // Long gone: not shown.
    expect(build([alexander], [alexPay], "2027-09-01").coaching).toEqual([]);
    // An ended term steps aside once something else is running.
    expect(build([alexander, monthly], [alexPay, ...subPays], "2027-06-12").coaching.map((c) => c.saleId)).toEqual(["sub"]);
  });

  it("starts later: upcoming", () => {
    const plan = build([alexander], [alexPay], "2026-05-25").coaching[0];
    expect(plan.timing).toBe("upcoming");
    expect(plan.elapsed).toBe(0);
  });

  it("a paid term with no dates says so, never a guessed start or end", () => {
    const plan = build([ashley], [ashPay]).coaching[0];
    expect(plan).toMatchObject({ kind: "term", timing: "no_dates", start: null, end: null, duration: "6 Months", daysLeft: null, elapsed: null });
    expect(timeLeftWords(plan, TODAY)).toBeNull();
  });

  it("a subscription: its charge with tax, the next charge, charged by Stripe", () => {
    const plan = build([monthly], subPays).coaching[0];
    expect(plan).toMatchObject({ kind: "subscription", state: "renews", cents: 13650, per: "month", next: "2026-12-06", auto: true, timing: "active" });
    const ending = build([{ ...monthly, cancel_at_period_end: true } as ScheduleSale], subPays).coaching[0];
    expect(ending).toMatchObject({ state: "cancelling", end: "2026-12-06" });
  });

  it("a cancelled subscription, a deposit, a session package and an unpaid link aren't plans", () => {
    const cancelled = { ...monthly, id: "old", payment_status: "Cancelled", stripe_subscription_status: "canceled" } as ScheduleSale;
    const pkg = { ...alexander, id: "pkg", sessions_purchased: 16 } as ScheduleSale;
    const link = { ...alexander, id: "link", amount_paid_cents: 0, amount_tax_paid_cents: 0, payment_status: "Payment Link Sent" } as ScheduleSale;
    const p = build([cancelled, deposit, pkg, link], [depPay]);
    expect(p.coaching).toEqual([]);
  });

  it("is computed straight from the sales and money (no guessing in the view)", () => {
    const p = build([alexander, deposit], [alexPay, depPay]);
    expect(coachingPlans([alexander, deposit] as any, p.money, TODAY).map((c) => c.saleId)).toEqual(["alex"]);
  });
});

describe("coaching row in the glance", () => {
  const snapshot = readFileSync("src/components/billing/package-snapshot.tsx", "utf8");
  const billing = readFileSync("src/components/admin/client-billing-panel.tsx", "utf8");
  it("the glance shows the coaching plan, and shows up for a client with no session package", () => {
    expect(snapshot).toContain('data-glance="coaching"');
    expect(snapshot).toMatch(/payments\.packages\.length === 0 && payments\.coaching\.length === 0/);
    expect(billing).toMatch(/p\.packages\.length > 0 \|\| p\.coaching\.length > 0|packages\.length > 0 \|\| .*coaching\.length > 0/);
  });
  it("a term with no dates is set from Billing, never guessed", () => {
    expect(billing).toContain("data-coaching-no-dates");
  });
});
