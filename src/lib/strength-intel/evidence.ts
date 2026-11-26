/**
 * What logged sets say about a max, gathered one session at a time (pure,
 * tested in strength-intel.test.ts).
 *
 * Every set gets an estimate (on the app's RPE chart, `chartMax`) and a
 * confidence tier (the tiers unchanged since Nov 23 2026):
 *  - high: rated RPE 7+ (RIR ≤ 3), ≤ 10 reps. It can SHOW a max ("exact").
 *  - medium: rated RPE 5–6.5, or 11–12 reps at RPE 7+. A lower bound: the reps
 *    left are credited at most 2, so a loosely rated light set never implies a
 *    max it can't back up.
 *  - low: unrated, ≤ 10 reps, read as if taken to failure. A lower bound.
 *
 * A session is one piece of evidence, never one per set, so a day of five
 * back-offs counts no more than a day with one top set:
 *  - its exact value is its top set's (the most reliable hard set that isn't a
 *    back-off: a set after a heavier one of the same lift that day, a row
 *    labelled a back-off, or a % of the day's top set);
 *  - its lower bound is the best of everything else (lighter sets, unrated
 *    sets, back-offs), which can only ever raise what the session says;
 *  - its reliability is the top set's: reps (singles to triples say the most),
 *    effort (closest to failure is rated best), a secondary exposure or the
 *    lift done after another competition lift a little less, and a video read
 *    that agrees with the athlete's own load–velocity line a little more.
 */
import { percentOf1RM } from "@/lib/analytics/e1rm";
import { effortOf } from "@/lib/analytics/strength-read";
import { STRENGTH_RULES as R, dayMs, DAY_MS } from "./rules";

export type Confidence = "high" | "medium" | "low";
export type SetEstimate = { e1rm: number; confidence: Confidence; effort: number | null };
export type RepBand = "low" | "mid" | "high";

export const repBand = (reps: number): RepBand => (reps <= 3 ? "low" : reps <= 6 ? "mid" : "high");

/** What one set says about a max, or null when it says nothing. */
export function setEstimate(s: {
  load: number;
  reps: number;
  rpe?: number | string | null;
  rir?: number | string | null;
}): SetEstimate | null {
  const load = Number(s.load) || 0;
  const reps = Number(s.reps) || 0;
  if (!(load > 0) || !(reps >= 1) || reps > R.MAX_INFORMATIVE_REPS) return null;
  const effort = effortOf(s);
  if (effort != null) {
    if (effort < R.MIN_INFORMATIVE_RPE) return null;
    const high = effort >= R.HARD_RPE && reps <= R.HARD_MAX_REPS;
    const e1rm = chartMax(load, reps, 10 - (high ? effort : Math.max(effort, 10 - R.LIGHT_RIR_CREDIT)));
    if (!(e1rm > 0)) return null;
    return { e1rm, confidence: high ? "high" : "medium", effort };
  }
  if (reps > R.HARD_MAX_REPS) return null;
  const e1rm = chartMax(load, reps, 0);
  return e1rm > 0 ? { e1rm, confidence: "low", effort: null } : null;
}

/**
 * The max a set implies on the app's RPE chart (load-suggestion.ts
 * `percentOf1RM`: the RTS-style reps × reps-in-reserve table the suggested
 * weights are backtested on), so a suggestion and an estimate never read the
 * same set two ways. Rounded to 0.1.
 */
export function chartMax(load: number, reps: number, rir: number): number {
  const pct = percentOf1RM(reps, Math.max(0, rir));
  return pct && pct > 0 ? Math.round((load / pct) * 10) / 10 : 0;
}

/** One logged set, in whatever unit the caller works in (lb from getClientResults). */
export type StrengthSet = {
  /** the athlete's own calendar day */
  day: string;
  load: number;
  reps: number;
  rpe?: number | string | null;
  rir?: number | string | null;
  /** the row's place in its workout, then the set's: the order sets were done */
  order?: number | null;
  setIndex?: number | null;
  /** the row's purpose label ("Primary Deadlift Backoff", "Secondary Squat") */
  role?: string | null;
  /** the row reads a % of today's top set or the previous set */
  basis?: string | null;
  /** a competition lift logged before this one in the same session */
  afterOtherLift?: boolean;
  /** what the athlete's own load–velocity line says about this set (velocity.ts) */
  velocity?: "agrees" | "faster" | "slower" | null;
};

