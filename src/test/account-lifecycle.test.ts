import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildClientPayments, type ScheduleSale } from "@/lib/payment-schedule";
import type { MoneyLedgerRow } from "@/lib/sale-money";
import { accountReview, effectiveInstant, lifecycleNote, paidThroughDay, PAID_THROUGH_MAX_DAYS } from "@/lib/account-review";

const read = (p: string) => readFileSync(p, "utf8");
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const TODAY = "2026-11-15";
const NOW = "2026-11-15T18:00:00Z";

// A $130/month coaching subscription Stripe charges (Devin, Jarrett, Nicole…): paid to Dec 9.
const monthly = {
  id: "sub", client_id: "c", offer_name: "Online Coaching — $130/month", currency: "CAD", full_payable_amount: 130,
  payment_status: "Active Subscription", payment_structure: "Monthly subscription", is_recurring: true, sessions_purchased: 0,
  stripe_subscription_id: "sub_1", stripe_subscription_status: "active", next_billing_date: "2026-12-09",
  amount_paid_cents: 27300, amount_tax_paid_cents: 1300, purchased_at: "2026-10-09T00:00:00Z", status: "Active",
} as unknown as ScheduleSale;
const monthlyPays = [
  { id: "s1", purchase_id: "sub", txn_type: "payment", amount_minor: 13650, tax_minor: 650, transaction_date: "2026-10-09", voided: false },
  { id: "s2", purchase_id: "sub", txn_type: "payment", amount_minor: 13650, tax_minor: 650, transaction_date: "2026-11-09", voided: false },
] as MoneyLedgerRow[];

// Marc's packages (payment-schedule.test.ts): package 2's subscription pays packages 3 and 4 after it.
const base = {
  offer_name: "Personal Training — 16 Sessions / 4 Weeks", sessions_purchased: 16, contract_value_cents: 64000, installment_amount: 160,
  number_of_payments: 4, currency: "CAD", payment_frequency: "biweekly", payment_structure: "Bi-weekly subscription (every 2 weeks) — 4 payments",
};
const marc: ScheduleSale[] = [
  { ...base, id: "p1", contract_value_cents: 80000, installment_amount: 200, payment_status: "Paid", term_start_date: "2026-08-10", stripe_subscription_id: "sub_old", stripe_subscription_status: "canceled", amount_paid_cents: 84000, amount_tax_paid_cents: 4000 } as any,
  { ...base, id: "p2", payment_status: "Active Subscription", term_start_date: "2026-09-07", is_recurring: true, stripe_subscription_id: "sub_live", stripe_subscription_status: "active", stripe_checkout_session_id: "cs_live", next_billing_date: "2026-11-27", first_payment_date: "2026-10-02", amount_paid_cents: 67200, amount_tax_paid_cents: 3200 } as any,
  { ...base, id: "p3", payment_status: "Unpaid", term_start_date: "2026-10-05", amount_paid_cents: 0 } as any,
  { ...base, id: "p4", payment_status: "Unpaid", term_start_date: "2026-11-02", package_expiry_date: "2027-03-05", amount_paid_cents: 0 } as any,
];
const pay = (pid: string, day: string, cents: number, tax: number): MoneyLedgerRow => ({ purchase_id: pid, txn_type: "payment", amount_minor: cents, tax_minor: tax, transaction_date: day });
const marcLedger: MoneyLedgerRow[] = [
  pay("p1", "2026-08-22", 21000, 1000), pay("p1", "2026-09-05", 21000, 1000), pay("p1", "2026-09-13", 42000, 2000),
  pay("p2", "2026-10-02", 16800, 800), pay("p2", "2026-10-16", 16800, 800), pay("p2", "2026-10-30", 16800, 800), pay("p2", "2026-11-13", 16800, 800),
];
const marcBalance = [
  { purchase_id: "p1", granted: 16, used: 16, reserved: 0, remaining: 0, expired: 0, transferred: 0 },
  { purchase_id: "p2", granted: 16, used: 16, reserved: 0, remaining: 0, expired: 0, transferred: 0 },
  { purchase_id: "p3", granted: 16, used: 16, reserved: 0, remaining: 0, expired: 0, transferred: 0 },
  { purchase_id: "p4", granted: 16, used: 6, reserved: 2, remaining: 8, expired: 0, transferred: 0 },
] as any[];
const sessions = [
  { id: "s-nov17", status: "Scheduled", starts_at: "2026-11-17T15:00:00Z", session_date: "2026-11-17" },
  { id: "s-nov19", status: "Scheduled", starts_at: "2026-11-19T15:00:00Z", session_date: "2026-11-19" },
  { id: "s-dec10", status: "Scheduled", starts_at: "2026-12-10T15:00:00Z", session_date: "2026-12-10" },
  { id: "s-past", status: "Scheduled", starts_at: "2026-11-14T15:00:00Z", session_date: "2026-11-14" },
  { id: "s-done", status: "Completed", starts_at: "2026-11-20T15:00:00Z", session_date: "2026-11-20" },
];

