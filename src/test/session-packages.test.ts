import { describe, expect, it } from "vitest";
import { buildSessionPackages, dayRange, packagePayLine, sessionPlaces, sessionsNextStep, type PackageLedgerEvent, type PackageSessionRow } from "@/lib/session-packages";

let seq = 0;
const id = () => `e${++seq}`;
const t = () => `2026-11-01T00:00:${String(seq).padStart(2, "0")}Z`;

/** A session used on a package (its hold converted, like the database does). */
function usedOn(sid: string, pid: string | null, day: string): PackageLedgerEvent[] {
  const r = { id: id(), purchase_id: pid, pt_session_id: sid, event_type: "reserved", session_count: -1, source: "reserve_on_book", effective_date: day, created_at: t() };
  const rel = { id: id(), purchase_id: pid, pt_session_id: sid, event_type: "released", session_count: 1, source: "convert_on_complete", related_event_id: r.id, created_at: t() };
  const u = { id: id(), purchase_id: pid, pt_session_id: sid, event_type: "used", session_count: -1, source: "auto_use_on_complete", effective_date: day, created_at: t() };
  return [r, rel, u];
}
const heldOn = (sid: string, pid: string | null, day: string): PackageLedgerEvent[] => [
  { id: id(), purchase_id: pid, pt_session_id: sid, event_type: "reserved", session_count: -1, source: "reserve_on_book", effective_date: day, created_at: t() },
];
/** Move a used session to another package the way _move_session_event does. */
function moveUse(events: PackageLedgerEvent[], sid: string, to: string | null): PackageLedgerEvent[] {
  const u = [...events].reverse().find((e) => e.pt_session_id === sid && e.event_type === "used")!;
  const back = { id: id(), purchase_id: u.purchase_id, pt_session_id: sid, event_type: "adjusted", session_count: 1, source: "reattribute", related_event_id: u.id, created_at: t() };
  const now = { id: id(), purchase_id: to, pt_session_id: sid, event_type: "used", session_count: -1, source: "reattribute", related_event_id: u.id, created_at: t() };
  return [back, now];
}

const session = (sid: string, day: string, status = "Completed", start = "17:30:00"): PackageSessionRow => ({ id: sid, session_date: day, start_time: start, status, uses_credit: true });

describe("which package a session is on", () => {
  it("follows a used session through every move, and a hold until it's released", () => {
    seq = 0;
    let ev = usedOn("s1", "p1", "2026-10-12");
    ev = [...ev, ...moveUse(ev, "s1", null)];
    ev = [...ev, ...moveUse(ev, "s1", "p3")];
    ev = [...ev, ...heldOn("s2", null, "2026-11-10")];
    const places = sessionPlaces(ev);
    expect(places.get("s1")).toMatchObject({ purchaseId: "p3", kind: "used" });
    expect(places.get("s2")).toMatchObject({ purchaseId: null, kind: "held" });
  });

  it("drops a use given back when a session is un-completed", () => {
    seq = 0;
    const ev = usedOn("s1", "p1", "2026-10-12");
    const u = ev[2];
    ev.push({ id: id(), purchase_id: "p1", pt_session_id: "s1", event_type: "adjusted", session_count: 1, source: "revert_on_uncomplete", related_event_id: u.id, created_at: t() });
    expect(sessionPlaces(ev).has("s1")).toBe(false);
  });
});

// Marc Asugui on Nov 10 2026: three packages of 16 (the third an unpaid renewal), then
// 4 trained and 1 booked past them: the start of his next 16.
const pkg = (pid: string, extra: Record<string, unknown>) => ({
  id: pid,
  offer_name: "Personal Training — 16 Sessions / 4 Weeks",
  sessions_purchased: 16,
  contract_value_cents: 64000,
  installment_amount: 160,
  number_of_payments: 4,
  currency: "CAD",
  payment_frequency: "biweekly",
  ...extra,
});
const sales = [
  pkg("p1", { contract_value_cents: 80000, installment_amount: 200, payment_status: "Paid", amount_paid_cents: 84000, amount_tax_paid_cents: 4000, purchased_at: "2026-08-22", term_start_date: "2026-08-10" }),
  pkg("p2", { payment_status: "Active Subscription", is_recurring: true, amount_paid_cents: 50400, amount_tax_paid_cents: 2400, purchased_at: "2026-10-02", term_start_date: "2026-09-07", next_billing_date: "2026-11-13", stripe_subscription_status: "active" }),
  pkg("p3", { payment_status: "Unpaid", amount_paid_cents: 0, amount_tax_paid_cents: 0, purchased_at: "2026-10-22", term_start_date: "2026-10-05" }),
  { id: "old", offer_name: "16 Sessions (Final Payment)", sessions_purchased: 0, archived_at: "2026-10-21", payment_status: "Voided" },
];
const payments = [
  { purchase_id: "p1", txn_type: "payment", amount_minor: 21000, tax_minor: 1000 },
  { purchase_id: "p1", txn_type: "payment", amount_minor: 21000, tax_minor: 1000 },
  { purchase_id: "p1", txn_type: "payment", amount_minor: 42000, tax_minor: 2000 },
  { purchase_id: "p2", txn_type: "payment", amount_minor: 16800, tax_minor: 800 },
  { purchase_id: "p2", txn_type: "payment", amount_minor: 16800, tax_minor: 800 },
  { purchase_id: "p2", txn_type: "payment", amount_minor: 16800, tax_minor: 800 },
];