export type SessionEvidence = {
  /** yyyy-mm-dd */
  day: string;
  /** what the session says (its top set's estimate when it has one, else its best lower bound) */
  e1rm: number;
  confidence: Confidence;
  /** exact: a hard top set shows a max · lower: only lighter, unrated or back-off sets */
  kind: "exact" | "lower";
  /** the best lower bound in the session (any set), for raising only */
  lowerBound: number | null;
  /** 0–1: how much this session's evidence is worth */
  reliability: number;
  band: RepBand;
  set: { load: number; reps: number; effort: number | null };
  /** heaviest load lifted that day (any set) */
  heaviest: number;
  /** sets read as back-offs (fatigued: lower bounds only) */
  backoffs: number;
  /** the best hard back-off's estimate over the top set's: how much this athlete's back-offs read under it */
  backoffRatio?: number;
  /** what lowered or raised its reliability, for the ⓘ */
  notes: string[];
  /** flagged far off the estimates around it: shown, kept out of the estimate */
  outlier?: "high" | "low";
};

const BACKOFF_LABEL = /\bback\s*-?\s*offs?\b|\bdrop\s*sets?\b|\bfatigue\s*sets?\b/i;
const SECONDARY_LABEL = /\b(secondary|tertiary|quaternary)\b/i;

function isLabelledBackoff(s: StrengthSet): boolean {
  return s.basis === "top_set" || s.basis === "prev_set" || BACKOFF_LABEL.test(String(s.role ?? ""));
}

