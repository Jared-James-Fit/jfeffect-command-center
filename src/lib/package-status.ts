/**
 * Two things about every session package, read on their own: where its
 * TRAINING stands (upcoming, being trained now, fully booked, completed,
 * expired, cancelled) and where its MONEY stands (paid in full, partly paid,
 * scheduled, due, overdue, failed, no schedule). They're independent: Marc
 * trains on Package 4 while his auto-pay is still paying off Package 2, so
 * the package he's training on and the one receiving the next payment are
 * found separately and never assumed to be the newest.
 *
 * Training now: the lowest-numbered package with sessions still to train
 * (booked, or available to book), the same package new bookings draw on.
 *
 * Paying now: per payment stream, the package its next payment goes to. One
 * auto-pay pays packages one at a time, oldest owed first, so it has one
 * package paying now and the rest queued behind it; every Stripe plan or
 * plan collected by hand is a stream of its own, so two plans running at
 * once are both paying now, never one picked arbitrarily.
 *
 * Coverage: payments are recorded on the package, never on a session, so
 * which completed sessions are "paid for" is an accounting split for display
 * only: the package's price spread evenly over the sessions it sold, the
 * payments on it applied to its completed sessions in order. It reads the
 * same numbers as unpaid training delivered (payment-schedule.ts), so the
 * grid and the dollar amount always agree, and a booked session is never
 * counted as delivered (paid ahead is said as money).
 *
 * Pure: no database, no dates of its own.
 */
import type { SaleState } from "@/lib/sale-money";

/* ---------------- Training ---------------- */

export type TrainingStatus =
  | "upcoming"
  | "training"
  /** Sessions trained and some left to book, while an earlier package is the one being trained. */
  | "in_progress"
  | "fully_booked"
  | "completed"
  | "expired"
  | "cancelled";

export const TRAINING_STATUS_LABEL: Record<TrainingStatus, string> = {
  upcoming: "Upcoming",
  training: "Currently training",
  in_progress: "In progress",
  fully_booked: "Fully booked",
  completed: "Training completed",
  expired: "Expired",
  cancelled: "Cancelled",
};

export type SessionCounts = {
  /** Sessions it sold. */
  purchased: number;
  /** Completed, or a no-show that counted. */
  completed: number;
  booked: number;
  /** Still to book (0 once it's past its use-by date). */
  available: number;
  /** Never used and past its use-by date. */
  expired: number;
};

export function trainingStatus(
  s: SessionCounts,
  o: { trainingNow: boolean; granted: boolean; cancelled: boolean },
): TrainingStatus {
  if (o.cancelled) return s.purchased > 0 && s.completed >= s.purchased ? "completed" : "cancelled";
  // Not paid for yet (a payment link out): its sessions start once it's paid.
  if (!o.granted) return "upcoming";
  const toTrain = s.booked + s.available;
  if (toTrain <= 0) return s.expired > 0 ? "expired" : "completed";
  if (o.trainingNow) return "training";
  if (s.available <= 0) return "fully_booked";
  return s.completed > 0 ? "in_progress" : "upcoming";
}

/** The package being trained now: the lowest-numbered one with sessions still to train. */
export function pickTrainingNow<T extends { id: string; number: number; granted: boolean; cancelled?: boolean; booked: number; available: number }>(xs: T[]): string | null {
  const live = xs.filter((x) => x.granted && !x.cancelled && x.booked + x.available > 0).sort((a, b) => a.number - b.number);
  return live[0]?.id ?? null;
}

/* ---------------- Money ---------------- */

export type PaymentStatus =
  | "paid"
  /** Some paid, the rest on a schedule. */
  | "partial"
  /** Nothing paid yet, all of it on a schedule. */
  | "scheduled"
  /** A payment is due today (or auto-pay's just ran and Stripe hasn't confirmed it). */
  | "due"
  | "overdue"
  | "failed"
  /** Money left with no dates to pay it on. */
  | "unscheduled"
  /** A payment link is out and nothing's paid: not owed yet. */
  | "link_out"
  | "free"
  | "cancelled";

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: "Paid in full",
  partial: "Partially paid",
  scheduled: "Payment scheduled",
  due: "Payment due",
  overdue: "Overdue",
  failed: "Payment failed",
  unscheduled: "No payment schedule",
  link_out: "Payment link sent",
  free: "Free",
  cancelled: "Cancelled",
};

export type StatusTone = "done" | "neutral" | "attention" | "error";

/** Green for done, red for money that didn't come in, amber for what needs the coach. A payment auto-pay takes today needs nobody. */
export function paymentStatusTone(status: PaymentStatus, auto = false): StatusTone {
  switch (status) {
    case "paid":
      return "done";
    case "overdue":
    case "failed":
      return "error";
    case "unscheduled":
      return "attention";
    case "due":
      return auto ? "neutral" : "attention";
    default:
      return "neutral";
  }
}

type InstallmentLike = { date: string; state: "failed" | "overdue" | "unconfirmed" | "due_today" | "scheduled"; auto: boolean };

