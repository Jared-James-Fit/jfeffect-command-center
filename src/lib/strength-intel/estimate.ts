/**
 * Current estimated strength for one lift, day by day (pure, tested in
 * strength-intel.test.ts): a deterministic filter over session evidence and
 * meets, with a confidence and the reason it moved, so every screen can say
 * what the number is and why.
 *
 * How it moves (rules.ts holds every number):
 *  - A hard top set over the estimate raises it by how reliable the set is (a
 *    heavy single at RPE 9 all the way; a set of 8 at RPE 7 about half).
 *  - A hard set that agrees (within 3%) nudges it: smoothing, not a jump.
 *  - Lighter, unrated and back-off sets are lower bounds: one over the estimate
 *    moves it halfway, never all the way. Low-RPE work contributes evidence
 *    without setting a max alone, so an RPE 6 block never inflates it.
 *  - Lower hard sessions only lower it when they're sustained: two comparable
 *    ones (the same rep band as what set it) within five weeks, or a month of
 *    non-comparable ones (sets of 5 under a single), and then at most 2% (1%)
 *    a week. In a fatigue phase (accumulation, the two weeks after a meet, a
 *    cut, illness, injury) one more session is needed and the rate halves: a
 *    fatigued athlete is not a weaker athlete.
 *  - A meet is what was lifted on the platform, peaked. The training-day
 *    capacity it implies is the meet over the athlete's platform premium
 *    (their own meets against their training before the taper, else 2.5%), so
 *    a peaked performance never stands as their everyday max. A meet under the
 *    estimate moves it most of the way (a bad day exists).
 *  - Nothing in the log for a month: strength fades slowly (time off). Training
 *    on with no hard set for 16 weeks: it eases down toward what the lighter
 *    work still proves, so an old PR is never an anchor forever.
 *  - Confidence is the evidence behind it, each piece fading with a six-week
 *    half-life and counting less where it disagrees.
 */
import { STRENGTH_RULES as R, dayMs, DAY_MS } from "./rules";
import type { RepBand, SessionEvidence } from "./evidence";

export type EnvelopeState = "measured" | "raised" | "held" | "stale" | "floor";

export type PhaseKind =
  | "accumulation"
  | "intensification"
  | "peaking"
  | "taper"
  | "deload"
  | "recovery"
  | "cut"
  | "illness"
  | "injury"
  | "normal";
export type PhaseSpan = { start: string; end: string; kind: PhaseKind; label?: string | null };

/** Phases where lower performances are fatigue first, not lost strength. */
export const FATIGUE_PHASES: ReadonlySet<PhaseKind> = new Set([
  "accumulation",
  "recovery",
  "cut",
  "illness",
  "injury",
]);

export type MeetEvidence = {
  day: string;
  /** what was lifted (the caller's unit) */
  value: number;
  name: string | null;
  /** 1 unless the meet says less (an opener with two misses after it) */
  reliability?: number;
};

export type EstimateReason =
  | "first"
  | "meet"
  | "meet-under"
  | "up"
  | "agrees"
  | "lower-raise"
  | "fluctuation"
  | "fatigue-hold"
  | "fall"
  | "held"
  | "time-off"
  | "drift";

export type EstimatePoint = {
  day: string;
  value: number;
  state: EnvelopeState;
  /** the day of the evidence the value rests on */
  basis: string;
  /** 0–1 */
  confidence: number;
  reason: EstimateReason;
};

