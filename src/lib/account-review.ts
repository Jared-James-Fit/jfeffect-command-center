/**
 * What deactivating, deleting or reactivating an account means for this
 * person, worked out from their records before anything happens: the
 * coach's own billing model (buildClientPayments), their Stripe
 * subscriptions as the sales record them, and their booked sessions. Only
 * what applies is said, and every figure is one the model already shows on
 * Billing (never estimated).
 *
 * It also decides what the server will do (`stop`, `cancel`), so the screen
 * and the action can't disagree: lifecycle.functions.ts works it out again
 * on the server from the database and acts on that, never on the phone's.
 *
 * The rules:
 * - Deactivating stops an open-ended coaching subscription (at the end of the
 *   period: nothing more is charged, nothing is refunded by itself). It can
 *   happen now, or the day the month they've paid for runs out (`paidThrough`).
 * - A session package's payment plan (auto-pay) pays for what they bought
 *   and keeps going unless the coach stops it; stopping never clears what's
 *   owed. Deleting stops every recurring charge.
 * - Unused sessions stay theirs (deleting gives them up, and says so); booked
 *   sessions from the day it takes effect are cancelled with each credit back
 *   on its package, and nothing is rebooked on reactivation.
 * - Reactivating restarts nothing and charges nothing.
 */
import type { ClientPayments } from "@/lib/payment-schedule";
import { billingDay } from "@/lib/date-range";

export type LifecycleKind = "deactivate" | "delete" | "reactivate";
export type LifecycleWho = "self" | "staff";

export type ReviewSale = {
  id: string;
  offer_name?: string | null;
  archived_at?: string | null;
  sessions_purchased?: number | null;
  stripe_subscription_id?: string | null;
  stripe_subscription_status?: string | null;
  payment_status?: string | null;
  cancel_at_period_end?: boolean | null;
  next_billing_date?: string | null;
};

export type ReviewSession = {
  id: string;
  status?: string | null;
  starts_at?: string | null;
  session_date?: string | null;
};

export type ReviewLine = {
  key: string;
  /** stop: something ends · keep: something carries on · owed: money · info: what happens */
  tone: "stop" | "keep" | "owed" | "info";
  title: string;
  body: string;
};

export type SubscriptionAction = {
  saleId: string;
  subscriptionId: string;
  name: string;
  kind: "coaching" | "plan";
};

export type AccountReview = {
  kind: LifecycleKind;
  who: LifecycleWho;
  lines: ReviewLine[];
  /** Deactivating can wait until what's paid for runs out (YYYY-MM-DD), when a coaching subscription is running. */
  paidThrough: string | null;
  /** When it takes effect (YYYY-MM-DD for later, null for now). */
  effective: string | null;
  /** Subscriptions set to stop at the end of their period. */
  stop: SubscriptionAction[];
  /** A package payment plan that keeps going (deactivate); the coach can stop it. */
  autoPay: SubscriptionAction | null;
  /** Booked sessions that get cancelled (their credits go back). */
  cancel: string[];
  /** The verified figures, for the coach's note. */
  facts: {
    outstandingCents: number;
    overdueCents: number;
    unusedSessions: number;
    bookedCancelled: number;
    waitingCents: number;
  };
};

const LIVE = new Set(["active", "trialing", "past_due"]);
const DAY = 86_400_000;
/** How far off a paid month's end can be and still be offered as "when it runs out". */
export const PAID_THROUGH_MAX_DAYS = 45;
/** The coach's day starts at midnight in Manitoba (fixed UTC-5 from Nov 1, 2026). */
export const effectiveInstant = (day: string) => `${day}T00:00:00-05:00`;

export function liveSubscription(s: ReviewSale): boolean {
  if (!s.stripe_subscription_id || s.archived_at) return false;
  const st = String(s.stripe_subscription_status ?? "").toLowerCase();
  return st ? LIVE.has(st) : s.payment_status === "Active Subscription";
}

