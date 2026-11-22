/**
 * Recovery over a period, from what the athlete logged at check-out (the
 * workout review): sleep (a range, read at its midpoint), how recovered they
 * felt (1–5), and pain. Logged observations only: the readiness score is a
 * model estimate and lives apart (readiness-factors.ts).
 *
 * A pattern between sleep and how sessions went is only said when it's
 * there: two separate groups (never overlapping), enough of each, and a gap
 * bigger than the one-hour ranges sleep is logged in can blur. "Your best
 * sessions average 7.5h, your low-readiness sessions average 7.5h" said
 * nothing (and the two groups overlapped).
 */
import { sleepBucketHours, type SleepBucket } from "@/lib/analytics/recovery-score";

export type CheckoutRow = {
  /** yyyy-mm-dd, the athlete's day */
  day: string;
  sleepBucket: SleepBucket | null;
  /** 1–5, higher = more recovered */
  recovery: number | null;
  pain: boolean | null;
  /** the session's own rating, 1–5 */
  rating: number | null;
  /** % of the workout logged */
  logging: number | null;
};

export const SLEEP_PATTERN_MIN_EACH = 4;
export const SLEEP_PATTERN_MIN_GAP_H = 0.5;

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

function weekOf(day: string): string {
  const n = Date.parse(`${day}T00:00:00Z`) / 86_400_000;
  const dow = (new Date(n * 86_400_000).getUTCDay() + 6) % 7;
  return new Date((n - dow) * 86_400_000).toISOString().slice(0, 10);
}

export type RecoveryWeek = {
  week: string;
  sleep: number | null;
  recovery: number | null;
  pain: number;
  checkouts: number;
};

export type RecoverySummary = {
  checkouts: number;
  sleepAvg: number | null;
  sleepN: number;
  recoveryAvg: number | null;
  recoveryN: number;
  painSessions: number;
  weeks: RecoveryWeek[];
  /** sleep: the later half of the period against the earlier half, hours; null with fewer than 8 nights */
  sleepChange: number | null;
};

export function recoverySummary(rows: CheckoutRow[]): RecoverySummary {
  const sorted = rows.slice().sort((a, b) => a.day.localeCompare(b.day));
  const sleep = sorted
    .map((r) => sleepBucketHours(r.sleepBucket))
    .filter((h): h is number => h != null);
  const rec = sorted.map((r) => r.recovery).filter((v): v is number => v != null && v > 0);
  const byWeek = new Map<string, CheckoutRow[]>();
  for (const r of sorted) byWeek.set(weekOf(r.day), [...(byWeek.get(weekOf(r.day)) ?? []), r]);
  const weeks: RecoveryWeek[] = [...byWeek.entries()].map(([week, rs]) => {
    const s = avg(
      rs.map((r) => sleepBucketHours(r.sleepBucket)).filter((h): h is number => h != null),
    );
    const v = avg(rs.map((r) => r.recovery).filter((x): x is number => x != null && x > 0));
    return {
      week,
      sleep: s == null ? null : round1(s),
      recovery: v == null ? null : round1(v),
      pain: rs.filter((r) => r.pain === true).length,
      checkouts: rs.length,
    };
  });
  let sleepChange: number | null = null;
  if (sleep.length >= 8) {
    const half = Math.floor(sleep.length / 2);
    sleepChange = round1((avg(sleep.slice(half)) ?? 0) - (avg(sleep.slice(0, half)) ?? 0));
  }
  const sa = avg(sleep);
  const ra = avg(rec);
  return {
    checkouts: sorted.length,
    sleepAvg: sa == null ? null : round1(sa),
    sleepN: sleep.length,
    recoveryAvg: ra == null ? null : round1(ra),
    recoveryN: rec.length,
    painSessions: sorted.filter((r) => r.pain === true).length,
    weeks,
    sleepChange,
  };
}

/** A session that went well, by its own rating (else nearly all of it logged), or null when nothing says. */
function wentWell(r: CheckoutRow): boolean | null {
  if (r.rating != null) return r.rating >= 4;
  if (r.logging != null) return r.logging >= 95;
  return null;
}

/**
 * One line when sleep before the sessions that went well differs from the
 * rest, else null. A pattern, said as one; never a cause.
 */
export function sleepPatternInsight(rows: CheckoutRow[]): string | null {
  const good: number[] = [];
  const rest: number[] = [];
  for (const r of rows) {
    const h = sleepBucketHours(r.sleepBucket);
    const w = wentWell(r);
    if (h == null || w == null) continue;
    (w ? good : rest).push(h);
  }
  if (good.length < SLEEP_PATTERN_MIN_EACH || rest.length < SLEEP_PATTERN_MIN_EACH) return null;
  const g = avg(good)!;
  const o = avg(rest)!;
  if (Math.abs(g - o) < SLEEP_PATTERN_MIN_GAP_H) return null;
  return g > o
    ? `Before the sessions you rated well you'd slept about ${round1(g)}h, against ${round1(o)}h before the rest (${good.length} and ${rest.length} sessions). A pattern worth noticing, not proof.`
    : `Sleep didn't line up with how sessions went: about ${round1(g)}h before the ones you rated well, ${round1(o)}h before the rest (${good.length} and ${rest.length} sessions).`;
}
