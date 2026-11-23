/**
 * The competition lifts' strength over time, every session counted with its
 * confidence (strength-estimate.ts) and meets as what was lifted on the
 * platform (pure, tested). One read for the strength chart, the Overview's
 * numbers, the SBD composition and the calendar, so none of them disagree.
 * Loads in lb (getClientResults' unit); screens convert.
 */
import {
  compLiftOfResult,
  COMP_LIFTS,
  type CompLift,
  type MeetResult,
} from "@/lib/analytics/competition-strength";
import {
  envelopeAt,
  envelopeTrend,
  sessionEstimates,
  strengthEnvelope,
  type EnvelopePoint,
  type EnvelopeTrend,
  type SessionEstimate,
} from "@/lib/analytics/strength-estimate";
import { neutralizeObviousLoadOutliers } from "@/lib/analytics/load-sanity";

export type LiftStrength = {
  lift: CompLift;
  sessions: SessionEstimate[];
  /** meets, as lifted (high confidence, never an estimate) */
  meets: Array<{ day: string; lb: number; name: string | null }>;
  envelope: EnvelopePoint[];
};

/** The athlete's own calendar day of an ISO time. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function liftStrengths(
  results: any[],
  meets: MeetResult[] = [],
  today?: string,
): Record<CompLift, LiftStrength> {
  const comp = neutralizeObviousLoadOutliers(
    (results ?? [])
      .filter((r) => compLiftOfResult(r))
      .map((r) => ({ ...r, est_1rm: Number(r.est_1rm) || 0 })),
  );
  const out = {} as Record<CompLift, LiftStrength>;
  for (const lift of COMP_LIFTS) {
    const sets = comp
      .filter((r: any) => compLiftOfResult(r) === lift && r.date && r.counts_load !== false)
      .map((r: any) => ({
        day: localDay(r.date),
        load: Number(r.load) || 0,
        reps: Number(r.reps) || 0,
        rpe: r.rpe,
        rir: r.rir,
      }));
    const ms = meets
      .filter((m) => m.lifts[lift] > 0)
      .map((m) => ({ day: m.date, lb: Math.round(m.lifts[lift] * 10) / 10, name: m.name }));
    let sessions = sessionEstimates(sets);
    // a meet is a max lifted: it stands in for that day's estimate
    const meetDays = new Set(ms.map((m) => m.day));
    sessions = sessions.filter((s) => !meetDays.has(s.day));
    const withMeets: SessionEstimate[] = [
      ...sessions,
      ...ms.map((m) => ({
        day: m.day,
        e1rm: m.lb,
        confidence: "high" as const,
        set: { load: m.lb, reps: 1, effort: 10 },
        heaviest: m.lb,
      })),
    ].sort((a, b) => a.day.localeCompare(b.day));
    out[lift] = {
      lift,
      sessions,
      meets: ms,
      envelope: strengthEnvelope(withMeets, { until: today }),
    };
  }
  return out;
}

export type LiftNow = {
  lift: CompLift;
  /** the line today: what the athlete can probably lift now */
  now: EnvelopePoint | null;
  trend: EnvelopeTrend;
};

export function liftNow(ls: LiftStrength, start: string, end: string): LiftNow {
  return {
    lift: ls.lift,
    now: envelopeAt(ls.envelope, end),
    trend: envelopeTrend(ls.envelope, start, end),
  };
}

/** The competition lift with the most sessions in the period (what a powerlifter's headline speaks for). */
export function mainLift(
  all: Record<CompLift, LiftStrength>,
  start: string,
  end: string,
): CompLift | null {
  let best: CompLift | null = null;
  let n = 0;
  for (const lift of COMP_LIFTS) {
    const c = all[lift].sessions.filter(
      (s) => s.day >= start && s.day <= end && s.confidence !== "low",
    ).length;
    if (c > n) {
      n = c;
      best = lift;
    }
  }
  return n >= 2 ? best : null;
}