function marc() {
  seq = 0;
  const sessions: PackageSessionRow[] = [];
  let events: PackageLedgerEvent[] = [];
  const add = (pid: string | null, days: string[]) => days.forEach((d, i) => {
    const sid = `${pid ?? "x"}-${i}`;
    sessions.push(session(sid, d));
    events = [...events, ...usedOn(sid, pid, d)];
  });
  add("p1", Array.from({ length: 16 }, (_, i) => `2026-08-${String(10 + i).padStart(2, "0")}`));
  add("p2", Array.from({ length: 16 }, (_, i) => `2026-09-${String(7 + i).padStart(2, "0")}`));
  add("p3", ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-26", "2026-10-28", "2026-10-29", "2026-10-30"]);
  add(null, ["2026-11-02", "2026-11-04", "2026-11-05", "2026-11-06"]);
  sessions.push(session("next", "2026-11-10", "Scheduled"));
  events = [...events, ...heldOn("next", null, "2026-11-10")];
  sessions.push(session("cxl", "2026-10-23", "Cancelled"));
  const balance = ["p1", "p2", "p3"].map((pid) => ({ purchase_id: pid, granted: 16, used: 16, reserved: 0, expired: 0, remaining: 0, expires_at: null }));
  // Grants sit on the packages, so the loose rows net to -5 (4 used, 1 held).
  return { sales, payments, balance, events, sessions };
}

describe("Marc's packages", () => {
  const view = buildSessionPackages(marc());

  it("lists his packages newest first, numbered in the order he bought them", () => {
    expect(view.packages.map((p) => [p.number, p.id, p.done, p.booked, p.open, p.phase])).toEqual([
      [3, "p3", 16, 0, 0, "finished"],
      [2, "p2", 16, 0, 0, "finished"],
      [1, "p1", 16, 0, 0, "finished"],
    ]);
    expect(view.packages[0].sessions).toHaveLength(16);
    expect(dayRange(view.packages[0].from, view.packages[0].to, 2026)).toBe("Oct 5 – Oct 30");
  });

  it("puts the 5 sessions since Nov 2 on his next 16, owed now since 4 are trained", () => {
    expect(view.next).toHaveLength(1);
    const next = view.next[0];
    expect(next).toMatchObject({ fromSaleId: "p3", size: 16, priceCents: 64000, eachCents: 67200, done: 4, booked: 1, open: 11, owed: true });
    expect(next.sessions.map((s) => s.session_date)).toEqual(["2026-11-02", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-10"]);
    expect(view.unpriced).toEqual([]);
    expect(view.free).toEqual([]);
  });

  it("says each package's payment in a few words", () => {
    const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
    const [p3, p2, p1] = view.packages;
    expect(packagePayLine(p1.money, fmt)).toEqual({ text: "Paid $840.00", tone: "done" });
    expect(packagePayLine(p2.money, fmt)).toEqual({ text: "$168.00 owed", tone: "attention" });
    expect(p2.money.plan).toEqual({ made: 3, total: 4 });
    expect(packagePayLine(p3.money, fmt)).toEqual({ text: "$672.00 owed", tone: "attention" });
    expect(p3.money.plan).toEqual({ made: 0, total: 4 });
  });

  it("owes $168 + $672 + the next 16's $672, tax included", () => {
    expect(view.totals).toMatchObject({ done: 52, booked: 1, leftToBook: 0, owedCents: 16800 + 67200 + 67200, paidCents: 84000 + 50400, taxIncluded: true });
  });

  it("once the renewal is added, it's the current package with the 11 still to book", () => {
    const data = marc();
    const p4 = pkg("p4", { payment_status: "Unpaid", amount_paid_cents: 0, purchased_at: "2026-11-10", term_start_date: "2026-11-02" });
    let events = data.events;
    for (const s of data.sessions.filter((x) => x.id.startsWith("x-"))) events = [...events, ...moveUse(events, s.id, "p4")];
    const hold = events.find((e) => e.pt_session_id === "next")!;
    events = [
      ...events,
      { id: id(), purchase_id: null, pt_session_id: "next", event_type: "released", session_count: 1, source: "reattribute", related_event_id: hold.id, created_at: t() },
      { id: id(), purchase_id: "p4", pt_session_id: "next", event_type: "reserved", session_count: -1, source: "reattribute", related_event_id: hold.id, created_at: t() },
    ];
    const v = buildSessionPackages({
      ...data,
      sales: [...data.sales, p4],
      events,
      balance: [...data.balance, { purchase_id: "p4", granted: 16, used: 4, reserved: 1, expired: 0, remaining: 11, expires_at: null }],
    });
    expect(v.next).toEqual([]);
    expect(v.currentId).toBe("p4");
    expect(v.packages[0]).toMatchObject({ number: 4, done: 4, booked: 1, open: 11, phase: "active" });
    expect(v.packages[0].sessions.map((s) => s.id)).toEqual(["x-0", "x-1", "x-2", "x-3", "next"]);
    expect(v.totals).toMatchObject({ leftToBook: 11, owedCents: 16800 + 67200 + 67200 });
  });
});

describe("sessions past every package", () => {
  it("free sessions cover the first of them; with no priced package the rest are just to sell", () => {
    seq = 0;
    const events = [
      { id: id(), purchase_id: null, event_type: "granted", session_count: 1, source: "admin_adjust", created_at: t() },
      ...usedOn("a", null, "2026-11-02"),
      ...usedOn("b", null, "2026-11-04"),
    ];
    const v = buildSessionPackages({ sales: [], payments: [], balance: [], events, sessions: [session("a", "2026-11-02"), session("b", "2026-11-04")] });
    expect(v.free.map((s) => s.id)).toEqual(["a"]);
    expect(v.unpriced.map((s) => s.id)).toEqual(["b"]);
    expect(v.next).toEqual([]);
    expect(v.totals.owedCents).toBe(0);
  });

  it("only booked past the package is a heads-up, not owed yet", () => {
    seq = 0;
    const events = heldOn("a", null, "2026-11-20");
    const v = buildSessionPackages({
      sales: [pkg("p1", { payment_status: "Paid", amount_paid_cents: 67200, amount_tax_paid_cents: 3200, purchased_at: "2026-10-01" })],
      payments: [],
      balance: [{ purchase_id: "p1", granted: 16, used: 16, reserved: 0, expired: 0, remaining: 0, expires_at: null }],
      events,
      sessions: [session("a", "2026-11-20", "Scheduled")],
    });
    expect(v.next[0]).toMatchObject({ done: 0, booked: 1, open: 15, owed: false });
    expect(v.totals.owedCents).toBe(0);
  });

  it("a package not paid for yet has nothing to book until its sessions are granted", () => {
    const v = buildSessionPackages({
      sales: [pkg("p1", { payment_status: "Pending", amount_paid_cents: 0, purchased_at: "2026-11-01" })],
      payments: [],
      balance: [],
      events: [],
      sessions: [],
    });
    expect(v.packages[0]).toMatchObject({ phase: "waiting", open: 0, size: 16 });
    expect(v.totals.leftToBook).toBe(0);
    expect(v.currentId).toBeNull();
  });
});

describe("the next step", () => {
  it("Marc: renew his next 16, which already has 5 on it", () => {
    const step = sessionsNextStep(buildSessionPackages(marc()), true, 16);
    expect(step.kind).toBe("renew");
    expect(step.kind === "renew" && step.next.open).toBe(11);
  });

  it("books what's left, then says it's all booked, then renew once it's all trained", () => {
    const base = { sales: [pkg("p1", { payment_status: "Paid", amount_paid_cents: 67200, amount_tax_paid_cents: 3200, purchased_at: "2026-10-01" })], payments: [], events: [], sessions: [] };
    const bal = (used: number, reserved: number) => [{ purchase_id: "p1", granted: 16, used, reserved, expired: 0, remaining: 16 - used - reserved, expires_at: null }];
    expect(sessionsNextStep(buildSessionPackages({ ...base, balance: bal(5, 3) }), true, 16)).toEqual({ kind: "book", left: 8, packageNumber: 1 });
    expect(sessionsNextStep(buildSessionPackages({ ...base, balance: bal(5, 11) }), true, 16)).toMatchObject({ kind: "all_booked", canRenew: true });
    expect(sessionsNextStep(buildSessionPackages({ ...base, balance: bal(16, 0) }), true, 16)).toEqual({ kind: "renew_all_used", size: 16 });
    expect(sessionsNextStep(buildSessionPackages({ ...base, sales: [], balance: [] }), false, null)).toEqual({ kind: "sell_first" });
  });
});
