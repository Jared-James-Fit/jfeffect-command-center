/**
 * A client's PT sessions the way the coach thinks about them: in packages
 * (Marc buys 16 at a time). Each package lists the very sessions on it, done
 * and booked, what's still to book, and its money; the sessions trained or
 * booked past every package are the next package, waiting to be added (a
 * renewal the client pays later, never a per-session tab).
 *
 * Which package a session is on is read from the session ledger exactly the
 * way the database reads it (pt_session_sale_id): its latest use nothing gave
 * back, else its latest hold nothing released. Counts come from
 * session_balance(), so the numbers here are the database's numbers.
 *
 * Pure: callers pass the rows they already loaded.
 */
import { clientTaxRate } from "@/lib/client-billing-summary";
import { latestPackage } from "@/lib/client-owed";
import { billingPeriod, saleMoney, withTax, type MoneyLedgerRow, type MoneySale, type SaleMoney } from "@/lib/sale-money";
import type { SessionBalanceRow } from "@/lib/sessions-inventory";

export type PackageLedgerEvent = {
  id: string;
  purchase_id: string | null;
  pt_session_id?: string | null;
  event_type: string;
  session_count: number | null;
  source?: string | null;
  related_event_id?: string | null;
  effective_date?: string | null;
  created_at?: string | null;
};

export type PackageSessionRow = {
  id: string;
  session_date: string;
  start_time: string;
  end_time?: string | null;
  status: string;
  uses_credit?: boolean | null;
};

export type PackageSale = MoneySale & {
  term_start_date?: string | null;
  term_end_date?: string | null;
  package_expiry_date?: string | null;
  // How it's paid in Stripe (auto-pay), when it is.
  stripe_subscription_id?: string | null;
  stripe_subscription_status?: string | null;
  stripe_checkout_session_id?: string | null;
  stripe_payment_link?: string | null;
  stripe_payment_intent_id?: string | null;
  cancel_at_period_end?: boolean | null;
  next_billing_date?: string | null;
  installment_amount?: number | string | null;
  payment_frequency?: string | null;
  offer_snapshot?: { source?: string | null } | null;
};

/** Where one session's credit sits: on a package (or none), used or held. */
export type SessionPlace = { purchaseId: string | null; kind: "used" | "held"; at: string };

const n = (v: unknown) => Number(v ?? 0) || 0;
const GIVE_BACK = new Set(["revert_on_uncomplete", "reattribute"]);

/** Every session's current place, from its ledger rows (pt_session_sale_id's rule). */
export function sessionPlaces(events: PackageLedgerEvent[]): Map<string, SessionPlace> {
  const givenBack = new Set<string>();
  const released = new Set<string>();
  for (const e of events) {
    if (!e.related_event_id) continue;
    if (e.event_type === "adjusted" && GIVE_BACK.has(String(e.source ?? ""))) givenBack.add(e.related_event_id);
    if (e.event_type === "released") released.add(e.related_event_id);
  }
  const use = new Map<string, PackageLedgerEvent>();
  const hold = new Map<string, PackageLedgerEvent>();
  const later = (a: PackageLedgerEvent | undefined, b: PackageLedgerEvent) => !a || String(b.created_at ?? "") > String(a.created_at ?? "");
  for (const e of events) {
    const sid = e.pt_session_id;
    if (!sid) continue;
    if (e.event_type === "used" && n(e.session_count) < 0 && !givenBack.has(e.id)) {
      if (later(use.get(sid), e)) use.set(sid, e);
    } else if (e.event_type === "reserved" && n(e.session_count) < 0 && !released.has(e.id)) {
      if (later(hold.get(sid), e)) hold.set(sid, e);
    }
  }
  const out = new Map<string, SessionPlace>();
  for (const sid of new Set([...use.keys(), ...hold.keys()])) {
    const u = use.get(sid);
    const h = hold.get(sid);
    const pick = u && (!h || String(u.created_at ?? "") > String(h.created_at ?? "")) ? u : h!;
    out.set(sid, { purchaseId: pick.purchase_id ?? null, kind: pick === u ? "used" : "held", at: String(pick.created_at ?? "") });
  }
  return out;
}

export type PackageView = {
  id: string;
  /** 1 for the first package the client bought. */
  number: number;
  name: string;
  /** Sessions it holds (what it sold, plus any added to it free). */
  size: number;
  done: number;
  booked: number;
  /** Still to book on it. */
  open: number;
  expired: number;
  /** The sessions on it, oldest first. */
  sessions: PackageSessionRow[];
  /** First and last session on it, else its term. */
  from: string | null;
  to: string | null;
  /** The package's own term (its period), when it has one. */
  termFrom: string | null;
  termTo: string | null;
  /**
   * waiting: nothing granted yet (sessions start once it's paid); active: has
   * sessions to train; finished: every session trained (or expired).
   */
  phase: "waiting" | "active" | "finished";
  money: SaleMoney;
  /** Last day a session on it can be used, when it expires. */
  expiresAt: string | null;
};

