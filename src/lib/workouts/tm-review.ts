/**
 * Training Max review (pure, tested): what a block's Training Max looks like
 * from the sets loaded off it, and what a calibration session says a missing
 * one should be. It only ever suggests: the coach commits a Training Max
 * (block-scoped `pl_client_maxes`), never this code, a job or a model.
 *
 * Reading a Training Max against its sets (`reviewTrainingMax`):
 *   A % TM set "runs hard" when, at the planned load (within a plate step),
 *   its RPE is over the row's cap, or it had to be loaded under the plan to
 *   stay at the cap. A session runs hard when at least half its % TM sets do.
 *   One hard session is "watch" (a bad day, poor sleep, a missed meal);
 *   HARD_SESSIONS_TO_FLAG sessions on different days within the last
 *   RECENT_SESSIONS is "review": the Training Max is flagged for the coach
 *   with a slightly lower one, read from the hard sets themselves (the load
 *   each would have been at the cap for its reps, over the row's %), never
 *   more than MAX_REVIEW_CUT below the current one and never above it.
 *
 * A missing Training Max from a calibration (`recommendFromCalibration`):
 *   needs the calibration single with its weight and an RPE (6 to 9.5) and at
 *   least one rated back-off the same day. The estimated max is the single's,
 *   checked against the back-offs: when they read more than CORROBORATE_GAP
 *   lower, the two are averaged. The Training Max is CALIBRATION_TM_SHARE of
 *   that, rounded down a plate step: a conservative start the next review
 *   moves, never a number the coach didn't confirm.
 */
import { percentOf1RM } from "@/lib/load-suggestion";

export const HARD_SESSIONS_TO_FLAG = 2;
export const RECENT_SESSIONS = 4;
/** The most a review suggests taking off a Training Max at once. */
export const MAX_REVIEW_CUT = 0.05;
/**
 * A step under where this program's other Training Maxes sit against their
 * estimated maxes (squat ~96%, bench ~100%): one moderate single is the least
 * precise read of a max (RPE ratings are least accurate far from failure).
 */
export const CALIBRATION_TM_SHARE = 0.925;
export const CORROBORATE_GAP = 0.08;

export type TmSet = {
  /** the workout's date (YYYY-MM-DD) */
  date: string;
  /** the row's % of the Training Max */
  pct: number;
  /** the row's RPE cap: the top of its RPE */
  cap: number;
  kg: number;
  reps: number;
  rpe: number | null;
};

export type TmReview = {
  status: "too_early" | "on_plan" | "watch" | "review";
  tmKg: number;
  /** sessions with % sets read, newest first */
  sessions: Array<{ date: string; hard: boolean; sets: number; hardSets: number }>;
  hardSessions: number;
  /** a slightly lower Training Max, only with status "review" */
  suggestedKg: number | null;
  reason: string;
};

const roundDown = (kg: number, step = 2.5) => Math.floor(kg / step + 1e-9) * step;

/** The load that sits at `rpe` for `reps`, from a logged set's estimated max. */
export function loadAtRpe(set: { kg: number; reps: number; rpe: number }, reps: number, rpe: number): number | null {
  const now = percentOf1RM(set.reps, 10 - set.rpe);
  const at = percentOf1RM(reps, 10 - rpe);
  if (!now || !at) return null;
  return (set.kg / now) * at;
}

/** An estimated max from one rated set (the RPE chart), or null. */
export function e1rmOf(set: { kg: number; reps: number; rpe: number | null }): number | null {
  if (set.rpe == null || set.rpe < 5 || set.rpe > 10 || !(set.kg > 0) || !(set.reps >= 1)) return null;
  const p = percentOf1RM(set.reps, 10 - set.rpe);
  return p ? set.kg / p : null;
}

function runsHard(s: TmSet, tmKg: number, step: number): boolean {
  if (s.rpe == null) return false;
  const planned = (tmKg * s.pct) / 100;
  const tol = Math.max(step, planned * 0.02);
  if (s.kg >= planned - tol) return s.rpe > s.cap + 0.25;
  // loaded under the plan and still at (or over) the cap
  return s.rpe >= s.cap - 0.25;
}

