/**
 * Logged sets (`pl_row_results`) in the order they were done: workouts by
 * when they started (their earliest saved set), then, inside one workout, the
 * exercise's place (row sort_order, then row id: the same lift can sit on two
 * rows, each starting at set 1) and the 1-based set number. Never by save
 * time inside a workout: a weight that fills the sets below saves them all at
 * once, in whatever order the writes land. Same rule as History's
 * `historySetOrder` (exercise-history-sheet.tsx). Pure, no I/O.
 */
export type SetPlace = {
  /** The workout (pl_days id); null = a workout of its own. */
  workout: string | null | undefined;
  /** When the set was saved (ISO). Only decides which workout came first. */
  at: string | null | undefined;
  rowOrder: number | null | undefined;
  rowId: string | null | undefined;
  setIndex: number | null | undefined;
};

/** A sorted copy of `sets`; `place` reads each one's workout, time and spot. */
export function inWorkoutOrder<T>(sets: readonly T[], place: (s: T) => SetPlace): T[] {
  const places = sets.map(place);
  const workoutOf = (i: number) => places[i].workout ?? `#${i}`;
  const startOf = new Map<string, number>();
  places.forEach((p, i) => {
    const t = p.at ? Date.parse(p.at) : NaN;
    if (Number.isNaN(t)) return;
    const k = workoutOf(i);
    const cur = startOf.get(k);
    if (cur == null || t < cur) startOf.set(k, t);
  });
  const order = sets.map((_, i) => i);
  order.sort((a, b) => {
    const wa = workoutOf(a);
    const wb = workoutOf(b);
    if (wa !== wb) {
      // a workout with no time at all goes last
      const ta = startOf.get(wa) ?? Infinity;
      const tb = startOf.get(wb) ?? Infinity;
      if (ta !== tb) return ta < tb ? -1 : 1;
      return wa < wb ? -1 : 1;
    }
    const pa = places[a];
    const pb = places[b];
    const ra = pa.rowOrder ?? 0;
    const rb = pb.rowOrder ?? 0;
    if (ra !== rb) return ra - rb;
    const ia = pa.rowId ?? "";
    const ib = pb.rowId ?? "";
    if (ia !== ib) return ia < ib ? -1 : 1;
    const sa = pa.setIndex ?? 0;
    const sb = pb.setIndex ?? 0;
    if (sa !== sb) return sa - sb;
    return a - b;
  });
  return order.map((i) => sets[i]);
}