export function paymentStatus(a: {
  state: SaleState;
  paidCents: number;
  balanceCents: number;
  schedule: { how: string; installments: InstallmentLike[] } | null;
}): PaymentStatus {
  if (a.state === "free") return "free";
  if (a.state === "ended") return "cancelled";
  if (a.state === "waiting") return "link_out";
  const due = a.schedule?.installments ?? [];
  if (a.state === "past_due" || due.some((i) => i.state === "failed")) return "failed";
  if (due.some((i) => i.state === "overdue")) return "overdue";
  // A subscription that charges again is on its schedule, never "paid in full".
  if (a.state === "renews") return "scheduled";
  if (a.state === "paid" || a.state === "cancelling" || a.balanceCents <= 0) return "paid";
  if (due.some((i) => i.state === "due_today" || i.state === "unconfirmed")) return "due";
  if (!a.schedule || a.schedule.how === "none" || due.length === 0) return "unscheduled";
  return a.paidCents > 0 ? "partial" : "scheduled";
}

/* ---------------- Paying now ---------------- */

type ScheduleLike<I extends InstallmentLike> = { saleId: string; label: string; how: "auto_pay" | "stripe" | "manual" | "none"; installments: I[] };

export type PayingNow<I extends InstallmentLike = InstallmentLike> = {
  saleId: string;
  label: string;
  how: "auto_pay" | "stripe" | "manual";
  /** Its next payment (a failed or overdue one first). */
  next: I;
  /** Payments still to come on it, the next included. */
  remaining: number;
  /** The packages the same auto-pay pays after this one, in order, with their first payment. */
  then: Array<{ saleId: string; label: string; first: string }>;
};

/** Per payment stream, the package its next payment goes to; earliest payment first. */
export function payingNow<I extends InstallmentLike>(balances: ScheduleLike<I>[]): PayingNow<I>[] {
  const streams = new Map<string, ScheduleLike<I>[]>();
  for (const b of balances) {
    if (b.how === "none" || b.installments.length === 0) continue;
    const key = b.how === "auto_pay" ? "auto_pay" : `sale:${b.saleId}`;
    const list = streams.get(key) ?? [];
    list.push(b);
    streams.set(key, list);
  }
  const firstOf = (b: ScheduleLike<I>) => [...b.installments].sort((x, y) => x.date.localeCompare(y.date))[0];
  const out: PayingNow<I>[] = [];
  for (const list of streams.values()) {
    const ordered = [...list].sort((a, b) => firstOf(a).date.localeCompare(firstOf(b).date));
    const head = ordered[0];
    out.push({
      saleId: head.saleId,
      label: head.label,
      how: head.how as PayingNow["how"],
      next: firstOf(head),
      remaining: head.installments.length,
      then: ordered.slice(1).map((b) => ({ saleId: b.saleId, label: b.label, first: firstOf(b).date })),
    });
  }
  return out.sort((a, b) => a.next.date.localeCompare(b.next.date));
}

/* ---------------- Which sessions are paid for ---------------- */

export type CoverageCell =
  /** Completed, and payments cover it. */
  | "paid"
  /** Completed, and payments cover part of it. */
  | "part"
  /** Completed, nothing paid toward it yet. */
  | "unpaid"
  /** Completed past what the package sold (added free). */
  | "free"
  | "booked"
  | "open"
  | "expired";

export type Coverage = {
  /** The package's price per session it sold. */
  perSessionCents: number;
  /** Completed sessions payments cover. */
  covered: number;
  /** Paid toward one more completed session (0 when none). */
  partCents: number;
  /** Completed sessions nothing is paid toward yet. */
  unpaid: number;
  /** Paid beyond the training delivered so far (toward sessions not trained yet). */
  aheadCents: number;
  /** One per session, in the order they're trained: what's paid for first. */
  cells: CoverageCell[];
};

/**
 * The display allocation of a package's payments over its sessions. Null
 * when the package has no price to share out (a subscription, a free or a
 * cancelled sale): then only the money is said, never a paid session.
 */
export function sessionCoverage(x: {
  sessions: SessionCounts;
  totalCents: number;
  paidCents: number;
  deliveredCents: number;
  unpaidDeliveredCents: number;
  valued: boolean;
}): Coverage | null {
  const s = x.sessions;
  if (!x.valued || s.purchased <= 0 || x.totalCents <= 0) return null;
  const per = x.totalCents / s.purchased;
  const done = Math.min(s.completed, s.purchased);
  // Covered = delivered less what's unpaid of it (payments, plus any credit that lowered the balance).
  const coveredCents = Math.max(0, x.deliveredCents - x.unpaidDeliveredCents);
  const covered = Math.min(done, Math.floor(coveredCents / per + 1e-6));
  const rest = Math.round(coveredCents - covered * per);
  const partCents = covered < done && rest >= 1 ? rest : 0;
  const unpaid = Math.max(0, done - covered - (partCents > 0 ? 1 : 0));
  const cells: CoverageCell[] = [
    ...Array<CoverageCell>(covered).fill("paid"),
    ...(partCents > 0 ? (["part"] as CoverageCell[]) : []),
    ...Array<CoverageCell>(unpaid).fill("unpaid"),
    ...Array<CoverageCell>(Math.max(0, s.completed - done)).fill("free"),
    ...Array<CoverageCell>(Math.max(0, s.booked)).fill("booked"),
    ...Array<CoverageCell>(Math.max(0, s.available)).fill("open"),
    ...Array<CoverageCell>(Math.max(0, s.expired)).fill("expired"),
  ];
  return {
    perSessionCents: Math.round(per),
    covered,
    partCents,
    unpaid,
    aheadCents: Math.max(0, x.paidCents - x.deliveredCents),
    cells,
  };
}
