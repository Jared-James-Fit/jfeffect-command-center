/**
 * How long a workout actually took, kept apart from when it was typed in, and
 * how long the next one will likely take (Nov 25 2026). Pure, deterministic,
 * tested in session-duration.test.ts.
 *
 * Signals, strongest first:
 *  - a time the athlete or coach confirmed (the Session Time sheet,
 *    `training_started_at`) or corrected (`actual_duration_min` edited): measured;
 *  - the Workout Session clock (`elapsed_duration_seconds`) when the logged
 *    sets agree with it: measured;
 *  - the logged sets' own times (each set's `completed_at`) when they were
 *    logged as they were done: the span from the first to the last, plus the
 *    first set's lead-in, with every rest kept (a powerlifter's 8-minute rest
 *    is training), and a gap past `BREAK_MINUTES` read as a stop, not a rest:
 *    reconstructed, never shown as measured;
 *  - the plan's estimate, when the sets were typed in afterwards (many sets in
 *    a few minutes): estimated, never shown as measured.
 *
 * A clock left running (9 AM to 8 PM with every set between 9 and 10:40) is
 * never an 11-hour workout: the sets' span wins and says so.
 */

export type DurationSource = "confirmed" | "clock" | "sets" | "estimated";
export type DurationConfidence = "high" | "medium" | "low";

export type DurationInput = {
  startedAt?: string | null;
  completedAt?: string | null;
  /** athlete / coach-confirmed start (Session Time sheet) */
  trainingStartedAt?: string | null;
  /** minutes the athlete or coach typed for the session */
  correctedMin?: number | null;
  /** the Workout Session clock's elapsed seconds */
  clockSeconds?: number | null;
  /** when each logged working set was saved */
  setTimes?: readonly (string | number | Date | null | undefined)[] | null;
  /** the plan's estimate for this workout (minutes) */
  estimatedMin?: number | null;
};

export type SessionDuration = {
  /** best read of time spent training, minutes; null when nothing says */
  minutes: number | null;
  source: DurationSource;
  confidence: DurationConfidence;
  /** true only for confirmed / clock: what the UI may call measured */
  measured: boolean;
  /** the sets were typed in after the session (a burst), so entry time isn't training time */
  lateEntry: boolean;
  /** wall-clock from the start to Finish, minutes (may include a forgotten clock) */
  elapsedMin: number | null;
  /** when it was performed, as best known */
  performedStart: Date | null;
};

/** A gap between sets longer than this is a stop (a break, the logger left open), not a rest. */
export const BREAK_MINUTES = 45;
/** Lead-in before the first logged set (warm-up to the first working set). */
export const LEAD_IN_MINUTES = 10;
/** Sets typed this fast were entered afterwards: under this many seconds apiece. */
export const BURST_SECONDS_PER_SET = 25;
export const MIN_BURST_SETS = 4;
/** A session shorter or longer than this isn't one. */
export const MIN_SESSION_MINUTES = 5;
export const MAX_SESSION_MINUTES = 300;
/** The clock agrees with the sets when it's within this of their span (warm-up, cool-down). */
export const CLOCK_SLACK_MINUTES = 40;
/** ELAPSED_CLAMP_FALLBACK_SECONDS (workout-duration.ts): what an overnight clock was stored as. */
export const FORGOTTEN_CLOCK_SECONDS = 4 * 60 * 60;

const ms = (v: string | number | Date | null | undefined): number => {
  if (v == null) return NaN;
  const n = v instanceof Date ? v.getTime() : typeof v === "number" ? v : new Date(v).getTime();
  return Number.isFinite(n) ? n : NaN;
};
const plausible = (m: number | null | undefined): m is number =>
  m != null && Number.isFinite(m) && m >= MIN_SESSION_MINUTES && m <= MAX_SESSION_MINUTES;

/**
 * The sets' own times as training segments: split at a break, keep the
 * segment with the most sets (ties: the first), drop a later burst typed in.
 */
