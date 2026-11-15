/**
 * My Purchases, as the client reads it: pure, tested, and built on the very
 * model the coach's Billing tab reads (buildClientPayments, payment-schedule.ts),
 * so what a client is told they owe, have paid and have left to train always
 * matches the coach's records. Nothing here changes a record.
 *
 * The rules a client page follows:
 * - What's owed is what's left on what they bought (installments due later
 *   included), never an archived or voided sale, never a payment link nobody
 *   has paid yet (that's an action, "Ready to pay"), and never the training
 *   delivered on top of a package's balance (that's part of the balance).
 * - "Action needed" only for something the client can do: pay a link, fix a
 *   card Stripe couldn't charge, or pay a payment that's past its date.
 * - A package says its training and its money apart; a subscription says it
 *   renews; a one-off says it's paid. One word each, never a mixed badge.
 * - A session counts only when the session ledger says it used a credit
 *   (completed, or a late cancel / no-show the coach counted); a booked one
 *   is booked, a cancelled one gave its credit back.
 */
import type { ClientPayments, Installment, PackageAccount, SaleSchedule, ScheduleSale } from "@/lib/payment-schedule";
import { saleLabels } from "@/lib/payment-schedule";
import type { CoachingPlan } from "@/lib/coaching-plan";
import type { MoneyLedgerRow, SaleMoney } from "@/lib/sale-money";
import { orderPackages } from "@/lib/package-view";
import { sessionPlaces, type PackageLedgerEvent } from "@/lib/session-packages";
import type { PaymentStatus, TrainingStatus } from "@/lib/package-status";

export type Tone = "done" | "neutral" | "attention" | "error";

/* ---------------- Words a client reads ---------------- */

export const MY_TRAINING_WORD: Record<TrainingStatus, { text: string; tone: Tone }> = {
  upcoming: { text: "Up next", tone: "neutral" },
  training: { text: "Training now", tone: "neutral" },
  in_progress: { text: "In progress", tone: "neutral" },
  fully_booked: { text: "All booked", tone: "neutral" },
  completed: { text: "Completed", tone: "done" },
  expired: { text: "Expired", tone: "attention" },
  cancelled: { text: "Cancelled", tone: "neutral" },
};

export const MY_PAYMENT_WORD: Record<PaymentStatus, { text: string; tone: Tone }> = {
  paid: { text: "Paid in full", tone: "done" },
  partial: { text: "Partly paid", tone: "neutral" },
  scheduled: { text: "Payment plan", tone: "neutral" },
  due: { text: "Payment due today", tone: "attention" },
  overdue: { text: "Overdue", tone: "error" },
  failed: { text: "Payment failed", tone: "error" },
  unscheduled: { text: "Balance owing", tone: "attention" },
  link_out: { text: "Ready to pay", tone: "attention" },
  free: { text: "Included", tone: "done" },
  cancelled: { text: "Cancelled", tone: "neutral" },
};