const subKind = (s: ReviewSale): "coaching" | "plan" => (Number(s.sessions_purchased ?? 0) > 0 ? "plan" : "coaching");

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function dayList(days: string[]): string {
  const shown = days.slice(0, 4).map((d) => billingDay(d) ?? d);
  const more = days.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** The day a coaching subscription's paid period runs out, when one is running and close. */
export function paidThroughDay(sales: ReviewSale[], today: string): string | null {
  const t = today.slice(0, 10);
  const limit = new Date(Date.parse(`${t}T00:00:00Z`) + PAID_THROUGH_MAX_DAYS * DAY).toISOString().slice(0, 10);
  let best: string | null = null;
  for (const s of sales) {
    if (!liveSubscription(s) || subKind(s) !== "coaching") continue;
    if (String(s.stripe_subscription_status ?? "").toLowerCase() === "past_due") continue;
    const d = s.next_billing_date ? String(s.next_billing_date).slice(0, 10) : null;
    if (!d || d <= t || d > limit) continue;
    if (!best || d > best) best = d;
  }
  return best;
}

export function accountReview(input: {
  kind: LifecycleKind;
  who: LifecycleWho;
  /** "Marc" for the coach's wording; ignored for the person themselves. */
  firstName: string;
  payments: ClientPayments;
  sales: ReviewSale[];
  sessions: ReviewSession[];
  /** The coach's today (YYYY-MM-DD) and the moment it is now. */
  today: string;
  now: string;
  /** Deactivating: now, or when what's paid for runs out. */
  when?: "now" | "paid_through";
  /** Deactivating, coach only: stop the package payment plan too. */
  stopAutoPay?: boolean;
  money: (cents: number) => string;
}): AccountReview {
  const { kind, who, payments: p, money } = input;
  const self = who === "self";
  const name = input.firstName.trim() || "They";
  const You = self ? "You" : name;
  const you = self ? "you" : name;
  const your = self ? "your" : "their";
  const Your = self ? "Your" : "Their";
  const lines: ReviewLine[] = [];
  const today = input.today.slice(0, 10);

  const sales = input.sales.filter((s) => !s.archived_at);
  const live = sales.filter(liveSubscription);
  const coachingSubs = live.filter((s) => subKind(s) === "coaching");
  const planSubs = live.filter((s) => subKind(s) === "plan");
  const action = (s: ReviewSale): SubscriptionAction => ({
    saleId: s.id,
    subscriptionId: s.stripe_subscription_id!,
    name: s.offer_name ?? "Subscription",
    kind: subKind(s),
  });

  const paidThrough = kind === "deactivate" ? paidThroughDay(sales, today) : null;
  const effective = kind === "deactivate" && input.when === "paid_through" && paidThrough ? paidThrough : null;
  const from = effective ? Date.parse(effectiveInstant(effective)) : Date.parse(input.now);

  // ---- subscriptions ----
  const stop: SubscriptionAction[] = [];
  let autoPay: SubscriptionAction | null = null;
  if (kind !== "reactivate") {
    for (const s of coachingSubs) {
      const next = s.next_billing_date ? billingDay(String(s.next_billing_date).slice(0, 10)) : null;
      if (s.cancel_at_period_end) {
        lines.push({
          key: `sub:${s.id}`,
          tone: "info",
          title: `${Your} coaching subscription already ends${next ? ` ${next}` : ""}`,
          body: "Nothing more is charged.",
        });
        continue;
      }
      stop.push(action(s));
      const body =
        kind === "delete"
          ? `No more charges.${next ? ` The month already paid for runs to ${next}; nothing is refunded by itself.` : ""}`
          : effective
            ? `Coaching carries on to ${billingDay(effective)}, the end of the month ${self ? "you've" : "they've"} paid for. No more charges after that.`
            : `No more charges.${next ? ` The rest of the month already paid for (to ${next}) isn't refunded by itself${self ? "" : "; refund it from Billing if you agree to"}.` : ""}`;
      lines.push({ key: `sub:${s.id}`, tone: "stop", title: `${Your} coaching subscription stops`, body });
    }

    const auto = p.autoPay;
    const carrier = auto ? planSubs.find((s) => s.id === auto.saleId) ?? null : null;
    const plans = carrier ? [carrier, ...planSubs.filter((s) => s.id !== carrier.id)] : planSubs;
    for (const s of plans) {
      if (s.cancel_at_period_end) continue;
      const stopIt = kind === "delete" || (!self && !!input.stopAutoPay);
      const per = auto && auto.saleId === s.id && auto.per ? ` every ${auto.per}` : "";
      const each = auto && auto.saleId === s.id ? `${money(auto.cents)}${per}` : null;
      if (stopIt) {
        stop.push(action(s));
        lines.push({
          key: `plan:${s.id}`,
          tone: "stop",
          title: `${Your} payment plan stops`,
          body: `No more automatic charges.${p.outstandingCents > 0 ? ` What's left (${money(p.outstandingCents)}) is still owed.` : ""}`,
        });
      } else if (!autoPay) {
        autoPay = action(s);
        lines.push({
          key: `plan:${s.id}`,
          tone: "keep",
          title: `${Your} payment plan keeps going`,
          body: self
            ? `${each ? `${each} ` : ""}until what you bought is paid off. It pays for sessions you already bought, and they stay yours. Ask your coach if you want it stopped.`
            : `${each ? `${each}, ` : ""}paying for the packages ${name} bought. Turn it off below if you've agreed to stop it; what's owed stays owed.`,
        });
      }
    }
  }

  // ---- money owed ----
  if (p.outstandingCents > 0) {
    const parts = [
      p.overdueCents > 0 ? `${money(p.overdueCents)} of it is overdue.` : "",
      kind === "delete"
        ? "Deleting the account doesn't clear it, and the payment records are kept."
        : kind === "deactivate"
          ? "Deactivating doesn't clear it."
          : "",
    ].filter(Boolean);
    lines.push({
      key: "owed",
      tone: "owed",
      title: `${You} still ${self ? "owe" : "owes"} ${money(p.outstandingCents)}`,
      body: parts.join(" ") || "It stays on the payment dates it already has.",
    });
  }
  const waitingCents = p.waiting.reduce((a, w) => a + w.cents, 0);
  if (p.waiting.length > 0 && kind !== "reactivate") {
    const w = p.waiting;
    lines.push({
      key: "waiting",
      tone: "info",
      title: w.length === 1 ? `An unpaid payment link: ${w[0].name}` : `${plural(w.length, "unpaid payment link")}`,
      body: self
        ? `Nothing is owed on ${w.length === 1 ? "it" : "them"} unless ${w.length === 1 ? "it's" : "they're"} paid (${money(waitingCents)}).`
        : `${money(waitingCents)}, not owed unless paid. Archive ${w.length === 1 ? "it" : "them"} from Billing if ${w.length === 1 ? "it's" : "they're"} no longer wanted.`,
    });
  }

  // ---- a coaching term paid up front ----
  for (const c of p.coaching) {
    if (c.kind !== "term" || (c.timing !== "active" && c.timing !== "ending_soon") || !c.end) continue;
    if (kind === "reactivate") continue;
    lines.push({
      key: `term:${c.saleId}`,
      tone: "info",
      title: `${Your} ${c.duration ? `${c.duration.toLowerCase()} of ` : ""}coaching ${kind === "delete" ? "was" : "is"} paid to ${billingDay(c.end, { year: "always" })}`,
      body: self
        ? `${kind === "delete" ? "Deleting" : "Deactivating"} doesn't refund the time left by itself. Talk to your coach about it first.`
        : "Nothing is refunded by itself. Refund it from Billing if you agree to.",
    });
  }

  // ---- sessions ----
  const unused = p.packages
    .filter((pk) => pk.granted && pk.sessions.available > 0 && pk.training !== "cancelled" && pk.training !== "expired")
    .map((pk) => ({ label: pk.label, n: pk.sessions.available, to: pk.to }));
  const unusedSessions = unused.reduce((a, u) => a + u.n, 0);
  if (unusedSessions > 0) {
    const where = unused.length === 1 ? unused[0].label : plural(unused.length, "package");
    const expiry = unused.length === 1 && unused[0].to ? unused[0].to : null;
    lines.push({
      key: "unused",
      tone: kind === "delete" ? "stop" : "keep",
      title: `${plural(unusedSessions, "session")} left on ${where}`,
      body:
        kind === "delete"
          ? `Deleting the account gives ${unusedSessions === 1 ? "it" : "them"} up. ${self ? "Talk to your coach about them first." : "Refund them from Billing if you agree to."}`
          : `${unusedSessions === 1 ? "It stays" : "They stay"} on ${your} account${kind === "reactivate" ? "" : ` for when ${you} ${self ? "come" : "comes"} back`}${expiry ? `, until the package expires ${billingDay(expiry)}` : ""}.`,
    });
  }

  const booked = input.sessions
    .filter((s) => s.status === "Scheduled" && s.starts_at && Date.parse(s.starts_at) >= from)
    .sort((a, b) => Date.parse(a.starts_at!) - Date.parse(b.starts_at!));
  const cancel = kind === "reactivate" ? [] : booked.map((s) => s.id);
  if (cancel.length > 0) {
    const days = booked.map((s) => String(s.session_date ?? s.starts_at).slice(0, 10));
    lines.push({
      key: "booked",
      tone: "stop",
      title: `${plural(cancel.length, "booked session")} ${effective ? `after ${billingDay(effective)} ` : ""}${cancel.length === 1 ? "is" : "are"} cancelled`,
      body: `${dayList(days)}. ${cancel.length === 1 ? "Its credit goes" : "Each credit goes"} back on ${your} package${kind === "delete" ? "" : ", and nothing is rebooked on reactivation"}.`,
    });
  }

  // ---- what happens to the account ----
  if (kind === "deactivate") {
    lines.push({
      key: "account",
      tone: "info",
      title: self ? "Your training and messages stay as they are" : "Their training and chat stay as they are",
      body: self
        ? "Your program, logs, progress and chat are kept. You can't use the app or the Crew until you reactivate, and nothing is sent to you meanwhile."
        : "They can't use the app or the Crew, they come off check-ins, reminders and your lists, and nothing is sent to them. Their program, logs and chat are kept.",
    });
  } else if (kind === "delete") {
    lines.push({
      key: "account",
      tone: "info",
      title: "What's deleted and what's kept",
      body: `After 30 days ${self ? "your" : "their"} training, nutrition, progress, health info, forms, Crew posts and photo are deleted. Payment and session records, ${your} signed agreement and ${your} chat with ${self ? "your coach" : "you"} are kept as business records.`,
    });
  } else {
    lines.push({
      key: "account",
      tone: "info",
      title: "Nothing restarts and nothing is charged",
      body: `No subscription or payment plan starts again, and sessions cancelled while it was off stay cancelled.${self ? " Talk to your coach about what's next." : " Sell a new plan from Billing if they're coming back."}`,
    });
  }

  return {
    kind,
    who,
    lines,
    paidThrough,
    effective,
    stop,
    autoPay,
    cancel,
    facts: {
      outstandingCents: p.outstandingCents,
      overdueCents: p.overdueCents,
      unusedSessions,
      bookedCancelled: cancel.length,
      waitingCents,
    },
  };
}

/** The coach's note in the client's chat (staff only): what happened, with the figures, once. */
export function lifecycleNote(input: {
  event: "deactivated" | "deactivation_scheduled" | "reactivated" | "deletion_requested" | "deletion_withdrawn";
  name: string;
  by: "self" | "coach" | "admin";
  byName?: string | null;
  reason?: string | null;
  review: AccountReview | null;
  money: (cents: number) => string;
  /** The day it takes effect / is deleted (YYYY-MM-DD). */
  day?: string | null;
}): string {
  const { name, review: r, money } = input;
  const who = input.by === "self" ? name : input.byName || "Your team";
  const head = {
    deactivated: input.by === "self" ? `${name} deactivated their account.` : `${who} deactivated ${name}'s account.`,
    deactivation_scheduled:
      input.by === "self"
        ? `${name} asked to deactivate their account on ${billingDay(input.day ?? null) ?? "the end of their paid month"}.`
        : `${who} set ${name}'s account to deactivate on ${billingDay(input.day ?? null) ?? "the end of their paid month"}.`,
    reactivated: input.by === "self" ? `${name} reactivated their account.` : `${who} reactivated ${name}'s account.`,
    deletion_requested:
      input.by === "self"
        ? `${name} asked to delete their account. It's deleted for good on ${billingDay(input.day ?? null, { year: "always" }) ?? "day 30"} unless they restore it.`
        : `${who} deleted ${name}'s account. It's deleted for good on ${billingDay(input.day ?? null, { year: "always" }) ?? "day 30"} unless an admin restores it.`,
    deletion_withdrawn: `${name} took back their deletion request. Their account is restored.`,
  }[input.event];
  const out = [`🔔 ${head}`];
  if (input.reason) out.push(`Why: ${input.reason}`);
  if (r) {
    const f = r.facts;
    const bits: string[] = [];
    if (r.stop.length) bits.push(`Stopped: ${r.stop.map((s) => s.name).join(", ")} (no more charges)`);
    if (r.autoPay) bits.push(`Still running: ${r.autoPay.name}`);
    if (f.outstandingCents > 0) bits.push(`Owed: ${money(f.outstandingCents)}${f.overdueCents > 0 ? ` (${money(f.overdueCents)} overdue)` : ""}`);
    if (f.unusedSessions > 0) bits.push(`Unused sessions: ${f.unusedSessions}`);
    if (f.bookedCancelled > 0) bits.push(`Booked sessions cancelled: ${f.bookedCancelled} (credits back on the package)`);
    if (f.waitingCents > 0) bits.push(`Unpaid links: ${money(f.waitingCents)}`);
    out.push(...bits);
  }
  return out.join("\n");
}
