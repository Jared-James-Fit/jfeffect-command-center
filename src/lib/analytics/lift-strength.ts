/**
 * The competition lifts' strength over time from the Strength Intelligence
 * engine (src/lib/strength-intel/profile.ts): every session counted for what
 * it can say, meets as what was lifted on the platform, one line per lift.
 * One read for the strength chart, the Overview's numbers, the SBD
 * composition, the calendar, the competition forecast and the logger's % of
 * Est. 1RM, so none of them disagree. Loads in lb (getClientResults' unit);
 * screens convert.
 */
import { COMP_LIFTS, type CompLift, type MeetResult } from "@/lib/analytics/competition-strength";
import { envelopeAt, envelopeTrend, type EnvelopePoint, type EnvelopeTrend, type SessionEstimate } from "@/lib/analytics/strength-estimate";
import { buildStrengthIntel, type LiftIntel, type StrengthContext } from "@/lib/strength-intel/profile";

export { isMeetLog, localDay, MEET_LOG_DAYS } from "@/lib/strength-intel/profile";

export type LiftStrength = {
  lift: CompLift;
  sessions: SessionEstimate[];
  /** meets, as lifted (high confidence, never an estimate) */
  meets: Array<{ day: string; lb: number; name: string | null }>;
  envelope: EnvelopePoint[];
  /** everything else the engine knows about this lift (PRs, peak, calibration, stance) */
  intel: LiftIntel;
};

const lastDay = (results: any[], meets: MeetResult[]) => {
  let d = "";
  for (const r of results ?? []) if (r?.date && String(r.date).slice(0, 10) > d) d = String(r.date).slice(0, 10);
  for (const m of meets ?? []) if (m?.date > d) d = m.date;
  return d || "1970-01-01";
};

export function liftStrengths(
  results: any[],
  meets: MeetResult[] = [],
  today?: string,
  ctx: Omit<StrengthContext, "today"> = {},
): Record<CompLift, LiftStrength> {
  // with no day given, read through the last thing logged (never past it)
  const day = today ?? lastDay(results, meets);
  const intel = buildStrengthIntel(results, meets, { ...ctx, today: day });
  const out = {} as Record<CompLift, LiftStrength>;
  for (const lift of COMP_LIFTS) {
    const l = intel.lifts[lift];
    out[lift] = {
      lift,
      sessions: l.sessions,
      meets: l.meets,
      envelope: today ? l.line : l.line.filter((p) => p.day <= day),
      intel: l,
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
export function mainLift(all: Record<CompLift, LiftStrength>, start: string, end: string): CompLift | null {
  let best: CompLift | null = null;
  let n = 0;
  for (const lift of COMP_LIFTS) {
    const c = all[lift].sessions.filter((s) => s.day >= start && s.day <= end && s.confidence !== "low").length;
    if (c > n) {
      n = c;
      best = lift;
    }
  }
  return n >= 2 ? best : null;
}
