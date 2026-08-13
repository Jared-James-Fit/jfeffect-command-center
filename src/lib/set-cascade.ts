/**
 * Smart downward cascade for the workout set logger.
 *
 * When a client enters/changes the load on one set, that value should flow
 * into the sets BELOW it — but only while those sets are still "blank" or
 * still "auto-derived" from a previous cascade. A genuine manual override
 * downstream is a hard boundary: the cascade stops there and never skips
 * past it. Nothing ever propagates upward.
 *
 * Pure functions only (no React, no Supabase) so the rule is testable and
 * shared by the UI and the batch persistence path.
 */

export type CascadeOrigin = "manual" | "auto";

export interface CascadeSetState {
  index: number;
  /** How the current load value got there. Undefined = untouched. */
  origin?: CascadeOrigin;
  /** True when the set already has a load value / load state entered. */
  hasValue: boolean;
  /** Confirmed rows the user explicitly completed by hand are never touched. */
  locked?: boolean;
}

/**
 * Returns the set indexes below `from` that should receive the cascaded value.
 * Stops at the first ineligible set (manual override, locked, or a value that
 * did not come from the cascade chain).
 */
export function planCascade(from: number, sets: CascadeSetState[]): number[] {
  const below = sets
    .filter((s) => s.index > from)
    .sort((a, b) => a.index - b.index);
  const out: number[] = [];
  for (const s of below) {
    if (s.locked) break;
    if (s.origin === "manual") break;
    const eligible = s.origin === "auto" || (!s.origin && !s.hasValue);
    if (!eligible) break;
    out.push(s.index);
  }
  return out;
}
