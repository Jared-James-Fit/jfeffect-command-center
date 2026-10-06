/**
 * Pure mapping from Oura Cloud API v2 collections to our DailyMetric shape.
 * No network, no secrets, so it is unit-testable.
 *
 * Oura reports one document per day per collection, except `sleep`, which has one
 * document per sleep period (long_sleep, naps...). We take the longest `long_sleep`
 * of the day for duration/HRV/resting HR so naps never overwrite the night.
 */
import { emptyMetric, type DailyMetric } from "./providers";

type Doc = Record<string, unknown>;

export type OuraCollections = {
  daily_sleep: Doc[];
  daily_readiness: Doc[];
  daily_activity: Doc[];
  sleep: Doc[];
};

const num = (v: unknown): number | null => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
};
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};
const day = (d: Doc): string | null => {
  const v = d.day;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
/** Oura reports 0 for "no reading" on some fields; treat non-positive as missing. */
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

export function normalizeOura(c: OuraCollections): DailyMetric[] {
  const byDay = new Map<string, DailyMetric>();
  const get = (d: string) => {
    let m = byDay.get(d);
    if (!m) byDay.set(d, (m = emptyMetric(d)));
    return m;
  };

  for (const d of c.daily_sleep) {
    const k = day(d);
    if (k) get(k).sleep_score = int(d.score);
  }
  for (const d of c.daily_readiness) {
    const k = day(d);
    if (!k) continue;
    const m = get(k);
    m.readiness_score = int(d.score);
    const t = num(d.temperature_deviation);
    m.temp_deviation_c = t === null ? null : Math.round(t * 100) / 100;
  }
  for (const d of c.daily_activity) {
    const k = day(d);
    if (!k) continue;
    const m = get(k);
    m.steps = int(d.steps);
    m.active_kcal = int(d.active_calories);
    m.activity_score = int(d.score);
  }

  const longest = new Map<string, Doc>();
  for (const d of c.sleep) {
    const k = day(d);
    if (!k || d.type !== "long_sleep") continue;
    const cur = longest.get(k);
    if (!cur || (num(d.total_sleep_duration) ?? 0) > (num(cur.total_sleep_duration) ?? 0))
      longest.set(k, d);
  }
  for (const [k, d] of longest) {
    const m = get(k);
    const secs = positive(d.total_sleep_duration);
    m.sleep_minutes = secs === null ? null : Math.round(secs / 60);
    m.sleep_efficiency = int(d.efficiency);
    const hrv = positive(d.average_hrv);
    m.hrv_ms = hrv === null ? null : Math.round(hrv * 10) / 10;
    const rhr = positive(d.lowest_heart_rate);
    m.resting_hr = rhr === null ? null : Math.round(rhr * 10) / 10;
  }

  return [...byDay.values()].sort((a, b) => a.metric_date.localeCompare(b.metric_date));
}
