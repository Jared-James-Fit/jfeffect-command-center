/**
 * Training Time analytics — when the athlete trains, for how long, and
 * whether the clock correlates with how strong they are.
 *
 * Pure functions only; the card does the fetching. Times are always read in
 * the athlete's own timezone (clients.timezone), never the viewer's, so a
 * coach in another province sees the same "5:40 PM" the athlete does.
 *
 * Strength is scored with RPE-adjusted e1RM relative to the athlete's own
 * recent best on the same exercise. RPE adjustment is what makes this fair:
 * a 5 @ 7 volume day and a single @ 9 heavy day land on the same scale, so a
 * window doesn't "win" just because heavy days happened to be scheduled there.
 */
import { parseRpe, percentOf1RM } from "@/lib/load-suggestion";

export const DEFAULT_TRAINING_TZ = "America/Winnipeg";

/** A session faster than this with real volume was logged after the fact. */
export const SUSPECT_MIN_MINUTES = 15;
export const SUSPECT_MIN_SETS = 6;
/** Longer than this is a forgotten timer, not a session. */
export const MAX_SESSION_MINUTES = 300;
/** Recent-best lookback for the strength index. */
export const STRENGTH_LOOKBACK_DAYS = 56;
/** Sessions per window before we'll compare it. */
export const MIN_WINDOW_SESSIONS = 3;

/* -------------------------------------------------------------------------- */
/*  Timezone helpers                                                          */
/* -------------------------------------------------------------------------- */

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
      });
    } catch {
      f = partsFormatter(DEFAULT_TRAINING_TZ);
    }
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedParts(date: Date, tz: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    weekday: Math.max(0, WEEKDAYS.indexOf(out.weekday)),
  };
}

function tzOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60000) * 60000;
}