const payments = (sales: ScheduleSale[], ledger: MoneyLedgerRow[], balance: any[] = []) =>
  buildClientPayments({ sales, ledger, balance, events: [], today: TODAY });
const review = (o: Partial<Parameters<typeof accountReview>[0]> & { sales: ScheduleSale[]; ledger?: MoneyLedgerRow[]; balance?: any[] }) =>
  accountReview({
    kind: "deactivate",
    who: "self",
    firstName: "Marc",
    payments: payments(o.sales, o.ledger ?? [], o.balance ?? []),
    sessions: [],
    today: TODAY,
    now: NOW,
    money: fmt,
    ...o,
  } as any);
const keys = (r: ReturnType<typeof accountReview>) => r.lines.map((l) => l.key);

describe("deactivating with a monthly coaching subscription", () => {
  it("stops it (no more charges) and offers to wait until the paid month runs out", () => {
    const r = review({ sales: [monthly], ledger: monthlyPays });
    expect(r.paidThrough).toBe("2026-12-09");
    expect(r.stop).toEqual([{ saleId: "sub", subscriptionId: "sub_1", name: "Online Coaching — $130/month", kind: "coaching" }]);
    expect(r.lines[0]).toMatchObject({ key: "sub:sub", tone: "stop", title: "Your coaching subscription stops" });
    expect(r.lines[0].body).toContain("isn't refunded by itself");
    expect(r.effective).toBeNull();
  });

  it("deactivating when the month runs out keeps coaching to then and cancels only sessions after it", () => {
    const r = review({ sales: [monthly], ledger: monthlyPays, when: "paid_through", sessions });
    expect(r.effective).toBe("2026-12-09");
    expect(r.lines[0].body).toBe("Coaching carries on to Dec 9, the end of the month you've paid for. No more charges after that.");
    expect(r.cancel).toEqual(["s-dec10"]);
    expect(r.lines.find((l) => l.key === "booked")!.title).toBe("1 booked session after Dec 9 is cancelled");
  });

  it("now cancels every booked session from now on, never a past or finished one, and says the credits go back", () => {
    const r = review({ sales: [monthly], ledger: monthlyPays, sessions });
    expect(r.cancel).toEqual(["s-nov17", "s-nov19", "s-dec10"]);
    const booked = r.lines.find((l) => l.key === "booked")!;
    expect(booked.title).toBe("3 booked sessions are cancelled");
    expect(booked.body).toBe("Nov 17, Nov 19 and Dec 10. Each credit goes back on your package, and nothing is rebooked on reactivation.");
  });

  it("a subscription already set to end isn't stopped twice", () => {
    const r = review({ sales: [{ ...monthly, cancel_at_period_end: true } as any], ledger: monthlyPays });
    expect(r.stop).toEqual([]);
    expect(r.lines[0]).toMatchObject({ tone: "info", title: "Your coaching subscription already ends Dec 9" });
  });

  it("only offers to wait for a month that runs out soon, and never on a failed charge", () => {
    expect(paidThroughDay([{ ...monthly, next_billing_date: "2027-03-01" } as any], TODAY)).toBeNull();
    expect(paidThroughDay([{ ...monthly, stripe_subscription_status: "past_due" } as any], TODAY)).toBeNull();
    expect(paidThroughDay([{ ...monthly, next_billing_date: TODAY } as any], TODAY)).toBeNull();
    expect(PAID_THROUGH_MAX_DAYS).toBe(45);
    expect(effectiveInstant("2026-12-09")).toBe("2026-12-09T00:00:00-05:00");
  });

  it("the coach's wording names them and points at refunding from Billing", () => {
    const r = review({ sales: [monthly], ledger: monthlyPays, who: "staff" });
    expect(r.lines[0].title).toBe("Their coaching subscription stops");
    expect(r.lines[0].body).toContain("refund it from Billing if you agree to");
    expect(r.lines.at(-1)!.body).toContain("they come off check-ins, reminders and your lists");
  });
});