export function setSpan(times: readonly (string | number | Date | null | undefined)[] | null | undefined): {
  start: number;
  end: number;
  sets: number;
  burst: boolean;
} | null {
  const t = (times ?? []).map(ms).filter(Number.isFinite).sort((a, b) => a - b);
  if (!t.length) return null;
  const segments: number[][] = [[t[0]]];
  for (let i = 1; i < t.length; i++) {
    if (t[i] - t[i - 1] > BREAK_MINUTES * 60_000) segments.push([t[i]]);
    else segments[segments.length - 1].push(t[i]);
  }
  const isBurst = (s: number[]) =>
    s.length >= MIN_BURST_SETS && (s[s.length - 1] - s[0]) / 1000 < s.length * BURST_SECONDS_PER_SET;
  // a segment logged live beats a burst typed in later, whatever their sizes
  const live = segments.filter((s) => !isBurst(s));
  const pool = live.length ? live : segments;
  const best = pool.reduce((a, b) => (b.length > a.length ? b : a));
  return { start: best[0], end: best[best.length - 1], sets: best.length, burst: isBurst(best) };
}

export function sessionDuration(input: DurationInput): SessionDuration {
  const started = ms(input.startedAt);
  const completed = ms(input.completedAt);
  const elapsedMin = Number.isFinite(started) && Number.isFinite(completed) && completed >= started
    ? Math.round((completed - started) / 60_000)
    : null;
  const estimate = plausible(input.estimatedMin) ? Math.round(input.estimatedMin) : null;
  const span = setSpan(input.setTimes);
  const lateEntry = !!span?.burst;
  const spanMin = span && !span.burst ? Math.round((span.end - span.start) / 60_000) + LEAD_IN_MINUTES : null;
  const spanStart = span && !span.burst ? new Date(span.start - LEAD_IN_MINUTES * 60_000) : null;
  const base = { lateEntry, elapsedMin };

  // 1. What a person confirmed or typed.
  const confirmedStart = ms(input.trainingStartedAt);
  if (plausible(input.correctedMin)) {
    return {
      ...base, minutes: Math.round(input.correctedMin), source: "confirmed", confidence: "high", measured: true,
      performedStart: Number.isFinite(confirmedStart) ? new Date(confirmedStart) : spanStart ?? (Number.isFinite(started) ? new Date(started) : null),
    };
  }
  if (Number.isFinite(confirmedStart) && Number.isFinite(completed)) {
    const m = Math.round((completed - confirmedStart) / 60_000);
    if (plausible(m)) {
      return { ...base, minutes: m, source: "confirmed", confidence: "high", measured: true, performedStart: new Date(confirmedStart) };
    }
  }

  // 2. The session clock, when the sets agree with it (or there are none to disagree).
  // 14,400 s is workout-duration.ts's stand-in for a clock left overnight, never a session
  const clockMin = input.clockSeconds != null && input.clockSeconds > 0 && input.clockSeconds !== FORGOTTEN_CLOCK_SECONDS
    ? Math.round(input.clockSeconds / 60)
    : null;
  if (plausible(clockMin) && !lateEntry && (spanMin == null || clockMin <= spanMin + CLOCK_SLACK_MINUTES)) {
    return {
      ...base, minutes: clockMin, source: "clock", confidence: "high", measured: true,
      performedStart: Number.isFinite(started) ? new Date(started) : spanStart,
    };
  }

  // 3. The sets' own times, logged as they were done: every rest kept.
  if (spanMin != null && span && span.sets >= 3 && plausible(spanMin)) {
    return {
      ...base, minutes: spanMin, source: "sets",
      confidence: span.sets >= 6 ? "medium" : "low",
      measured: false, performedStart: spanStart,
    };
  }

  // 4. Typed in afterwards, or nothing to read: the plan's estimate, said as one.
  return {
    ...base, minutes: estimate, source: "estimated", confidence: "low", measured: false,
    performedStart: spanStart ?? (Number.isFinite(started) ? new Date(started) : null),
  };
}

/* -------------------------------------------------------------------------- */
/*  Personalized prediction                                                    */
/* -------------------------------------------------------------------------- */

export type DurationHistory = {
  /** the plan's estimate for that workout */
  estimatedMin: number | null | undefined;
  /** how long it took */
  actualMin: number | null | undefined;
  source: DurationSource;
};

export type DurationPrediction = {
  minutes: number;
  low: number;
  high: number;
  /** personal: from their own reliable sessions; estimate: the plan's estimate as is */
  basis: "personal" | "estimate";
  /** reliable sessions behind it */
  sessions: number;
};

