/**
 * "Last week this slot was …" — when an exercise card holds a different
 * exercise than the same slot did last week (the client swapped it last week,
 * swapped it this week, or the coach changed it), the card shows what was done
 * there so the athlete can see last week's work without digging through
 * History. The "Last time" chip already covers the same exercise.
 *
 * A slot is the same day of the previous week of the block, at the same
 * position. Swaps overwrite the row's exercise (no "swapped from" is stored),
 * so the comparison is between the two weeks' rows, guarded against the usual
 * false alarms: an exercise that was done last week anywhere on that day is
 * not a swap, an exercise from last week's slot that is still on today's
 * workout elsewhere was reordered, not swapped, different purpose labels
 * ("GPP" vs "Secondary Bench") are different slots, and a swap trades for a
 * SIMILAR exercise — same main-lift family, same primary muscle, or same
 * specific category — so a redesigned day (a lat pulldown where a squat was)
 * isn't called one. On real programs: 96 swaps across 9 clients, e.g. Chest
 * Supported Dumbbell Row ⇐ Dumbbell Bent Over Row, Competition Squat ⇐ Hack Squat.
 */

export type SlotRow = {
  id: string;
  exerciseId: string | null;
  name: string;
  sortOrder: number | null;
  purposeLabel: string | null;
  /** Exercise library metadata, when the row is linked to an exercise. */
  muscleGroup?: string | null;
  category?: string | null;
  family?: string | null;
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const sameExercise = (a: SlotRow, b: SlotRow) =>
  (!!a.exerciseId && a.exerciseId === b.exerciseId) || (!!norm(a.name) && norm(a.name) === norm(b.name));
const ordered = (rows: SlotRow[]) =>
  [...rows].sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));

/** Categories too broad to call two exercises alike ("Lower Body" holds glute bridges and back extensions). */
const BROAD_CATEGORIES = new Set(["lower body", "legs", "upper body", "full body", "uncategorized", "calisthenics-cardio-plyo-functional"]);
const primaryMuscle = (r: SlotRow) => norm((r.muscleGroup ?? "").split(",")[0]);

/** Would a lifter swap one for the other? Unknown metadata leans on the purpose label. */
export function similarExercises(a: SlotRow, b: SlotRow): boolean {
  const fa = norm(a.family), fb = norm(b.family);
  if (fa && fa === fb && fa !== "accessory") return true;
  if (primaryMuscle(a) && primaryMuscle(a) === primaryMuscle(b)) return true;
  const ca = norm(a.category), cb = norm(b.category);
  if (ca && ca === cb && !BROAD_CATEGORIES.has(ca)) return true;
  const known = (r: SlotRow) => !!(norm(r.family) || primaryMuscle(r) || norm(r.category));
  if (known(a) && known(b)) return false;
  return !!a.purposeLabel && !!b.purposeLabel && norm(a.purposeLabel) === norm(b.purposeLabel);
}

/** Current row id → last week's row in that slot, only where the exercise changed. */
export function matchPreviousWeekSlots(current: SlotRow[], previous: SlotRow[]): Map<string, SlotRow> {
  const out = new Map<string, SlotRow>();
  const now = ordered(current);
  const before = ordered(previous);
  now.forEach((row, i) => {
    if (before.some((p) => sameExercise(p, row))) return; // done last week too: "Last time" covers it
    const slot = before[i];
    if (!slot) return;
    if (row.purposeLabel && slot.purposeLabel && norm(row.purposeLabel) !== norm(slot.purposeLabel)) return;
    if (now.some((other) => other.id !== row.id && sameExercise(other, slot))) return; // moved, not swapped
    if (!similarExercises(row, slot)) return; // the day was redesigned, not swapped
    out.set(row.id, slot);
  });
  return out;
}
