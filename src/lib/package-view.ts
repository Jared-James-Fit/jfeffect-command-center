/**
 * What a coach reads about a client's session packages at a glance, worked
 * out once from the payments model (payment-schedule.ts) so the Summary,
 * Sessions and Billing tabs say exactly the same thing:
 *
 *  - packageGlance: the package being trained now and the package being
 *    paid off now (they're often different), each in a few words;
 *  - orderPackages: the package list's order: the one being trained, then
 *    the ones with money left, then the settled ones (folded), each group in
 *    the order they were bought, so the renewal chronology still reads;
 *  - paymentPlans: each way money comes in (one auto-pay pays packages one at
 *    a time, oldest owed first) and which packages it pays, when;
 *  - coverageWords: how a package's payments cover its completed sessions,
 *    said in plain words with the arithmetic already done.
 *
 * Pure: no React, no database.
 */
import type { ClientPayments, Installment, PackageAccount, SaleSchedule } from "@/lib/payment-schedule";
import type { PaymentStatus, TrainingStatus } from "@/lib/package-status";

/* ---------------- The glance ---------------- */

export type TrainingGlance =
  | {
      kind: "package";
      saleId: string;
      label: string;
      name: string;
      from: string | null;
      to: string | null;
      /** The one being trained now (false: the last package, everything on it trained). */
      now: boolean;
      status: TrainingStatus;
      /** Nothing left to book, sessions still booked. */
      fullyBooked: boolean;
      completed: number;
      booked: number;
      available: number;
      expired: number;
      size: number;
    }
  /** Trained past every package, and that training isn't billed yet. */
  | { kind: "past"; trained: number; afterLabel: string | null }
  | { kind: "none" };

export type PayingGlance =
  | {
      kind: "plan";
      saleId: string;
      label: string;
      from: string | null;
      to: string | null;
      status: PaymentStatus;
      paidCents: number;
      totalCents: number;
      leftCents: number;
      next: Installment;
      /** The packages the same auto-pay pays after this one. */
      then: string[];
      /** Other payment plans running at the same time (overlapping), beyond this one. */
      more: number;
    }
  /** Money left with no payment dates on it. */
  | { kind: "unscheduled"; saleId: string; label: string; leftCents: number; packages: number }
  /** Nothing left to pay on a package (a subscription's next charge may still come). */
  | { kind: "paid_up"; nextCharge: Installment | null }
  /** Never billed anything. */
  | { kind: "nothing" };

export type Glance = { training: TrainingGlance; paying: PayingGlance };

const byNumber = (a: PackageAccount, b: PackageAccount) => a.number - b.number;

export function packageGlance(p: ClientPayments): Glance {
  const pkgs = [...p.packages].sort(byNumber);
  const now = pkgs.find((x) => x.saleId === p.trainingNowId) ?? null;
  // Nothing left to train: the last package that was trained, unless training ran past it.
  const last = [...pkgs].reverse().find((x) => x.granted && x.state !== "ended") ?? null;
  let training: TrainingGlance;
  if (now || (last && !p.notBilled)) {
    const x = (now ?? last)!;
    const s = x.sessions;
    training = {
      kind: "package",
      saleId: x.saleId,
      label: x.label,
      name: x.name,
      from: x.from,
      to: x.to,
      now: !!now,
      status: x.training,
      fullyBooked: !!now && s.available === 0 && s.booked > 0,
      completed: s.completed,
      booked: s.booked,
      available: s.available,
      expired: s.expired,
      size: Math.max(s.purchased, s.completed + s.booked + s.available + s.expired),
    };
  } else if (p.notBilled) {
    const trained = p.notBilled.kind === "renewal" ? p.notBilled.trained : p.notBilled.sessions;
    training = { kind: "past", trained, afterLabel: last?.label ?? null };
  } else {
    training = { kind: "none" };
  }

  let paying: PayingGlance;
  const first = p.payingNow[0];
  if (first) {
    const acc = pkgs.find((x) => x.saleId === first.saleId) ?? null;
    const bal = p.balances.find((b) => b.saleId === first.saleId) ?? null;
    paying = {
      kind: "plan",
      saleId: first.saleId,
      label: first.label,
      from: acc?.from ?? null,
      to: acc?.to ?? null,
      status: acc?.payment ?? statusOf(first.next, (bal?.money.paidCents ?? 0) > 0),
      paidCents: acc?.paidCents ?? bal?.money.paidCents ?? 0,
      totalCents: acc?.totalCents ?? bal?.money.priceCents ?? 0,
      leftCents: acc?.balanceCents ?? bal?.money.leftCents ?? 0,
      next: first.next,
      then: first.then.map((t) => t.label),
      more: p.payingNow.length - 1,
    };
  } else {
    const undated = p.balances.filter((b) => b.how === "none" && b.unscheduledCents > 0);
    if (undated.length) {
      paying = {
        kind: "unscheduled",
        saleId: undated[0].saleId,
        label: undated[0].label,
        leftCents: undated.reduce((t, b) => t + b.unscheduledCents, 0),
        packages: undated.length,
      };
    } else if (p.paidCents > 0 || p.recurring.length > 0) {
      paying = { kind: "paid_up", nextCharge: p.upcoming.find((i) => i.recurring) ?? null };
    } else {
      paying = { kind: "nothing" };
    }
  }
  return { training, paying };
}

function statusOf(i: Installment, partlyPaid: boolean): PaymentStatus {
  if (i.state === "failed") return "failed";
  if (i.state === "overdue") return "overdue";
  if (i.state === "due_today" || i.state === "unconfirmed") return "due";
  return partlyPaid ? "partial" : "scheduled";
}

