import { isLoadValueEntered } from "@/lib/set-completion";

/**
 * Where a workout is, set by set (pure, tested): what the logger's Focus bars,
 * the progress ring and the finish review all read, so "every set is logged"
 * means the same thing everywhere.
 *
 * A set is done when the logger stamped it (`completed_at`, written by
 * `isSetLogComplete`, which knows bodyweight, reps-only, weight-only and timed
 * sets) and it holds a value (an old blank row stamped done doesn't count).
 * An exercise is done when each of its sets on screen (1…sets) is done, or
 * when it's skipped; an extra set logged on one exercise never makes up for a
 * missing one on another.
 */

export type ProgressRow = { id: string | number; sets?: number | string | null; skipped?: boolean | null };
export type ProgressResult = {
  row_id: string | number;
  set_index?: number | null;
  completed_at?: string | null;
  actual_reps?: unknown;
  actual_load?: unknown;
  completed_duration_seconds?: unknown;
};

export type WorkoutSetProgress = {
  setsDone: number;
  setsTotal: number;
  exercisesDone: number;
  exercisesTotal: number;
  /** Skipped exercises included. */
  doneRowIds: Set<string>;
  /** Every set of every exercise that isn't skipped is logged. */
  allDone: boolean;
};

const positive = (v: unknown) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) > 0;

export function isLoggedSetDone(r: ProgressResult): boolean {
  if (!r.completed_at) return false;
  return positive(r.actual_reps) || positive(r.completed_duration_seconds) || isLoadValueEntered(r.actual_load);
}

/** The sets each exercise shows: its prescribed count, at least one. */
export const setsShown = (row: ProgressRow) => Math.max(1, Number(row.sets) || 1);

export function workoutSetProgress(rows: ProgressRow[], results: ProgressResult[]): WorkoutSetProgress {
  const done = new Map<string, Set<number>>();
  for (const r of results) {
    if (!isLoggedSetDone(r)) continue;
    const id = String(r.row_id);
    const set = done.get(id) ?? new Set<number>();
    set.add(Number(r.set_index));
    done.set(id, set);
  }
  const doneRowIds = new Set<string>();
  let setsDone = 0;
  let setsTotal = 0;
  let exercisesDone = 0;
  let exercisesTotal = 0;
  for (const row of rows) {
    const id = String(row.id);
    if (row.skipped) {
      doneRowIds.add(id);
      continue;
    }
    const need = setsShown(row);
    const logged = done.get(id);
    let n = 0;
    for (let i = 1; i <= need; i++) if (logged?.has(i)) n++;
    setsTotal += need;
    setsDone += n;
    exercisesTotal++;
    if (n >= need) {
      exercisesDone++;
      doneRowIds.add(id);
    }
  }
  return { setsDone, setsTotal, exercisesDone, exercisesTotal, doneRowIds, allDone: exercisesTotal > 0 && exercisesDone === exercisesTotal };
}

/**
 * Whether the finish review should pop now. It pops once each time the
 * workout becomes fully logged (Close keeps it shut until a set is cleared or
 * added), only once the screen's data has settled and while online (it saves
 * straight away). The athlete also gets it on opening a workout that's all
 * logged but not finished; a coach viewing as a client only after logging a
 * set from this screen, never just for opening a client's full workout.
 */
export function shouldPromptReview(s: {
  allDone: boolean;
  settled: boolean;
  finished: boolean;
  online: boolean;
  previewing: boolean;
  loggedHere: boolean;
  alreadyPrompted: boolean;
}): boolean {
  if (!s.allDone || !s.settled || s.finished || !s.online || s.alreadyPrompted) return false;
  return !s.previewing || s.loggedHere;
}