export function reviewTrainingMax(input: { tmKg: number; sets: TmSet[]; step?: number }): TmReview {
  const step = input.step ?? 2.5;
  const tm = input.tmKg;
  const rated = input.sets.filter((s) => s.rpe != null && s.kg > 0 && s.reps > 0 && s.pct > 0);
  const byDate = new Map<string, TmSet[]>();
  for (const s of rated) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const sessions = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, RECENT_SESSIONS)
    .map(([date, sets]) => {
      const hardSets = sets.filter((s) => runsHard(s, tm, step)).length;
      return { date, sets: sets.length, hardSets, hard: hardSets > 0 && hardSets * 2 >= sets.length, list: sets };
    });
  const hardSessions = sessions.filter((s) => s.hard);
  const out = (status: TmReview["status"], suggestedKg: number | null, reason: string): TmReview => ({
    status,
    tmKg: tm,
    sessions: sessions.map(({ list: _l, ...s }) => s),
    hardSessions: hardSessions.length,
    suggestedKg,
    reason,
  });
  if (!sessions.length) return out("too_early", null, "No rated sets off this Training Max yet.");
  if (hardSessions.length < HARD_SESSIONS_TO_FLAG) {
    return hardSessions.length
      ? out("watch", null, "One session ran past its RPE cap: watching, not changing it from one day.")
      : out("on_plan", null, "The sets off it are at or under their RPE caps.");
  }
  // the Training Max each hard set implies: the load at its cap, over its %
  const implied: number[] = [];
  for (const sess of hardSessions) {
    for (const s of sess.list) {
      if (!runsHard(s, tm, step) || s.rpe == null) continue;
      const atCap = loadAtRpe({ kg: s.kg, reps: s.reps, rpe: s.rpe }, s.reps, s.cap);
      if (atCap) implied.push(atCap / (s.pct / 100));
    }
  }
  implied.sort((a, b) => a - b);
  const median = implied.length ? implied[Math.floor((implied.length - 1) / 2)] : null;
  const floor = roundDown(tm * (1 - MAX_REVIEW_CUT), step);
  const suggested = median == null ? floor : Math.min(roundDown(tm - step, step), Math.max(floor, roundDown(median, step)));
  return out(
    "review",
    suggested,
    `${hardSessions.length} of the last ${sessions.length} sessions ran past their RPE caps at the planned loads: the sets read about ${median ? `${roundDown(median, step)} kg` : "a lower Training Max"}.`,
  );
}

export type CalibrationSet = { kg: number; reps: number; rpe: number | null; single: boolean };

export type CalibrationRead = {
  status: "waiting" | "need_more" | "ready";
  /** what's missing, in plain words, when it isn't ready */
  missing: string | null;
  e1rmKg: number | null;
  suggestedKg: number | null;
  /** how it was worked out, for the coach */
  basis: string | null;
};

export function recommendFromCalibration(input: { sets: CalibrationSet[]; step?: number }): CalibrationRead {
  const step = input.step ?? 2.5;
  const singles = input.sets.filter((s) => s.single && s.kg > 0);
  if (!singles.length) return { status: "waiting", missing: "The calibration single isn't logged yet.", e1rmKg: null, suggestedKg: null, basis: null };
  const top = singles.sort((a, b) => b.kg - a.kg)[0];
  if (top.rpe == null || top.rpe < 6 || top.rpe > 9.5) {
    return { status: "need_more", missing: top.rpe == null ? "The single has no RPE." : `The single's RPE (${top.rpe}) is outside what a calibration can read (6 to 9.5).`, e1rmKg: null, suggestedKg: null, basis: null };
  }
  const backoffs = input.sets.filter((s) => !s.single && s.rpe != null && s.kg > 0 && s.reps >= 2 && s.reps <= 8);
  if (!backoffs.length) return { status: "need_more", missing: "No rated back-off set the same day to check the single against.", e1rmKg: null, suggestedKg: null, basis: null };
  const single = e1rmOf(top) as number;
  const bo = backoffs.map(e1rmOf).filter((x): x is number => x != null).sort((a, b) => a - b);
  const boMedian = bo[Math.floor((bo.length - 1) / 2)];
  const agree = boMedian >= single * (1 - CORROBORATE_GAP);
  const e1 = agree ? single : (single + boMedian) / 2;
  const tm = roundDown(e1 * CALIBRATION_TM_SHARE, step);
  return {
    status: "ready",
    missing: null,
    e1rmKg: Math.round(e1 * 10) / 10,
    suggestedKg: tm,
    basis: `${top.kg} kg × 1 @${top.rpe} reads about ${Math.round(single)} kg; the back-offs read about ${Math.round(boMedian)} kg${agree ? ", so the single holds" : ", so the two are averaged"}. ${CALIBRATION_TM_SHARE * 100}% of ${Math.round(e1)} kg, rounded down: a conservative start the next review can move.`,
  };
}
