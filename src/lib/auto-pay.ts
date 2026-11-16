/**
 * Changing how a client pays, in the coach's words, decided before anything
 * goes to Stripe (pure, tested; auto-pay.server.ts / auto-pay.functions.ts do
 * the Stripe side).
 *
 * A change of amount, schedule or card is a new subscription the client sets
 * up themselves from a link, never a silent change to the one they agreed to.
 * The current auto-pay keeps going until they finish it, then it's cancelled
 * by the webhook, so there's never a gap and never two. The new one is
 * attached to the package it pays first, never the sale that carries the
 * current one (its cancellation would mark that sale cancelled).
 */
import type { ClientPayments } from "@/lib/payment-schedule";
import { addPeriod } from "@/lib/session-packages";
import { billingPeriod } from "@/lib/sale-money";
import { billingDay } from "@/lib/date-range";

export type Every = "week" | "2 weeks" | "month";
export const EVERY_OPTIONS: Every[] = ["week", "2 weeks", "month"];

/** Stripe's recurring interval for each choice. */
export const EVERY_STRIPE: Record<Every, { interval: "week" | "month"; count: number }> = {
  week: { interval: "week", count: 1 },
  "2 weeks": { interval: "week", count: 2 },
  month: { interval: "month", count: 1 },
};

/** How the sale records it (billingPeriod reads these back). */
export const FREQUENCY_FOR: Record<Every, string> = { week: "weekly", "2 weeks": "biweekly", month: "monthly" };

export const everyWords = (e: Every | string | null) => (e === "week" ? "every week" : e === "month" ? "every month" : "every 2 weeks");

/** "Bi-weekly subscription (every 2 weeks) — 2 payments": the sale's payment structure. */
export function structureText(every: Every, payments: number | null): string {
  const head = every === "week" ? "Weekly subscription (every week)" : every === "month" ? "Monthly subscription" : "Bi-weekly subscription (every 2 weeks)";
  return payments && payments > 0 ? `${head} — ${payments} payment${payments === 1 ? "" : "s"}` : head;
}

/** Whole payments to pay a balance (the last one may be a part payment). */
export const paymentsToCover = (leftCents: number, eachCents: number) =>
  eachCents > 0 && leftCents > 0 ? Math.ceil(leftCents / eachCents) : 0;

/**
 * Stripe Checkout only waits for a first charge at least 48 hours out; a start
 * nearer than `MIN_LEAD_DAYS` charges when they set it up instead (the old
 * auto-pay is stopped then, so nothing is charged twice).
 */