describe("deactivating with a session package on auto-pay (Marc)", () => {
  const marcReview = (o: any = {}) => review({ sales: marc, ledger: marcLedger, balance: marcBalance, sessions, ...o });

  it("the payment plan keeps going (it pays for what they bought) and is never stopped by the person", () => {
    const r = marcReview();
    expect(r.stop).toEqual([]);
    expect(r.autoPay).toMatchObject({ saleId: "p2", subscriptionId: "sub_live", kind: "plan" });
    const plan = r.lines.find((l) => l.key === "plan:p2")!;
    expect(plan).toMatchObject({ tone: "keep", title: "Your payment plan keeps going" });
    expect(plan.body).toContain("$168.00 every 2 weeks");
    expect(r.paidThrough).toBeNull();
  });

  it("the coach can stop it, and what's owed stays owed", () => {
    const r = marcReview({ who: "staff", stopAutoPay: true });
    expect(r.stop.map((s) => s.saleId)).toEqual(["p2"]);
    expect(r.autoPay).toBeNull();
    expect(r.lines.find((l) => l.key === "plan:p2")!.body).toBe("No more automatic charges. What's left is still owed.");
    expect(r.lines.find((l) => l.key === "owed")!.title).toBe(`Marc still owes ${fmt(r.facts.outstandingCents)}`);
    expect(r.lines.find((l) => l.key === "owed")!.body).toContain("Deactivating doesn't clear it.");
  });

  it("unused sessions stay theirs (until the package expires), and money owed is said once", () => {
    const r = marcReview();
    const unused = r.lines.find((l) => l.key === "unused")!;
    expect(unused).toMatchObject({ tone: "keep" });
    expect(r.facts.unusedSessions).toBeGreaterThan(0);
    expect(unused.body).toContain("for when you come back");
    expect(r.lines.filter((l) => l.key === "owed")).toHaveLength(1);
  });

  it("deleting stops every recurring charge and says the sessions are given up", () => {
    const r = marcReview({ kind: "delete" });
    expect(r.stop.map((s) => s.saleId)).toEqual(["p2"]);
    expect(r.lines.find((l) => l.key === "unused")).toMatchObject({ tone: "stop" });
    expect(r.lines.find((l) => l.key === "unused")!.body).toContain("gives them up");
    expect(r.lines.at(-1)!.title).toBe("What's deleted and what's kept");
    expect(r.lines.at(-1)!.body).toContain("Payment and session records");
  });

  it("reactivating restarts nothing, cancels nothing and charges nothing", () => {
    const r = marcReview({ kind: "reactivate" });
    expect(r.stop).toEqual([]);
    expect(r.cancel).toEqual([]);
    expect(r.autoPay).toBeNull();
    expect(r.lines.at(-1)!.title).toBe("Nothing restarts and nothing is charged");
  });
});

describe("only what applies", () => {
  it("a free member with nothing billed sees one line about their account", () => {
    const r = review({ sales: [] });
    expect(keys(r)).toEqual(["account"]);
    expect(r.stop).toEqual([]);
    expect(r.paidThrough).toBeNull();
  });

  it("an unpaid payment link is named, never counted as owed", () => {
    const link = { id: "lnk", offer_name: "Single session", currency: "CAD", contract_value_cents: 5000, payment_status: "Payment Link Sent", sessions_purchased: 0, purchased_at: "2026-11-10T00:00:00Z" } as unknown as ScheduleSale;
    const r = review({ sales: [link] });
    expect(keys(r)).toContain("waiting");
    expect(keys(r)).not.toContain("owed");
    expect(r.lines.find((l) => l.key === "waiting")!.title).toBe("An unpaid payment link: Single session");
  });
});

describe("the coach's note", () => {
  it("says who did it and the verified figures, once", () => {
    const r = review({ sales: marc, ledger: marcLedger, balance: marcBalance, sessions });
    const note = lifecycleNote({ event: "deactivated", name: "Marc Asugui", by: "self", reason: "Travelling for a month", review: r, money: fmt });
    expect(note.split("\n")[0]).toBe("🔔 Marc Asugui deactivated their account.");
    expect(note).toContain("Why: Travelling for a month");
    expect(note).toContain("Still running: Personal Training — 16 Sessions / 4 Weeks");
    expect(note).toContain("Booked sessions cancelled: 3 (credits back on the package)");
    const staff = lifecycleNote({ event: "deletion_requested", name: "Marc Asugui", by: "admin", byName: "Jared", review: null, money: fmt, day: "2026-12-15" });
    expect(staff).toBe("🔔 Jared deleted Marc Asugui's account. It's deleted for good on Dec 15, 2026 unless an admin restores it.");
  });
});

