/**
 * How long a session takes, estimated from its prescription: working time per
 * rep, the rest between sets, moving between exercises (longer when the
 * station changes), warming up the first heavy barbell lift and changing
 * adjustable dumbbells. Calibrated, when there's enough of it, against how
 * long this athlete's logged sessions actually took. Deterministic.
 */
import { repRange } from "./core";
import { stationOf } from "./equipment";

export type TimedExercise = {
  name: string;
  equipment?: string | null;
  sets: number;
  reps: string | null;
  restSeconds: number | null;
  compound?: boolean;
};

const SECONDS_PER_REP = 4;
const SET_SETUP_S = 15;
const TRANSITION_S = 60;
const STATION_CHANGE_S = 90;
const BARBELL_WARMUP_S = 300;
const ADJUSTABLE_DB_CHANGE_S = 15;

export function isUnilateral(name: string, reps: string | null): boolean {
  return /each|per (leg|side|arm)|single[- ]?(leg|arm)|one[- ]?(leg|arm)|split squat|bulgarian|lunge|step[- ]up|unilateral/i.test(`${name} ${reps ?? ""}`);
}

/** The rest the app assumes when none is prescribed (compound barbell lifts rest longer). */
export function defaultRest(name: string, equipment?: string | null): number {
  const st = stationOf({ name, equipment });
  if (st === "barbell" || st === "landmine") return 150;
  if (/squat|deadlift|press|row|pull[- ]?up|chin|lunge|hip thrust|rdl/i.test(name)) return 105;
  return 75;
}

export function exerciseSeconds(x: TimedExercise, opts: { adjustableDumbbells?: boolean } = {}): number {
  const rr = repRange(x.reps);
  const reps = rr ? (rr[0] + rr[1]) / 2 : 8;
  const sides = isUnilateral(x.name, x.reps) ? 2 : 1;
  const rest = x.restSeconds ?? defaultRest(x.name, x.equipment);
  const work = x.sets * (reps * SECONDS_PER_REP * sides + SET_SETUP_S);
  const restTotal = Math.max(0, x.sets - 1) * rest + (sides === 2 ? x.sets * 20 : 0);
  const db = opts.adjustableDumbbells && stationOf(x) === "dumbbells" ? x.sets * ADJUSTABLE_DB_CHANGE_S : 0;
  return work + restTotal + db;
}

export type DayEstimate = { minutes: number; stationChanges: number; stations: string[] };

export function estimateDay(exercises: TimedExercise[], opts: { adjustableDumbbells?: boolean; calibration?: number } = {}): DayEstimate {
  let s = 0;
  let changes = 0;
  const stations: string[] = [];
  let firstBarbell = true;
  for (const [i, x] of exercises.entries()) {
    const st = stationOf(x);
    if (i > 0) {
      const changed = st !== stations[stations.length - 1];
      s += changed ? STATION_CHANGE_S : TRANSITION_S;
      if (changed) changes++;
    }
    if (!stations.length || stations[stations.length - 1] !== st) stations.push(st);
    if (firstBarbell && (st === "barbell" || st === "landmine")) {
      s += BARBELL_WARMUP_S;
      firstBarbell = false;
    }
    s += exerciseSeconds(x, opts);
  }
  const cal = opts.calibration && Number.isFinite(opts.calibration) ? opts.calibration : 1;
  return { minutes: Math.round((s / 60) * cal), stationChanges: changes, stations };
}

/**
 * How this athlete's real sessions compare with the estimate for the same
 * workouts: median of actual / estimated over sessions with a logged
 * duration, kept within 0.75–1.4 (so one odd session can't skew it). Null
 * when fewer than 4 sessions have a duration.
 */
export function calibrationFactor(pairs: Array<{ estimated: number; actual: number }>): number | null {
  const ratios = pairs.filter((p) => p.estimated > 5 && p.actual >= 10 && p.actual <= 240).map((p) => p.actual / p.estimated).sort((a, b) => a - b);
  if (ratios.length < 4) return null;
  const mid = ratios.length >> 1;
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Math.round(Math.min(1.4, Math.max(0.75, median)) * 100) / 100;
}
