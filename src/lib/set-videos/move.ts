/**
 * Moving a set video to another set of its workout (pure, tested): which sets
 * each exercise offers, and what the clip's labels say on the one it goes to
 * (the set's own logged numbers, as set_video_attach's are). The picker is
 * set-video-move.tsx, the move itself set_video_move.
 */
import { filmLabels, filmSetValues, type LoggedSetRow } from "@/lib/workout-film";

export type MoveSet = { n: number; logged: boolean; label: string; labelNoLoad: string };
export type MoveExercise = { rowId: string; name: string; sets: MoveSet[] };

/** The workout's exercises and sets, in order: as many sets as written or logged, whichever is more. */
export function moveChoices(
  rows: { id: string; sort_order: number | null; sets: number | null; name: string }[],
  results: (LoggedSetRow & { row_id: string; set_index: number })[],
): MoveExercise[] {
  return [...rows]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((r) => {
      const logged = new Map<number, LoggedSetRow>();
      for (const x of results) if (x.row_id === r.id && x.set_index >= 1) logged.set(x.set_index, x);
      const count = Math.min(20, Math.max(r.sets ?? 0, ...logged.keys(), 1));
      const sets: MoveSet[] = [];
      for (let n = 1; n <= count; n++) {
        const x = logged.get(n);
        const labels = x ? filmLabels(filmSetValues(x), null) : { label: "", label_no_load: "" };
        sets.push({ n, logged: !!x, label: labels.label, labelNoLoad: labels.label_no_load });
      }
      return { rowId: r.id, name: r.name, sets };
    });
}
