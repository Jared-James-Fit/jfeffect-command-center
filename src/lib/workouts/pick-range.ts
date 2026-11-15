/**
 * Which cards may offer a suggested weight as a few loads to choose from
 * (suggestionPicks, load-suggestion.ts) rather than one number. Pure.
 *
 * A range is for the one decision a lifter makes by feel: the day's first heavy
 * set of a barbell squat, bench or deadlift, picked from how the warm-ups moved.
 * Everything else is one number:
 *  - a dumbbell, machine, band or belt-squat lift in a main lift's family (an
 *    incline dumbbell press is a bench-family accessory): its load jumps by the
 *    dumbbell or the stack and progresses from last time, like any accessory;
 *  - every later card of that lift today (its back-offs, a variation after it):
 *    the lifter is already warm and the earlier sets read the day, whether or
 *    not they were rated;
 *  - a card once a set of that lift is logged on another card (the day's read).
 */
import { resolveMovementFamily } from "@/lib/exercise-family";

const MAIN_LIFTS = new Set(["squat", "bench", "deadlift"]);
/** Implements that make a main-lift-family exercise an accessory for this purpose. */
const NOT_A_BARBELL = /\b(dumbbells?|db|machines?|smith|cables?|bands?|kettlebells?|kb|landmine|belt squat|bodyweight|leg press|hack squat|goblet)\b/i;

/** A barbell squat, bench or deadlift: the competition lift or a barbell variation of it. */
export function rangeLift(family: string | null | undefined, name?: string | null, equipment?: string | null): boolean {
  if (!MAIN_LIFTS.has(String(family ?? "").toLowerCase())) return false;
  return !NOT_A_BARBELL.test(`${name ?? ""} ${equipment ?? ""}`);
}

type CardRow = {
  id: string;
  movement_family?: string | null;
  exercise_name_override?: string | null;
  exercises?: {
    name?: string | null;
    equipment?: string | null;
    movement_family?: string | null;
    competition_lift_type?: string | null;
  } | null;
};

/**
 * The cards that hold the day's first heavy set of each barbell main lift: the
 * first card of that lift's family in the workout's order, while no set of it is
 * logged on another card of the family. `loggedRowIds` = cards with a completed
 * working set today, rated or not.
 */
export function firstHeavyCards(rows: CardRow[], loggedRowIds: ReadonlySet<string>): Set<string> {
  const first = new Map<string, string>();
  const logged = new Map<string, string[]>();
  for (const r of rows) {
    const family = resolveMovementFamily(r.exercises ?? null, r.movement_family);
    if (!rangeLift(family, r.exercises?.name ?? r.exercise_name_override, r.exercises?.equipment)) continue;
    if (!first.has(family)) first.set(family, r.id);
    if (loggedRowIds.has(r.id)) logged.set(family, [...(logged.get(family) ?? []), r.id]);
  }
  const out = new Set<string>();
  for (const [family, id] of first) {
    if (!(logged.get(family) ?? []).some((other) => other !== id)) out.add(id);
  }
  return out;
}

/**
 * The cards that are a later card of an exercise already on an earlier card
 * today (its back-offs: "Competition Squat" top set, then "Competition Squat"
 * back-offs). Their cold suggestion reads past back-offs as logged, not as the
 * top set they imply (load-suggestion.ts note 11, `backoffs: "as_logged"`).
 */
export function backoffCards(rows: Array<{ id: string; exercise_id?: string | null; exercises?: { id?: string | null } | null }>): Set<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const r of rows) {
    const key = String(r.exercises?.id ?? r.exercise_id ?? r.id);
    if (seen.has(key)) out.add(r.id);
    seen.add(key);
  }
  return out;
}
