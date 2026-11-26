/**
 * The analytics' names for the Strength Intelligence engine (src/lib/strength-
 * intel): what a set says about a max (`setEstimate`), one piece of evidence
 * per session (`sessionEstimates`), and the estimated-strength line
 * (`strengthEnvelope`). Kept so every chart, the competition forecast and the
 * calendar read the one engine without changing their imports.
 *
 * The line is the engine's: hard top sets move it by how reliable they are,
 * lighter sets contribute without setting a max alone, sustained comparable
 * declines lower it slowly, meets read as training-day capacity, and it holds
 * (then fades) when there's nothing new. estimate.ts says it in full.
 */
import { STRENGTH_RULES as R } from "@/lib/strength-intel/rules";
import { STEADY_PCT } from "@/lib/analytics/strength-read";
import {
  flagOutliers as flag,
  repBand,
  sessionEvidence,
  setEstimate as estimateSet,
  type Confidence as C,
  type SessionEvidence,
  type SetEstimate as S,
} from "@/lib/strength-intel/evidence";
import {
  estimateLine,
  lineAt,
  type EnvelopeState as ES,
  type EstimatePoint,
} from "@/lib/strength-intel/estimate";

export type Confidence = C;
export type SetEstimate = S;
export type EnvelopeState = ES;
export const CONFIDENCE_WORD: Record<Confidence, string> = {
  high: "Hard set",
  medium: "Lighter set (a lower bound)",
  low: "Unrated set (a lower bound)",
};

export const MIN_INFORMATIVE_RPE = R.MIN_INFORMATIVE_RPE;
export const LIGHT_RIR_CREDIT = R.LIGHT_RIR_CREDIT;
export const MAX_INFORMATIVE_REPS = R.MAX_INFORMATIVE_REPS;
export const ENVELOPE_DAYS = 42;
export const STALE_DAYS = R.STALE_DAYS;
export const OUTLIER_HIGH = R.OUTLIER_HIGH;
export const OUTLIER_LOW = R.OUTLIER_LOW;
export const MAX_FALL_PER_WEEK = R.MAX_FALL_PER_WEEK;

export const setEstimate = estimateSet;

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
} & Partial<Pick<SessionEvidence, "kind" | "reliability" | "band" | "lowerBound" | "backoffs" | "notes">>;

/** One piece of evidence per training day (the engine's `sessionEvidence`). */
export function sessionEstimates(
  sets: Array<{
    day: string;
    load: number;
    reps: number;
    rpe?: number | string | null;
    rir?: number | string | null;
  }>,
): SessionEstimate[] {
  return sessionEvidence(sets);
}

export const flagOutliers = flag;

export type EnvelopePoint = {
  day: string;
  value: number;
  state: EnvelopeState;
  basis: string;
  confidence?: number;
  reason?: EstimatePoint["reason"];
};

/** A bare session (no engine fields) as evidence: its tier says exact or lower, its set its reliability. */
function asEvidence(p: SessionEstimate): SessionEvidence {
  const reps = Number(p.set?.reps) || 1;
  const effort = p.set?.effort ?? null;
  const exact = p.kind ? p.kind === "exact" : p.confidence === "high";
  const reliability =
    p.reliability ??
    (exact
      ? R.repReliability(reps) * R.effortReliability(effort ?? 10)
      : R.repReliability(reps) * (p.confidence === "low" ? R.UNRATED_RELIABILITY : 0.8));
  return {
    day: p.day,
    e1rm: p.e1rm,
    confidence: p.confidence,
    kind: exact ? "exact" : "lower",
    lowerBound: p.lowerBound ?? null,
    reliability,
    band: p.band ?? repBand(reps),
    set: { load: p.set?.load ?? p.e1rm, reps, effort },
    heaviest: p.heaviest,
    backoffs: p.backoffs ?? 0,
    notes: p.notes ?? [],
    outlier: p.outlier,
  };
}

/** The estimated-strength line at every session day (and `until`, when given). */
export function strengthEnvelope(points: SessionEstimate[], opts: { until?: string } = {}): EnvelopePoint[] {
  return estimateLine({ sessions: points.map(asEvidence), until: opts.until });
}

/** The line's value on a day (the last point on or before it), or null. */
export function envelopeAt(env: EnvelopePoint[], day: string): EnvelopePoint | null {
  return lineAt(env, day);
}

export type EnvelopeTrend =
  | { kind: "up" | "down" | "steady"; pct: number; from: EnvelopePoint; to: EnvelopePoint }
  | { kind: "unclear"; reason: "no-data" | "few" | "held"; to: EnvelopePoint | null };

const dayMs = (d: string) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);

/**
 * How the line moved across a period: from its value at (or first after) the
 * start to its value at the end. "held" when the end has no hard set behind
 * it: the honest answer is that we don't know yet.
 */
export function envelopeTrend(env: EnvelopePoint[], start: string, end: string): EnvelopeTrend {
  const inside = env.filter((p) => p.day >= start && p.day <= end);
  const to = envelopeAt(env, end);
  if (!to) return { kind: "unclear", reason: "no-data", to: null };
  if (to.state === "held" || to.state === "stale" || to.state === "floor") return { kind: "unclear", reason: "held", to };
  const atStart = envelopeAt(env, start);
  const fresh =
    atStart &&
    (atStart.state === "measured" || atStart.state === "raised") &&
    dayMs(start) - dayMs(atStart.basis) <= STALE_DAYS * 86_400_000;
  const from = (fresh ? atStart : null) ?? inside[0] ?? null;
  if (!from || from === to || inside.length < 2) return { kind: "unclear", reason: "few", to };
  const pct = Math.round(((to.value - from.value) / from.value) * 1000) / 10;
  const kind = Math.abs(pct) < STEADY_PCT ? "steady" : pct > 0 ? "up" : "down";
  return { kind, pct, from, to };
}