/** Reliable sessions it takes before their own pace replaces the plan's estimate. */
export const MIN_PERSONAL_SESSIONS = 3;
/** Most recent sessions read. */
export const PREDICTION_WINDOW = 12;

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Each session's actual ÷ estimate, oldest first; only measured or reconstructed, outliers out. */
export function reliableRatios(history: readonly DurationHistory[]): number[] {
  const raw = history
    .filter((h) => h.source !== "estimated" && plausible(h.actualMin) && plausible(h.estimatedMin))
    .slice(-PREDICTION_WINDOW)
    .map((h) => (h.actualMin as number) / (h.estimatedMin as number))
    .filter((r) => r >= 0.4 && r <= 2.5);
  if (raw.length < MIN_PERSONAL_SESSIONS) return raw;
  // outliers by median absolute deviation (a session cut short, one with a long chat)
  const med = median(raw);
  const mad = median(raw.map((r) => Math.abs(r - med))) || 0.05;
  return raw.filter((r) => Math.abs(r - med) <= 3 * 1.4826 * mad);
}

const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);

/**
 * How long this workout will likely take: the plan's estimate scaled by how
 * their own reliable sessions compare with their estimates, with a range from
 * their own spread; the estimate itself (±10%) until there are enough.
 */
export function predictDuration(estimateMin: number | null | undefined, history: readonly DurationHistory[]): DurationPrediction | null {
  if (!plausible(estimateMin)) return null;
  const ratios = reliableRatios(history);
  if (ratios.length < MIN_PERSONAL_SESSIONS) {
    return { minutes: round5(estimateMin), low: round5(estimateMin * 0.9), high: round5(estimateMin * 1.1), basis: "estimate", sessions: ratios.length };
  }
  const r = median(ratios);
  const sorted = [...ratios].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
  const minutes = round5(estimateMin * r);
  return {
    minutes,
    low: Math.min(minutes, round5(estimateMin * q(0.2))),
    high: Math.max(minutes, round5(estimateMin * q(0.8))),
    basis: "personal",
    sessions: ratios.length,
  };
}