/** Sessions trained or booked past every package: the next one, not added yet. */
export type NextPackage = {
  /** The package it renews: the client's latest priced one. */
  fromSaleId: string | null;
  name: string;
  size: number;
  /** One package, before tax and in the dollars the client pays. */
  priceCents: number;
  eachCents: number;
  /** The sessions it holds (up to `size`), oldest first. */
  sessions: PackageSessionRow[];
  done: number;
  booked: number;
  open: number;
  /** A session on it is trained, so it's owed now. */
  owed: boolean;
};

export type SessionPackages = {
  /** Newest first. */
  packages: PackageView[];
  /** The package new bookings draw on: the oldest with sessions to train. */
  currentId: string | null;
  /** One per renewal the sessions past every package fill (usually one), oldest first. */
  next: NextPackage[];
  /** Past every package with no priced package to renew (a drop-in): sessions to sell. */
  unpriced: PackageSessionRow[];
  /** Covered by sessions given free (Adjust / Add free sessions), not by a package. */
  free: PackageSessionRow[];
  totals: {
    done: number;
    booked: number;
    /** Free to book on the packages they have. */
    leftToBook: number;
    /** On packages and renewals, in the dollars the client pays. */
    owedCents: number;
    paidCents: number;
    /** Every amount includes tax (false = before tax, the rate isn't known). */
    taxIncluded: boolean;
  };
};

const byWhen = (a: PackageSessionRow, b: PackageSessionRow) =>
  `${a.session_date}${a.start_time}`.localeCompare(`${b.session_date}${b.start_time}`);

function saleStart(s: PackageSale, opened: string | null): string {
  return String(opened ?? s.term_start_date ?? s.purchased_at ?? s.created_at ?? "").slice(0, 10);
}

/**
 * A Stripe subscription paying session packages (auto-pay). It pays the
 * client's packages in order, the oldest still owed first: its own package,
 * then the pay-later renewals after it, and stops once nothing's owed. That's
 * the database's rule (session_plan_payment_target, which the webhook and the
 * daily sync follow); this projects it forward so the tab can say when each
 * package gets paid.
 */
export type AutoPay = {
  /** The sale the subscription was sold with. */
  saleId: string;
  /** One payment, in the dollars the client pays. */
  eachCents: number;
  /** "2 weeks", "week", "month". */
  per: string | null;
  /** The next charge (null when Stripe hasn't said). */
  next: string | null;
  /** Set to stop at `next` (nothing else is owed, or it was cancelled). */
  ending: boolean;
  /** Per package (sale id): the payments still to come on it and their first and last dates. */
  covers: Map<string, { payments: number; first: string | null; last: string | null }>;
  /** The day the last package owed is paid off on this schedule. */
  paidUpOn: string | null;
};

const LIVE_SUB = new Set(["active", "trialing", "past_due"]);

/** The day after `iso` by one billing period. */
export function addPeriod(iso: string, per: string | null, times = 1): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (per === "month") d.setUTCMonth(d.getUTCMonth() + times);
  else if (per === "year") d.setUTCFullYear(d.getUTCFullYear() + times);
  else d.setUTCDate(d.getUTCDate() + (per === "week" ? 7 : 14) * times);
  return d.toISOString().slice(0, 10);
}

/** Paid by Stripe in its own right (so auto-pay never pays it). */
const paysItself = (s: PackageSale) =>
  !!(s.stripe_subscription_id || s.stripe_checkout_session_id || s.stripe_payment_link || s.stripe_payment_intent_id) ||
  s.offer_snapshot?.source === "booking";

const startOf = (s: PackageSale) => String(s.term_start_date ?? s.purchased_at ?? s.created_at ?? "").slice(0, 10);

