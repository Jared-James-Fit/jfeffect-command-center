/**
 * Recovery Pattern Detection.
 *
 * Derives a short list of insights strictly from data the app already
 * collects. Only patterns with strong enough support (n >= threshold and
 * a meaningful effect size) are returned; otherwise nothing is shown.
 */
import { computeRecoveryScore } from "./recovery-score";

export interface ReviewLike {
  completion_id?: string | null;
  completed_at?: string | null;
  overall_rating?: number | null;
  session_rpe?: number | null;
  strength_feel?: string | null;
  fatigue_feel?: string | null;
  pain?: boolean | null;
  completion_pct?: number | null;
}

export interface WorkoutSessionMeta {
  /** ISO date of the workout */
  date: string;
  completionPct?: number | null;
  avgRpe?: number | null;
  sessionRpe?: number | null;
  overallRating?: number | null;
  strengthFeel?: string | null;
  fatigueFeel?: string | null;
  pain?: boolean | null;
  /** Sets performed that day */
  sets?: number | null;
  /** Total volume for the day (lb) */
  volume?: number | null;
  /** Optional per-exercise top e1RM for tagged competition lifts */
  topE1rmByLift?: Record<string, number>;
}

export interface Pattern {
  id: string;
  text: string;
  /** Number of sessions supporting the pattern */
  support: number;
}

function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

function scoreForSession(s: WorkoutSessionMeta): number {
  return computeRecoveryScore({
    completionPct: s.completionPct ?? null,
    avgRpe: s.avgRpe ?? null,
    sessionRpe: s.sessionRpe ?? null,
    overallRating: s.overallRating ?? null,
    strengthFeel: s.strengthFeel ?? null,
    fatigueFeel: s.fatigueFeel ?? null,
    pain: s.pain ?? null,
  }).score;
}

/**
 * Detect a small, fixed set of patterns. Returns [] when not enough data.
 * MIN_SESSIONS gate ensures we don't fabricate insights early on.
 */
export function detectRecoveryPatterns(sessions: WorkoutSessionMeta[]): Pattern[] {
  const MIN_SESSIONS = 12;
  if (sessions.length < MIN_SESSIONS) return [];

  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const patterns: Pattern[] = [];

  // 1) Rest-day effect: recovery/perf tends to be higher after >=1 rest day.
  const withRestGap: { gap: number; score: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.max(0, daysBetween(sorted[i].date, sorted[i - 1].date) - 1);
    withRestGap.push({ gap, score: scoreForSession(sorted[i]) });
  }
  const afterRest = withRestGap.filter((x) => x.gap >= 1).map((x) => x.score);
  const backToBack = withRestGap.filter((x) => x.gap === 0).map((x) => x.score);
  if (afterRest.length >= 6 && backToBack.length >= 6) {
    const diff = mean(afterRest) - mean(backToBack);
    if (diff >= 5) {
      patterns.push({
        id: "rest_day_effect",
        text: "You tend to perform best after one or two rest days.",
        support: afterRest.length + backToBack.length,
      });
    }
  }

  // 2) High-RPE → next-session lower recovery.
  let pairSupport = 0;
  const nextAfterHigh: number[] = [];
  const nextAfterLow: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevRpe = sorted[i - 1].sessionRpe ?? sorted[i - 1].avgRpe ?? null;
    if (prevRpe == null) continue;
    pairSupport++;
    const score = scoreForSession(sorted[i]);
    if (prevRpe >= 8.5) nextAfterHigh.push(score);
    else if (prevRpe <= 7) nextAfterLow.push(score);
  }
  if (nextAfterHigh.length >= 4 && nextAfterLow.length >= 4) {
    const diff = mean(nextAfterLow) - mean(nextAfterHigh);
    if (diff >= 6) {
      patterns.push({
        id: "rpe_next_recovery",
        text: "Higher session RPEs are usually followed by lower recovery scores.",
        support: pairSupport,
      });
    }
  }

  // 3) High-volume week dip.
  // Bucket into weeks and compare weekly total volume vs mean weekly recovery.
  const byWeek = new Map<string, { volume: number; scores: number[] }>();
  for (const s of sorted) {
    const d = new Date(s.date);
    // ISO week key: yyyy-Www (rough)
    const yr = d.getUTCFullYear();
    const firstDay = new Date(Date.UTC(yr, 0, 1));
    const week = Math.floor(((d.getTime() - firstDay.getTime()) / 86400000 + firstDay.getUTCDay() + 1) / 7);
    const key = `${yr}-W${week}`;
    if (!byWeek.has(key)) byWeek.set(key, { volume: 0, scores: [] });
    const b = byWeek.get(key)!;
    b.volume += Number(s.volume ?? 0);
    b.scores.push(scoreForSession(s));
  }
  const weeks = [...byWeek.values()].filter((w) => w.scores.length >= 2 && w.volume > 0);
  if (weeks.length >= 4) {
    const sortedByVol = [...weeks].sort((a, b) => a.volume - b.volume);
    const q = Math.max(1, Math.floor(sortedByVol.length / 4));
    const lowVol = sortedByVol.slice(0, q).flatMap((w) => w.scores);
    const highVol = sortedByVol.slice(-q).flatMap((w) => w.scores);
    if (lowVol.length >= 4 && highVol.length >= 4) {
      const diff = mean(lowVol) - mean(highVol);
      if (diff >= 6) {
        patterns.push({
          id: "high_volume_dip",
          text: "Recovery is usually lower during your highest-volume weeks.",
          support: lowVol.length + highVol.length,
        });
      }
    }
  }

  return patterns;
}