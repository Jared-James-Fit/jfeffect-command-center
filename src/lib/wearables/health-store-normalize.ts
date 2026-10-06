/**
 * Pure mapping from phone health-store samples (Apple HealthKit / Android Health
 * Connect, as returned by @capgo/capacitor-health) to our DailyMetric shape.
 * Runs ON THE DEVICE, so "local date" is the athlete's own day. No I/O.
 *
 * Mirrors the Oura rules so the two stay comparable in spirit:
 *  - a night is attributed to its WAKE-UP date,
 *  - only the longest main sleep of that date counts (naps never replace the night),
 *  - HRV is the overnight average, never daytime spot checks,
 *  - missing is null, never 0.
 */
import { emptyMetric, METRIC_FIELDS, type DailyMetric } from "./providers";

export type HealthSample = {
  value: number;
  startDate: string;
  endDate: string;
  sourceName?: string;
  sourceId?: string;
  sleepState?: string;
  stages?: { startDate: string; endDate: string; stage: string }[];
};
export type AggregatedBucket = { startDate: string; value: number };

export type HealthStoreInput = {
  steps?: AggregatedBucket[];
  activeKcal?: AggregatedBucket[];
  sleep?: HealthSample[];
  hrv?: HealthSample[];
  restingHr?: HealthSample[];
};

export const ASLEEP_STATES = new Set(["asleep", "rem", "deep", "light"]);
/** Segments closer than this belong to one sleep session (brief wake-ups, sensor gaps). */
const SESSION_GAP_MIN = 60;
/** Shorter than this is a nap or an incomplete recording, not a night. */
export const MIN_MAIN_SLEEP_MIN = 180;

const MIN = 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

export function deviceLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Interval = { start: number; end: number };
type Session = { start: number; end: number; minutes: number; source: string };

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function segmentsOf(sample: HealthSample): Interval[] {
  const raw = sample.stages?.length
    ? sample.stages.map((s) => ({ start: s.startDate, end: s.endDate, state: s.stage }))
    : [{ start: sample.startDate, end: sample.endDate, state: sample.sleepState ?? "asleep" }];
  const out: Interval[] = [];
  for (const r of raw) {
    if (!ASLEEP_STATES.has(r.state)) continue; // inBed / awake are not sleep
    const start = Date.parse(r.start);
    const end = Date.parse(r.end);
    if (finite(start) && finite(end) && end > start) out.push({ start, end });
  }
  return out;
}

/** Union of overlapping intervals (two apps writing the same night must not double count). */
function union(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

function sessionsBySource(samples: HealthSample[]): Session[] {
  const bySource = new Map<string, Interval[]>();
  for (const s of samples) {
    const key = s.sourceName ?? s.sourceId ?? "unknown";
    const list = bySource.get(key) ?? [];
    list.push(...segmentsOf(s));
    bySource.set(key, list);
  }
  const sessions: Session[] = [];
  for (const [source, ivs] of bySource) {
    let cur: { start: number; end: number; minutes: number } | null = null;
    for (const iv of union(ivs)) {
      if (cur && iv.start - cur.end <= SESSION_GAP_MIN * MIN) {
        cur.minutes += (iv.end - iv.start) / MIN;
        cur.end = iv.end;
      } else {
        if (cur) sessions.push({ ...cur, source });
        cur = { start: iv.start, end: iv.end, minutes: (iv.end - iv.start) / MIN };
      }
    }
    if (cur) sessions.push({ ...cur, source });
  }
  return sessions;
}

export function normalizeHealthStore(
  input: HealthStoreInput,
  toLocalDate: (iso: string) => string = deviceLocalDate,
): DailyMetric[] {
  const byDay = new Map<string, DailyMetric>();
  const get = (d: string) => {
    let m = byDay.get(d);
    if (!m) byDay.set(d, (m = emptyMetric(d)));
    return m;
  };

  for (const b of input.steps ?? []) {
    if (finite(b.value) && b.value > 0) get(toLocalDate(b.startDate)).steps = Math.round(b.value);
  }
  for (const b of input.activeKcal ?? []) {
    if (finite(b.value) && b.value > 0)
      get(toLocalDate(b.startDate)).active_kcal = Math.round(b.value);
  }

  // Best main-sleep session per wake-up date (largest across sources, then longest).
  const mainByDate = new Map<string, Session>();
  for (const s of sessionsBySource(input.sleep ?? [])) {
    if (s.minutes < MIN_MAIN_SLEEP_MIN) continue;
    const date = toLocalDate(new Date(s.end).toISOString());
    const cur = mainByDate.get(date);
    if (!cur || s.minutes > cur.minutes) mainByDate.set(date, s);
  }
  for (const [date, s] of mainByDate) {
    const m = get(date);
    m.sleep_minutes = Math.min(1440, Math.round(s.minutes));
    const overnight = (input.hrv ?? []).filter((h) => {
      const mid = (Date.parse(h.startDate) + Date.parse(h.endDate)) / 2;
      return finite(h.value) && h.value > 0 && mid >= s.start && mid <= s.end;
    });
    if (overnight.length) {
      const avg = overnight.reduce((a, h) => a + h.value, 0) / overnight.length;
      m.hrv_ms = Math.round(avg * 10) / 10;
    }
  }

  // Resting HR: the latest reading of each local day.
  const rhr = new Map<string, HealthSample>();
  for (const r of input.restingHr ?? []) {
    if (!finite(r.value) || r.value <= 0) continue;
    const date = toLocalDate(r.endDate);
    const cur = rhr.get(date);
    if (!cur || Date.parse(r.endDate) > Date.parse(cur.endDate)) rhr.set(date, r);
  }
  for (const [date, r] of rhr) get(date).resting_hr = Math.round(r.value * 10) / 10;

  return [...byDay.values()]
    .filter((m) => METRIC_FIELDS.some((f) => m[f] != null))
    .sort((a, b) => a.metric_date.localeCompare(b.metric_date));
}
