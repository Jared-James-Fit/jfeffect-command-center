/**
 * Exercise note history — pure selectors shared by the client workout
 * logger, coach view, and Client POV. All surfaces read the same canonical
 * table (public.pl_exercise_notes) and use these helpers to organize the
 * per-exercise history list.
 *
 * Identity strategy: notes are matched by the canonical exercise_id when the
 * note carries one; otherwise by exact (trimmed, case-insensitive) exercise
 * name. Display names are NEVER fuzzy-matched, so "Bench Press" and
 * "Close-Grip Bench Press" histories never merge.
 */

export interface ExerciseNoteHistoryRow {
  id: string;
  exercise_id: string | null;
  exercise_name: string;
  content: string;
  status: string;
  created_at: string;
  updated_at: string;
  day_id: string | null;
  pl_days?: {
    title?: string | null;
    day_index?: number | null;
    pl_weeks?: {
      week_index?: number | null;
      pl_blocks?: { name?: string | null } | null;
    } | null;
  } | null;
}

export interface NoteHistoryFilter {
  /** Canonical exercise id of the exercise whose sheet is open. */
  exerciseId?: string | null;
  /** Display name fallback used when exerciseId is unavailable. */
  exerciseName?: string | null;
  /** Exclude the current (editable) note row itself. */
  excludeNoteId?: string | null;
  /** Exclude every note from the currently-open day (the current note). */
  excludeDayId?: string | null;
  limit?: number;
}

/**
 * Newest-first history for one exercise, excluding the current workout's
 * note. Pure — takes already-fetched rows so callers control caching
 * (TanStack Query) and no N+1 fetch happens during workout render.
 */
export function selectExerciseNoteHistory(
  rows: readonly ExerciseNoteHistoryRow[] | null | undefined,
  opts: NoteHistoryFilter,
): ExerciseNoteHistoryRow[] {
  const id = opts.exerciseId ?? null;
  const name = (opts.exerciseName ?? "").trim().toLowerCase();
  const limit = opts.limit ?? 20;
  return (rows ?? [])
    .filter((n) => {
      if (!n?.id) return false;
      if (opts.excludeNoteId && n.id === opts.excludeNoteId) return false;
      if (opts.excludeDayId && n.day_id && n.day_id === opts.excludeDayId) return false;
      if (id) return n.exercise_id === id;
      if (!name) return false;
      return (n.exercise_name ?? "").trim().toLowerCase() === name;
    })
    .sort((a, b) => Date.parse(b.updated_at ?? "") - Date.parse(a.updated_at ?? ""))
    .slice(0, limit);
}

/** Secondary context line for a historical note, e.g. "Block 3 · Week 4 · Day 1". */
export function noteContextLabel(note: ExerciseNoteHistoryRow): string {
  const parts: string[] = [];
  const week = note.pl_days?.pl_weeks ?? null;
  const blockName = week?.pl_blocks?.name ?? null;
  if (blockName) parts.push(blockName);
  if (week?.week_index != null) parts.push(`Week ${week.week_index}`);
  const dayLabel =
    note.pl_days?.title ??
    (note.pl_days?.day_index != null ? `Day ${note.pl_days.day_index}` : null);
  if (dayLabel) parts.push(dayLabel);
  return parts.join(" · ");
}

/** Notes longer than this get collapsed with a "Read more" toggle. */
export const NOTE_PREVIEW_CHARS = 140;