export const MIN_LEAD_DAYS = 3;
export function stripeFirstCharge(firstDate: string | null, today: string): string | null {
  if (!firstDate) return null;
  const lead = (Date.parse(`${firstDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000;
  return lead >= MIN_LEAD_DAYS ? firstDate : null;
}

/** One reusable Stripe price per product, amount and schedule. */
export const priceLookupKey = (product: string, eachCents: number, every: Every) =>
  `jf_autopay_${product}_${eachCents}_${every.replace(" ", "")}`;

/** With tax, from before tax and back (a rate unknown means no tax on file). */
export const withTax = (cents: number, rate: number | null) => Math.round(cents * (1 + (rate ?? 0)));
export const beforeTax = (cents: number, rate: number | null) => Math.round(cents / (1 + (rate ?? 0)));

export type AutoPaySale = {
  id: string;
  archived_at?: string | null;
  sessions_purchased?: number | null;
  stripe_subscription_id?: string | null;
  stripe_subscription_status?: string | null;
  stripe_checkout_session_id?: string | null;
  stripe_payment_link?: string | null;
  stripe_payment_intent_id?: string | null;
  payment_status?: string | null;
  installment_amount?: number | string | null;
  payment_frequency?: string | null;
  payment_structure?: string | null;
  next_billing_date?: string | null;
  cancel_at_period_end?: boolean | null;
  offer_snapshot?: { source?: string | null } | null;
};

export type AutoPayCurrent = {
  saleId: string;
  subscriptionId: string;
  /** One payment before tax and with it. */
  eachCents: number;
  eachWithTaxCents: number;
  every: Every;
  next: string | null;
  ending: boolean;
  failing: boolean;
};

export type AutoPayTarget = { saleId: string; label: string; leftCents: number };

export type AutoPayOptions = {
  current: AutoPayCurrent | null;
  /** Packages a new auto-pay can be attached to: owed, and paid by nothing of their own. */
  targets: AutoPayTarget[];
  target: string | null;
  /** Each payment with tax, how often, and the first charge, to start the form. */
  eachWithTaxCents: number;
  every: Every;
  firstDate: string;
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const LIVE = new Set(["active", "trialing", "past_due"]);
const asEvery = (per: string | null): Every => (per === "week" ? "week" : per === "month" ? "month" : "2 weeks");

const paysItself = (s: AutoPaySale) =>
  !!(s.stripe_subscription_id || s.stripe_checkout_session_id || s.stripe_payment_link || s.stripe_payment_intent_id) ||
  s.offer_snapshot?.source === "booking";

/** The package auto-pay running now (the Billing model's own carrier), with its Stripe subscription. */
export function currentAutoPay(p: ClientPayments, sales: AutoPaySale[], rate: number | null): AutoPayCurrent | null {
  const a = p.autoPay;
  if (!a) return null;
  const s = sales.find((x) => x.id === a.saleId);
  if (!s?.stripe_subscription_id) return null;
  const status = String(s.stripe_subscription_status ?? "").toLowerCase();
  if (status && !LIVE.has(status) && s.payment_status !== "Active Subscription") return null;
  const each = Math.round(n(s.installment_amount) * 100);
  return {
    saleId: s.id,
    subscriptionId: s.stripe_subscription_id,
    eachCents: each,
    eachWithTaxCents: withTax(each, rate),
    every: asEvery(billingPeriod(s)),
    next: s.next_billing_date ? String(s.next_billing_date).slice(0, 10) : null,
    ending: !!s.cancel_at_period_end,
    failing: status === "past_due" || a.state === "failing",
  };
}

/** What the "Change auto-pay" / "Set up auto-pay" sheet starts from. */
export function autoPayOptions(input: {
  p: ClientPayments;
  sales: AutoPaySale[];
  rate: number | null;
  today: string;
  /** A package the coach opened it from. */
  preferSaleId?: string | null;
}): AutoPayOptions {
  const { p, sales, rate, today } = input;
  const current = currentAutoPay(p, sales, rate);
  const saleOf = new Map(sales.map((s) => [s.id, s]));
  const targets: AutoPayTarget[] = p.packages
    .filter((pk) => pk.balanceCents > 0 && pk.payment !== "cancelled" && pk.payment !== "free")
    .filter((pk) => {
      const s = saleOf.get(pk.saleId);
      if (!s || s.archived_at || n(s.sessions_purchased) <= 0) return false;
      if (current && s.id === current.saleId) return false;
      return !paysItself(s);
    })
    .map((pk) => ({ saleId: pk.saleId, label: pk.label, leftCents: pk.balanceCents }));
  const target =
    (input.preferSaleId && targets.some((t) => t.saleId === input.preferSaleId) ? input.preferSaleId : null) ??
    targets[0]?.saleId ??
    null;
  const firstDate =
    current?.next && current.next > today
      ? current.next
      : addPeriod(today, "week");
  return {
    current,
    targets,
    target,
    eachWithTaxCents: current?.eachWithTaxCents ?? 0,
    every: current?.every ?? "2 weeks",
    firstDate,
  };
}

/** Why a change can't be sent, in the coach's words (null = fine). */
export function changeProblem(input: {
  eachWithTaxCents: number;
  firstDate: string | null;
  today: string;
  target: AutoPayTarget | null;
}): string | null {
  if (!input.target) return "Pick the package it pays first. To add one, renew their package.";
  if (!(input.eachWithTaxCents >= 100)) return "Enter how much each payment is.";
  if (input.eachWithTaxCents > input.target.leftCents * 4 && input.eachWithTaxCents > 100_000)
    return "That's more than the whole package. Check the amount.";
  if (!input.firstDate) return "Pick the day of the first payment.";
  if (input.firstDate < input.today) return "The first payment can't be in the past.";
  return null;
}

/** The plan in one sentence (the sheet's preview, the coach's note). */
export function changeSentence(input: {
  eachWithTaxCents: number;
  every: Every;
  firstDate: string | null;
  today: string;
  target: AutoPayTarget;
  current: AutoPayCurrent | null;
  money: (cents: number) => string;
}): string {
  const first = stripeFirstCharge(input.firstDate, input.today);
  const payments = paymentsToCover(input.target.leftCents, input.eachWithTaxCents);
  const when = first ? `from ${billingDay(first)}` : "starting the day it's set up";
  const head = `${input.money(input.eachWithTaxCents)} ${everyWords(input.every)} ${when}, paying ${input.target.label} (${input.money(input.target.leftCents)}) in ${payments} payment${payments === 1 ? "" : "s"}. It stops once nothing's owed, unless you add their next package.`;
  const old = input.current
    ? ` The ${input.money(input.current.eachWithTaxCents)} auto-pay keeps going until they set this up, then it stops.`
    : "";
  return head + old;
}

/** The client's chat message with the link. */
export function setupMessage(input: {
  firstName: string | null;
  eachWithTaxCents: number;
  every: Every;
  firstDate: string | null;
  today: string;
  replacing: AutoPayCurrent | null;
  url: string;
  money: (cents: number) => string;
}): string {
  const hey = input.firstName ? `Hey ${input.firstName.split(/\s+/)[0]}!` : "Hey!";
  const first = stripeFirstCharge(input.firstDate, input.today);
  const plan = `${input.money(input.eachWithTaxCents)} ${everyWords(input.every)}${first ? `, starting ${billingDay(first)}` : ""}`;
  const lines = [
    `${hey} Here's the link to set up your new auto-pay: ${plan} (tax included).`,
    "",
    input.url,
    "",
    input.replacing
      ? `Your current ${input.money(input.replacing.eachWithTaxCents)} payments stop as soon as this is set up, so you're never charged twice.`
      : first
        ? `It takes a minute, and nothing is charged until ${billingDay(first)}.`
        : "It takes a minute. The first payment is taken when you set it up.",
  ];
  return lines.join("\n");
}

/**
 * The payment that keeps pace with their training: the package's price (with
 * tax) spread over its own length, per period. A 16-session package over 4
 * weeks at $672 is $336 every 2 weeks. Null without both dates.
 */
export function paceAmount(input: { totalWithTaxCents: number; from: string | null | undefined; to: string | null | undefined; every: Every }): number | null {
  const { from, to } = input;
  if (!from || !to || input.totalWithTaxCents <= 0) return null;
  const days = Math.round((Date.parse(`${String(to).slice(0, 10)}T12:00:00Z`) - Date.parse(`${String(from).slice(0, 10)}T12:00:00Z`)) / 86_400_000) + 1;
  if (!(days >= 7)) return null;
  const per = input.every === "week" ? 7 : input.every === "2 weeks" ? 14 : 365.25 / 12;
  return Math.round((input.totalWithTaxCents * per) / days);
}