export function autoPayPlan(sales: PackageSale[], views: Pick<PackageView, "id" | "money">[], rate: number | null): AutoPay | null {
  const carriers = sales
    .filter((s) => !s.archived_at && n(s.sessions_purchased) > 0 && s.stripe_subscription_id && n(s.installment_amount) > 0)
    .filter((s) => LIVE_SUB.has(String(s.stripe_subscription_status ?? "").toLowerCase()) || String(s.payment_status ?? "") === "Active Subscription")
    .sort((a, b) => startOf(b).localeCompare(startOf(a)));
  const carrier = carriers[0];
  if (!carrier) return null;
  const eachCents = withTax(Math.round(n(carrier.installment_amount) * 100), rate);
  const per = billingPeriod(carrier);
  const next = carrier.next_billing_date ? String(carrier.next_billing_date).slice(0, 10) : null;
  const ending = !!carrier.cancel_at_period_end;
  const covers: AutoPay["covers"] = new Map();
  if (ending || eachCents <= 0) return { saleId: carrier.id, eachCents, per, next, ending, covers, paidUpOn: null };

  const moneyOf = new Map(views.map((v) => [v.id, v.money]));
  const owedOf = (s: PackageSale) => {
    const m = moneyOf.get(s.id);
    return m && (m.state === "left" || m.state === "past_due") ? m.leftCents : 0;
  };
  const onPlan = sales
    .filter((s) => !s.archived_at && n(s.sessions_purchased) > 0)
    .filter((s) => s.id === carrier.id || (!paysItself(s) && startOf(s) >= startOf(carrier)))
    .sort((a, b) => startOf(a).localeCompare(startOf(b)) || String(a.purchased_at ?? "").localeCompare(String(b.purchased_at ?? "")));

  // Whole payments, oldest owed first (a payment never splits across packages).
  let k = 0;
  let paidUpOn: string | null = null;
  for (const s of onPlan) {
    let left = owedOf(s);
    if (left <= 0) continue;
    const first = next ? addPeriod(next, per, k) : null;
    let payments = 0;
    while (left > 0 && payments < 120) {
      left -= eachCents;
      payments += 1;
      k += 1;
    }
    const last = next ? addPeriod(next, per, k - 1) : null;
    covers.set(s.id, { payments, first, last });
    paidUpOn = last;
  }
  return { saleId: carrier.id, eachCents, per, next, ending, covers, paidUpOn };
}

export function buildSessionPackages(input: {
  sales: PackageSale[];
  payments: MoneyLedgerRow[];
  balance: Array<SessionBalanceRow & { opened_on?: string | null }>;
  events: PackageLedgerEvent[];
  sessions: PackageSessionRow[];
  /** The coach's today: a package past its last day has nothing left to book. */
  today?: string;
}): SessionPackages {
  const sales = input.sales.filter((s) => !s.archived_at && n(s.sessions_purchased) > 0);
  const rate = clientTaxRate(sales as any);
  const places = sessionPlaces(input.events);
  const sessionById = new Map(input.sessions.map((s) => [s.id, s]));
  const onSale = new Map<string | null, PackageSessionRow[]>();
  for (const [sid, place] of places) {
    const s = sessionById.get(sid);
    if (!s) continue;
    const list = onSale.get(place.purchaseId) ?? [];
    list.push(s);
    onSale.set(place.purchaseId, list);
  }

  // First session on each package (its start), from the sessions themselves.
  const firstOn = (id: string) => (onSale.get(id) ?? []).map((s) => s.session_date).sort()[0] ?? null;
  const ordered = sales
    .map((s) => ({ s, start: saleStart(s, firstOn(s.id)) }))
    .sort((a, b) => a.start.localeCompare(b.start) || String(a.s.purchased_at ?? "").localeCompare(String(b.s.purchased_at ?? "")));

  let owedCents = 0;
  let paidCents = 0;
  let currentId: string | null = null;
  const views: PackageView[] = ordered.map(({ s }, i) => {
    const b = input.balance.find((r) => r.purchase_id === s.id);
    const done = n(b?.used);
    const booked = n(b?.reserved);
    const expired = n(b?.expired);
    const size = b ? Math.max(n(b.granted) - n((b as { transferred?: number }).transferred), done + booked) : n(s.sessions_purchased);
    const open = b ? Math.max(0, n(b.remaining)) : 0;
    const sessions = [...(onSale.get(s.id) ?? [])].sort(byWhen);
    const phase: PackageView["phase"] = !b || n(b.granted) <= 0 ? "waiting" : open + booked > 0 ? "active" : "finished";
    if (phase === "active" && !currentId) currentId = s.id;
    const money = saleMoney(s, input.payments.filter((p) => p.purchase_id === s.id), rate, { sessionsUsed: done });
    if (money.state === "left" || money.state === "past_due") owedCents += money.leftCents;
    paidCents += money.paidCents;
    const days = sessions.map((x) => x.session_date);
    return {
      id: s.id,
      number: i + 1,
      name: s.offer_name ?? "Session package",
      size,
      done,
      booked,
      open,
      expired,
      sessions,
      from: days[0] ?? s.term_start_date ?? null,
      to: days[days.length - 1] ?? s.term_end_date ?? null,
      termFrom: s.term_start_date ?? null,
      termTo: s.term_end_date ?? null,
      phase,
      money,
      expiresAt: (b?.expires_at ?? s.package_expiry_date ?? null)?.slice(0, 10) ?? null,
    };
  });

  // Past every package: free sessions cover the first of them, the rest are the next package.
  const loose = [...(onSale.get(null) ?? [])].sort((a, b) => {
    const ka = places.get(a.id)!.kind === "used" ? 0 : 1;
    const kb = places.get(b.id)!.kind === "used" ? 0 : 1;
    return ka - kb || byWhen(a, b);
  });
  const looseNet = input.events.filter((e) => !e.purchase_id).reduce((sum, e) => sum + n(e.session_count), 0);
  const uncovered = Math.min(loose.length, Math.max(0, -looseNet));
  const free = loose.slice(0, loose.length - uncovered).sort(byWhen);
  const past = loose.slice(loose.length - uncovered);

  const pkg = latestPackage(sales as any);
  const next: NextPackage[] = [];
  let unpriced: PackageSessionRow[] = [];
  if (pkg && past.length) {
    const eachCents = withTax(pkg.priceCents, rate);
    for (let i = 0; i < past.length; i += pkg.size) {
      const chunk = past.slice(i, i + pkg.size);
      const done = chunk.filter((s) => places.get(s.id)!.kind === "used").length;
      const owed = done > 0;
      if (owed) owedCents += eachCents;
      next.push({
        fromSaleId: (pkg.sale as { id?: string }).id ?? null,
        name: pkg.sale.offer_name ?? "Session package",
        size: pkg.size,
        priceCents: pkg.priceCents,
        eachCents,
        sessions: [...chunk].sort(byWhen),
        done,
        booked: chunk.length - done,
        open: pkg.size - chunk.length,
        owed,
      });
    }
  } else {
    unpriced = [...past].sort(byWhen);
  }

  const booked = views.reduce((t, v) => t + v.booked, 0) + loose.filter((s) => places.get(s.id)!.kind === "held").length;
  const done = views.reduce((t, v) => t + v.done, 0) + loose.filter((s) => places.get(s.id)!.kind === "used").length;
  // Free sessions not used yet are bookable too.
  const freeLeft = Math.max(0, looseNet);
  return {
    packages: [...views].reverse(),
    currentId,
    next,
    unpriced,
    free,
    totals: {
      done,
      booked,
      leftToBook: views.reduce((t, v) => t + (v.phase === "active" && !(input.today && v.expiresAt && v.expiresAt < input.today) ? v.open : 0), 0) + freeLeft,
      owedCents,
      paidCents,
      taxIncluded: rate != null,
    },
  };
}

