/**
 * Pure analytics over normalized wearable metrics. No I/O.
 *
 * Principle: trends against the athlete's OWN baseline, never absolute cutoffs and
 * never one bad night. A lifter with a 45 ms HRV and one with a 90 ms HRV are both
 * fine; a 20% drop from either one's baseline is the signal.
 */
import { METRIC_FIELDS, type DailyMetric, type MetricField } from "./providers";

export type StoredMetric = DailyMetric & { provider: string };

/**
 * Collapse multiple providers into one record per day. For each field the first
 * provider in `priority` that has a value wins (e.g. ring beats phone for HRV).
 */
export function resolveDaily(rows: StoredMetric[], priority: string[] = []): DailyMetric[] {
  const rank = (p: string) => {
    const i = priority.indexOf(p);
    return i === -1 ? priority.length : i;
  };
  const byDate = new Map<string, StoredMetric[]>();
  for (const r of rows) {
    const list = byDate.get(r.metric_date) ?? [];
    list.push(r);
    byDate.set(r.metric_date, list);
  }
  const out: DailyMetric[] = [];
  for (const [date, list] of byDate) {
    list.sort((a, b) => rank(a.provider) - rank(b.provider));
    const m: any = { metric_date: date };
    for (const f of METRIC_FIELDS) m[f] = list.find((r) => r[f] != null)?.[f] ?? null;
    out.push(m);
  }
  return out.sort((a, b) => a.metric_date.localeCompare(b.metric_date));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Mean of the `window` days BEFORE `date` that have a value. Returns null with
 * fewer than `minPoints` readings, so a new connection does not produce fake baselines.
 */
export function baseline(
  series: DailyMetric[],
  field: MetricField,
  date: string,
  window = 14,
  minPoints = 5,
): number | null {
  const prior = series
    .filter((d) => d.metric_date < date && d[field] != null)
    .slice(-window)
    .map((d) => d[field] as number);
  return prior.length >= minPoints ? mean(prior) : null;
}

export type RecoveryState = "good" | "watch" | "low" | "unknown";

export type RecoverySummary = {
  date: string;
  state: RecoveryState;
  /** Human reasons, only for signals that actually fired. */
  reasons: string[];
  hrvPctVsBaseline: number | null;
  restingHrDeltaBpm: number | null;
  sleepHours: number | null;
  sleepHoursVsBaseline: number | null;
};

const pct = (value: number, base: number) => Math.round(((value - base) / base) * 1000) / 10;

/**
 * Compare the latest day to the athlete's own 14-day baseline.
 *  - HRV: down >=15% = flag (>=25% = strong)
 *  - Resting HR: up >=5 bpm = flag (>=8 = strong)
 *  - Sleep: >=1h under baseline AND under 6.5h = flag
 * 0 flags = good, 1 = watch, 2+ or any strong = low. Needs at least one comparable signal.
 */
export function summarizeRecovery(series: DailyMetric[]): RecoverySummary | null {
  const latest = [...series]
    .reverse()
    .find((d) => d.hrv_ms != null || d.resting_hr != null || d.sleep_minutes != null);
  if (!latest) return null;

  const reasons: string[] = [];
  let flags = 0;
  let strong = false;
  let comparable = 0;

  const hrvBase = latest.hrv_ms != null ? baseline(series, "hrv_ms", latest.metric_date) : null;
  const hrvPct = hrvBase && latest.hrv_ms != null ? pct(latest.hrv_ms, hrvBase) : null;
  if (hrvPct !== null) {
    comparable++;
    if (hrvPct <= -15) {
      flags++;
      reasons.push(`HRV ${Math.abs(hrvPct)}% below your baseline`);
      if (hrvPct <= -25) strong = true;
    }
  }

  const rhrBase =
    latest.resting_hr != null ? baseline(series, "resting_hr", latest.metric_date) : null;
  const rhrDelta =
    rhrBase && latest.resting_hr != null
      ? Math.round((latest.resting_hr - rhrBase) * 10) / 10
      : null;
  if (rhrDelta !== null) {
    comparable++;
    if (rhrDelta >= 5) {
      flags++;
      reasons.push(`Resting HR ${rhrDelta} bpm above baseline`);
      if (rhrDelta >= 8) strong = true;
    }
  }

  const sleepBase =
    latest.sleep_minutes != null ? baseline(series, "sleep_minutes", latest.metric_date) : null;
  const sleepH =
    latest.sleep_minutes != null ? Math.round((latest.sleep_minutes / 60) * 10) / 10 : null;
  const sleepVs =
    sleepBase != null && latest.sleep_minutes != null
      ? Math.round(((latest.sleep_minutes - sleepBase) / 60) * 10) / 10
      : null;
  if (sleepVs !== null) {
    comparable++;
    if (sleepVs <= -1 && (latest.sleep_minutes as number) < 390) {
      flags++;
      reasons.push(`Slept ${sleepH}h, ${Math.abs(sleepVs)}h under baseline`);
    }
  }

  const state: RecoveryState =
    comparable === 0 ? "unknown" : strong || flags >= 2 ? "low" : flags === 1 ? "watch" : "good";
  return {
    date: latest.metric_date,
    state,
    reasons,
    hrvPctVsBaseline: hrvPct,
    restingHrDeltaBpm: rhrDelta,
    sleepHours: sleepH,
    sleepHoursVsBaseline: sleepVs,
  };
}

/** Trailing average over the last `days` calendar days ending at the latest row. */
export function trailingAverage(
  series: DailyMetric[],
  field: MetricField,
  days = 7,
): number | null {
  if (!series.length) return null;
  const last = series[series.length - 1].metric_date;
  const cutoff = new Date(`${last}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const from = cutoff.toISOString().slice(0, 10);
  const xs = series
    .filter((d) => d.metric_date >= from && d[field] != null)
    .map((d) => d[field] as number);
  return xs.length ? Math.round(mean(xs) * 10) / 10 : null;
}
