/**
 * A client's payments laid out in time, the way a coach reads them: what came
 * in, what's overdue, what's due today, what's scheduled and when, and what
 * has no date at all (a balance that needs a schedule). The Billing tab, the
 * Sessions tab's one billing line and their tests all read this, so they
 * never disagree.
 *
 * Dates are only ever real ones, never made up:
 *  - auto-pay (a Stripe subscription paying session packages, oldest owed
 *    first: session_plan_payment_target) steps from Stripe's own next charge
 *    by the subscription's period (autoPayPlan);
 *  - a Stripe plan steps from Stripe's next charge;
 *  - a plan collected by hand steps from its own first payment date, payment
 *    by payment (so a payment recorded moves the rest along);
 *  - anything else left to pay has no date and says it needs a schedule.
 *
 * Money is integer cents in the dollars the client pays (tax included when
 * the client's rate is known: clientTaxRate, never a hard-coded rate). A
 * remaining balance on a plan is not overdue: only a date that passed with
 * nothing paid (or a payment Stripe says failed) is.
 *
 * Pure: callers pass the rows they already loaded.
 */
import { buildBillingSummary, clientTaxRate, type BillingSessionEvent, type RenewalLine, type UnbilledLine } from "@/lib/client-billing-summary";
import { addPeriod, autoPayPlan, type AutoPay, type PackageSale } from "@/lib/session-packages";
import { billingPeriod, saleMoney, type MoneyLedgerRow, type SaleMoney } from "@/lib/sale-money";
import type { SessionBalanceRow } from "@/lib/sessions-inventory";

export type ScheduleSale = PackageSale & {
  first_payment_date?: string | null;
  purchased_at?: string | null;
};

export type DueState =
  /** Stripe says the payment failed. */
  | "failed"
  /** Its date passed and nothing came in. */
  | "overdue"
  /** Auto-pay's date just passed and Stripe hasn't confirmed the charge yet. */
  | "unconfirmed"
  | "due_today"
  | "scheduled";

export type Installment = {
  key: string;
  saleId: string;
  /** "Package 3", or the sale's name. */
  label: string;
  date: string;
  cents: number;
  /** Charged by Stripe on its own (auto-pay, a Stripe plan or subscription). */
  auto: boolean;
  state: DueState;
  /** Which payment of the sale ("2 of 4"), when the sale counts payments. */
  nth: number | null;
  of: number | null;
  /** An open-ended subscription's next charge: never part of what's owed. */
  recurring?: boolean;
};

export type SaleSchedule = {
  saleId: string;
  label: string;
  name: string;
  money: SaleMoney;
  /** How what's left gets paid. */
  how: "auto_pay" | "stripe" | "manual" | "none";
  installments: Installment[];
  /** Left with no date to pay it on: the schedule needs setting up. */
  unscheduledCents: number;
  /** Can the coach set its dates here (collected by hand, nothing in Stripe)? */
  canSetDates: boolean;
};

export type RecurringCharge = {
  saleId: string;
  name: string;
  cents: number;
  per: string | null;
  next: string | null;
  state: "renews" | "cancelling" | "past_due";
};

export type AutoPayStatus = {
  saleId: string;
  state: "on" | "failing" | "ending";
  cents: number;
  per: string | null;
  next: string | null;
  /** Its last scheduled payment. Nothing is paid until it comes in. */
  lastScheduled: string | null;
  /** Owed on its packages that nothing in Stripe will collect (it's ending). */
  uncoveredCents: number;
};

export type ClientPayments = {
  currency: string;
  /** Every amount includes tax (false: the rate isn't known, amounts are before tax). */
  taxIncluded: boolean;
  /** Everything billed and still to pay: overdue + due now + scheduled + no date. */
  outstandingCents: number;
  overdueCents: number;
  /** Due today, or auto-pay Stripe hasn't confirmed yet. */
  dueNowCents: number;
  scheduledCents: number;
  unscheduledCents: number;
  /** What came in, tax included, less refunds. */
  paidCents: number;
  /** The next payment due today or later (an open-ended subscription's included). */
  next: Installment | null;
  /** Failed and overdue, oldest first. */
  overdue: Installment[];
  /** Due today onward, by date (subscriptions' next charges included). */
  upcoming: Installment[];
  /** Sales with money left on them, oldest first. */
  balances: SaleSchedule[];
  recurring: RecurringCharge[];
  /** Payment links or requests nothing's been paid on: not owed yet. */
  waiting: Array<{ saleId: string; name: string; cents: number; since: string | null }>;
  autoPay: AutoPayStatus | null;
  /** Training past every package that no sale bills yet (renew to bill it). */
  notBilled: RenewalLine | UnbilledLine | null;
  /** Each live sale's money as read here (a renewal auto-pay pays is billed), for the sale cards. */
  money: Map<string, SaleMoney>;
};