describe("the lifecycle, end to end in code", () => {
  const sql = read("supabase/migrations/20270324090000_account_lifecycle.sql");
  const fns = read("src/lib/lifecycle.functions.ts");
  const server = read("src/lib/lifecycle.server.ts");

  it("deactivating archives, turns the app off, cancels booked sessions (credits back) and keeps what it changed", () => {
    expect(sql).toContain("SET status = 'Deactivated', archived = true, portal_access_disabled = true,");
    expect(sql).toContain("WHERE client_id = _client AND status = 'Scheduled' AND starts_at >= now()");
    expect(sql).toContain("deactivation_prior = v_prior");
    expect(sql).toContain("IF c.status IN ('Deactivated', 'Deleted') THEN\n    RETURN jsonb_build_object('ok', true, 'already', true);");
  });

  it("reactivating puts back exactly what was there and touches no money", () => {
    expect(sql).toContain("archived = coalesce((c.prior ->> 'archived')::boolean, false),");
    expect(sql).toContain("v_status := CASE WHEN c.service_tier = 'self_serve' THEN 'Member' ELSE 'Active' END;");
    const react = sql.slice(sql.indexOf("FUNCTION public._account_reactivation_apply"), sql.indexOf("FUNCTION public.account_lifecycle_status"));
    for (const money of ["purchase_records", "payment_ledger", "session_ledger_events", "pt_sessions"]) expect(react).not.toContain(money);
  });

  it("Stripe goes first, so an account is never changed while it keeps charging", () => {
    const d = fns.slice(fns.indexOf("export const deactivateAccount"), fns.indexOf("export const reactivateAccount"));
    expect(d.indexOf("await stopSubscriptions(")).toBeLessThan(d.indexOf('rpc("_account_deactivation_apply"'));
    expect(server).toContain('body: "cancel_at_period_end=true"');
    expect(server).toContain("idempotencyKey: `${why}_${s.subscriptionId}`");
  });

  it("only the person, an admin or the client's own coach may act; a coach's pause is theirs to undo", () => {
    expect(server).toContain('throw new Error("You can\'t change this account.");');
    expect(server).toContain("Team accounts are managed by the owner from Team, not here.");
    expect(fns).toContain("Your coach paused your account, so they're the one to turn it back on.");
    expect(fns).toContain('throw new Error("Only an admin can delete an account.");');
  });

  it("a deletion the person asked for is theirs to take back, never staff's", () => {
    expect(sql).toContain("They asked for this deletion themselves, so only they can take it back");
  });

  it("every step is recorded where clients can't write, and outlives the account", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.account_lifecycle_events");
    expect(sql).toContain("-- no foreign keys: the record outlives the account");
    expect(sql).toContain("REVOKE ALL ON public.account_lifecycle_events FROM anon, authenticated;");
    expect(sql).toContain("CREATE TRIGGER account_deletions_lifecycle AFTER INSERT OR UPDATE OF status ON public.account_deletions");
  });

  it("deactivated people are hidden from the Crew and listed only under Deactivated", () => {
    expect(sql).toContain("WHERE c.status = 'Deactivated' AND c.user_id IS NOT NULL AND c.user_id NOT IN (SELECT id FROM mine))");
    expect(sql).toContain("and coalesce(c.status, '') <> 'Deactivated')$a$;");
  });

  it("day 30 keeps money, sessions, agreements and the chat, and deletes the person's own data", () => {
    expect(sql).toContain("keep_client text[] := ARRAY['messages', 'pt_sessions', 'agreements'");
    expect(sql).toContain("PERFORM set_config('jf.allow_history_delete', 'on', true);");
    const purge = read("src/lib/account-deletion.server.ts");
    expect(purge).toContain('admin.rpc("_account_purge_personal"');
    expect(purge).toContain('"payment_ledger", "session_ledger_events", "purchase_records"');
    expect(purge).toContain("email: `deleted-${row.user_id}@deleted.invalid`");
  });
});
