/**
 * Moving a set video to another set of its workout (pure, tested): which sets
 * and warm-ups each exercise offers, and what the clip's labels say on the one
 * it goes to (the set's own logged numbers, as set_video_attach's are). The
 * picker is set-video-move.tsx, the move itself set_video_move.
 *
 * A clip can go onto a working set or a warm-up (set 0): each warm-up logged on
 * the exercise, or, with none logged, the warm-up still to log (the clip is
 * tied to it when it's saved). An exercise that's on more than one card of the
 * day reads by its role there ("Competition Squat · Backoff"), Focus's names.
 */
import { filmLabels, filmSetValues, type LoggedSetRow } from "@/lib/workout-film";
import { describeWarmup, normalizeWarmupRow } from "@/lib/final-warmup";
import { focusNames } from "@/lib/workouts/focus-names";
import { isTimedCardio } from "@/lib/timed-cardio";
import { resolveLoadType } from "@/lib/workout-load-type";

export type MoveSet = { n: number; logged: boolean; label: string; labelNoLoad: string };
/** A warm-up a clip can go onto: a logged one (its id and numbers), or the one still to log (id null). */
export type MoveWarmup = { id: string | null; logged: boolean; label: string };
/** `name` is how the picker says it (a repeated exercise by its role); `exercise` the exercise itself, as the clip records it. */
export type MoveExercise = { rowId: string; name: string; exercise: string; sets: MoveSet[]; warmups: MoveWarmup[] };

export type MoveRow = {
  id: string;
  sort_order: number | null;
  sets: number | null;
  name: string;
  purpose_label?: string | null;
  notes?: string | null;
  reps_text?: string | null;
};
export type MoveWarmupRow = { id: string; row_id: string; load: number | string; unit: string; reps: number | string; rpe: number | string | null; created_at?: string | null };

/** The workout's exercises and sets, in order: as many sets as written or logged, whichever is more, and their warm-ups. */
export function moveChoices(
  rows: MoveRow[],
  results: (LoggedSetRow & { row_id: string; set_index: number; load_type?: string | null; is_bodyweight?: boolean | null })[],
  warmups: MoveWarmupRow[] = [],
): MoveExercise[] {
  const sorted = [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const names = focusNames(
    sorted.map((r) => ({ name: r.name, purposeLabel: r.purpose_label ?? null, notes: r.notes ?? null, sets: r.sets, reps: r.reps_text ?? null })),
  );
  return sorted.map((r, i) => {
    const mine = results.filter((x) => x.row_id === r.id);
    const logged = new Map<number, LoggedSetRow>();
    for (const x of mine) if (x.set_index >= 1) logged.set(x.set_index, x);
    const count = Math.min(20, Math.max(r.sets ?? 0, ...logged.keys(), 1));
    const sets: MoveSet[] = [];
    for (let n = 1; n <= count; n++) {
      const x = logged.get(n);
      const labels = x ? filmLabels(filmSetValues(x), null) : { label: "", label_no_load: "" };
      sets.push({ n, logged: !!x, label: labels.label, labelNoLoad: labels.label_no_load });
    }
    const logs = warmups
      .filter((w) => w.row_id === r.id)
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
      .map((w) => normalizeWarmupRow(w))
      .filter((w): w is NonNullable<typeof w> => !!w)
      .map((w) => ({ id: w.id, logged: true, label: describeWarmup(w, w.unit) }));
    const list: MoveWarmup[] = logs.length ? logs : takesWarmup(r.name, mine) ? [{ id: null, logged: false, label: "" }] : [];
    return { rowId: r.id, name: names[i] ?? r.name, exercise: r.name, sets, warmups: list };
  });
}

/**
 * Whether an exercise takes a warm-up a clip can wait on: one lifted with a
 * weight (its logged sets say so), or nothing logged yet on one that isn't
 * cardio done for time. A warm-up already logged is always offered.
 */
export function takesWarmup(name: string, results: { load_type?: string | null; is_bodyweight?: boolean | null }[]): boolean {
  if (results.length) return results.some((x) => resolveLoadType(x.load_type, x.is_bodyweight) === "external");
  return !isTimedCardio(name);
}

/** A warm-up chip's number beside its flame: none for one warm-up, "1", "2"… for several. */
export function warmupChipNumber(list: MoveWarmup[], i: number): string {
  return list.length > 1 ? String(i + 1) : "";
}