export type EstimatorInput = {
  sessions: SessionEvidence[];
  meets?: MeetEvidence[];
  phases?: PhaseSpan[];
  /** platform over training-day capacity (calibrate.ts) */
  premium?: number;
  /** what an exact set of 4+ reps is multiplied by to read like this athlete's singles (calibrate.ts) */
  repFactor?: number;
  /** 0.7–1: how consistent this athlete's RPE-read estimates are (calibrate.ts) */
  consistency?: number;
  /** carry the line to this day */
  until?: string;
  /** days the lift's family was trained some other way (a variation): not time off */
  activity?: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const addDays = (d: string, n: number) => new Date(dayMs(d) + n * DAY_MS).toISOString().slice(0, 10);
const daysFrom = (a: string, b: string) => (dayMs(b) - dayMs(a)) / DAY_MS;

export function phaseOn(phases: PhaseSpan[] | undefined, day: string): PhaseSpan | null {
  const all = phasesOn(phases, day);
  return all.find((p) => FATIGUE_PHASES.has(p.kind)) ?? all[all.length - 1] ?? null;
}

/** Every phase covering a day (a block, a cut and a pain report can overlap). */
export function phasesOn(phases: PhaseSpan[] | undefined, day: string): PhaseSpan[] {
  return (phases ?? []).filter((p) => p.start <= day && day <= p.end);
}

type Ev = { day: string; value: number; w: number; kind: "exact" | "lower" };

/** Days the estimate starts again: the first day of training after half a year with nothing of this lift's family. */
export function restartDays(
  sessions: Array<{ day: string }>,
  meets: Array<{ day: string }>,
  activity: string[] = [],
): string[] {
  const timeline = [...new Set([...activity, ...sessions.map((s) => s.day), ...meets.map((m) => m.day)])].sort();
  return timeline.filter((d, i) => i > 0 && daysFrom(timeline[i - 1], d) > R.FRESH_START_DAYS);
}

export function estimateLine(input: EstimatorInput): EstimatePoint[] {
  const sessions = input.sessions.filter((s) => !s.outlier);
  const meets = (input.meets ?? []).filter((m) => m.value > 0);
  const premium = input.premium && input.premium > 0 ? input.premium : R.DEFAULT_PEAK_PREMIUM;
  const repFactor = input.repFactor && input.repFactor > 0 ? input.repFactor : 1;
  const consistency = input.consistency ?? 1;
  const byDay = new Map(sessions.map((s) => [s.day, s]));
  const activity = [...new Set(input.activity ?? [])].sort();
  const restarts = restartDays(sessions, meets, activity);
  let restartsDone = 0;
  const lastActivityBefore = (d: string, own: string | null) => {
    let a = own;
    for (const x of activity) {
      if (x >= d) break;
      if (!a || x > a) a = x;
    }
    return a;
  };
  const meetsByDay = new Map<string, MeetEvidence[]>();
  for (const m of meets) meetsByDay.set(m.day, [...(meetsByDay.get(m.day) ?? []), m]);

  const days = [...new Set([...sessions.map((s) => s.day), ...meets.map((m) => m.day)])].sort();
  if (input.until && days.length && input.until > days[days.length - 1]) days.push(input.until);

  const out: EstimatePoint[] = [];
  let V: number | null = null;
  let basis = "";
  let basisBand: RepBand = "low";
  let state: EnvelopeState = "floor";
  let everExact = false;
  let anchor = { value: 0, day: "" };
  let lastExactDay: string | null = null;
  let lastActivityDay: string | null = null;
  let bestLowerSinceExact = 0;
  let recoveryUntil = "";
  let lowers: Array<{ day: string; value: number; band: RepBand }> = [];
  let declineFrom: number | null = null;
  const evid: Ev[] = [];

  const fatigueOn = (d: string) => {
    return (
      phasesOn(input.phases, d).some((p) => FATIGUE_PHASES.has(p.kind)) ||
      (recoveryUntil !== "" && d <= recoveryUntil)
    );
  };
  const settle = (d: string, value: number) => {
    V = r1(value);
    anchor = { value: V, day: d };
  };

  for (const d of days) {
    let reason: EstimateReason = "held";
    let moved = false;

    // 0. a long time away: the old estimate is history, not today's strength
    let restart = false;
    while (restartsDone < restarts.length && restarts[restartsDone] <= d) {
      restart = true;
      restartsDone++;
    }
    const activeDay = lastActivityBefore(d, lastActivityDay);
    if (V != null && (restart || (activeDay && daysFrom(activeDay, d) > R.FRESH_START_DAYS))) {
      V = null;
      basis = "";
      state = "floor";
      everExact = false;
      lastExactDay = null;
      bestLowerSinceExact = 0;
      lowers = [];
      declineFrom = null;
      evid.length = 0;
    }

    // 1. time off / no hard set: fade from the last value evidence set
    if (V != null) {
      const sinceActivity = activeDay ? daysFrom(activeDay, d) : 0;
      const sinceHard = lastExactDay ? daysFrom(lastExactDay, d) : 0;
      const timeOff =
        sinceActivity > R.INTERRUPTION_DAYS
          ? Math.min(R.MAX_TIME_OFF_LOSS, ((sinceActivity - R.INTERRUPTION_DAYS) / 7) * R.TIME_OFF_LOSS_PER_WEEK)
          : 0;
      const drift =
        everExact && sinceHard > R.NO_HARD_SET_DRIFT_AFTER_DAYS
          ? Math.min(R.MAX_NO_HARD_SET_DRIFT, ((sinceHard - R.NO_HARD_SET_DRIFT_AFTER_DAYS) / 7) * R.NO_HARD_SET_DRIFT_PER_WEEK)
          : 0;
      if (timeOff > 0 || drift > 0) {
        const faded = timeOff >= drift ? anchor.value * (1 - timeOff) : Math.max(anchor.value * (1 - drift), bestLowerSinceExact);
        if (faded < V) {
          V = r1(faded);
          reason = timeOff >= drift ? "time-off" : "drift";
        }
      }
    }

    // 2. meets: what was lifted, read as training-day capacity
    for (const m of meetsByDay.get(d) ?? []) {
      const T = m.value / premium;
      const r = m.reliability ?? 1;
      if (V == null || state === "floor") {
        settle(d, V == null ? T : Math.max(T, V));
        reason = "meet";
      } else if (T >= V * (1 - R.AGREE_BAND)) {
        settle(d, T > V ? T : V + R.AGREE_GAIN * (T - V));
        reason = "meet";
      } else {
        settle(d, V + R.MEET_UNDER_GAIN * r * (T - V));
        reason = "meet-under";
      }
      basis = d;
      basisBand = "low";
      state = "measured";
      everExact = true;
      lastExactDay = d;
      lastActivityDay = d;
      bestLowerSinceExact = 0;
      lowers = [];
      declineFrom = null;
      recoveryUntil = addDays(d, R.POST_MEET_RECOVERY_DAYS);
      evid.push({ day: d, value: T, w: 1.2 * r, kind: "exact" });
      moved = true;
    }

    // 3. the session
    const s = byDay.get(d);
    if (s) {
      lastActivityDay = d;
      if (s.kind === "exact") {
        const x = s.e1rm * (s.band === "low" ? 1 : repFactor);
        const r = Math.min(1, s.reliability * consistency);
        evid.push({ day: d, value: x, w: r, kind: "exact" });
        if (V == null || state === "floor") {
          settle(d, V == null || x >= V ? x : V + 0.5 * (x - V));
          reason = "first";
          basis = d;
          basisBand = s.band;
          state = "measured";
          lowers = [];
          declineFrom = null;
        } else if (x > V * (1 + R.AGREE_BAND)) {
          settle(d, V + r * (x - V));
          reason = "up";
          basis = d;
          basisBand = s.band;
          state = "measured";
          lowers = [];
          declineFrom = null;
        } else if (x >= V * (1 - R.AGREE_BAND) && !(declineFrom != null && x < V)) {
          settle(d, V + R.AGREE_GAIN * r * (x - V));
          reason = "agrees";
          basis = d;
          basisBand = s.band;
          state = "measured";
          lowers = [];
          declineFrom = null;
        } else {
          // under the estimate: a decline only when it's sustained
          if (declineFrom == null) declineFrom = V;
          lowers = [...lowers, { day: d, value: x, band: s.band }].filter(
            (l) => daysFrom(l.day, d) <= R.FALL_WINDOW_DAYS,
          );
          const fatigue = fatigueOn(d);
          const extra = fatigue ? R.FATIGUE_EXTRA_SESSIONS : 0;
          const rateFactor = fatigue ? R.FATIGUE_RATE_FACTOR : 1;
          const comparable = lowers.filter((l) => l.band === basisBand);
          let run: typeof lowers | null = null;
          let rate = 0;
          if (comparable.length >= R.FALL_SESSIONS + extra) {
            run = comparable;
            rate = R.MAX_FALL_PER_WEEK * rateFactor;
          } else if (
            lowers.length >= R.FALL_SESSIONS_OTHER_BAND + extra &&
            daysFrom(lowers[0].day, d) >= R.FALL_SPAN_DAYS_OTHER_BAND
          ) {
            run = lowers;
            rate = R.MAX_FALL_PER_WEEK_OTHER_BAND * rateFactor;
          }
          if (run) {
            const best = run.reduce((a, l) => (l.value > a.value ? l : a));
            const weeks = Math.max(1, daysFrom(run[0].day, d) / 7);
            const floor = (declineFrom ?? V) * (1 - rate * weeks);
            const next = Math.min(V, Math.max(best.value, floor));
            if (next < V) {
              settle(d, next);
              reason = "fall";
              basis = best.day;
              basisBand = best.band;
              state = "measured";
            } else reason = fatigue ? "fatigue-hold" : "fluctuation";
          } else {
            reason = fatigue ? "fatigue-hold" : "fluctuation";
            state = "held";
          }
        }
        everExact = true;
        lastExactDay = d;
        bestLowerSinceExact = 0;
        moved = true;
      }
      const lb = s.kind === "lower" ? s.e1rm : s.lowerBound;
      if (lb != null && lb > 0) {
        const rl = s.kind === "lower" ? s.reliability : 0.8 * s.reliability;
        evid.push({ day: d, value: lb, w: 0.25 * rl, kind: "lower" });
        bestLowerSinceExact = Math.max(bestLowerSinceExact, lb);
        if (V == null) {
          settle(d, lb);
          basis = d;
          basisBand = s.band;
          state = "floor";
          reason = "first";
          moved = true;
        } else if (lb > V) {
          const gain = R.LOWER_BOUND_GAIN * Math.min(1, rl / 0.8);
          settle(d, V + gain * (lb - V));
          basis = d;
          if (state !== "floor") state = "raised";
          reason = "lower-raise";
          moved = true;
        }
        // still at least this strong: a decline in progress isn't sustained
        if (V != null && lb >= V * (1 - R.AGREE_BAND)) {
          lowers = [];
          declineFrom = null;
        }
      }
    }

    if (V == null) continue;
    if (!moved && state !== "floor") {
      const since = lastExactDay ? daysFrom(lastExactDay, d) : Infinity;
      state = since > R.STALE_DAYS ? "stale" : "held";
    }

    // confidence: the evidence behind it, fading, counting less where it disagrees
    let mass = 0;
    for (const e of evid) {
      const age = daysFrom(e.day, d);
      if (age < 0) continue;
      const fade = 0.5 ** (age / R.CONFIDENCE_HALF_LIFE_DAYS);
      const rel = (e.value - V) / V;
      const agree =
        e.kind === "lower"
          ? rel <= R.AGREE_BAND
            ? 0.5
            : 0.3
          : Math.abs(rel) <= R.AGREE_BAND + 0.01
            ? 1
            : Math.abs(rel) <= 0.08
              ? 0.5
              : 0.2;
      mass += e.w * fade * agree;
    }
    let confidence = 1 - Math.exp(-mass);
    if (state === "floor") confidence *= 0.6;
    const sinceHard = lastExactDay ? daysFrom(lastExactDay, d) : 0;
    if (sinceHard > R.STALE_DAYS) confidence *= 0.5 ** ((sinceHard - R.STALE_DAYS) / R.STALE_CONFIDENCE_HALF_LIFE_DAYS);
    confidence *= consistency;
    out.push({
      day: d,
      value: V,
      state,
      basis: basis || d,
      confidence: Math.round(confidence * 100) / 100,
      reason,
    });
  }
  return out;
}

/** The line on a day (the last point on or before it), or null. */
export function lineAt<T extends { day: string }>(line: T[], day: string): T | null {
  let hit: T | null = null;
  for (const p of line) {
    if (p.day <= day) hit = p;
    else break;
  }
  return hit;
}
