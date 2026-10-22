/**
 * A client's balance the way a coach reads it: what they owe in real
 * dollars (GST included), broken into the payments still scheduled on each
 * sale and the renewal their training has started (a package renews in its
 * own size: 16 past Marc's 16 is his next 16, at that package's price).
 *
 * Prices are stored before tax and payments include it. The rate comes from
 * what the client has actually paid (tax / paid before tax), per sale, else
 * the client's own rate, else none (amounts are then "before tax").
 *
 * Pure: callers pass the rows they already loaded.
 */
import type { PurchaseInput } from "@/lib/payment-display";
import { packageRenewal } from "@/lib/client-owed";
import { saleMoney, withTax } from "@/lib/sale-money";
import { isUseReversal, summarizeSessions, type SessionBalanceRow } from "@/lib/sessions-inventory";

export type BillingSale = PurchaseInput & {
  id: string;
  archived_at?: string | null;
  created_at?: string | null;
  sessions_purchased?: number | null;
};

export type BillingLedgerRow = {
  purchase_id?: string | null;
  txn_type: string;
  amount_minor: number | string | null;
  tax_minor?: number | string | null;
  voided?: boolean | null;
};

export type BillingSessionEvent = {
  id: string;
  purchase_id: string | null;
  event_type: string;
  session_count: number | null;
  source?: string | null;
  effective_date?: string | null;
  related_event_id?: string | null;
};

export type SaleOwedLine = {
  kind: "sale";
  id: string;
  name: string;
  /** What's left, tax included when the rate is known. */
  leftCents: number;
  paymentsMade: number | null;
  paymentsTotal: number | null;
  nextPaymentCents: number | null;
  nextDate: string | null;
  /** A payment failed. */
  pastDue: boolean;
  /** Its term, to tell two of the same package apart. */
  from: string | null;
  to: string | null;
};

/** A sale with nothing paid yet: a payment link or request is out. Not owed. */
export type WaitingLine = {
  kind: "waiting";
  id: string;
  name: string;
  cents: number;
  since: string | null;
};

/**
 * The renewal a client's training has started: their latest package again
 * (same sessions, same price). `count` renewals are owed (sessions already
 * trained need them); with count 0 only bookings run past the package, a
 * heads-up that's not owed until the first of them is trained.
 */
export type RenewalLine = {
  kind: "renewal";
  /** The package to renew (Add renewal copies it). */
  fromSaleId: string | null;
  name: string;
  size: number;
  count: number;
  /** One package, tax included when the rate is known. */
  eachCents: number;
  /** One package before tax. */
  priceCents: number;
  totalCents: number;
  trained: number;
  trainedFrom: string | null;
  trainedTo: string | null;
  /** Booked into the renewal(s) owed, and past even those. */
  bookedIn: number;
  bookedAfter: number;
  bookedAfterFrom: string | null;
  bookedAfterTo: string | null;
};

/** Sessions past what was bought when there's no priced package to renew. */
export type UnbilledLine = {
  kind: "unbilled";
  sessions: number;
  from: string | null;
  to: string | null;
  /** Price of one session, tax included when the rate is known. */
  eachCents: number | null;
  totalCents: number;
  /** Bookings ahead that no package covers. */
  booked: number;
  bookedFrom: string | null;
  bookedTo: string | null;
};

