/**
 * Helpers for workout set logging defaults and downward cascading inputs.
 *
 * Programmed ranges always start at their top-end target (6–10 => 10,
 * RPE 7–8 => 8). A change made on set N cascades only to N and the sets
 * below it, matching the existing weight-input mental model.
 */

export type CascadedInputField = "reps" | "rpe";
export const SET_INPUT_CASCADE_EVENT = "jf:set-input-cascade";

const manualBoundaries = new Map<string, Set<number>>();
const boundaryKey = (rowId: string, field: CascadedInputField) => `${rowId}:${field}`;

export function markManualInputBoundary(rowId: string, field: CascadedInputField, setIndex: number) {
  const key = boundaryKey(rowId, field);
  const current = manualBoundaries.get(key) ?? new Set<number>();
  current.add(setIndex);
  manualBoundaries.set(key, current);
}

export function canCascadeInputTo(rowId: string, field: CascadedInputField, fromSetIndex: number, toSetIndex: number) {
  if (toSetIndex <= fromSetIndex) return false;
  const boundaries = manualBoundaries.get(boundaryKey(rowId, field));
  if (!boundaries?.size) return true;
  for (const index of boundaries) {
    if (index > fromSetIndex && index <= toSetIndex) return false;
  }
  return true;
}

export function topEndProgrammedTarget(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const matches = [...text.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const finite = matches.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}

export function defaultProgrammedSetInputs<T extends Record<string, any>>(
  sets: T[],
  prescription: { reps?: unknown; rpe?: unknown },
): T[] {
  const reps = topEndProgrammedTarget(prescription.reps);
  const rpe = topEndProgrammedTarget(prescription.rpe);
  return sets.map((set) => ({
    ...set,
    ...(set.reps == null || set.reps === "" ? { reps } : {}),
    ...(set.rpe == null || set.rpe === "" ? { rpe } : {}),
  }));
}

export function cascadeSetInput<T extends Record<string, any>, K extends keyof T>(
  sets: T[],
  startIndex: number,
  field: K,
  value: T[K],
): T[] {
  if (startIndex < 0 || startIndex >= sets.length) return sets;
  return sets.map((set, index) => (index >= startIndex ? { ...set, [field]: value } : set));
}

export function inheritNewSetInputs<T extends Record<string, any>>(
  sets: T[],
  blankSet: T,
  prescription: { reps?: unknown; rpe?: unknown },
): T {
  const previous = sets.at(-1);
  return {
    ...blankSet,
    reps: previous?.reps ?? topEndProgrammedTarget(prescription.reps),
    rpe: previous?.rpe ?? topEndProgrammedTarget(prescription.rpe),
    ...(previous?.weight != null ? { weight: previous.weight } : {}),
  };
}
