/**
 * Strength over time with every logged set counted for what it can say
 * (pure, tested in analytics-redesign.test.ts).
 *
 * The Nov 22 read (strength-read.ts `comparableE1rm`) kept only hard sets
 * (RPE 7+, ≤ 10 reps). That's still the definition of a set that can SHOW a
 * max ("high" confidence here, unchanged, so Program Intelligence and every
 * other reader agree), but it dropped whole phases of training from the
 * charts: an off-season of RPE 6 work read as "no data", and a chart of only
 * the occasional hard set jumped between whatever happened to be rated.
 *
 * Every set now gets an estimate and a confidence:
 *  - high: rated RPE 7+ (RIR ≤ 3), ≤ 10 reps. Shows a max.
 *  - medium: rated RPE 5–6.5, or 11–12 reps at RPE 7+. A lower bound: lifters
 *    under-call how much they have left the further they are from failure, so
 *    an RPE 6 estimate tends to read LOW; and the reps left are credited at
 *    most 2 (`LIGHT_RIR_CREDIT`), so a loosely rated light single never
 *    implies a max it can't back up.
 *  - low: unrated, ≤ 10 reps, read as if taken to failure (Epley on the reps
 *    done): the smallest max that set allows. Also a lower bound.
 *  Below RPE 5 or over 12 reps a set says nothing about a max and is left out.
 *
 * The line ("estimated strength", `strengthEnvelope`) is the best high-
 * confidence estimate in the last `ENVELOPE_DAYS` (42, the same window that
 * makes an estimate "current"). Lower-bound evidence can only RAISE it (a
 * lighter set that implies more than the line is real evidence); it never
 * lowers it, so a light week, a deload or an RPE 6 block is never drawn as
 * strength lost. With no hard set in the window the line HOLDS at its last
 * value and is said to be held; after `STALE_DAYS` it's stale. It only falls
 * when hard sets keep coming in lower for a whole window: a real, sustained
 * change in comparable performances.
 *
 * Points far off everything around them (`OUTLIER_HIGH` / `OUTLIER_LOW` of
 * the median of the other estimates within 60 days) are flagged and kept out
 * of the line: a unit slip (kg typed as lb), a mis-typed rep count. They're
 * shown, never deleted, and nothing stored changes.
 */
import { epley1RM, estimate1RMWithRpe } from "@/lib/analytics/e1rm";
import {
  COMPARABLE_MAX_REPS,
  COMPARABLE_MIN_RPE,
  effortOf,
  STEADY_PCT,
} from "@/lib/analytics/strength-read";

export type Confidence = "high" | "medium" | "low";
export const CONFIDENCE_WORD: Record<Confidence, string> = {
  high: "Hard set",
  medium: "Lighter set (a lower bound)",
  low: "Unrated set (a lower bound)",
};

export const MIN_INFORMATIVE_RPE = 5;
/** reps in reserve a lighter set is credited, at most */
export const LIGHT_RIR_CREDIT = 2;
export const MAX_INFORMATIVE_REPS = 12;
export const ENVELOPE_DAYS = 42;
export const STALE_DAYS = 56;
export const OUTLIER_HIGH = 1.35;
export const OUTLIER_LOW = 0.65;
/**
 * The most the line falls per week when hard sets say it's lower. Strength
 * doesn't drop 20% in a month while someone keeps training: two volume-block
 * sets of 5 rated RPE 7–8 under a meet max are the RPE chart's error, not a
 * collapse. Real declines still show, a week at a time.
 */
export const MAX_FALL_PER_WEEK = 0.02;
const OUTLIER_WINDOW_DAYS = 60;
const DAY = 86_400_000;

const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export type SetEstimate = { e1rm: number; confidence: Confidence; effort: number | null };

