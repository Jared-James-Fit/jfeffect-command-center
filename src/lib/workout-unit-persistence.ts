/**
 * Pure helper used by SetRow autosave to decide which unit string to persist
 * with a row result.
 *
 * UNIT TOGGLE IS DISPLAY-ONLY — stored weight must never be converted on
 * toggle. Regression fix 2026-06-25. If you remove this, the weight
 * corruption bug returns (the pl_row_results trigger uses actual_load_unit
 * to derive actual_load_kg/actual_load_lb; if we let an unrelated edit
 * rewrite actual_load_unit to match the current display preference, every
 * historical value gets re-normalized in the wrong direction).
 *
 * Rule: if the raw load number is unchanged compared to what's already
 * stored on the row, preserve the original entered unit. Only when the user
 * actually types a new number do we adopt the current display unit.
 */
export type WUnit = "kg" | "lb";

export type ExistingForUnit = {
  actual_load?: number | string | null;
  actual_load_unit?: string | null;
  entered_unit?: string | null;
} | null | undefined;

export function persistedUnitForValue(
  loadValue: string,
  nextUnit: WUnit,
  existing: ExistingForUnit,
): WUnit {
  if (!existing) return nextUnit;
  const existingUnit: WUnit | null =
    existing.entered_unit === "kg" || existing.entered_unit === "lb"
      ? (existing.entered_unit as WUnit)
      : existing.actual_load_unit === "kg" || existing.actual_load_unit === "lb"
        ? (existing.actual_load_unit as WUnit)
        : null;
  const nextLoad = loadValue ? Number(loadValue) : null;
  const currentLoad = existing.actual_load != null ? Number(existing.actual_load) : null;
  const loadUnchanged =
    nextLoad == null && currentLoad == null
      ? true
      : nextLoad != null && currentLoad != null && Math.abs(nextLoad - currentLoad) < 0.0001;
  return loadUnchanged ? (existingUnit ?? nextUnit) : nextUnit;
}