const n = (v: unknown) => Number(v ?? 0) || 0;
/** Auto-pay late by more than this with no word from Stripe reads as overdue. */
const UNCONFIRMED_GRACE_DAYS = 3;

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a.slice(0, 10)}T12:00:00Z`) - Date.parse(`${b.slice(0, 10)}T12:00:00Z`)) / 86_400_000);

function dueState(date: string, today: string, auto: boolean): DueState {
  if (date === today) return "due_today";
  if (date > today) return "scheduled";
  return auto && dayDiff(today, date) <= UNCONFIRMED_GRACE_DAYS ? "unconfirmed" : "overdue";
}

const startOf = (s: ScheduleSale) => String(s.term_start_date ?? s.purchased_at ?? s.created_at ?? "").slice(0, 10);
const isPackage = (s: ScheduleSale) => n(s.sessions_purchased) > 0;
const LIVE_SUB = new Set(["active", "trialing", "past_due"]);
const liveSub = (s: ScheduleSale) =>
  !!s.stripe_subscription_id && (LIVE_SUB.has(String(s.stripe_subscription_status ?? "").toLowerCase()) || String(s.payment_status ?? "") === "Active Subscription");

/**
 * "Package N" for session packages, numbered oldest first the way the
 * Sessions tab numbers them; other sales keep their own name.
 */
export function saleLabels(sales: ScheduleSale[]): Map<string, string> {
  const pkgs = sales
    .filter((s) => !s.archived_at && isPackage(s))
    .sort((a, b) => startOf(a).localeCompare(startOf(b)) || String(a.purchased_at ?? "").localeCompare(String(b.purchased_at ?? "")));
  const out = new Map<string, string>();
  pkgs.forEach((s, i) => out.set(s.id, `Package ${i + 1}`));
  for (const s of sales) if (!out.has(s.id)) out.set(s.id, s.offer_name ?? "Sale");
  return out;
}

/** Collected by hand: no Stripe subscription, checkout or link of its own. */
const collectedByHand = (s: ScheduleSale) =>
  !s.stripe_subscription_id && !s.stripe_checkout_session_id && !s.stripe_payment_link && !s.stripe_payment_intent_id;

/** One payment on a plan, tax included. */
const eachOf = (s: ScheduleSale, m: SaleMoney) => Math.round(n(s.installment_amount) * 100 * (1 + (m.rate ?? 0)));

function scheduleSale(s: ScheduleSale, m: SaleMoney, label: string, today: string, auto: AutoPay | null, coveredByAutoPay: boolean): SaleSchedule {
  const base = { saleId: s.id, label, name: s.offer_name ?? "Sale", money: m };
  const made = m.plan?.made ?? 0;
  const failed = m.state === "past_due";
  const lay = (dates: string[], each: number, isAuto: boolean): Installment[] => {
    let left = m.leftCents;
    return dates.map((date, i) => {
      const cents = i === dates.length - 1 ? left : Math.min(each, left);
      left -= cents;
      return {
        key: `${s.id}:${i}`,
        saleId: s.id,
        label,
        date,
        cents,
        auto: isAuto,
        state: failed && i === 0 ? "failed" : dueState(date, today, isAuto),
        nth: m.plan ? made + i + 1 : null,
        of: m.plan ? Math.max(m.plan.total, made + dates.length) : null,
      };
    });
  };
  const steps = (from: string, per: string | null, count: number) => Array.from({ length: count }, (_, i) => addPeriod(from, per, i));

  // 1. Auto-pay pays it, oldest owed first, from Stripe's next charge.
  const cover = auto?.covers.get(s.id);
  if (auto && cover && cover.payments > 0 && cover.first) {
    return { ...base, how: "auto_pay", installments: lay(steps(cover.first, auto.per, cover.payments), auto.eachCents, true), unscheduledCents: 0, canSetDates: false };
  }

  const per = billingPeriod(s);
  const each = eachOf(s, m);
  const count = each > 0 ? Math.max(1, Math.ceil(m.leftCents / each)) : 1;

  // 2. Its own Stripe plan: Stripe's next charge, then every period.
  if (liveSub(s) && !s.cancel_at_period_end && m.next?.date) {
    return { ...base, how: "stripe", installments: lay(steps(m.next.date, per, m.plan ? count : 1), each || m.leftCents, true), unscheduledCents: 0, canSetDates: false };
  }

  // 3. Collected by hand on dates the coach set: payment k falls k periods after the first.
  const hand = collectedByHand(s) && !coveredByAutoPay;
  const first = s.first_payment_date ? String(s.first_payment_date).slice(0, 10) : null;
  if (hand && first && (!m.plan || per)) {
    const dates = m.plan ? steps(addPeriod(first, per, made), per, count) : [first];
    return { ...base, how: "manual", installments: lay(dates, m.plan ? each || m.leftCents : m.leftCents, false), unscheduledCents: 0, canSetDates: true };
  }

  // 4. No date anywhere: say so, never guess one.
  return { ...base, how: "none", installments: [], unscheduledCents: m.leftCents, canSetDates: hand && !failed };
}

export function buildClientPayments(input: {
  sales: ScheduleSale[];
  ledger: MoneyLedgerRow[];
  /** session_balance() and the session ledger: training past every package. */
  balance?: SessionBalanceRow[];
  events?: BillingSessionEvent[];
  /** The coach's today (YYYY-MM-DD). */
  today: string;
}): ClientPayments {
  const today = input.today.slice(0, 10);
  const sales = input.sales.filter((s) => !s.archived_at);
  const rate = clientTaxRate(sales as any);
  const labels = saleLabels(sales);
  const usedOn = new Map((input.balance ?? []).map((b) => [b.purchase_id, n(b.used)]));
  const moneyOf = new Map<string, SaleMoney>();
  for (const s of sales) {
    moneyOf.set(s.id, saleMoney(s, input.ledger.filter((l) => l.purchase_id === s.id), rate, { sessionsUsed: usedOn.get(s.id) }));
  }
  const currency = sales.map((s) => moneyOf.get(s.id)!.currency)[0] ?? "CAD";

  const packages = sales.filter(isPackage);
  const viewsOf = () => packages.map((s) => ({ id: s.id, money: moneyOf.get(s.id)! }));
  const first = autoPayPlan(packages, viewsOf(), rate);
  // Packages auto-pay pays (its own and the pay-later ones after it: session_plan_payment_target).
  const carrier = first ? sales.find((s) => s.id === first.saleId) ?? null : null;
  const onPlan = (s: ScheduleSale) =>
    !!carrier && isPackage(s) && (s.id === carrier.id || (collectedByHand(s) && (s as any).offer_snapshot?.source !== "booking" && startOf(s) >= startOf(carrier)));
  // A pay-later renewal its live auto-pay will pay is billed, even before a session on it is trained.
  let rebilled = false;
  if (first && !first.ending) {
    for (const s of packages) {
      if (onPlan(s) && moneyOf.get(s.id)!.state === "waiting") {
        moneyOf.set(s.id, saleMoney(s, input.ledger.filter((l) => l.purchase_id === s.id), rate, { billed: true }));
        rebilled = true;
      }
    }
  }
  // A sale collected by hand with payment dates the coach set is billed on those dates.
  for (const s of sales) {
    if (s.first_payment_date && collectedByHand(s) && moneyOf.get(s.id)!.state === "waiting") {
      moneyOf.set(s.id, saleMoney(s, input.ledger.filter((l) => l.purchase_id === s.id), rate, { billed: true }));
      rebilled = rebilled || isPackage(s);
    }
  }
  const plan = rebilled ? autoPayPlan(packages, viewsOf(), rate) : first;

  const balances: SaleSchedule[] = [];
  const recurring: RecurringCharge[] = [];
  const waiting: ClientPayments["waiting"] = [];
  const subscriptionCharges: Installment[] = [];
  const failedSubs: Installment[] = [];

  for (const s of [...sales].sort((a, b) => startOf(a).localeCompare(startOf(b)))) {
    const m = moneyOf.get(s.id)!;
    const label = labels.get(s.id)!;
    if (m.state === "waiting") {
      waiting.push({ saleId: s.id, name: s.offer_name ?? "Sale", cents: m.leftCents, since: String(s.purchased_at ?? s.created_at ?? "").slice(0, 10) || null });
      continue;
    }
    if (m.kind === "subscription" && (m.state === "renews" || m.state === "cancelling" || m.state === "past_due")) {
      recurring.push({ saleId: s.id, name: s.offer_name ?? "Subscription", cents: m.priceCents, per: m.per, next: m.next?.date ?? null, state: m.state });
      if (m.state === "renews" && m.next?.date) {
        subscriptionCharges.push({ key: `${s.id}:sub`, saleId: s.id, label, date: m.next.date, cents: m.priceCents, auto: !!s.stripe_subscription_id, state: dueState(m.next.date, today, true), nth: null, of: null, recurring: true });
      }
      if (m.state === "past_due") {
        failedSubs.push({ key: `${s.id}:sub`, saleId: s.id, label, date: m.next?.date ?? today, cents: m.priceCents, auto: true, state: "failed", nth: null, of: null });
      }
      continue;
    }
    if ((m.state === "left" || m.state === "past_due") && m.leftCents > 0) {
      const autoOn = plan && !plan.ending ? plan : null;
      balances.push(scheduleSale(s, m, label, today, autoOn, !!autoOn && onPlan(s)));
    }
  }

  const all = balances.flatMap((b) => b.installments);
  const overdue = [...failedSubs, ...all.filter((i) => i.state === "failed" || i.state === "overdue")].sort((a, b) => a.date.localeCompare(b.date));
  const dueNow = all.filter((i) => i.state === "due_today" || i.state === "unconfirmed");
  const scheduled = all.filter((i) => i.state === "scheduled");
  const sum = (xs: Installment[]) => xs.reduce((t, i) => t + i.cents, 0);
  const upcoming = [...dueNow, ...scheduled, ...subscriptionCharges.filter((c) => c.state !== "overdue")]
    .sort((a, b) => a.date.localeCompare(b.date) || Number(!!a.recurring) - Number(!!b.recurring));
  const unscheduledCents = balances.reduce((t, b) => t + b.unscheduledCents, 0);
  const overdueCents = sum(overdue);
  const dueNowCents = sum(dueNow);
  const scheduledCents = sum(scheduled);

  // What came in, less refunds: the ledger, whole.
  const IN = new Set(["payment", "deposit", "legacy_backfill"]);
  const paidCents = input.ledger.reduce((t, l) => {
    if (l.voided) return t;
    if (IN.has(l.txn_type)) return t + n(l.amount_minor);
    if (l.txn_type === "refund" || l.txn_type === "partial_refund") return t - Math.abs(n(l.amount_minor));
    return t;
  }, 0);

  let autoPay: AutoPayStatus | null = null;
  if (plan && carrier) {
    const failing = moneyOf.get(carrier.id)?.state === "past_due" || String(carrier.stripe_subscription_status ?? "").toLowerCase() === "past_due";
    const uncovered = plan.ending
      ? balances.filter((b) => onPlan(sales.find((s) => s.id === b.saleId)!)).reduce((t, b) => t + b.unscheduledCents, 0)
      : 0;
    autoPay = {
      saleId: plan.saleId,
      state: failing ? "failing" : plan.ending ? "ending" : "on",
      cents: plan.eachCents,
      per: plan.per,
      next: plan.next,
      lastScheduled: plan.ending ? null : plan.paidUpOn,
      uncoveredCents: uncovered,
    };
  }

  const billing = input.balance && input.events
    ? buildBillingSummary({ sales: sales as any, ledger: input.ledger as any, balance: input.balance, events: input.events })
    : null;
  const notBilled = (billing?.lines.find((l) => l.kind === "renewal" || l.kind === "unbilled") ?? null) as RenewalLine | UnbilledLine | null;

  return {
    currency,
    taxIncluded: rate != null,
    outstandingCents: overdueCents + dueNowCents + scheduledCents + unscheduledCents,
    overdueCents,
    dueNowCents,
    scheduledCents,
    unscheduledCents,
    paidCents,
    next: upcoming[0] ?? null,
    overdue,
    upcoming,
    balances,
    recurring,
    waiting,
    autoPay,
    notBilled,
    money: moneyOf,
  };
}

/** The one billing line the Sessions tab shows, and how loud to say it. */
export function billingStatusLine(
  p: ClientPayments,
  fmt: (cents: number) => string,
  day: (iso: string) => string,
): { text: string; tone: "error" | "attention" | "neutral" | "done" } {
  if (p.overdueCents > 0) return { text: `Overdue ${fmt(p.overdueCents)}`, tone: "error" };
  const next = p.next;
  const nextText = next ? `${fmt(next.cents)} ${next.state === "due_today" || next.state === "unconfirmed" ? "due today" : `on ${day(next.date)}`}${next.auto ? " by auto-pay" : ""}` : null;
  if (p.outstandingCents > 0) {
    if (p.dueNowCents > 0 && next) return { text: `${nextText} · ${fmt(p.outstandingCents)} left`, tone: next.auto ? "neutral" : "attention" };
    if (p.unscheduledCents > 0 && p.unscheduledCents === p.outstandingCents) return { text: `${fmt(p.outstandingCents)} left · no payment dates set`, tone: "attention" };
    return { text: `${fmt(p.outstandingCents)} left${nextText ? ` · next ${nextText}` : ""}`, tone: "neutral" };
  }
  if (p.notBilled) return { text: "Training past their package isn't billed yet", tone: "attention" };
  if (nextText) return { text: `Paid up · next ${nextText}`, tone: "done" };
  return { text: p.paidCents > 0 ? "Paid up" : "Nothing billed yet", tone: p.paidCents > 0 ? "done" : "neutral" };
}
