/**
 * The estimated max a "% of Est. 1RM" prescription reads when no e1RM is
 * stored on the athlete's maxes: the app's own estimated strength for that
 * competition lift (lift-strength.ts, the line on the Strength tab), so the
 * logger's "Est. 1RM" is the same number analytics shows (pure, tested in
 * planning-e1rm.test.ts).
 *
 * That line counts every logged set for what it can say (strength-estimate.ts):
 * hard sets show a max, lighter sets only ever raise it, and it HOLDS through
 * a block of RPE 6 work instead of reading it as strength lost. Meets are what
 * was lifted on the platform, and a meet's attempts typed into the app days
 * later never stand in for it.
 *
 * It replaces the logger's own narrower read (Nov 2026: RPE 6.5+ sets in the
 * last 6 weeks, 2+ sessions), which gave nothing to anyone in an off-season of
 * RPE-capped work: Jared's 60% Est. 1RM paused deadlift on Nov 25 2026 showed
 * no weight, with one hard deadlift session in 6 weeks (Nov 13) and a 270 kg
 * meet pull on Sep 18.
 *
 * It plans from the line only while something stands behind it:
 *  - not a `floor` (only lighter sets ever: a lower bound, not a max);
 *  - at least `E1RM_MIN_POINTS` sessions or meets in the read, so one typed
 *    set (a unit slip) never becomes the max a whole program reads;
 *  - its newest evidence (the last hard set or meet, or the lighter set that
 *    raised it) within `E1RM_PLAN_DAYS`. Past that it isn't a current max and
 *    the RPE leads, as before.
 * The RPE beside a % is its cap (load-reference.ts), so a set that goes over it
 * still brings the next one down.
 */
import { liftStrengths, type LiftStrength } from "@/lib/analytics/lift-strength";
import type { CompLift, MeetResult } from "@/lib/analytics/competition-strength";
import { envelopeAt, type EnvelopeState } from "@/lib/analytics/strength-estimate";
import { billingDay } from "@/lib/date-range";
import type { LiftFamily } from "@/lib/workouts/load-reference";

/** How far back the read goes: enough for the line to hold through a long block of lighter work. */
export const E1RM_READ_DAYS = 180;
/** The newest hard evidence may be at most this old: a 16-week off-season block of RPE-capped work. */
export const E1RM_PLAN_DAYS = 112;
/** Sessions or meets the line needs behind it before a program reads it. */
export const E1RM_MIN_POINTS = 2;

const LB_PER_KG = 2.2046226218;
const DAY = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);

export type E1rmSource =
  | { kind: "meet"; day: string; name: string | null }
  | { kind: "set"; day: string; loadLb: number; reps: number; effort: number | null };

export type PlanningE1rm = {
  kg: number;
  state: EnvelopeState;
  source: E1rmSource | null;
};

/** The line on `today`, when a program may read it (the rules above), in kg. */
export function planningE1rm(ls: LiftStrength, today: string): PlanningE1rm | null {
  const point = envelopeAt(ls.envelope, today);
  if (!point || !(point.value > 0) || point.state === "floor") return null;

  const sessions = ls.sessions.filter((s) => !s.outlier && s.day <= today);
  const meets = ls.meets.filter((m) => m.day <= today);
  if (sessions.length + meets.length < E1RM_MIN_POINTS) return null;

  const hard = [
    ...sessions.filter((s) => s.confidence === "high").map((s) => s.day),
    ...meets.map((m) => m.day),
  ];
  // the newest of the last hard set or meet and what the line rests on (a lighter set that raised it)
  const evidence = [...hard, point.basis].reduce((a, d) => (d > a ? d : a));
  if (!evidence || dayMs(today) - dayMs(evidence) > E1RM_PLAN_DAYS * DAY) return null;

  const meet = ls.meets.find((m) => m.day === point.basis);
  const session = meet ? null : ls.sessions.find((s) => s.day === point.basis && !s.outlier);
  const source: E1rmSource | null = meet
    ? { kind: "meet", day: meet.day, name: meet.name }
    : session
      ? {
          kind: "set",
          day: session.day,
          loadLb: session.set.load,
          reps: session.set.reps,
          effort: session.set.effort,
        }
      : null;
  return { kg: Math.round((point.value / LB_PER_KG) * 10) / 10, state: point.state, source };
}

/**
 * Every requested lift's planning e1RM from the athlete's logged competition
 * sets (analytics' result shape: `load` in lb, `date`, `reps`, `rpe`, `rir`,
 * `counts_load`, `competition_lift_type`, `is_competition_lift`) and meets.
 */
export function planningE1rmByFamily(
  results: any[],
  meets: MeetResult[],
  families: LiftFamily[],
  today: string,
): Partial<Record<LiftFamily, PlanningE1rm>> {
  const all = liftStrengths(results, meets, today);
  const out: Partial<Record<LiftFamily, PlanningE1rm>> = {};
  for (const fam of families) {
    const ls = all[fam as CompLift];
    const e = ls ? planningE1rm(ls, today) : null;
    if (e) out[fam] = e;
  }
  return out;
}

const LIFT_WORD: Record<LiftFamily, string> = {
  squat: "squat",
  bench: "bench",
  deadlift: "deadlift",
};

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * Where the estimate came from, for the planned weight's ⓘ, in the card's unit:
 * "Your estimated max is your deadlift at Commonwealth Championships (Sep 18)."
 * "Your estimated max is worked out from 224.5 kg × 4 @ RPE 10 on Nov 13."
 */
export function e1rmSourceLine(
  source: E1rmSource | null | undefined,
  family: LiftFamily,
  unit: "kg" | "lb",
): string | null {
  if (!source) return null;
  const day = billingDay(source.day) ?? source.day;
  if (source.kind === "meet") {
    return `Your estimated max is your ${LIFT_WORD[family]} at ${source.name ?? "your last meet"} (${day}).`;
  }
  const load = unit === "kg" ? source.loadLb / LB_PER_KG : source.loadLb;
  const effort = source.effort != null ? ` @ RPE ${fmt(source.effort)}` : "";
  return `Your estimated max is worked out from ${fmt(load)} ${unit} × ${source.reps}${effort} on ${day}.`;
}
