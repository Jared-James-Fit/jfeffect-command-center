/**
 * Single source of truth for "is this logged set complete?".
 *
 * Used by the workout logger's autosave (to stamp `completed_at`), by the
 * offline queue payload, by the green/confirmed row styling and by the manual
 * status-circle guard — so all four can never disagree.
 *
 * Rules (do not invent extra required fields):
 *  - reps-based rows require reps > 0
 *  - rows that show a load column additionally require a valid load
 *  - a load is valid when it is a finite number >= 0 (0 is an intentional,
 *    entered value — never treated as blank), OR the set is Bodyweight
 *  - Assisted sets are ordinary numeric loads (the number is assistance)
 *  - time-based rows require a completed duration > 0
 */
import type { LoadType } from "@/lib/workout-load-type";

export interface SetCompletionInput {
  /** "time" rows complete on duration, "reps" rows on reps (+ load). */
  measurementType?: "reps" | "time" | null;
  /** True when the row hides the weight column (no load required). */
  hideWeight?: boolean;
  /** Explicit column model (Timer as an additional input). When either flag
   *  is provided, requirements are composed instead of using measurementType. */
  requireReps?: boolean;
  requireTime?: boolean;
  loadType?: LoadType | null;
  load?: string | number | null;
  reps?: string | number | null;
  durationSeconds?: string | number | null;
}

const positive = (v: unknown): boolean => {
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
};

/** 0 counts as entered. Only blank/NaN/negative are missing. */
export const isLoadValueEntered = (v: unknown): boolean => {
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0;
};

export function isLoadComplete(loadType: LoadType | null | undefined, load: unknown): boolean {
  if (loadType === "bodyweight") return true; // Bodyweight is a valid load
  return isLoadValueEntered(load); // external + assisted, 0 allowed
}

export function isSetLogComplete(i: SetCompletionInput): boolean {
  // Composed model: Reps / Timer / Weight can coexist on the same row.
  if (i.requireReps !== undefined || i.requireTime !== undefined) {
    const requireReps = i.requireReps ?? false;
    const requireTime = i.requireTime ?? false;
    const requireLoad = !i.hideWeight;
    if (!requireReps && !requireTime && !requireLoad) return false;
    if (requireTime && !positive(i.durationSeconds)) return false;
    if (requireReps && !positive(i.reps)) return false;
    if (requireLoad && !isLoadComplete(i.loadType ?? "external", i.load)) return false;
    return true;
  }
  if (i.measurementType === "time") return positive(i.durationSeconds);
  if (!positive(i.reps)) return false;
  if (i.hideWeight) return true;
  return isLoadComplete(i.loadType ?? "external", i.load);
}