/** One piece of evidence per training day (see the header). */
export function sessionEvidence(sets: StrengthSet[]): SessionEvidence[] {
  const byDay = new Map<string, StrengthSet[]>();
  for (const s of sets) {
    if (!s?.day || !(Number(s.load) > 0) || !(Number(s.reps) >= 1)) continue;
    byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
  }
  const out: SessionEvidence[] = [];
  for (const [day, raw] of byDay) {
    const ordered = raw
      .map((s, i) => ({ s, i }))
      .sort((a, b) => (a.s.order ?? 0) - (b.s.order ?? 0) || (a.s.setIndex ?? a.i) - (b.s.setIndex ?? b.i))
      .map((x) => x.s);
    const heaviest = Math.max(...ordered.map((s) => Number(s.load) || 0));
    // a lighter set after a heavier HARD one that day is a fatigued back-off
    // (only when the order sets were done is known; a heavy single at RPE 6
    // first leaves little fatigue, so it doesn't make what follows a back-off)
    const ordered_ = ordered.some((s) => s.order != null || s.setIndex != null);
    let heaviestHard = 0;
    type Read = { s: StrengthSet; est: SetEstimate; backoff: boolean; rel: number; notes: string[] };
    const reads: Read[] = [];
    for (const s of ordered) {
      const load = Number(s.load) || 0;
      const est = setEstimate(s);
      const backoff = isLabelledBackoff(s) || (ordered_ && heaviestHard > 0 && load < heaviestHard * 0.98);
      if (est && (est.confidence === "high" || est.confidence === "low")) heaviestHard = Math.max(heaviestHard, load);
      if (!est) continue;
      const notes: string[] = [];
      let rel =
        est.confidence === "high"
          ? R.repReliability(Number(s.reps)) * R.effortReliability(est.effort ?? 10)
          : est.confidence === "medium"
            ? R.repReliability(Number(s.reps)) * 0.8
            : R.repReliability(Number(s.reps)) * R.UNRATED_RELIABILITY;
      if (SECONDARY_LABEL.test(String(s.role ?? ""))) {
        rel *= R.SECONDARY_FACTOR;
        notes.push("secondary");
      }
      if (s.afterOtherLift) {
        rel *= R.AFTER_OTHER_LIFT_FACTOR;
        notes.push("after-other-lift");
      }
      let kind = est.confidence;
      if (s.velocity === "agrees") {
        rel = Math.min(1, rel * R.VELOCITY_AGREE_FACTOR);
        notes.push("velocity-agrees");
      } else if (s.velocity === "faster" && kind === "high" && (est.effort ?? 0) >= 8) {
        // rated hard but moved faster than their own line at that load: there was more in it
        kind = "medium";
        notes.push("velocity-faster");
      } else if (s.velocity === "slower" && (est.effort ?? 10) <= 7.5) {
        rel *= R.VELOCITY_DISAGREE_FACTOR;
        notes.push("velocity-slower");
      }
      reads.push({ s, est: { ...est, confidence: kind }, backoff, rel, notes });
    }
    if (!reads.length) continue;
    const tops = reads.filter((r) => r.est.confidence === "high" && !r.backoff);
    const others = reads.filter((r) => !tops.includes(r));
    const lowerBound = others.length ? Math.max(...others.map((r) => r.est.e1rm)) : null;
    const backoffs = reads.filter((r) => r.backoff).length;
    let pick: Read;
    let kind: "exact" | "lower";
    if (tops.length) {
      const bestRel = Math.max(...tops.map((r) => r.rel));
      pick = tops
        .filter((r) => r.rel >= bestRel * 0.85)
        .reduce((a, r) => (r.est.e1rm > a.est.e1rm ? r : a));
      kind = "exact";
    } else {
      // no hard top set: the most confident lighter set, then the best of them
      const rank = (r: Read) => (r.est.confidence === "high" ? 3 : r.est.confidence === "medium" ? 2 : 1);
      pick = others.reduce((a, r) =>
        rank(r) > rank(a) || (rank(r) === rank(a) && r.est.e1rm > a.est.e1rm) ? r : a,
      );
      kind = "lower";
    }
    const reps = Number(pick.s.reps);
    const hardBackoffs = reads.filter((r) => r.backoff && r.est.confidence === "high");
    const backoffRatio =
      kind === "exact" && hardBackoffs.length
        ? Math.round((Math.max(...hardBackoffs.map((r) => r.est.e1rm)) / pick.est.e1rm) * 1000) / 1000
        : undefined;
    out.push({
      day,
      e1rm: Math.round(pick.est.e1rm * 10) / 10,
      confidence: kind === "exact" ? "high" : pick.est.confidence === "low" ? "low" : "medium",
      kind,
      lowerBound: lowerBound != null ? Math.round(lowerBound * 10) / 10 : null,
      reliability: Math.round(pick.rel * 1000) / 1000,
      band: repBand(reps),
      set: { load: Number(pick.s.load), reps, effort: pick.est.effort },
      heaviest,
      backoffs,
      ...(backoffRatio != null ? { backoffRatio } : {}),
      notes: pick.notes,
    });
  }
  return flagOutliers(out.sort((a, b) => a.day.localeCompare(b.day)));
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Marks estimates far off the others within 60 days (needs 3+ others to judge). */
export function flagOutliers<T extends { day: string; e1rm: number; confidence: Confidence; outlier?: "high" | "low" }>(
  points: T[],
): T[] {
  return points.map((p) => {
    const t = dayMs(p.day);
    const near = points.filter(
      (q) => q !== p && Math.abs(dayMs(q.day) - t) <= R.OUTLIER_WINDOW_DAYS * DAY_MS && q.confidence !== "low",
    );
    if (near.length < 3) return { ...p, outlier: undefined };
    const m = median(near.map((q) => q.e1rm));
    if (p.e1rm > m * R.OUTLIER_HIGH) return { ...p, outlier: "high" as const };
    if (p.confidence === "high" && p.e1rm < m * R.OUTLIER_LOW) return { ...p, outlier: "low" as const };
    return { ...p, outlier: undefined };
  });
}
