/**
 * The day's cardio in the workout logger (pure, tested): the row the client's
 * cardio plan put on the workout (`pl_exercise_rows.cardio_target_id`, added by
 * `program_cardio_sync`) is the workout's own Cardio, after the lifting, never
 * one of the exercises. It's logged in the logger like any timed set (and that
 * checks off the day's cardio), but it sits under its own "Cardio" heading,
 * Focus calls it Cardio instead of "Exercise 9 of 9", and the progress counts
 * the lifts apart from it.
 *
 * Only a row linked to the plan counts: a program's own timed rows (a running
 * program's runs, a conditioning finisher) are its exercises.
 */

/** A workout row as the logger reads it (its id, and the cardio plan it's linked to, if any). */
export type RowLike = { id: string | number; cardio_target_id?: string | null };

/** The plan's cardio row for the day (linked to the client's cardio plan). */
export function isPlanCardioRow(row: RowLike | null | undefined): boolean {
  return !!row?.cardio_target_id;
}

/**
 * The workout's rows with the plan's cardio last, the lifts in their own order
 * (a stable split). The same array back when there's nothing to move, so a
 * memo downstream doesn't churn.
 */
export function cardioLast<T extends RowLike>(rows: readonly T[]): T[] {
  let seenCardio = false;
  let needsMove = false;
  for (const r of rows) {
    if (isPlanCardioRow(r)) seenCardio = true;
    else if (seenCardio) { needsMove = true; break; }
  }
  if (!needsMove) return rows as T[];
  return [...rows.filter((r) => !isPlanCardioRow(r)), ...rows.filter((r) => isPlanCardioRow(r))];
}

/** How many of the rows are lifts (everything before the cardio, once `cardioLast` has run). */
export function liftCount(rows: readonly RowLike[]): number {
  return rows.filter((r) => !isPlanCardioRow(r)).length;
}

/**
 * Where Focus says you are: "Exercise 3 of 8" for a lift, "Cardio" for the
 * day's cardio ("Cardio 1 of 2" in the rare day with two).
 */
export function focusPlaceLabel(index: number, count: number, lifts: number): string {
  const cardio = count - lifts;
  if (cardio <= 0 || index < lifts) return `Exercise ${index + 1} of ${cardio > 0 ? lifts : count}`;
  return cardio > 1 ? `Cardio ${index - lifts + 1} of ${cardio}` : "Cardio";
}

/** The lifts done / total and whether the day's cardio is done, for the progress pill. */
export function liftAndCardioProgress(
  rows: readonly (RowLike & { skipped?: boolean | null })[],
  doneRowIds: ReadonlySet<string>,
): { liftsDone: number; liftsTotal: number; cardioTotal: number; cardioDone: boolean } {
  let liftsDone = 0;
  let liftsTotal = 0;
  let cardioTotal = 0;
  let cardioDoneCount = 0;
  for (const r of rows) {
    if (r.skipped) continue;
    const done = doneRowIds.has(String(r.id));
    if (isPlanCardioRow(r)) {
      cardioTotal += 1;
      if (done) cardioDoneCount += 1;
    } else {
      liftsTotal += 1;
      if (done) liftsDone += 1;
    }
  }
  return { liftsDone, liftsTotal, cardioTotal, cardioDone: cardioTotal > 0 && cardioDoneCount >= cardioTotal };
}
