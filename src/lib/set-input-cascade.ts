/**
 * Helpers for workout set logging defaults and downward cascading inputs.
 *
 * Programmed ranges always start at their top-end target (6–10 => 10,
 * RPE 7–8 => 8). A change made on set N cascades only to N and the sets
 * below it, matching the existing weight-input mental model.
 * Wired into the live workout logger; manual lower-set edits are boundaries.
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

/**
 * Parse a reps prescription into a range/exact target. Accepts unit suffixes
 * ("8-12 per leg", "10–12 each side", "6 to 10 reps"); timed prescriptions and
 * multi-set schemes ("12, 6, 12", "2/3/4/5") are not rep ranges.
 */
export function parseRepTarget(text?: string | null): { exact?: number; min?: number; max?: number } {
  if (!text) return {};
  const s = String(text).trim();
  // Timed prescriptions ("30-45 sec/side") are not rep targets.
  if (/\b(sec|secs|second|seconds|min|mins|minute|minutes)\b|\d\s*s\b/i.test(s)) return {};
  // Ranges with a unit suffix count too: "8-12 per leg", "10–12 each side",
  // "6 to 10 reps". Multi-set schemes ("12, 6, 12", "2/3/4/5") are not ranges.
  const range = s.match(/^(\d+)\s*(?:[-–—]|to)\s*(\d+)(?:\s*(?:reps?|per|each)\b.*|\s*\/.*|\s*)$/i);
  if (range && !/[,/]\s*\d/.test(s)) return { min: Number(range[1]), max: Number(range[2]) };
  const n = s.match(/^(\d+)(?:\s*(?:reps?|per|each)\b.*|\s*)$/i);
  if (n) return { exact: Number(n[1]) };
  return {};
}

export interface FieldCascadeSet {
  index: number;
  /** Current stored value for the field ("" when blank). */
  value: string;
  /** Confirmed (completed) set. */
  completed: boolean;
  /** The athlete typed this field on this set by hand. */
  manual: boolean;
}

/**
 * Reps / RPE fill-down. A change on set `from` flows to the sets below until
 * the first one the athlete set by hand, or a completed set holding its own
 * different value (a real rating). Completed sets that still match the source
 * set's previous value (or are blank) were just following along — they update
 * too, which keeps this correct after a reload. Never flows upward.
 */
export function planFieldCascade(from: number, previousValue: string, sets: FieldCascadeSet[]): number[] {
  const out: number[] = [];
  const same = (a: string, b: string) => a === b || (a !== "" && b !== "" && Number(a) === Number(b));
  for (const s of [...sets].filter((x) => x.index > from).sort((a, b) => a.index - b.index)) {
    if (s.manual) break;
    if (s.completed && s.value !== "" && !same(s.value, previousValue)) break;
    out.push(s.index);
  }
  return out;
}

/** Typed reps / RPE / RIR validation for the set logger. */
export function validateSetField(kind: "reps" | "rpe" | "rir", raw: string):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  const text = raw.trim().replace(",", ".");
  if (text === "") return { ok: true, value: "" };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: "Numbers only" };
  if (kind === "reps") {
    if (!Number.isInteger(n) || n < 0 || n > 200) return { ok: false, error: "Whole reps, 0–200" };
    return { ok: true, value: String(n) };
  }
  const lo = kind === "rpe" ? 1 : 0;
  if (n < lo || n > 10) return { ok: false, error: kind === "rpe" ? "RPE is 1–10" : "RIR is 0–10" };
  const half = Math.round(n * 2) / 2; // RPE/RIR are rated in half steps
  return { ok: true, value: String(half) };
}
