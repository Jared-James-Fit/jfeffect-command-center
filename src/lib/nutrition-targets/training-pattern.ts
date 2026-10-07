/**
 * When does this client actually train? Built from logged workout start times
 * (pl_day_completions.started_at) in the client's time zone. Used by the
 * nutrition AI to place Pre-/Post-Workout meals when the form answer is
 * "It varies" or blank, and shown to the coach on the Nutrition panel.
 * Pure + deterministic so it can be tested.
 */

/** Same wording as the "What time do you usually train?" options. */
export const TRAINING_TIME_LABELS = {
  early: "Early morning (before 8am)",
  morning: "Morning (8–11am)",
  midday: "Midday (11am–2pm)",
  afternoon: "Afternoon (2–5pm)",
  evening: "Evening (5–8pm)",
  night: "Night (after 8pm)",
} as const;
export type TrainingBucket = keyof typeof TRAINING_TIME_LABELS;

export type TrainingPattern = {
  /** Distinct training days found (one per local date). */
  sessions: number;
  /** Median start, local time, e.g. "5:40pm". */
  typicalStart: string;
  bucket: TrainingBucket;
  /** Form-style label for the median, e.g. "Evening (5–8pm)". */
  label: string;
  /** Share of sessions starting within ±90 min of the median (0–1). */
  consistency: number;
  /** Enough sessions, tightly clustered: safe to plan around. */
  confident: boolean;
  /** Weekend sessions start far from weekdays (≥3 h apart), if so. */
  weekend: { sessions: number; typicalStart: string; label: string } | null;
  /** One plain line for the coach / AI. */
  summary: string;
};

export const MIN_SESSIONS = 4;
export const MIN_CONSISTENCY = 0.6;
const WINDOW_MIN = 90;

export function bucketFor(minutes: number): TrainingBucket {
  if (minutes < 8 * 60) return "early";
  if (minutes < 11 * 60) return "morning";
  if (minutes < 14 * 60) return "midday";
  if (minutes < 17 * 60) return "afternoon";
  if (minutes < 20 * 60) return "evening";
  return "night";
}

export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm}${h24 < 12 ? "am" : "pm"}`;
}

function localParts(iso: string | Date, tz: string): { date: string; minutes: number; weekend: boolean } | null {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    }).formatToParts(d);
  } catch {
    return localParts(d, "UTC");
  }
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: hour * 60 + Number(p.minute),
    weekend: p.weekday === "Sat" || p.weekday === "Sun",
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Summarise workout start times. Returns null with no sessions. One session
 * per local day (the earliest start), so double-completions don't skew it.
 */
export function summarizeTrainingTimes(starts: Array<string | Date | null | undefined>, tz: string): TrainingPattern | null {
  const byDay = new Map<string, { minutes: number; weekend: boolean }>();
  for (const s of starts) {
    if (!s) continue;
    const lp = localParts(s, tz);
    if (!lp) continue;
    const cur = byDay.get(lp.date);
    if (!cur || lp.minutes < cur.minutes) byDay.set(lp.date, { minutes: lp.minutes, weekend: lp.weekend });
  }
  const days = [...byDay.values()];
  if (!days.length) return null;

  const all = days.map((d) => d.minutes);
  const med = median(all);
  const consistency = all.filter((m) => Math.abs(m - med) <= WINDOW_MIN).length / all.length;
  const confident = days.length >= MIN_SESSIONS && consistency >= MIN_CONSISTENCY;
  const bucket = bucketFor(med);

  let weekend: TrainingPattern["weekend"] = null;
  const we = days.filter((d) => d.weekend).map((d) => d.minutes);
  const wd = days.filter((d) => !d.weekend).map((d) => d.minutes);
  if (we.length >= 2 && wd.length >= 2) {
    const weMed = median(we);
    if (Math.abs(weMed - median(wd)) >= 180) {
      weekend = { sessions: we.length, typicalStart: formatClock(weMed), label: TRAINING_TIME_LABELS[bucketFor(weMed)] };
    }
  }

  const n = days.length;
  const workouts = `${n} logged workout${n === 1 ? "" : "s"}`;
  let summary: string;
  if (confident) {
    summary = `${workouts}: usually starts around ${formatClock(med)} — ${TRAINING_TIME_LABELS[bucket]}.`;
    if (weekend) summary += ` Weekends usually around ${weekend.typicalStart}.`;
  } else if (n < MIN_SESSIONS) {
    summary = `${workouts} (around ${formatClock(med)}) — too few to call a pattern yet.`;
  } else {
    summary = `${workouts}: start times vary (middle of the range ${formatClock(med)}).`;
  }

  return {
    sessions: n,
    typicalStart: formatClock(med),
    bucket,
    label: TRAINING_TIME_LABELS[bucket],
    consistency: Math.round(consistency * 100) / 100,
    confident,
    weekend,
    summary,
  };
}