/** "Card", "E-transfer", "Cash"… (never a card number). */
export function methodWord(method: string | null | undefined): string {
  const m = String(method ?? "").toLowerCase();
  if (!m || m === "stripe" || m === "credit_card") return "Card";
  if (m === "etransfer") return "E-transfer";
  if (m === "bank_transfer") return "Bank transfer";
  if (m === "credit_balance") return "Account credit";
  if (m === "legacy_backfill" || m === "other") return "Payment";
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/* ---------------- The page ---------------- */

export type MyAction =
  /** A payment link is out and nothing's paid on it yet. */
  | { kind: "pay"; saleId: string; name: string; cents: number }
  /** Stripe couldn't charge their card: they can update it. */
  | { kind: "card"; saleId: string; name: string; cents: number; date: string }
  /** A payment collected by hand is past its date. */
  | { kind: "overdue"; saleId: string; name: string; cents: number; date: string };

export type MyNext = { saleId: string; label: string; cents: number; date: string; auto: boolean; recurring: boolean; state: Installment["state"] };

export type MySummary = {
  /** What they owe on what they bought, due later included (tax included when known). */
  outstandingCents: number;
  overdueCents: number;
  /** Left with no date set: their coach will say when. */
  noDatesCents: number;
  /** Paid all time, less refunds. */
  paidCents: number;
  next: MyNext | null;
  actions: MyAction[];
  /** nothing: no purchases; clear: nothing owed; on_plan: owed, all on schedule; action: something to do. */
  state: "nothing" | "clear" | "on_plan" | "action";
  taxIncluded: boolean;
};

export type MyPackage = {
  kind: "package";
  saleId: string;
  /** "Package 4". */
  label: string;
  name: string;
  now: boolean;
  sessions: PackageAccount["sessions"];
  training: { text: string; tone: Tone };
  payment: { text: string; tone: Tone };
  totalCents: number;
  paidCents: number;
  leftCents: number;
  from: string | null;
  to: string | null;
  boughtOn: string | null;
  renewedFromLabel: string | null;
};

export type MyPlan = { kind: "plan"; saleId: string; plan: CoachingPlan };

/** Anything else still open: a one-off still being paid (a payment link waiting is an action instead). */
export type MyOpen = {
  kind: "open";
  saleId: string;
  name: string;
  payment: { text: string; tone: Tone };
  /** Left to pay (a waiting link: its whole price). */
  leftCents: number;
  paidCents: number;
};

export type MyPast = {
  saleId: string;
  /** "Package 2", or the purchase's name. */
  name: string;
  /** A package's product name under its number. */
  sub: string | null;
  /** "Paid in full · $3,150.00", "Cancelled", "Completed · 16 sessions". */
  line: string;
  date: string | null;
  tone: Tone;
};

export type MyPayment = {
  id: string;
  date: string | null;
  kind: "payment" | "refund";
  cents: number;
  taxCents: number;
  method: string;
  /** Recorded by the coach (e-transfer, cash, another account), not a payment processor. */
  byHand: boolean;
  /** What it was for: "Package 2", "Online Coaching — $130/month". */
  forLabel: string | null;
  saleId: string | null;
  /** A receipt to open, one Stripe can provide when asked, or none. */
  receipt: { kind: "url"; url: string } | { kind: "fetch" } | { kind: "none" };
  note: string | null;
};

export type MyPurchases = {
  summary: MySummary;
  packages: MyPackage[];
  plans: MyPlan[];
  open: MyOpen[];
  past: MyPast[];
  payments: MyPayment[];
  currency: string;
};

/** A client-safe payment row (what the server sends). */
export type MyLedgerRow = MoneyLedgerRow & {
  id: string;
  client_note?: string | null;
  /** Stripe holds a receipt for it that the app hasn't saved yet. */
  receipt_fetchable?: boolean | null;
};

const n = (v: unknown) => Number(v ?? 0) || 0;

export function packageItem(x: PackageAccount, labelOf: (id: string) => string | null): MyPackage {
  return {
    kind: "package",
    saleId: x.saleId,
    label: x.label,
    name: x.name,
    now: x.trainingNow,
    sessions: x.sessions,
    training: MY_TRAINING_WORD[x.training],
    payment: MY_PAYMENT_WORD[x.payment],
    totalCents: x.totalCents,
    paidCents: x.paidCents,
    leftCents: x.balanceCents,
    from: x.from,
    to: x.to,
    boughtOn: x.boughtOn,
    renewedFromLabel: x.renewedFrom ? labelOf(x.renewedFrom.saleId) ?? (x.renewedFrom.number ? `Package ${x.renewedFrom.number}` : null) : null,
  };
}

function summaryOf(p: ClientPayments, sales: ScheduleSale[]): MySummary {
  const name = (id: string) => p.balances.find((b) => b.saleId === id)?.label ?? sales.find((s) => s.id === id)?.offer_name ?? "Your purchase";
  const actions: MyAction[] = [];
  for (const w of p.waiting) actions.push({ kind: "pay", saleId: w.saleId, name: w.name, cents: w.cents });
  for (const i of p.overdue) {
    if (i.state === "failed") actions.push({ kind: "card", saleId: i.saleId, name: name(i.saleId), cents: i.cents, date: i.date });
    else if (!i.auto) actions.push({ kind: "overdue", saleId: i.saleId, name: name(i.saleId), cents: i.cents, date: i.date });
  }
  // A failed subscription charge is its own failed installment (past_due), never twice.
  const seen = new Set<string>();
  const unique = actions.filter((a) => {
    const k = `${a.kind}:${a.saleId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const next = p.next
    ? { saleId: p.next.saleId, label: p.next.label, cents: p.next.cents, date: p.next.date, auto: p.next.auto, recurring: !!p.next.recurring, state: p.next.state }
    : null;
  const live = sales.filter((s) => !s.archived_at);
  const state: MySummary["state"] =
    live.length === 0 ? "nothing"
    : unique.length > 0 ? "action"
    : p.outstandingCents > 0 ? "on_plan"
    : "clear";
  return {
    outstandingCents: p.outstandingCents,
    overdueCents: p.overdueCents,
    noDatesCents: p.unscheduledCents,
    paidCents: p.paidCents,
    next,
    actions: unique,
    state,
    taxIncluded: p.taxIncluded,
  };
}

/** One line for a purchase that's done: what it was and how it ended. */
function pastLine(s: ScheduleSale, m: SaleMoney | undefined, pkg: PackageAccount | undefined, money: (c: number) => string): { line: string; tone: Tone } {
  if (pkg) {
    const t = MY_TRAINING_WORD[pkg.training];
    return { line: `${t.text} · ${pkg.sessions.completed} of ${pkg.sessions.purchased} sessions · ${MY_PAYMENT_WORD[pkg.payment].text}`, tone: t.tone };
  }
  if (!m) return { line: "", tone: "neutral" };
  switch (m.state) {
    case "paid": return { line: `Paid in full · ${money(m.paidCents)}`, tone: "done" };
    case "free": return { line: "Included", tone: "done" };
    case "ended": {
      const raw = String(s.payment_status ?? "").toLowerCase();
      const word = raw === "refunded" ? "Refunded" : m.kind === "subscription" ? "Subscription ended" : "Cancelled";
      return { line: m.paidCents > 0 ? `${word} · ${money(m.paidCents)} paid` : word, tone: "neutral" };
    }
    default: return { line: "", tone: "neutral" };
  }
}

export function myPurchases(input: {
  payments: ClientPayments;
  sales: ScheduleSale[];
  ledger: MyLedgerRow[];
  money: (cents: number) => string;
}): MyPurchases {
  const { payments: p, money } = input;
  const sales = input.sales.filter((s) => !s.archived_at);
  const labels = saleLabels(sales);
  const labelOf = (id: string) => labels.get(id) ?? null;

  // Settled packages (nothing to pay, nothing to train) are past purchases.
  const ordered = orderPackages(p.packages);
  const packages = ordered.open.map((x) => packageItem(x, labelOf));
  const livePlans = p.coaching.filter((c) => c.timing !== "ended");
  const plans: MyPlan[] = livePlans.map((plan) => ({ kind: "plan", saleId: plan.saleId, plan }));

  const pkgOf = new Map(p.packages.map((x) => [x.saleId, x]));
  const inView = new Set<string>([...packages.map((x) => x.saleId), ...plans.map((x) => x.saleId)]);
  // A payment link waiting is its "Ready to pay" action (said once, there); a one-off still being paid stays in view.
  const open: MyOpen[] = [];
  for (const w of p.waiting) inView.add(w.saleId);
  for (const b of p.balances) {
    if (inView.has(b.saleId) || pkgOf.has(b.saleId)) continue;
    const late = b.installments.some((i) => i.state === "failed" || i.state === "overdue");
    const word = b.installments.some((i) => i.state === "failed") ? MY_PAYMENT_WORD.failed
      : late ? MY_PAYMENT_WORD.overdue
      : b.how === "none" ? MY_PAYMENT_WORD.unscheduled
      : b.money.paidCents > 0 ? MY_PAYMENT_WORD.partial
      : MY_PAYMENT_WORD.scheduled;
    open.push({ kind: "open", saleId: b.saleId, name: b.name, payment: word, leftCents: b.money.leftCents, paidCents: b.money.paidCents });
    inView.add(b.saleId);
  }
  const shown = inView;
  const past: MyPast[] = sales
    .filter((s) => !shown.has(s.id))
    .map((s) => {
      const pkg = pkgOf.get(s.id);
      const { line, tone } = pastLine(s, p.money.get(s.id), pkg, money);
      return {
        saleId: s.id,
        name: pkg ? pkg.label : s.offer_name ?? "Purchase",
        sub: pkg ? s.offer_name ?? null : null,
        line,
        tone,
        date: String(s.term_start_date ?? s.purchased_at ?? s.created_at ?? "").slice(0, 10) || null,
      };
    })
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

  return {
    summary: summaryOf(p, sales),
    packages,
    plans,
    open,
    past,
    payments: myPayments(input.ledger, labelOf),
    currency: p.currency,
  };
}

/** Every payment and refund, newest first, with what it was for and its receipt. Voided rows are corrections, never shown. */
export function myPayments(ledger: MyLedgerRow[], labelOf: (saleId: string) => string | null): MyPayment[] {
  const IN = new Set(["payment", "deposit", "legacy_backfill"]);
  const OUT = new Set(["refund", "partial_refund"]);
  return ledger
    .filter((l) => !l.voided && (IN.has(l.txn_type) || OUT.has(l.txn_type)))
    .map((l) => {
      const url = l.receipt_url ?? l.hosted_invoice_url ?? l.invoice_pdf_url ?? null;
      const byHand = l.source === "manual" || l.source === "backfill";
      const receipt: MyPayment["receipt"] = url ? { kind: "url", url } : l.receipt_fetchable ? { kind: "fetch" } : { kind: "none" };
      return {
        id: l.id,
        date: l.transaction_date ? String(l.transaction_date).slice(0, 10) : null,
        kind: OUT.has(l.txn_type) ? ("refund" as const) : ("payment" as const),
        cents: Math.abs(n(l.amount_minor)),
        taxCents: Math.abs(n(l.tax_minor)),
        method: methodWord(l.method),
        byHand,
        forLabel: l.purchase_id ? labelOf(l.purchase_id) : null,
        saleId: l.purchase_id ?? null,
        receipt,
        note: (l.client_note ?? "").trim() || null,
      };
    })
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")) || b.cents - a.cents);
}

/* ---------------- One package's sessions ---------------- */

export type MySessionRow = {
  id: string;
  session_date: string;
  start_time: string;
  status: string;
  title?: string | null;
  location?: string | null;
};

export type MySessionEntry = {
  id: string;
  date: string;
  start: string;
  /** completed / booked / counted (a late cancel or no-show that used it) / returned (cancelled or moved, credit back). */
  kind: "completed" | "booked" | "counted" | "returned";
  label: string;
  tone: Tone;
};

/**
 * The sessions on one package, oldest first: those that used or hold one of
 * its credits (the session ledger's own reading, sessionPlaces), plus those
 * cancelled or moved off it, which gave their credit back and don't count.
 */
export function packageSessionLog(sessions: MySessionRow[], events: PackageLedgerEvent[], saleId: string): MySessionEntry[] {
  const places = sessionPlaces(events);
  const lastOn = new Map<string, PackageLedgerEvent>();
  for (const e of events) {
    if (!e.pt_session_id) continue;
    const prev = lastOn.get(e.pt_session_id);
    if (!prev || String(e.created_at ?? "") >= String(prev.created_at ?? "")) lastOn.set(e.pt_session_id, e);
  }
  const out: MySessionEntry[] = [];
  for (const s of sessions) {
    const place = places.get(s.id);
    const start = String(s.start_time ?? "").slice(0, 5);
    if (place?.purchaseId === saleId) {
      const kind: MySessionEntry["kind"] =
        s.status === "Completed" ? "completed"
        : s.status === "Missed" ? "counted"
        : "booked";
      out.push({
        id: s.id,
        date: String(s.session_date).slice(0, 10),
        start,
        kind,
        label: kind === "completed" ? "Completed" : kind === "counted" ? "Missed · counted" : "Booked",
        tone: kind === "completed" ? "done" : kind === "counted" ? "attention" : "neutral",
      });
      continue;
    }
    if ((s.status === "Cancelled" || s.status === "Rescheduled") && lastOn.get(s.id)?.purchase_id === saleId) {
      out.push({
        id: s.id,
        date: String(s.session_date).slice(0, 10),
        start,
        kind: "returned",
        label: s.status === "Rescheduled" ? "Moved · not counted" : "Cancelled · not counted",
        tone: "neutral",
      });
    }
  }
  // A credit used or held by a session the client can't see (the coach hid it from their calendar):
  // the ledger still says it counts, so it's listed (its day only), or the counts wouldn't add up.
  const seen = new Set(sessions.map((x) => x.id));
  for (const [sid, place] of places) {
    if (seen.has(sid) || place.purchaseId !== saleId) continue;
    const e = lastOn.get(sid);
    const date = String(e?.effective_date ?? place.at ?? "").slice(0, 10);
    if (!date) continue;
    const used = place.kind === "used";
    out.push({ id: sid, date, start: "", kind: used ? "counted" : "booked", label: used ? "Counted · not on your calendar" : "Booked · not on your calendar", tone: "neutral" });
  }
  return out.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
}

/* ---------------- One purchase ---------------- */

export type MyDetail = {
  saleId: string;
  kind: "package" | "plan" | "waiting" | "one_off";
  title: string;
  subtitle: string | null;
  pkg: MyPackage | null;
  account: PackageAccount | null;
  plan: CoachingPlan | null;
  money: SaleMoney | null;
  schedule: SaleSchedule | null;
  /** What's still to pay on it, by date. */
  upcoming: Installment[];
  payments: MyPayment[];
  /** How payments sit against a package's completed sessions, in plain words. */
  coverage: string[] | null;
};

export function purchaseDetail(input: {
  payments: ClientPayments;
  sales: ScheduleSale[];
  ledger: MyLedgerRow[];
  saleId: string;
  money: (cents: number) => string;
}): MyDetail | null {
  const { payments: p, saleId, money } = input;
  const sales = input.sales.filter((s) => !s.archived_at);
  const sale = sales.find((s) => s.id === saleId);
  if (!sale) return null;
  const labels = saleLabels(sales);
  const labelOf = (id: string) => labels.get(id) ?? null;
  const account = p.packages.find((x) => x.saleId === saleId) ?? null;
  const plan = p.coaching.find((c) => c.saleId === saleId) ?? null;
  const waiting = p.waiting.some((w) => w.saleId === saleId);
  const schedule = p.balances.find((b) => b.saleId === saleId) ?? null;
  const kind: MyDetail["kind"] = account ? "package" : waiting ? "waiting" : plan ? "plan" : "one_off";
  const upcoming = [...p.overdue, ...p.upcoming].filter((i) => i.saleId === saleId);
  return {
    saleId,
    kind,
    title: account ? account.label : sale.offer_name ?? "Purchase",
    subtitle: account ? account.name : null,
    pkg: account ? packageItem(account, labelOf) : null,
    account,
    plan,
    money: p.money.get(saleId) ?? null,
    schedule,
    upcoming,
    payments: myPayments(input.ledger.filter((l) => l.purchase_id === saleId), labelOf),
    coverage: account ? myCoverageWords(account, money) : null,
  };
}

/**
 * How a package's payments sit against the sessions done on it, for the
 * client: an even split of its price (never which session a payment was
 * for), and that the unpaid part is the package's balance, not a charge on
 * top of it.
 */
export function myCoverageWords(x: PackageAccount, money: (cents: number) => string): string[] | null {
  const c = x.coverage;
  if (!c || x.sessions.purchased <= 0) return null;
  const done = Math.min(x.sessions.completed, x.sessions.purchased);
  const lines = [`${money(c.perSessionCents)} a session (${money(x.totalCents)} for ${x.sessions.purchased}).`];
  if (done === 0) {
    lines.push(x.paidCents > 0 ? `${money(x.paidCents)} paid so far, ahead of your sessions.` : "No sessions completed on it yet.");
    return lines;
  }
  if (c.unpaid === 0 && c.partCents === 0) {
    lines.push(`Your payments cover all ${done} completed session${done === 1 ? "" : "s"}${c.aheadCents > 0 ? `, with ${money(c.aheadCents)} paid ahead` : ""}.`);
    return lines;
  }
  const covered = c.covered > 0 ? `Your payments so far cover ${c.covered} of the ${done} completed` : `Nothing's been paid on it yet, so the ${done} completed ${done === 1 ? "isn't" : "aren't"} paid for yet`;
  lines.push(c.covered > 0 ? `${covered} (${money(x.paidCents)} paid).` : `${covered}.`);
  lines.push(`That ${money(x.unpaidDeliveredCents)} is part of this package's ${money(x.balanceCents)} balance, paid on its payment dates, never an extra charge.`);
  return lines;
}
