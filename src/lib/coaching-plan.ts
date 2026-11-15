/**
 * What a client is on that isn't a session package: a coaching term paid
 * for up front (Alexander's 12 months of online coaching, paid in full) or a
 * subscription that charges every month. Pure, read from the same sales and
 * money as the rest of the client's payments (payment-schedule.ts), so the
 * glance on Summary and Billing says what they're on, how it's paid, and
 * when it renews or ends, without the coach opening the sale.
 *
 * Only what the records say: a term with no dates says so ("no dates"),
 * never a guessed start or end; a deposit or a one-off with no term isn't a
 * plan; a session package is the package list's, never here.
 */
import type { SaleMoney } from "@/lib/sale-money";

export type CoachingPlanSale = {
  id: string;
  offer_name?: string | null;
  archived_at?: string | null;
  sessions_purchased?: number | null;
  term_start_date?: string | null;
  term_end_date?: string | null;
  service_start_date?: string | null;
  package_expiry_date?: string | null;
  term_duration_text?: string | null;
  purchased_at?: string | null;
  created_at?: string | null;
  stripe_subscription_id?: string | null;
};

export type CoachingTiming =
  /** Paid, starts later. */
  | "upcoming"
  | "active"
  /** Ends within ENDING_SOON_DAYS. */
  | "ending_soon"
  /** Its end date has passed. */
  | "ended"
  /** Paid, but nothing says when it starts or ends. */
  | "no_dates";

export type CoachingPlan = {
  saleId: string;
  name: string;
  kind: "subscription" | "term";
  /** A subscription's charge, or a term's whole price (tax included when known). */
  cents: number;
  paidCents: number;
  leftCents: number;
  /** subscription: renews / cancelling / past_due; term: paid / left / past_due. */
  state: SaleMoney["state"];
  /** A subscription's period ("month"). */
  per: string | null;
  /** A subscription's next charge (or the day it stops); null for a term. */
  next: string | null;
  /** Charged by Stripe on its own. */
  auto: boolean;
  start: string | null;
  end: string | null;
  /** "12 Months", as sold. */
  duration: string | null;
  timing: CoachingTiming;
  /** Days until it ends (negative once it has). */
  daysLeft: number | null;
  /** Share of the term gone by, 0..1 (null without both dates). */
  elapsed: number | null;
};

/** A term ending within this many days is flagged. */
export const ENDING_SOON_DAYS = 30;
/** A term that ended within this many days still shows (to renew it). */
export const ENDED_SHOW_DAYS = 60;

const n = (v: unknown) => Number(v ?? 0) || 0;
const day = (v?: string | null) => {
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const noon = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((noon(b) - noon(a)) / 86_400_000);

/** Every coaching plan the client has, the one running now first. */
export function coachingPlans(sales: CoachingPlanSale[], money: Map<string, SaleMoney>, today: string): CoachingPlan[] {
  const t = today.slice(0, 10);
  const out: CoachingPlan[] = [];
  for (const s of sales) {
    if (s.archived_at || n(s.sessions_purchased) > 0) continue;
    const m = money.get(s.id);
    if (!m) continue;
    const base = {
      saleId: s.id,
      name: s.offer_name ?? "Coaching",
      paidCents: m.paidCents,
      leftCents: m.leftCents,
      state: m.state,
      auto: !!s.stripe_subscription_id,
    };
    if (m.kind === "subscription") {
      if (m.state !== "renews" && m.state !== "cancelling" && m.state !== "past_due") continue;
      out.push({
        ...base, kind: "subscription", cents: m.priceCents, per: m.per, next: m.next?.date ?? null,
        start: null, end: m.state === "cancelling" ? m.next?.date ?? null : null, duration: null,
        timing: "active", daysLeft: null, elapsed: null,
      });
      continue;
    }
    if (m.kind !== "one_time" && m.kind !== "plan") continue;
    if (m.state !== "paid" && m.state !== "left" && m.state !== "past_due") continue;
    const start = day(s.service_start_date) ?? day(s.term_start_date);
    const end = day(s.term_end_date) ?? day(s.package_expiry_date);
    const duration = (s.term_duration_text ?? "").trim() || null;
    // A one-off with no term at all (a deposit) isn't a plan.
    if (!start && !end && !duration) continue;
    const daysLeft = end ? daysBetween(t, end) : null;
    if (daysLeft != null && daysLeft < -ENDED_SHOW_DAYS) continue;
    const timing: CoachingTiming =
      !start && !end ? "no_dates"
      : start && start > t ? "upcoming"
      : daysLeft != null && daysLeft < 0 ? "ended"
      : daysLeft != null && daysLeft <= ENDING_SOON_DAYS ? "ending_soon"
      : "active";
    const elapsed = start && end && end > start
      ? Math.min(1, Math.max(0, daysBetween(start, t) / daysBetween(start, end)))
      : null;
    out.push({
      ...base, kind: "term", cents: m.priceCents, per: null, next: null,
      start, end, duration, timing, daysLeft, elapsed,
    });
  }
  // An ended term shows only while nothing else is running (it's there to renew).
  const live = out.filter((p) => p.timing !== "ended");
  const shown = live.length > 0 ? live : out;
  const rank = (p: CoachingPlan) => (p.timing === "ended" ? 2 : p.timing === "upcoming" ? 1 : 0);
  return shown.sort((a, b) => rank(a) - rank(b) || String(a.start ?? "").localeCompare(String(b.start ?? "")));
}

/** "Jun 2, 2026". */
export function termDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Jun 2, 2026 – Jun 2, 2027", "from Jun 2, 2026", "to Jun 2, 2027". */
export function termRange(start: string | null, end: string | null): string | null {
  if (start && end) return `${termDate(start)} – ${termDate(end)}`;
  return start ? `from ${termDate(start)}` : end ? `to ${termDate(end)}` : null;
}

/** Whole calendar months from a to b (b on or after a). */
function monthsBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma) - (db < da ? 1 : 0);
}

/** "6 months left", "3 weeks left", "12 days left", "Ends today", "Ended 5 days ago". */
export function timeLeftWords(p: Pick<CoachingPlan, "end" | "daysLeft">, today: string): string | null {
  if (!p.end || p.daysLeft == null) return null;
  const d = p.daysLeft;
  if (d < 0) return d === -1 ? "Ended yesterday" : `Ended ${-d} days ago`;
  if (d === 0) return "Ends today";
  if (d === 1) return "Ends tomorrow";
  const months = monthsBetween(today.slice(0, 10), p.end);
  if (months >= 2) return `${months} months left`;
  if (d >= 14) return `${Math.floor(d / 7)} weeks left`;
  return `${d} days left`;
}