/** "1h 42m", "48m", "2h". */
export function formatHm(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return "";
  const t = Math.round(min);
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** A completion row (pl_day_completions) as the reader takes it, stored fields first. */
export function durationOfCompletion(
  c: {
    started_at?: string | null;
    completed_at?: string | null;
    training_started_at?: string | null;
    actual_duration_min?: number | null;
    elapsed_duration_seconds?: number | null;
    performed_duration_seconds?: number | null;
    duration_source?: string | null;
    duration_confidence?: string | null;
  } | null | undefined,
  extra: { setTimes?: DurationInput["setTimes"]; estimatedMin?: number | null } = {},
): SessionDuration | null {
  if (!c?.completed_at) return null;
  const stored = c.duration_source as DurationSource | null | undefined;
  if (stored && c.performed_duration_seconds != null && c.performed_duration_seconds > 0) {
    const measured = stored === "confirmed" || stored === "clock";
    return {
      minutes: Math.round(c.performed_duration_seconds / 60),
      source: stored,
      confidence: (c.duration_confidence as DurationConfidence) ?? (measured ? "high" : "low"),
      measured,
      lateEntry: false,
      elapsedMin: c.elapsed_duration_seconds ? Math.round(c.elapsed_duration_seconds / 60) : null,
      performedStart: c.training_started_at ? new Date(c.training_started_at) : c.started_at ? new Date(c.started_at) : null,
    };
  }
  // Before the stored read (older rows): actual_duration_min was the clock's, or a typed number.
  const clockSeconds = c.elapsed_duration_seconds ?? null;
  const typed =
    c.actual_duration_min != null && clockSeconds != null && Math.abs(c.actual_duration_min - Math.round(clockSeconds / 60)) > 1
      ? c.actual_duration_min
      : null;
  return sessionDuration({
    startedAt: c.started_at,
    completedAt: c.completed_at,
    trainingStartedAt: c.training_started_at,
    correctedMin: typed,
    clockSeconds: clockSeconds ?? (c.actual_duration_min != null ? c.actual_duration_min * 60 : null),
    setTimes: extra.setTimes,
    estimatedMin: extra.estimatedMin,
  });
}

/* -------------------------------------------------------------------------- */
/*  Analytics: average, estimate vs actual, weekly training time               */
/* -------------------------------------------------------------------------- */

export type DurationKind = "measured" | "reconstructed" | "estimated";

export const durationKindOf = (d: Pick<SessionDuration, "source">): DurationKind =>
  d.source === "confirmed" || d.source === "clock" ? "measured" : d.source === "sets" ? "reconstructed" : "estimated";

export type DurationStats = {
  /** mean of measured + reconstructed sessions, minutes */
  avgMin: number | null;
  sessions: number;
  /** of them, measured */
  measured: number;
  /** actual − estimate, mean minutes (positive = longer than planned), sessions with both */
  overEstimateMin: number | null;
  compared: number;
  /** mean training minutes per week over the weeks the range spans */
  weeklyMin: number | null;
};

const WEEK_MS = 7 * 86_400_000;

export function durationStats(
  sessions: readonly { start: Date; minutes: number | null; kind: DurationKind; estimatedMin?: number | null }[],
  range?: { start: Date; end: Date },
): DurationStats {
  const real = sessions.filter((s) => s.kind !== "estimated" && plausible(s.minutes));
  const avg = real.length ? real.reduce((a, s) => a + (s.minutes as number), 0) / real.length : null;
  const both = real.filter((s) => plausible(s.estimatedMin));
  const over = both.length >= 2
    ? both.reduce((a, s) => a + ((s.minutes as number) - (s.estimatedMin as number)), 0) / both.length
    : null;
  let weekly: number | null = null;
  if (real.length) {
    const from = range?.start.getTime() ?? Math.min(...real.map((s) => s.start.getTime()));
    const to = range?.end.getTime() ?? Math.max(...real.map((s) => s.start.getTime()));
    const weeks = Math.max(1, Math.round((to - from) / WEEK_MS));
    // every session counts toward time trained, an estimated one at its estimate
    const total = sessions.reduce((a, s) => a + (plausible(s.minutes) ? (s.minutes as number) : 0), 0);
    weekly = total / weeks;
  }
  return {
    avgMin: avg != null ? Math.round(avg) : null,
    sessions: real.length,
    measured: real.filter((s) => s.kind === "measured").length,
    overEstimateMin: over != null ? Math.round(over) : null,
    compared: both.length,
    weeklyMin: weekly != null ? Math.round(weekly) : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  The coach's brief: how long sessions take against the session limit        */
/* -------------------------------------------------------------------------- */

/**
 * Facts for Cleo and the client brief (client-intel): the sessions' real
 * length against their limit, said only from measured or reconstructed
 * sessions, each kind counted, never an estimate called a measurement.
 * "Sessions: median 92 min over the last 8 (5 measured, 3 from set times) vs
 * their 60-min PT session; 7 of 8 over (by about 30 min)."
 */
export function sessionLengthFacts(
  durations: readonly { minutes: number | null; kind: DurationKind }[],
  limit: { minutes: number | null; phrase: string },
  plannedMedianMin?: number | null,
): string[] {
  const real = durations.filter((d) => d.kind !== "estimated" && plausible(d.minutes)).map((d) => ({ m: d.minutes as number, kind: d.kind }));
  const lines: string[] = [];
  if (real.length < 2) {
    lines.push(`- Session length: not enough timed sessions to say (${real.length} with a measured or reconstructed length); the limit is ${limit.phrase}.`);
    return lines;
  }
  const mins = real.map((r) => r.m);
  const med = Math.round(median(mins));
  const measured = real.filter((r) => r.kind === "measured").length;
  const kinds = measured === real.length ? "all measured" : `${measured} measured, ${real.length - measured} reconstructed from set times`;
  let line = `- Session length: median ${med} min over the last ${real.length} (${kinds})`;
  if (limit.minutes != null) {
    const over = mins.filter((m) => m > limit.minutes! + 5);
    line += ` vs ${limit.phrase}`;
    line += over.length
      ? `; ${over.length} of ${real.length} over, by about ${Math.round(median(over.map((m) => m - limit.minutes!)))} min`
      : "; within it";
  }
  if (plannedMedianMin != null && plausible(plannedMedianMin)) line += `; the program's estimates are about ${Math.round(plannedMedianMin)} min`;
  lines.push(`${line}.`);
  if (limit.minutes != null && med > limit.minutes + 5) {
    lines.push(`- Sessions run longer than ${limit.phrase}: fit the work to the time (fewer sets or exercises, supersets, shorter rests on accessories) before adding anything.`);
  }
  return lines;
}
