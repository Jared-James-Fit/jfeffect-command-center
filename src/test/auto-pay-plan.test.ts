import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { addPeriod, autoPayPlan, packagePayLine, type PackageSale } from "@/lib/session-packages";
import { saleMoney, type MoneyLedgerRow } from "@/lib/sale-money";

// Marc Asugui on Nov 11 2026: package 1 paid ($840), package 2 on a Stripe
// subscription ($160 + tax every 2 weeks, 3 of 4 paid, next Nov 13), packages 3
// and 4 renewals added pay later with nothing paid.
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
const sales: PackageSale[] = [
  { ...base, id: "p1", contract_value_cents: 80000, installment_amount: 200, payment_status: "Paid", term_start_date: "2026-08-10", stripe_subscription_id: "sub_old", stripe_subscription_status: "canceled", amount_paid_cents: 84000, amount_tax_paid_cents: 4000 } as any,
  { ...base, id: "p2", payment_status: "Active Subscription", term_start_date: "2026-09-07", is_recurring: true, stripe_subscription_id: "sub_live", stripe_subscription_status: "active", stripe_checkout_session_id: "cs_live", next_billing_date: "2026-11-13", amount_paid_cents: 50400, amount_tax_paid_cents: 2400 } as any,
  { ...base, id: "p3", payment_status: "Unpaid", term_start_date: "2026-10-05", amount_paid_cents: 0 } as any,
  { ...base, id: "p4", payment_status: "Unpaid", term_start_date: "2026-11-02", amount_paid_cents: 0 } as any,
];
const pay = (pid: string, day: string, cents: number, tax: number): MoneyLedgerRow => ({ purchase_id: pid, txn_type: "payment", amount_minor: cents, tax_minor: tax, transaction_date: day });
const ledger: MoneyLedgerRow[] = [
  pay("p1", "2026-08-22", 21000, 1000), pay("p1", "2026-09-05", 21000, 1000), pay("p1", "2026-09-13", 42000, 2000),
  pay("p2", "2026-10-02", 16800, 800), pay("p2", "2026-10-16", 16800, 800), pay("p2", "2026-10-30", 16800, 800),
];
const rate = 0.05;
const views = sales.map((s) => ({ id: s.id, money: saleMoney(s, ledger.filter((l) => l.purchase_id === s.id), rate, { sessionsUsed: 16 }) }));
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const md = (iso: string) => iso.slice(5);

describe("auto-pay pays the packages in order", () => {
  it("projects $168 every 2 weeks over packages 2, 3 and 4, oldest owed first", () => {
    const a = autoPayPlan(sales, views, rate)!;
    expect(a).toMatchObject({ saleId: "p2", eachCents: 16800, per: "2 weeks", next: "2026-11-13", ending: false });
    expect(a.covers.get("p1")).toBeUndefined();
    expect(a.covers.get("p2")).toEqual({ payments: 1, first: "2026-11-13", last: "2026-11-13" });
    expect(a.covers.get("p3")).toEqual({ payments: 4, first: "2026-11-27", last: "2027-01-08" });
    expect(a.covers.get("p4")).toEqual({ payments: 4, first: "2027-01-22", last: "2027-03-05" });
    expect(a.paidUpOn).toBe("2027-03-05");
  });

  it("says when auto-pay collects it instead of calling it owed", () => {
    const a = autoPayPlan(sales, views, rate)!;
    const line = (id: string) => packagePayLine(views.find((v) => v.id === id)!.money, fmt, { cover: a.covers.get(id), day: md });
    expect(line("p1")).toEqual({ text: "Paid $840.00", tone: "done" });
    expect(line("p2")).toEqual({ text: "$168.00 · auto-pay 11-13", tone: "neutral" });
    expect(line("p3")).toEqual({ text: "$672.00 · auto-pay 11-27 – 01-08", tone: "neutral" });
    // Without auto-pay it's owed.
    expect(packagePayLine(views[2].money, fmt)).toEqual({ text: "$672.00 owed", tone: "attention" });
  });

  it("never pays a package that pays for itself, nor one sold before the plan", () => {
    const withLink = sales.map((s) => (s.id === "p3" ? { ...s, stripe_payment_link: "https://buy.stripe.com/x" } : s));
    const a = autoPayPlan(withLink, views, rate)!;
    expect(a.covers.has("p3")).toBe(false);
    expect(a.covers.get("p4")).toEqual({ payments: 4, first: "2026-11-27", last: "2027-01-08" });
  });

  it("is ending (nothing projected) once the subscription is set to stop, and absent with no live one", () => {
    const ending = sales.map((s) => (s.id === "p2" ? { ...s, cancel_at_period_end: true } : s));
    expect(autoPayPlan(ending, views, rate)).toMatchObject({ ending: true, paidUpOn: null });
    expect(autoPayPlan(ending, views, rate)!.covers.size).toBe(0);
    const none = sales.map((s) => (s.id === "p2" ? { ...s, stripe_subscription_status: "canceled", payment_status: "Paid" } : s));
    expect(autoPayPlan(none, views, rate)).toBeNull();
  });

  it("steps by the billing period", () => {
    expect(addPeriod("2026-11-13", "2 weeks", 2)).toBe("2026-12-11");
    expect(addPeriod("2026-11-13", "week", 1)).toBe("2026-11-20");
    expect(addPeriod("2026-01-31", "month", 1)).toBe("2026-03-03");
  });
});

describe("the server pays the same order", () => {
  const sql = readFileSync("supabase/migrations/20270303090000_auto_pay_pays_packages_in_order.sql", "utf8");
  const hook = readFileSync("src/routes/api/public/stripe-webhook.ts", "utf8");

  it("session_plan_payment_target: its own package and pay-later ones after it, oldest owed first", () => {
    expect(sql).toMatch(/COALESCE\(p\.amount_outstanding_cents, 0\) > 0/);
    expect(sql).toMatch(/p\.stripe_subscription_id IS NULL[\s\S]*p\.stripe_checkout_session_id IS NULL[\s\S]*p\.stripe_payment_link IS NULL[\s\S]*p\.stripe_payment_intent_id IS NULL/);
    expect(sql).toMatch(/ORDER BY COALESCE\(p\.term_start_date/);
    expect(sql).toMatch(/auth\.uid\(\)\) IS NULL OR/);
  });

  it("the webhook records a subscription payment on the plan's target and ends auto-pay only when nothing's owed", () => {
    expect(hook).toMatch(/planPaymentTarget\(supabase, purchase\)/);
    expect(hook).toMatch(/purchase_id: payTo\.id/);
    expect(hook).toMatch(/planStillOwed\(supabase, purchase\)/);
    expect(hook).toMatch(/stillOwed === false \|\| \(stillOwed === null && contractedPayments > 0\)/);
  });
});