/** "2026-10-07" + "17:40" in `tz` → the real instant. DST-safe. */
export function zonedWallTimeToDate(dateStr: string, timeStr: string, tz: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const t = /^(\d{1,2}):(\d{2})/.exec(timeStr);
  if (!d || !t) return null;
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  let ms = guess - tzOffsetMs(new Date(guess), tz);
  // Second pass lands on the right side of a DST change.
  ms = guess - tzOffsetMs(new Date(ms), tz);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

export function zonedDateInput(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function zonedTimeInput(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Minutes since midnight → "5:40 PM". Values past 24h wrap. */
export function formatClock(minutesOfDay: number): string {
  const m = ((Math.round(minutesOfDay) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${suffix}`;
}

export function formatClockAt(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return formatClock(p.hour * 60 + p.minute);
}

export function formatMinutes(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return "—";
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/* -------------------------------------------------------------------------- */
/*  Time-of-day windows                                                       */
/* -------------------------------------------------------------------------- */

export type WindowKey = "early" | "morning" | "midday" | "afternoon" | "evening" | "night";

export const TRAINING_WINDOWS: { key: WindowKey; label: string; range: string; from: number; to: number }[] = [
  { key: "early", label: "Early AM", range: "4–8 AM", from: 4, to: 8 },
  { key: "morning", label: "Morning", range: "8–11 AM", from: 8, to: 11 },
  { key: "midday", label: "Midday", range: "11 AM–2 PM", from: 11, to: 14 },
  { key: "afternoon", label: "Afternoon", range: "2–5 PM", from: 14, to: 17 },
  { key: "evening", label: "Evening", range: "5–8 PM", from: 17, to: 20 },
  { key: "night", label: "Night", range: "8 PM–4 AM", from: 20, to: 28 },
];

export function windowForHour(hour: number): WindowKey {
  const h = hour < 4 ? hour + 24 : hour;
  return TRAINING_WINDOWS.find((w) => h >= w.from && h < w.to)?.key ?? "night";
}

/** Minutes of day on a 4 AM → 4 AM axis, so 1 AM sorts after 11 PM. */
export function trainingDayMinutes(hour: number, minute: number): number {
  const m = hour * 60 + minute;
  return hour < 4 ? m + 1440 : m;
}

/* -------------------------------------------------------------------------- */
/*  Session timing                                                            */
/* -------------------------------------------------------------------------- */

export type TimeSource = "confirmed" | "tracked" | "suspect";

export type CompletionTimingInput = {
  startedAt: string | null;
  trainingStartedAt: string | null;
  completedAt: string;
  durationMin: number | null;
  loggedSets: number | null;
};

export type ResolvedTiming = {
  start: Date;
  durationMin: number | null;
  source: TimeSource;
};

const plausibleMinutes = (m: number | null | undefined): m is number =>
  m != null && Number.isFinite(m) && m > 0 && m <= MAX_SESSION_MINUTES;

/**
 * Pick the best start + duration for one completion and say how much to
 * trust it. "suspect" sessions are shown in the log (with a fix-it prompt)
 * but kept out of time-of-day and duration stats.
 */
export function resolveTiming(c: CompletionTimingInput): ResolvedTiming | null {
  const completed = new Date(c.completedAt);
  if (!Number.isFinite(completed.getTime())) return null;
  const stored = plausibleMinutes(c.durationMin) ? Math.round(c.durationMin) : null;

  if (c.trainingStartedAt) {
    const start = new Date(c.trainingStartedAt);
    if (Number.isFinite(start.getTime())) {
      const spanMin = (completed.getTime() - start.getTime()) / 60000;
      return { start, durationMin: stored ?? (plausibleMinutes(spanMin) ? Math.round(spanMin) : null), source: "confirmed" };
    }
  }

  const startedMs = c.startedAt ? new Date(c.startedAt).getTime() : NaN;
  const spanMin = Number.isFinite(startedMs) ? (completed.getTime() - startedMs) / 60000 : null;
  const durationMin = stored ?? (plausibleMinutes(spanMin) ? Math.round(spanMin!) : null);
  const start = Number.isFinite(startedMs)
    ? new Date(startedMs)
    : new Date(completed.getTime() - (durationMin ?? 0) * 60000);

  const sets = c.loggedSets ?? 0;
  const tooFast = durationMin != null && durationMin < SUSPECT_MIN_MINUTES && sets >= SUSPECT_MIN_SETS;
  const noClock = durationMin == null;
  const forgotten = spanMin != null && spanMin > MAX_SESSION_MINUTES && stored == null;
  return { start, durationMin, source: tooFast || noClock || forgotten ? "suspect" : "tracked" };
}

/* -------------------------------------------------------------------------- */
/*  Strength index (RPE-adjusted e1RM vs recent best)                         */
/* -------------------------------------------------------------------------- */

export type StrengthSet = {
  /** Session the set belongs to (completion id), or a date bucket. */
  sessionKey: string;
  /** When that session happened (ms). */
  at: number;
  exerciseKey: string;
  loadLb: number;
  reps: number;
  rpe: number | string | null;
  rir: number | string | null;
};

/** RPE-adjusted e1RM for a set, or null when effort wasn't logged / is unreliable. */
export function rpeAdjustedE1rm(loadLb: number, reps: number, rpe: number | string | null, rir: number | string | null): number | null {
  if (!(loadLb > 0) || !(reps >= 1) || reps > 10) return null;
  let r = parseRpe(rpe);
  if (r == null) {
    const n = rir == null || rir === "" ? NaN : parseFloat(String(rir));
    if (Number.isFinite(n) && n >= 0 && n <= 5) r = 10 - n;
  }
  if (r == null || r < 6) return null;
  const pct = percentOf1RM(reps, 10 - r);
  return pct ? loadLb / pct : null;
}

/**
 * Per-session strength index: the mean, across exercises, of today's best
 * RPE-adjusted e1RM ÷ the best on that exercise over the prior 8 weeks.
 * 100 = matched your recent best. Exercises with no prior history are skipped.
 */
export function strengthIndexBySession(sets: StrengthSet[]): Map<string, number> {
  const best = new Map<string, { at: number; e1rm: number; exerciseKey: string; sessionKey: string }>();
  for (const s of sets) {
    const e = rpeAdjustedE1rm(s.loadLb, s.reps, s.rpe, s.rir);
    if (e == null) continue;
    const k = `${s.sessionKey}::${s.exerciseKey}`;
    const prev = best.get(k);
    if (!prev || e > prev.e1rm) best.set(k, { at: s.at, e1rm: e, exerciseKey: s.exerciseKey, sessionKey: s.sessionKey });
  }
  const byExercise = new Map<string, { at: number; e1rm: number; sessionKey: string }[]>();
  for (const b of best.values()) {
    const list = byExercise.get(b.exerciseKey) ?? [];
    list.push(b);
    byExercise.set(b.exerciseKey, list);
  }
  const ratios = new Map<string, number[]>();
  const lookbackMs = STRENGTH_LOOKBACK_DAYS * 86_400_000;
  for (const list of byExercise.values()) {
    list.sort((a, b) => a.at - b.at);
    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      let ref = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (cur.at - list[j].at > lookbackMs) break;
        if (list[j].sessionKey !== cur.sessionKey) ref = Math.max(ref, list[j].e1rm);
      }
      if (ref <= 0) continue;
      // Clamp so a typo'd load can't swing a whole window.
      const ratio = Math.min(1.15, Math.max(0.8, cur.e1rm / ref));
      const arr = ratios.get(cur.sessionKey) ?? [];
      arr.push(ratio);
      ratios.set(cur.sessionKey, arr);
    }
  }
  const out = new Map<string, number>();
  for (const [k, arr] of ratios) out.set(k, (arr.reduce((s, n) => s + n, 0) / arr.length) * 100);
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Summary                                                                   */
/* -------------------------------------------------------------------------- */

export type TrainingSession = {
  id: string;
  dayId: string;
  title: string | null;
  start: Date;
  end: Date | null;
  durationMin: number | null;
  activeMin: number | null;
  source: TimeSource;
  /** Minutes on the 4 AM → 4 AM axis in the athlete's timezone. */
  startMinutes: number;
  weekday: number;
  window: WindowKey;
  loggedSets: number | null;
  loggingPct: number | null;
  setsPerHour: number | null;
  rating: number | null;
  sessionRpe: number | null;
  strengthIndex: number | null;
  strengthFeel: string | null;
  fatigueFeel: string | null;
  pain: boolean;
  notes: string | null;
  reviewNote: string | null;
};

export type WindowStat = {
  key: WindowKey;
  label: string;
  range: string;
  sessions: number;
  medianDurationMin: number | null;
  avgRating: number | null;
  ratedSessions: number;
  avgStrength: number | null;
  scoredSessions: number;
};

export type Insight = { id: string; tone: "good" | "warn" | "info"; title: string; body: string };

export type TrainingTimeSummary = {
  sessions: TrainingSession[];
  /** Trusted sessions only (confirmed + tracked). */
  timed: TrainingSession[];
  suspectCount: number;
  typicalStartMinutes: number | null;
  /** Timed sessions starting within ±60 min of the typical start. */
  nearTypicalCount: number;
  medianDurationMin: number | null;
  durationP25: number | null;
  durationP75: number | null;
  medianSetsPerHour: number | null;
  durationTrendMin: number | null;
  windows: WindowStat[];
  /** `meaningful` = the gap clears MEANINGFUL_DELTA, so it's worth acting on. */
  best: { key: WindowKey; label: string; metric: "strength" | "rating"; delta: number; sessions: number; meaningful: boolean } | null;
  insights: Insight[];
};

export function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function quantile(values: number[], q: number): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

const mean = (v: number[]) => (v.length ? v.reduce((s, n) => s + n, 0) / v.length : null);

/** Pick the window that stands out, or null when the data can't support a call. */
export function pickBestWindow(windows: WindowStat[], timed: TrainingSession[]): TrainingTimeSummary["best"] {
  const tryMetric = (metric: "strength" | "rating") => {
    const value = (s: TrainingSession) => (metric === "strength" ? s.strengthIndex : s.rating);
    const qualified = windows.filter((w) => (metric === "strength" ? w.scoredSessions : w.ratedSessions) >= MIN_WINDOW_SESSIONS);
    if (qualified.length < 2) return null;
    const top = [...qualified].sort((a, b) =>
      ((metric === "strength" ? b.avgStrength : b.avgRating) ?? 0) - ((metric === "strength" ? a.avgStrength : a.avgRating) ?? 0),
    )[0];
    const topAvg = (metric === "strength" ? top.avgStrength : top.avgRating) ?? 0;
    const qualifiedKeys = new Set(qualified.map((w) => w.key));
    const rest = timed
      .filter((s) => s.window !== top.key && qualifiedKeys.has(s.window))
      .map(value)
      .filter((n): n is number => n != null);
    const restAvg = mean(rest);
    if (restAvg == null) return null;
    const delta = topAvg - restAvg;
    return {
      key: top.key,
      label: top.label,
      metric,
      delta,
      sessions: metric === "strength" ? top.scoredSessions : top.ratedSessions,
      meaningful: delta >= MEANINGFUL_DELTA[metric],
    };
  };
  return tryMetric("strength") ?? tryMetric("rating");
}

/** Smallest gap worth calling a winner, per metric. */
export const MEANINGFUL_DELTA = { strength: 1.5, rating: 0.4 } as const;

export function summarizeTrainingTime(
  sessions: TrainingSession[],
  opts: { now?: Date; nextMeetDate?: string | null } = {},
): TrainingTimeSummary {
  const now = opts.now ?? new Date();
  const timed = sessions.filter((s) => s.source !== "suspect");
  const suspectCount = sessions.length - timed.length;

  const starts = timed.map((s) => s.startMinutes);
  const typical = median(starts);
  const nearTypicalCount = typical == null ? 0 : starts.filter((m) => Math.abs(m - typical) <= 60).length;

  const durations = timed.map((s) => s.durationMin).filter((n): n is number => n != null);
  const density = timed.map((s) => s.setsPerHour).filter((n): n is number => n != null);

  // Last 4 weeks vs the 4 before, inside the selected range.
  const fourWeeks = 28 * 86_400_000;
  const recent = timed.filter((s) => now.getTime() - s.start.getTime() <= fourWeeks).map((s) => s.durationMin).filter((n): n is number => n != null);
  const prior = timed
    .filter((s) => {
      const age = now.getTime() - s.start.getTime();
      return age > fourWeeks && age <= 2 * fourWeeks;
    })
    .map((s) => s.durationMin)
    .filter((n): n is number => n != null);
  const durationTrendMin = recent.length >= 3 && prior.length >= 3 ? median(recent)! - median(prior)! : null;

  const windows: WindowStat[] = TRAINING_WINDOWS.map((w) => {
    const list = timed.filter((s) => s.window === w.key);
    const rated = list.map((s) => s.rating).filter((n): n is number => n != null);
    const scored = list.map((s) => s.strengthIndex).filter((n): n is number => n != null);
    return {
      key: w.key,
      label: w.label,
      range: w.range,
      sessions: list.length,
      medianDurationMin: median(list.map((s) => s.durationMin).filter((n): n is number => n != null)),
      avgRating: mean(rated),
      ratedSessions: rated.length,
      avgStrength: mean(scored),
      scoredSessions: scored.length,
    };
  });

  const best = pickBestWindow(windows, timed);

  const summary: TrainingTimeSummary = {
    sessions,
    timed,
    suspectCount,
    typicalStartMinutes: typical,
    nearTypicalCount,
    medianDurationMin: median(durations),
    durationP25: quantile(durations, 0.25),
    durationP75: quantile(durations, 0.75),
    medianSetsPerHour: median(density),
    durationTrendMin,
    windows,
    best,
    insights: [],
  };
  summary.insights = buildInsights(summary, now, opts.nextMeetDate ?? null);
  return summary;
}

/* -------------------------------------------------------------------------- */
/*  Coach feedback                                                            */
/* -------------------------------------------------------------------------- */

function buildInsights(s: TrainingTimeSummary, now: Date, nextMeetDate: string | null): Insight[] {
  const out: Insight[] = [];
  const n = s.timed.length;

  // Meet in the next 12 weeks: specificity to meet time beats the best window.
  const meetDays = nextMeetDate ? Math.round((new Date(`${nextMeetDate}T12:00:00`).getTime() - now.getTime()) / 86_400_000) : null;
  const meetSoon = meetDays != null && meetDays >= 0 && meetDays <= 84;
  const bestIsMorning = s.best?.key === "morning" || s.best?.key === "early";

  // 1) Best window — only when the gap is real.
  if (s.best) {
    const w = TRAINING_WINDOWS.find((x) => x.key === s.best!.key)!;
    if (s.best.meaningful) {
      out.push({
        id: "best-window",
        tone: "good",
        title: `${w.label} (${w.range}) is your strongest window`,
        body:
          s.best.metric === "strength"
            ? `Your RPE-adjusted strength runs ${s.best.delta.toFixed(1)}% higher there than at your other training times (${s.best.sessions} sessions). ${meetSoon && !bestIsMorning ? "Outside meet prep, that's where your heaviest day belongs. For this peak, see the meet note." : "Put your heaviest day there when your schedule allows."}`
            : `Sessions there rate ${s.best.delta.toFixed(1)} stars higher than your other times (${s.best.sessions} sessions). Log RPE on top sets to back this with strength data.`,
      });
    } else {
      out.push({
        id: "no-clear-window",
        tone: "info",
        title: "No time of day stands out",
        body: "Your performance is about the same across the times you train. Don't chase a perfect time: pick the slot you can hit every week and protect it.",
      });
    }
  } else if (n > 0) {
    out.push({
      id: "need-data",
      tone: "info",
      title: "Not enough data to call a best time yet",
      body: `It takes ${MIN_WINDOW_SESSIONS}+ sessions in at least two time windows, with RPE logged on top sets. Widen the date range or keep logging live.`,
    });
  }

  // 2) Meet prep: most meets start lifting in the morning.
  if (nextMeetDate && s.typicalStartMinutes != null) {
    const days = meetDays!;
    const morning = s.typicalStartMinutes >= 7 * 60 && s.typicalStartMinutes < 11 * 60 + 30;
    if (meetSoon) {
      const weeks = Math.max(1, Math.round(days / 7));
      out.push(
        morning
          ? {
              id: "meet-time",
              tone: "good",
              title: `Meet in ${weeks} wk${weeks === 1 ? "" : "s"}: your timing already matches`,
              body: "You already train when most meets start lifting (morning). Keep it there through the peak.",
            }
          : {
              id: "meet-time",
              tone: "warn",
              title: `Meet in ${weeks} wk${weeks === 1 ? "" : "s"}: practice morning heavy days`,
              body: `You usually start around ${formatClock(s.typicalStartMinutes)}, and most meets start lifting around 9–10 AM. In the last 3–4 weeks, move your heaviest day to the morning so openers at that hour feel normal, including warm-up and meal timing.`,
            },
      );
    }
  }

  // 3) Consistency. A median start alone hides a split schedule (weekday
  // evenings + Saturday mornings), so judge by how many sessions sit near it.
  if (n >= 6 && s.typicalStartMinutes != null) {
    const share = s.nearTypicalCount / n;
    const slots = s.windows.filter((w) => w.sessions / n >= 0.25).sort((a, b) => b.sessions - a.sessions);
    if (share >= 0.75) {
      out.push({
        id: "consistency",
        tone: "good",
        title: "Consistent start time",
        body: `${s.nearTypicalCount} of ${n} sessions start within an hour of ${formatClock(s.typicalStartMinutes)}. That routine is an edge, so keep it.`,
      });
    } else if (slots.length >= 2) {
      out.push({
        id: "split-schedule",
        tone: "info",
        title: `You train in two slots: ${slots[0].label.toLowerCase()} and ${slots[1].label.toLowerCase()}`,
        body: "That's fine if it's a fixed weekly pattern. Keep each slot steady, and use the breakdown above to see which one your heavy days belong in.",
      });
    } else if (share < 0.5) {
      out.push({
        id: "consistency",
        tone: "warn",
        title: "Your start time moves around a lot",
        body: `Only ${s.nearTypicalCount} of ${n} sessions start within an hour of your usual ${formatClock(s.typicalStartMinutes)}. Your body gets better at performing at a time you train often. Try to keep most sessions inside a 2-hour window.`,
      });
    }
  }

  // 4) Session length.
  if (s.medianDurationMin != null && n >= 4) {
    if (s.medianDurationMin > 135) {
      out.push({
        id: "length",
        tone: "warn",
        title: `Long sessions (median ${formatMinutes(s.medianDurationMin)})`,
        body: "Past about 2 hours, quality usually drops. Check rest times on accessories (90–120s is plenty for most) and cut any volume that isn't driving a lift.",
      });
    } else if (s.durationTrendMin != null && Math.abs(s.durationTrendMin) >= 15) {
      const up = s.durationTrendMin > 0;
      out.push({
        id: "length-trend",
        tone: "info",
        title: `Sessions are ${formatMinutes(Math.abs(s.durationTrendMin))} ${up ? "longer" : "shorter"} than a month ago`,
        body: up
          ? "Expected if volume or intensity went up this block. If the program didn't change, look at rest periods and phone time between sets."
          : "Expected on a taper or deload. If not, check that sets aren't being skipped or rushed.",
      });
    }
  }

  // 5) Late sessions vs sleep.
  const night = s.timed.filter((x) => x.window === "night").length;
  if (n >= 6 && night / n >= 0.3) {
    out.push({
      id: "late",
      tone: "info",
      title: `${Math.round((night / n) * 100)}% of sessions start after 8 PM`,
      body: "Hard training close to bedtime can cut into sleep, and sleep drives recovery. Try to finish about 2 hours before bed and take pre-workout caffeine earlier, or skip it on late nights.",
    });
  }

  // 6) Data quality.
  if (s.suspectCount > 0) {
    out.push({
      id: "suspect",
      tone: "warn",
      title: `${s.suspectCount} session${s.suspectCount === 1 ? "" : "s"} missing a real time`,
      body: "These were logged after training or have no timer data, so they're left out of the stats above. Tap one in the session log to set when you actually trained.",
    });
  }

  return out;
}
