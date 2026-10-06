/**
 * Carrying a "move exercise up/down" from one workout to the same workout in
 * later weeks of a block.
 *
 * Only the moved exercise is repositioned, relative to the exercise it now
 * sits next to. Everything else in the later workout keeps its own order, so
 * a week that was customised (or has an exercise the source day doesn't) is
 * never reshuffled wholesale.
 */

export type ExerciseIdentity = {
  exercise_id?: string | null;
  exercise_name_override?: string | null;
  exercises?: { name?: string | null } | null;
};

/**
 * Identity of an exercise across weeks. Matches by name first — coaches often
 * repeat the same exercise with different library records week to week (the
 * swap flow handles it the same way) — falling back to the library id.
 */
export function exerciseKey(row: ExerciseIdentity): string {
  const name = (row.exercise_name_override ?? row.exercises?.name ?? "").trim().toLowerCase();
  if (name) return `name:${name}`;
  return row.exercise_id ? `id:${row.exercise_id}` : "unknown";
}

/**
 * Make duplicate exercises distinguishable: the 2nd "Back Squat" in a workout
 * is "name:back squat#1". Keeps a back-off squat from being confused with the
 * top set.
 */
export function withOccurrence(keys: string[]): string[] {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return `${k}#${n}`;
  });
}

/**
 * Where `moved` should sit in a later workout.
 *
 * `prev` / `next` are the exercises that now sit directly above / below
 * `moved` in the workout it was moved in (null = top / bottom). All keys are
 * occurrence keys. Returns the new order, or null when nothing should change
 * (the moved exercise isn't in this workout, there is nothing to anchor to,
 * or it already sits there).
 */
export function planMove(target: string[], moved: string, prev: string | null, next: string | null): string[] | null {
  if (!target.includes(moved)) return null;
  const rest = target.filter((k) => k !== moved);

  let at: number;
  if (prev === null) at = 0; // moved to the top
  else if (next === null) at = rest.length; // moved to the bottom
  else if (rest.includes(next)) at = rest.indexOf(next); // sit just above where it now sits above
  else if (rest.includes(prev)) at = rest.indexOf(prev) + 1; // else just below what it now sits below
  else return null; // neither neighbour exists here — don't guess

  const out = [...rest.slice(0, at), moved, ...rest.slice(at)];
  return out.every((k, i) => k === target[i]) ? null : out;
}
