/**
 * What the engine learns about one athlete's lift once there's enough of it
 * (pure, tested): each is shrunk toward a neutral default until the athlete's
 * own evidence outweighs it, and clamped to a believable range, so a couple
 * of odd sessions never recalibrate anyone.
 *
 *  - peakPremium: how much more they lift on the platform than their training
 *    said three weeks before (taper, peak, the day). Default 2.5%.
 *  - repFactor: how their sets of 4+ read against their singles to triples at
 *    the same time (a rep-strong lifter's 5s overstate their single; a
 *    single-strong lifter's understate it). Default 1.
 *  - consistency: how much their RPE-read estimates scatter between sessions
 *    a few weeks apart. Loose ratings count for less (0.7–1).
 *  - backoffRatio: how far their hard back-offs read under the day's top set
 *    (their fatigue response), for the ⓘ and the back-off suggestions.
 */
import { STRENGTH_RULES as R, dayMs, DAY_MS } from "./rules";
import type { SessionEvidence } from "./evidence";
import { FATIGUE_PHASES, lineAt, phaseOn, type EstimatePoint, type MeetEvidence, type PhaseSpan } from "./estimate";

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const shrink = (value: number, n: number, prior: number, neutral: number) => (neutral * prior + value * n) / (prior + n);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const addDays = (d: string, n: number) => new Date(dayMs(d) + n * DAY_MS).toISOString().slice(0, 10);

export type Calibration = {
  premium: number;
  premiumMeets: number;
  repFactor: number;
  repPairs: number;
  consistency: number;
  /** robust SD of their hard-set estimates, as a share; null with too few */
  scatter: number | null;
  backoffRatio: number | null;
  backoffSessions: number;
};

export const NEUTRAL_CALIBRATION: Calibration = {
  premium: R.DEFAULT_PEAK_PREMIUM,
  premiumMeets: 0,
  repFactor: 1,
  repPairs: 0,
  consistency: 1,
  scatter: null,
  backoffRatio: null,
  backoffSessions: 0,
};

/** Platform over the training line three weeks before each meet (never a line a meet itself set). */
export function peakPremium(line: EstimatePoint[], meets: MeetEvidence[]): { value: number; meets: number } {
  const meetDays = new Set(meets.map((m) => m.day));
  const ratios: number[] = [];
  for (const m of meets) {
    const p = lineAt(line, addDays(m.day, -R.PEAK_READ_DAYS_BEFORE));
    if (!p || (p.state !== "measured" && p.state !== "raised") || meetDays.has(p.basis)) continue;
    if ((dayMs(m.day) - dayMs(p.basis)) / DAY_MS > R.PEAK_READ_DAYS_BEFORE + 42) continue;
    if (p.value > 0 && m.value > 0) ratios.push(m.value / p.value);
  }
  if (!ratios.length) return { value: R.DEFAULT_PEAK_PREMIUM, meets: 0 };
  const own = clamp(median(ratios), R.PEAK_PREMIUM_MIN, R.PEAK_PREMIUM_MAX);
  return {
    value: Math.round(shrink(own, ratios.length, R.PEAK_PREMIUM_PRIOR, R.DEFAULT_PEAK_PREMIUM) * 1000) / 1000,
    meets: ratios.length,
  };
}

/** Singles-to-triples against sets of 4+ within three weeks, outside peaks, tapers and fatigue phases. */
export function repFactor(
  sessions: SessionEvidence[],
  opts: { phases?: PhaseSpan[]; meetDays?: string[] } = {},
): { value: number; pairs: number } {
  const quiet = (d: string) => {
    const p = phaseOn(opts.phases, d);
    if (p && (FATIGUE_PHASES.has(p.kind) || p.kind === "peaking" || p.kind === "taper")) return false;
    return !(opts.meetDays ?? []).some((m) => {
      const gap = (dayMs(m) - dayMs(d)) / DAY_MS;
      return gap >= 0 && gap <= 21;
    });
  };
  const exact = sessions.filter((s) => s.kind === "exact" && !s.outlier && quiet(s.day));
  const lows = exact.filter((s) => s.band === "low");
  const ratios: number[] = [];
  for (const h of exact.filter((s) => s.band !== "low")) {
    const near = lows
      .map((l) => ({ l, gap: Math.abs(dayMs(l.day) - dayMs(h.day)) / DAY_MS }))
      .filter((x) => x.gap <= R.REP_PAIR_DAYS)
      .sort((a, b) => a.gap - b.gap)[0];
    if (near) ratios.push(near.l.e1rm / h.e1rm);
  }
  if (!ratios.length) return { value: 1, pairs: 0 };
  const own = clamp(median(ratios), R.REP_FACTOR_MIN, R.REP_FACTOR_MAX);
  return { value: Math.round(shrink(own, ratios.length, R.REP_FACTOR_PRIOR, 1) * 1000) / 1000, pairs: ratios.length };
}

/** How much their hard-set estimates scatter between sessions within three weeks (robust SD as a share). */
export function rpeConsistency(sessions: SessionEvidence[]): { value: number; scatter: number | null } {
  const exact = sessions.filter((s) => s.kind === "exact" && !s.outlier);
  const devs: number[] = [];
  for (const s of exact) {
    const near = exact.filter((q) => q !== s && Math.abs(dayMs(q.day) - dayMs(s.day)) / DAY_MS <= 21);
    if (near.length < 2) continue;
    devs.push(s.e1rm / median(near.map((q) => q.e1rm)) - 1);
  }
  if (devs.length < 5) return { value: 1, scatter: null };
  const m = median(devs);
  const sd = 1.4826 * median(devs.map((d) => Math.abs(d - m)));
  const value =
    sd <= R.RPE_SCATTER_OK ? 1 : sd >= R.RPE_SCATTER_POOR ? 0.7 : 1 - (0.3 * (sd - R.RPE_SCATTER_OK)) / (R.RPE_SCATTER_POOR - R.RPE_SCATTER_OK);
  return { value: Math.round(value * 100) / 100, scatter: Math.round(sd * 1000) / 1000 };
}

/** Their median hard back-off against the day's top set, once three sessions show it. */
export function backoffRatio(sessions: SessionEvidence[]): { value: number | null; sessions: number } {
  const r = sessions.filter((s) => s.backoffRatio != null && !s.outlier).map((s) => s.backoffRatio as number);
  if (r.length < 3) return { value: null, sessions: r.length };
  return { value: Math.round(clamp(median(r), 0.8, 1.05) * 1000) / 1000, sessions: r.length };
}