export type BillingSummary = {
  owedCents: number;
  lines: Array<SaleOwedLine | RenewalLine | UnbilledLine>;
  /** Payment requests nothing has been paid on yet (not in owedCents). */
  waiting: WaitingLine[];
  /** The next scheduled charge across every sale. */
  next: { cents: number | null; date: string; name: string } | null;
  /** True when every amount includes tax; false = before tax (rate unknown). */
  taxIncluded: boolean;
  /** Paid so far: what was charged (tax included), less refunds. */
  paidCents: number;
  sessions: { bought: number; used: number; booked: number };
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const PAID_TYPES = new Set(["payment", "deposit", "legacy_backfill"]);

/** The client's own rate across every taxed sale (GST 5%, HST 13–15%...). */
export function clientTaxRate(sales: BillingSale[]): number | null {
  let tax = 0;
  let beforeTax = 0;
  for (const s of sales) {
    if (s.archived_at) continue;
    const t = n(s.amount_tax_paid_cents);
    if (t <= 0) continue;
    tax += t;
    beforeTax += n(s.amount_paid_cents) - t;
  }
  return tax > 0 && beforeTax > 0 ? tax / beforeTax : null;
}

function span(dates: Array<string | null | undefined>): { from: string | null; to: string | null } {
  const ds = dates.filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  return { from: ds[0] ?? null, to: ds[ds.length - 1] ?? null };
}

export function buildBillingSummary(input: {
  sales: BillingSale[];
  ledger: BillingLedgerRow[];
  balance: SessionBalanceRow[];
  events: BillingSessionEvent[];
}): BillingSummary {
  const sales = input.sales.filter((s) => !s.archived_at);
  const rate = clientTaxRate(sales);
  const lines: BillingSummary["lines"] = [];
  const waiting: WaitingLine[] = [];
  let next: BillingSummary["next"] = null;

  const usedOn = new Map(input.balance.map((b) => [b.purchase_id, Number(b.used ?? 0)]));
  for (const s of sales) {
    const m = saleMoney(s, input.ledger.filter((l) => l.purchase_id === s.id), rate, { sessionsUsed: usedOn.get(s.id) });
    const name = s.offer_name ?? "Sale";
    if (m.next?.date && (m.state === "renews" || m.state === "left" || m.state === "past_due")) {
      if (!next || m.next.date < next.date) next = { cents: m.next.cents, date: m.next.date, name };
    }
    if (m.state === "waiting") {
      waiting.push({ kind: "waiting", id: s.id, name, cents: m.leftCents, since: (s.purchased_at ?? s.created_at ?? null)?.slice(0, 10) ?? null });
      continue;
    }
    if (m.leftCents <= 0) continue;
    lines.push({
      kind: "sale",
      id: s.id,
      name,
      leftCents: m.leftCents,
      paymentsMade: m.plan ? m.plan.made : null,
      paymentsTotal: m.plan ? m.plan.total : null,
      nextPaymentCents: m.next?.cents ?? null,
      nextDate: m.next?.date ?? null,
      pastDue: m.state === "past_due",
      from: (s as { term_start_date?: string | null }).term_start_date ?? null,
      to: (s as { term_end_date?: string | null }).term_end_date ?? null,
    });
  }

  // Sessions trained past what was bought: the use events no package holds.
  const reversed = new Set(input.events.filter(isUseReversal).map((e) => e.related_event_id).filter(Boolean) as string[]);
  const released = new Set(input.events.filter((e) => e.event_type === "released").map((e) => e.related_event_id).filter(Boolean) as string[]);
  const loose = input.events.filter((e) => !e.purchase_id);
  const byDate = (a: BillingSessionEvent, b: BillingSessionEvent) => String(a.effective_date ?? "").localeCompare(String(b.effective_date ?? ""));
  const looseUsed = loose.filter((e) => e.event_type === "used" && !reversed.has(e.id) && n(e.session_count) < 0).sort(byDate);
  const looseHolds = loose.filter((e) => e.event_type === "reserved" && !released.has(e.id)).sort(byDate);
  const summary = summarizeSessions(input.balance, loose as any);
  const over = summary.overdrawn;
  const renewal = packageRenewal(sales, over, looseHolds.length);
  if (renewal) {
    const each = withTax(renewal.priceCents, rate);
    const trainedSpan = span(looseUsed.slice(-over).map((e) => e.effective_date));
    const afterSpan = span(looseHolds.slice(renewal.bookedIn).map((e) => e.effective_date));
    lines.push({
      kind: "renewal",
      fromSaleId: renewal.fromSaleId,
      name: renewal.name,
      size: renewal.size,
      count: renewal.count,
      eachCents: each,
      priceCents: renewal.priceCents,
      totalCents: each * renewal.count,
      trained: renewal.trained,
      trainedFrom: trainedSpan.from,
      trainedTo: trainedSpan.to,
      bookedIn: renewal.bookedIn,
      bookedAfter: renewal.bookedAfter,
      bookedAfterFrom: afterSpan.from,
      bookedAfterTo: afterSpan.to,
    });
  } else if (over > 0) {
    const usedSpan = span(looseUsed.slice(-over).map((e) => e.effective_date));
    const bookedSpan = span(looseHolds.map((e) => e.effective_date));
    lines.push({
      kind: "unbilled",
      sessions: over,
      from: usedSpan.from,
      to: usedSpan.to,
      eachCents: null,
      totalCents: 0,
      booked: looseHolds.length,
      bookedFrom: bookedSpan.from,
      bookedTo: bookedSpan.to,
    });
  }

  const paidCents = input.ledger.reduce((sum, l) => {
    if (l.voided) return sum;
    if (PAID_TYPES.has(l.txn_type)) return sum + n(l.amount_minor);
    if (l.txn_type === "refund" || l.txn_type === "partial_refund") return sum - Math.abs(n(l.amount_minor));
    return sum;
  }, 0);

  return {
    owedCents: lines.reduce((sum, l) => sum + (l.kind === "sale" ? l.leftCents : l.totalCents), 0),
    lines,
    waiting,
    next,
    taxIncluded: rate != null,
    paidCents,
    sessions: { bought: summary.purchased, used: summary.used, booked: summary.scheduled },
  };
}