/** "today", "Fri, Nov 27", "overdue since Fri, Nov 13", "failed". */
export function dueWords(i: Installment, day: (iso: string) => string): string {
  if (i.state === "failed") return "failed";
  if (i.state === "overdue") return `overdue since ${day(i.date)}`;
  if (i.state === "due_today" || i.state === "unconfirmed") return "today";
  return day(i.date);
}

/* ---------------- The package list's order ---------------- */

/** Nothing left to pay and nothing left to train: folded away. */
export function settledPackage(x: PackageAccount): boolean {
  return (
    !x.trainingNow &&
    x.balanceCents === 0 &&
    x.unpaidDeliveredCents === 0 &&
    x.sessions.booked === 0 &&
    x.sessions.available === 0 &&
    x.state !== "past_due" &&
    x.state !== "waiting"
  );
}

/**
 * The one being trained now, then every package with money left on it, then
 * anything else still open; the settled ones apart, to be folded. Each group
 * keeps the order they were bought (their numbers).
 */
export function orderPackages(packages: PackageAccount[]): { open: PackageAccount[]; settled: PackageAccount[] } {
  const all = [...packages].sort(byNumber);
  const settled = all.filter(settledPackage);
  const rest = all.filter((x) => !settledPackage(x));
  const rank = (x: PackageAccount) => (x.trainingNow ? 0 : x.balanceCents > 0 || x.unpaidDeliveredCents > 0 ? 1 : 2);
  const open = [...rest].sort((a, b) => rank(a) - rank(b) || a.number - b.number);
  return { open, settled };
}

/* ---------------- Payment plans: how money comes in, and to which package ---------------- */

export type PlanStep = { saleId: string; label: string; payments: number; first: string; last: string; cents: number };

export type PaymentPlan = {
  key: string;
  how: "auto_pay" | "stripe" | "manual";
  /** One payment, in the dollars the client pays. */
  eachCents: number;
  /** The packages it pays, in the order it pays them. */
  steps: PlanStep[];
  /** Its last scheduled payment (nothing is paid until it comes in). */
  ends: string | null;
  /** Something on it failed or is overdue. */
  late: boolean;
};

/**
 * Every payment plan with money still to come: one auto-pay is one plan that
 * pays packages one after another (oldest owed first); a Stripe plan or one
 * collected by hand is its own. Read from the installments the payments model
 * already laid out, so the dates are the real ones.
 */
export function paymentPlans(balances: SaleSchedule[]): PaymentPlan[] {
  const groups = new Map<string, SaleSchedule[]>();
  for (const b of balances) {
    if (b.how === "none" || b.installments.length === 0) continue;
    const key = b.how === "auto_pay" ? "auto_pay" : `sale:${b.saleId}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const plans: PaymentPlan[] = [];
  for (const [key, list] of groups) {
    const steps = list
      .map((b) => {
        const dates = b.installments.map((i) => i.date).sort();
        return {
          saleId: b.saleId,
          label: b.label,
          payments: b.installments.length,
          first: dates[0],
          last: dates[dates.length - 1],
          cents: b.installments.reduce((t, i) => t + i.cents, 0),
        };
      })
      .sort((a, b) => a.first.localeCompare(b.first));
    const all = list.flatMap((b) => b.installments);
    const each = all.reduce((m, i) => Math.max(m, i.cents), 0);
    plans.push({
      key,
      how: list[0].how as PaymentPlan["how"],
      eachCents: each,
      steps,
      ends: steps.length ? steps[steps.length - 1].last : null,
      late: all.some((i) => i.state === "failed" || i.state === "overdue"),
    });
  }
  return plans.sort((a, b) => (a.steps[0]?.first ?? "").localeCompare(b.steps[0]?.first ?? ""));
}

/* ---------------- How payments cover a package's sessions, in words ---------------- */

/**
 * The coverage split said plainly, the arithmetic done: "$42.00 a session
 * ($672.00 for 16). The $504.00 paid covers 12 of its 16 completed sessions;
 * 4 aren't paid for yet ($168.00)." Null when the package has no price to
 * share out.
 */
export function coverageWords(x: PackageAccount, money: (cents: number) => string): string[] | null {
  const c = x.coverage;
  if (!c) return null;
  const done = Math.min(x.sessions.completed, x.sessions.purchased);
  const lines = [`${money(c.perSessionCents)} a session (${money(x.totalCents)} for ${x.sessions.purchased}).`];
  if (done === 0) {
    lines.push(x.paidCents > 0 ? `${money(x.paidCents)} paid ahead; no sessions completed yet.` : "No sessions completed yet.");
    return lines;
  }
  const paid = x.paidCents > 0 ? `The ${money(x.paidCents)} paid` : "A credit on it";
  if (c.unpaid === 0 && c.partCents === 0) {
    lines.push(`${paid} covers all ${done} completed session${done === 1 ? "" : "s"}.`);
  } else {
    const notPaid = c.unpaid + (c.partCents > 0 ? 1 : 0);
    const covers = c.covered > 0 ? `covers ${c.covered} of the ${done} completed` : `covers none of the ${done} completed`;
    lines.push(
      x.paidCents > 0
        ? `${paid} ${covers}; ${notPaid} ${notPaid === 1 ? "isn't" : "aren't"} paid for yet (${money(x.unpaidDeliveredCents)}).`
        : `Nothing paid yet, so the ${done} completed (${money(x.unpaidDeliveredCents)}) ${done === 1 ? "isn't" : "aren't"} paid for yet.`,
    );
    if (c.partCents > 0) lines.push(`One of them is part paid (${money(c.partCents)} of ${money(c.perSessionCents)}).`);
  }
  if (c.aheadCents > 0) lines.push(`${money(c.aheadCents)} is paid ahead of the training so far.`);
  if (x.sessions.booked > 0) lines.push(`Booked sessions aren't counted until they're done.`);
  return lines;
}