/** What one set says about a max, or null when it says nothing. */
export function setEstimate(s: {
  load: number;
  reps: number;
  rpe?: number | string | null;
  rir?: number | string | null;
}): SetEstimate | null {
  const load = Number(s.load) || 0;
  const reps = Number(s.reps) || 0;
  if (!(load > 0) || !(reps >= 1) || reps > MAX_INFORMATIVE_REPS) return null;
  const effort = effortOf(s);
  if (effort != null) {
    if (effort < MIN_INFORMATIVE_RPE) return null;
    const high = effort >= COMPARABLE_MIN_RPE && reps <= COMPARABLE_MAX_REPS;
    // a lighter set's reps-in-reserve is credited at most 2: far from failure
    // the call is loose, so the estimate stays a conservative lower bound
    const e1rm = estimate1RMWithRpe(
      load,
      reps,
      high ? effort : Math.max(effort, 10 - LIGHT_RIR_CREDIT),
    );
    if (!(e1rm > 0)) return null;
    return { e1rm, confidence: high ? "high" : "medium", effort };
  }
  if (reps > COMPARABLE_MAX_REPS) return null;
  const e1rm = epley1RM(load, reps);
  return e1rm > 0 ? { e1rm, confidence: "low", effort: null } : null;
}

export type SessionEstimate = {
  /** yyyy-mm-dd */
  day: string;
  e1rm: number;
  confidence: Confidence;
  set: { load: number; reps: number; effort: number | null };
  /** heaviest load lifted that day (any set) */
  heaviest: number;
  /** flagged far off the estimates around it: shown, kept out of the line */
  outlier?: "high" | "low";
};

/**
 * One estimate per training day: its most confident set's (the best of the
 * hard sets; with none, the best lighter set; then the best unrated one).
 */
export function sessionEstimates(
  sets: Array<{
    day: string;
    load: number;
    reps: number;
    rpe?: number | string | null;
    rir?: number | string | null;
  }>,
): SessionEstimate[] {
  const byDay = new Map<string, SessionEstimate>();
  for (const s of sets) {
    if (!s?.day) continue;
    const est = setEstimate(s);
    const cur = byDay.get(s.day);
    const heaviest = Math.max(cur?.heaviest ?? 0, Number(s.load) || 0);
    if (!est) {
      if (cur) cur.heaviest = heaviest;
      continue;
    }
    const better =
      !cur ||
      RANK[est.confidence] > RANK[cur.confidence] ||
      (RANK[est.confidence] === RANK[cur.confidence] && est.e1rm > cur.e1rm);
    if (better) {
      byDay.set(s.day, {
        day: s.day,
        e1rm: Math.round(est.e1rm * 10) / 10,
        confidence: est.confidence,
        set: { load: Number(s.load), reps: Number(s.reps), effort: est.effort },
        heaviest,
      });
    } else cur.heaviest = heaviest;
  }
  return flagOutliers([...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)));
}

const dayMs = (d: string) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Marks estimates far off the others within 60 days (needs 3+ others to judge). */
export function flagOutliers(points: SessionEstimate[]): SessionEstimate[] {
  return points.map((p) => {
    const t = dayMs(p.day);
    const near = points.filter(
      (q) =>
        q !== p &&
        Math.abs(dayMs(q.day) - t) <= OUTLIER_WINDOW_DAYS * DAY &&
        q.confidence !== "low",
    );
    if (near.length < 3) return { ...p, outlier: undefined };
    const m = median(near.map((q) => q.e1rm));
    if (p.e1rm > m * OUTLIER_HIGH) return { ...p, outlier: "high" as const };
    if (p.confidence === "high" && p.e1rm < m * OUTLIER_LOW)
      return { ...p, outlier: "low" as const };
    return { ...p, outlier: undefined };
  });
}

/**
 * measured: a hard set in the window sets it · raised: a lighter set implied
 * more · held: no hard set in the window, kept at the last value · stale: held
 * past STALE_DAYS · floor: only lighter sets so far (a lower bound).
 */
export type EnvelopeState = "measured" | "raised" | "held" | "stale" | "floor";
export type EnvelopePoint = { day: string; value: number; state: EnvelopeState; basis: string };

