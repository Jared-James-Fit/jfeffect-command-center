/**
 * Training load vs recovery. Pure functions, no I/O.
 *
 * Two questions a coach actually asks:
 *  1. "Is this athlete ramping load faster than they've been adapting?"  -> loadRamp
 *  2. "How does THIS athlete's recovery respond to hard days vs rest?"    -> nextMorningResponse
 *
 * These are descriptive, per-athlete, small-sample statistics, not predictions. Every
 * output carries its sample size and returns null instead of guessing when the data is
 * too thin. Recovery series must come from ONE source (see summarizeRecoveryFromRows).
 */
import { baseline } from "./analytics";
import type { DailyMetric } from "./providers";

export type TrainingDay = {
  day: string; // YYYY-MM-DD, athlete-local
  sets: number;
  hard_sets: number; // RPE >= 8
  tonnage_kg: number;
  avg_rpe: number | null;
};

const DAY_MS = 24 * 3600 * 1000;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (n: number) => Math.round(n * 10) / 10;

export type LoadRamp = {
  /** Hard sets in the last 7 days (ending `asOf`, inclusive). */
  acuteHardSets: number;
  /** Average hard sets per week over the 28 days ending `asOf`. */
  chronicWeeklyHardSets: number;
  ratio: number | null;
  state: "ramping" | "steady" | "dropping" | "unknown";
};

/**
 * Acute 7-day hard sets vs the 28-day weekly average. Ratio > 1.5 = a sharp spike
 * (flag), < 0.6 = a drop. Needs ≥ 3 weeks of history so the "chronic" figure is real.
 * Hard sets (RPE >= 8) rather than tonnage, so a deload at the same weights reads as
 * lower and a high-rep back-off block does not read as a spike.
 */
export function loadRamp(days: TrainingDay[], asOf: string): LoadRamp | null {
  if (!days.length) return null;
  const inWindow = (d: TrainingDay, n: number) => d.day <= asOf && d.day > addDays(asOf, -n);
  const first = days.reduce((a, d) => (d.day < a ? d.day : a), days[0].day);
  const acute = days.filter((d) => inWindow(d, 7)).reduce((a, d) => a + d.hard_sets, 0);
  const chronicTotal = days.filter((d) => inWindow(d, 28)).reduce((a, d) => a + d.hard_sets, 0);
  const chronicWeekly = chronicTotal / 4;
  const historyDays =
    Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS) + 1;
  if (historyDays < 21 || chronicWeekly < 1) {
    return {
      acuteHardSets: acute,
      chronicWeeklyHardSets: round1(chronicWeekly),
      ratio: null,
      state: "unknown",
    };
  }
  const ratio = Math.round((acute / chronicWeekly) * 100) / 100;
  return {
    acuteHardSets: acute,
    chronicWeeklyHardSets: round1(chronicWeekly),
    ratio,
    state: ratio > 1.5 ? "ramping" : ratio < 0.6 ? "dropping" : "steady",
  };
}

export type ResponseGroup = {
  n: number;
  avgHrvPct: number | null; // next-morning HRV vs the athlete's 14-day baseline, %
  avgRestingHrDeltaBpm: number | null;
};

export type NextMorningResponse = {
  /** Hard days = sets at or above the athlete's own 66th percentile of hard sets (min 3). */
  hardThresholdHardSets: number;
  afterHard: ResponseGroup;
  afterRest: ResponseGroup;
  /** Enough in BOTH groups to say anything. Otherwise show the numbers, never the sentence. */
  reliable: boolean;
};

const MIN_PER_GROUP = 4;

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/**
 * How does recovery the morning AFTER respond to this athlete's hard days vs rest days?
 * "Morning after training day D" is recovery day D+1 (overnight data is attributed to
 * the wake-up date, in both the Oura and phone adapters).
 */
export function nextMorningResponse(
  train: TrainingDay[],
  recovery: DailyMetric[],
): NextMorningResponse | null {
  const trained = train.filter((d) => d.sets > 0);
  if (trained.length < MIN_PER_GROUP) return null;

  const hardSetCounts = trained.map((d) => d.hard_sets).sort((a, b) => a - b);
  const threshold = Math.max(3, percentile(hardSetCounts, 0.66));
  const trainedDays = new Set(trained.map((d) => d.day));
  const hardDays = trained.filter((d) => d.hard_sets >= threshold).map((d) => d.day);

  const byDate = new Map(recovery.map((r) => [r.metric_date, r]));
  const firstRecovery = recovery.length ? recovery[0].metric_date : null;
  const lastRecovery = recovery.length ? recovery[recovery.length - 1].metric_date : null;
  if (!firstRecovery || !lastRecovery) return null;

  const respond = (days: string[]): ResponseGroup => {
    const hrv: number[] = [];
    const rhr: number[] = [];
    let n = 0;
    for (const d of days) {
      const next = addDays(d, 1);
      const r = byDate.get(next);
      if (!r) continue;
      let counted = false;
      if (r.hrv_ms != null) {
        const base = baseline(recovery, "hrv_ms", next);
        if (base) {
          hrv.push(((r.hrv_ms - base) / base) * 100);
          counted = true;
        }
      }
      if (r.resting_hr != null) {
        const base = baseline(recovery, "resting_hr", next);
        if (base != null) {
          rhr.push(r.resting_hr - base);
          counted = true;
        }
      }
      if (counted) n++;
    }
    return {
      n,
      avgHrvPct: hrv.length ? round1(mean(hrv)) : null,
      avgRestingHrDeltaBpm: rhr.length ? round1(mean(rhr)) : null,
    };
  };

  // Rest days: no logged training, inside the span we have recovery data for.
  const restDays: string[] = [];
  for (let d = addDays(firstRecovery, -1); d <= lastRecovery; d = addDays(d, 1)) {
    if (!trainedDays.has(d)) restDays.push(d);
  }

  const afterHard = respond(hardDays);
  const afterRest = respond(restDays);
  return {
    hardThresholdHardSets: threshold,
    afterHard,
    afterRest,
    reliable: afterHard.n >= MIN_PER_GROUP && afterRest.n >= MIN_PER_GROUP,
  };
}
