/**
 * What clients owe the business, for the money screens (pure, tested): read
 * client by client from the Billing model (`buildClientPayments`), so the
 * totals here are the sums of what each client's Billing tab shows, with tax,
 * never a second formula. A payment link nobody has paid is not money owed
 * (it's listed apart, as links waiting); a balance on its schedule is not
 * overdue; a balance with no payment dates says so.
 */
import type { ClientPayments, Installment, ScheduleSale } from "@/lib/payment-schedule";
import { serviceOf, type ServiceKey } from "@/lib/books/money-view";
import { addDays } from "@/lib/books/period";

export type ReceivableLine = {
  clientId: string;
  client: string;
  saleId: string;
  label: string;
  outstandingCents: number;
  overdueCents: number;
  dueNowCents: number;
  scheduledCents: number;
  unscheduledCents: number;
  how: "auto_pay" | "stripe" | "manual" | "none" | "subscription";
  next: { date: string; cents: number } | null;
  /** The oldest date a payment on it was missed, when it's overdue. */
  overdueSince: string | null;
};

export type WaitingLine = { clientId: string; client: string; saleId: string; name: string; cents: number; since: string | null };

export type ExpectedLine = { clientId: string; client: string; saleId: string; label: string; date: string; cents: number; auto: boolean; recurring: boolean };

/** A package or plan sold (paid, part paid or billed), by the day it was sold. Payment links nobody paid and subscriptions are left out. */
export type BookedSale = { saleId: string; clientId: string; client: string; date: string; label: string; service: ServiceKey; beforeTaxMinor: number };

export type Receivables = {
  asOf: string;
  outstandingCents: number;
  overdueCents: number;
  dueNowCents: number;
  scheduledCents: number;
  unscheduledCents: number;
  /** Payments due in the next 30 days, subscription renewals included (a forecast, not a debt). */
  expected30Cents: number;
  waitingCents: number;
  lines: ReceivableLine[];
  waiting: WaitingLine[];
  expected: ExpectedLine[];
  booked: BookedSale[];
};

export type ClientBillingRead = {
  clientId: string;
  client: string;
  /** An archived or deactivated client: still owes what they owe, but no new links or sales are counted for them. */
  archived: boolean;
  p: ClientPayments;
  sales: ScheduleSale[];
};

const isMissed = (i: Installment) => i.state === "failed" || i.state === "overdue";
const isNow = (i: Installment) => i.state === "due_today" || i.state === "unconfirmed";

export function receivablesFrom(clients: ClientBillingRead[], today: string): Receivables {
  const lines: ReceivableLine[] = [];
  const waiting: WaitingLine[] = [];
  const expected: ExpectedLine[] = [];
  const booked: BookedSale[] = [];
  const horizon = addDays(today, 30);

  for (const c of clients) {
    const { p } = c;
    for (const b of p.balances) {
      const inst = b.installments;
      const overdue = inst.filter(isMissed);
      const sumOf = (xs: Installment[]) => xs.reduce((t, i) => t + i.cents, 0);
      const overdueCents = sumOf(overdue);
      const dueNowCents = sumOf(inst.filter(isNow));
      const scheduledCents = sumOf(inst.filter((i) => i.state === "scheduled"));
      const next = inst.filter((i) => !isMissed(i)).sort((a, b2) => a.date.localeCompare(b2.date))[0] ?? null;
      lines.push({
        clientId: c.clientId,
        client: c.client,
        saleId: b.saleId,
        label: b.label,
        outstandingCents: overdueCents + dueNowCents + scheduledCents + b.unscheduledCents,
        overdueCents,
        dueNowCents,
        scheduledCents,
        unscheduledCents: b.unscheduledCents,
        how: b.how,
        next: next ? { date: next.date, cents: next.cents } : null,
        overdueSince: overdue.length ? overdue.map((i) => i.date).sort()[0] : null,
      });
    }
    // A failing subscription: its missed charge is overdue, though nothing else is owed on it.
    const listed = new Set(p.balances.map((b) => b.saleId));
    for (const i of p.overdue) {
      if (listed.has(i.saleId)) continue;
      listed.add(i.saleId);
      const same = p.overdue.filter((x) => x.saleId === i.saleId);
      const cents = same.reduce((t, x) => t + x.cents, 0);
      lines.push({
        clientId: c.clientId, client: c.client, saleId: i.saleId, label: i.label, outstandingCents: cents, overdueCents: cents,
        dueNowCents: 0, scheduledCents: 0, unscheduledCents: 0, how: "subscription", next: null, overdueSince: same.map((x) => x.date).sort()[0],
      });
    }
    for (const i of p.upcoming) {
      if (i.date > horizon) continue;
      expected.push({ clientId: c.clientId, client: c.client, saleId: i.saleId, label: i.label, date: i.date, cents: i.cents, auto: i.auto, recurring: !!i.recurring });
    }
    if (c.archived) continue;
    for (const w of p.waiting) waiting.push({ clientId: c.clientId, client: c.client, ...w });
    for (const s of c.sales) {
      const m = p.money.get(s.id);
      if (!m || m.kind === "subscription" || m.kind === "free") continue;
      if (m.state === "waiting" || m.state === "ended") continue;
      const before = Number((s as any).contract_value_cents ?? 0) || Math.round(Number((s as any).full_payable_amount ?? 0) * 100);
      if (before <= 0) continue;
      const date = String(s.purchased_at ?? (s as any).created_at ?? "").slice(0, 10);
      if (!date) continue;
      booked.push({
        saleId: s.id, clientId: c.clientId, client: c.client, date, label: String((s as any).offer_name ?? "Sale"),
        service: serviceOf({ source: "client", product: (s as any).offer_name ?? null }), beforeTaxMinor: before,
      });
    }
  }

  const total = (f: (l: ReceivableLine) => number) => lines.reduce((t, l) => t + f(l), 0);
  lines.sort((a, b) => b.overdueCents - a.overdueCents || b.outstandingCents - a.outstandingCents);
  expected.sort((a, b) => a.date.localeCompare(b.date));
  waiting.sort((a, b) => b.cents - a.cents);
  booked.sort((a, b) => b.date.localeCompare(a.date));
  return {
    asOf: today,
    outstandingCents: total((l) => l.outstandingCents),
    overdueCents: total((l) => l.overdueCents),
    dueNowCents: total((l) => l.dueNowCents),
    scheduledCents: total((l) => l.scheduledCents),
    unscheduledCents: total((l) => l.unscheduledCents),
    expected30Cents: expected.reduce((t, e) => t + e.cents, 0),
    waitingCents: waiting.reduce((t, w) => t + w.cents, 0),
    lines,
    waiting,
    expected,
    booked,
  };
}

/** Sold in a period: booked sales whose day falls in it. */
export function bookedIn(r: Receivables | null | undefined, range: { start: string; end: string }) {
  const rows = (r?.booked ?? []).filter((b) => b.date >= range.start && b.date <= range.end);
  return { rows, minor: rows.reduce((t, b) => t + b.beforeTaxMinor, 0) };
}
