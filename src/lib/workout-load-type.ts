/**
 * Load-type model for the workout logger.
 *
 * A logged set carries exactly one load type:
 *   - `external`   — normal external resistance (the numeric value is weight)
 *   - `bodyweight` — no external load (numeric value is meaningless / 0)
 *   - `assisted`   — counterweighted machine (the numeric value is ASSISTANCE)
 *
 * Assistance is stored as a positive number, never as a negative weight, never
 * as a fake bodyweight set and never as a note string. Analytics must invert
 * the direction for assisted sets: LESS assistance = better performance.
 */
export type LoadType = "external" | "bodyweight" | "assisted";
export type LUnit = "kg" | "lb";

export const LB_PER_KG = 2.2046226218;

/** Coerce anything into a valid load type (legacy rows only carry the BW flag). */
export function resolveLoadType(raw: unknown, isBodyweight?: boolean | null): LoadType {
  if (raw === "assisted" || raw === "bodyweight" || raw === "external") return raw;
  return isBodyweight ? "bodyweight" : "external";
}

/** Exercise-library default, or null when the exercise has no opinion. */
export function normalizeDefaultLoadType(raw: unknown): LoadType | null {
  return raw === "assisted" || raw === "bodyweight" || raw === "external" ? raw : null;
}

/** Column / picker header: "Weight (lb)" vs "Assistance (lb)". */
export function loadFieldLabel(loadType: LoadType, unit: LUnit): string {
  return `${loadType === "assisted" ? "Assistance" : "Weight"} (${unit})`;
}

/** Short column header used inside the set grid. */
export function loadColumnLabel(loadType: LoadType, unit: LUnit): string {
  return `${loadType === "assisted" ? "Asst" : "Wt"} (${unit.toUpperCase()})`;
}

function trimNum(value: number): string {
  const rounded = Math.abs(value - Math.round(value)) < 0.05 ? Math.round(value) : Number(value.toFixed(1));
  return String(rounded);
}

/** Human display for a logged load. */
export function formatLoadDisplay(
  load: string | number | null | undefined,
  loadType: LoadType,
  unit: LUnit,
  opts: { empty?: string; compact?: boolean } = {},
): string {
  if (loadType === "bodyweight") return "Bodyweight";
  const n = load === "" || load == null ? null : Number(load);
  if (n == null || !Number.isFinite(n)) return opts.empty ?? "Select";
  if (loadType === "assisted") {
    return opts.compact ? `${trimNum(n)} asst` : `${trimNum(n)} ${unit} assistance`;
  }
  return opts.compact ? trimNum(n) : `${trimNum(n)} ${unit}`;
}

/** Convert an assistance/weight value between units (never double-converts). */
export function convertLoad(value: number, from: LUnit, to: LUnit): number {
  if (from === to) return value;
  return to === "kg" ? value / LB_PER_KG : value * LB_PER_KG;
}

const ASSISTED_NAME = /\bassisted\b|\bcounter-?weight(ed)?\b|\bgravitron\b/i;
const AMBIGUOUS_ASSIST = /\bband\b|\bbench\b|\bpartner\b|\bself\b/i;

/**
 * Conservative name heuristic used only for reporting/auditing library gaps.
 * The UI never relies on it — the source of truth is `exercises.default_load_type`.
 */
export function looksLikeAssistedMachine(name: string | null | undefined): boolean {
  const s = String(name ?? "");
  if (!ASSISTED_NAME.test(s)) return false;
  if (AMBIGUOUS_ASSIST.test(s)) return false;
  return /pull\s*-?\s*up|chin\s*-?\s*up|dip/i.test(s);
}