/** "Aug 10 – Sep 4" (the year only when it isn't this year). */
export function dayRange(from: string | null, to: string | null, thisYear = new Date().getFullYear()): string | null {
  const fmt = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", ...(d.getFullYear() === thisYear ? {} : { year: "numeric" }) });
  };
  const a = fmt(from);
  const b = fmt(to);
  if (a && b) return a === b ? a : `${a} – ${b}`;
  return a ?? b;
}

/** The one thing to do next on a client's sessions (the Sessions tab's one red button). */
export type SessionsNextStep =
  /** Trained or booked past every package: renew it (pay later), then book the rest of it. */
  | { kind: "renew"; next: NextPackage }
  /** Past every package with no priced package to renew: sell them sessions. */
  | { kind: "sell_unpriced"; count: number }
  /** Sessions left to book. */
  | { kind: "book"; left: number; packageNumber: number | null }
  /** Everything on their package is booked; renewing early is there when they want it. */
  | { kind: "all_booked"; through: string | null; canRenew: boolean }
  /** A package is sold but not paid, so its sessions haven't started. */
  | { kind: "waiting_payment"; name: string }
  /** Every session is trained and nothing's booked past it. */
  | { kind: "renew_all_used"; size: number }
  /** No session package yet. */
  | { kind: "sell_first" };

export function sessionsNextStep(m: SessionPackages, hasPriced: boolean, renewSize: number | null): SessionsNextStep {
  if (m.next.length) return { kind: "renew", next: m.next[0] };
  if (m.unpriced.length) return { kind: "sell_unpriced", count: m.unpriced.length };
  const current = m.packages.find((p) => p.id === m.currentId) ?? null;
  if (m.totals.leftToBook > 0) return { kind: "book", left: m.totals.leftToBook, packageNumber: current?.number ?? null };
  if (current && current.booked > 0) {
    const days = m.packages.filter((p) => p.phase === "active").flatMap((p) => p.sessions.map((s) => s.session_date)).sort();
    return { kind: "all_booked", through: days[days.length - 1] ?? null, canRenew: hasPriced };
  }
  const waiting = m.packages.find((p) => p.phase === "waiting" && p.money.state !== "ended");
  if (waiting) return { kind: "waiting_payment", name: waiting.name };
  if (hasPriced && renewSize) return { kind: "renew_all_used", size: renewSize };
  return { kind: "sell_first" };
}
