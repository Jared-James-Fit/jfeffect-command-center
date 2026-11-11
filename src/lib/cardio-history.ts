/**
 * A cardio exercise's History (a treadmill walk, a bike): what was done each
 * day is time, calories and how hard it felt, never load / reps / velocity.
 * Pure, so it's tested.
 */
import { isTimedCardio } from "@/lib/timed-cardio";
import { formatClockSeconds, parseDurationInput } from "@/lib/duration";
import { effortTrend, type EffortTrend } from "@/lib/analytics/cardio-adherence";

export type CardioHistorySet = {
  completed_duration_seconds?: number | null;
  actual_calories?: number | null;
  actual_rpe?: string | number | null;
  actual_rpe_num?: number | null;
  actual_reps?: number | null;
  actual_load?: number | string | null;
  entered_value?: number | string | null;
  completed_at?: string | null;
};

const has = (v: unknown) => v != null && v !== "";

/**
 * Read as cardio: the exercise is timed cardio by name, or everything logged
 * for it is time / calories with no load or reps (a custom-named "Zone 2").
 */
export function isCardioHistory(exerciseName: string | null | undefined, sets: CardioHistorySet[]): boolean {
  if (isTimedCardio(exerciseName)) return true;
  if (!sets.length) return false;
  return sets.every(
    (s) =>
      !has(s.actual_load) &&
      !has(s.entered_value) &&
      !has(s.actual_reps) &&
      (has(s.completed_duration_seconds) || has(s.actual_calories)),
  );
}

/** 1110 → "18:30", 3720 → "1:02:00", null → "—" (the logger's "Last time" uses the same clock). */
export const cardioClock = formatClockSeconds;

/** The longest cardio a set can say (6 hours). */
export const MAX_CARDIO_SECONDS = 6 * 3600;

/**
 * What someone types for a cardio time: "18:30", "1:02:00", "18 min", or a
 * bare number, which is minutes here ("20" is a 20 minute walk, never 20
 * seconds). Seconds, or null when it doesn't read as a time.
 */
export function parseCardioTime(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  const hms = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(s);
  if (hms) {
    const [h, m, sec] = [Number(hms[1]), Number(hms[2]), Number(hms[3])];
    if (m >= 60 || sec >= 60) return null;
    const t = h * 3600 + m * 60 + sec;
    return t > 0 ? t : null;
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const t = Math.round(Number(s) * 60);
    return t > 0 ? t : null;
  }
  return parseDurationInput(s);
}

export type CardioDay = { date: string; sets: CardioHistorySet[] };

export type CardioHistorySummary = {
  sessions: number;
  /** Per session (all its sets together). */
  avgSeconds: number | null;
  avgCalories: number | null;
  avgRpe: number | null;
  /** The same cardio getting easier or harder (4+ rated sessions). */
  effort: EffortTrend | null;
};

const rpeOf = (s: CardioHistorySet): number | null => {
  const n = s.actual_rpe_num != null ? Number(s.actual_rpe_num) : s.actual_rpe != null && s.actual_rpe !== "" ? Number(s.actual_rpe) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * A session is a day's sets together, the way the plan counts it (the cardio
 * done trigger): time and calories added up, the hardest set's RPE.
 */
export function cardioHistorySummary(days: CardioDay[]): CardioHistorySummary {
  const sessions = days
    .map((d) => {
      const secs = d.sets.reduce((t, s) => t + (Number(s.completed_duration_seconds) > 0 ? Number(s.completed_duration_seconds) : 0), 0);
      const cals = d.sets.filter((s) => has(s.actual_calories)).map((s) => Number(s.actual_calories));
      const rpes = d.sets.map(rpeOf).filter((n): n is number => n != null);
      return {
        date: d.date,
        seconds: secs > 0 ? secs : null,
        calories: cals.length ? cals.reduce((t, n) => t + n, 0) : null,
        rpe: rpes.length ? Math.max(...rpes) : null,
      };
    })
    .filter((x) => x.seconds != null || x.calories != null || x.rpe != null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((t, n) => t + n, 0) / xs.length : null);
  const secs = mean(sessions.map((x) => x.seconds).filter((n): n is number => n != null));
  const cals = mean(sessions.map((x) => x.calories).filter((n): n is number => n != null));
  const rpe = mean(sessions.map((x) => x.rpe).filter((n): n is number => n != null));
  return {
    sessions: sessions.length,
    avgSeconds: secs != null ? Math.round(secs) : null,
    avgCalories: cals != null ? Math.round(cals) : null,
    avgRpe: rpe != null ? Math.round(rpe * 10) / 10 : null,
    effort: effortTrend(
      sessions.map((x) => ({ date: x.date, minutes: x.seconds != null ? Math.round(x.seconds / 60) : null, rpe: x.rpe })),
    ),
  };
}