/** The estimated-strength line at every session day (and `until`, when given). */
export function strengthEnvelope(
  points: SessionEstimate[],
  opts: { until?: string } = {},
): EnvelopePoint[] {
  const usable = points.filter((p) => !p.outlier);
  const days = [...new Set(usable.map((p) => p.day))];
  if (opts.until && days.length && opts.until > days[days.length - 1]) days.push(opts.until);
  days.sort();
  const out: EnvelopePoint[] = [];
  let prev: EnvelopePoint | null = null;
  let lastHighDay: string | null = null;
  for (const d of days) {
    const t = dayMs(d);
    const inWin = usable.filter((p) => p.day <= d && t - dayMs(p.day) < ENVELOPE_DAYS * DAY);
    const highs = inWin.filter((p) => p.confidence === "high");
    const lows = inWin.filter((p) => p.confidence !== "high");
    let cur: EnvelopePoint | null = null;
    if (highs.length) {
      const best = highs.reduce((a, p) => (p.e1rm > a.e1rm ? p : a));
      lastHighDay = highs.reduce((a, p) => (p.day > a ? p.day : a), lastHighDay ?? highs[0].day);
      // one hard session under the line is a fluctuation, never a fall: it takes 2+
      if (prev && best.e1rm < prev.value && highs.length < 2) {
        cur = { day: d, value: prev.value, state: "held", basis: prev.basis };
      } else if (prev && best.e1rm < prev.value && prev.state !== "floor") {
        // a fall, at most MAX_FALL_PER_WEEK since the last point
        const weeks = Math.max(0, (t - dayMs(prev.day)) / (7 * DAY));
        const lowest: number = prev.value * Math.max(0, 1 - MAX_FALL_PER_WEEK * weeks);
        cur = {
          day: d,
          value: Math.round(Math.max(best.e1rm, lowest) * 10) / 10,
          state: "measured",
          basis: best.day,
        };
      } else {
        cur = { day: d, value: best.e1rm, state: "measured", basis: best.day };
      }
    } else if (prev) {
      const since = lastHighDay ? (t - dayMs(lastHighDay)) / DAY : Infinity;
      cur = {
        day: d,
        value: prev.value,
        state: since > STALE_DAYS ? "stale" : "held",
        basis: prev.basis,
      };
      if (prev.state === "floor") cur.state = "floor";
    }
    const bestLow = lows.length ? lows.reduce((a, p) => (p.e1rm > a.e1rm ? p : a)) : null;
    if (bestLow && (!cur || bestLow.e1rm > cur.value)) {
      cur = {
        day: d,
        value: bestLow.e1rm,
        state: cur && cur.state !== "floor" ? "raised" : "floor",
        basis: bestLow.day,
      };
    }
    if (cur) {
      out.push(cur);
      prev = cur;
    }
  }
  return out;
}

/** The line's value on a day (the last point on or before it), or null. */
export function envelopeAt(env: EnvelopePoint[], day: string): EnvelopePoint | null {
  let hit: EnvelopePoint | null = null;
  for (const p of env) {
    if (p.day <= day) hit = p;
    else break;
  }
  return hit;
}

export type EnvelopeTrend =
  | { kind: "up" | "down" | "steady"; pct: number; from: EnvelopePoint; to: EnvelopePoint }
  | { kind: "unclear"; reason: "no-data" | "few" | "held"; to: EnvelopePoint | null };

/**
 * How the line moved across a period: from its value at (or first after) the
 * start to its value at the end. "held" when the end has no hard set behind
 * it: the honest answer is that we don't know yet.
 */
export function envelopeTrend(env: EnvelopePoint[], start: string, end: string): EnvelopeTrend {
  const inside = env.filter((p) => p.day >= start && p.day <= end);
  const to = envelopeAt(env, end);
  if (!to) return { kind: "unclear", reason: "no-data", to: null };
  if (to.state === "held" || to.state === "stale" || to.state === "floor")
    return { kind: "unclear", reason: "held", to };
  // the line at the start counts only when a recent session stands behind it
  const atStart = envelopeAt(env, start);
  const fresh =
    atStart &&
    (atStart.state === "measured" || atStart.state === "raised") &&
    dayMs(start) - dayMs(atStart.basis) <= STALE_DAYS * DAY;
  const from = (fresh ? atStart : null) ?? inside[0] ?? null;
  if (!from || from === to || inside.length < 2) return { kind: "unclear", reason: "few", to };
  const pct = Math.round(((to.value - from.value) / from.value) * 1000) / 10;
  const kind = Math.abs(pct) < STEADY_PCT ? "steady" : pct > 0 ? "up" : "down";
  return { kind, pct, from, to };
}
