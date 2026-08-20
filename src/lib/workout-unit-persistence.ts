/**
 * Canonical weight-unit contract for workout set logs.
 *
 * Storage is always an entered pair (`entered_value`, `entered_unit`) plus
 * normalized kg/lb mirrors. UI may render that physical load in either unit,
 * but a display-unit change must never relabel or rewrite the stored pair.
 */
export type WUnit = "kg" | "lb";

export type ExistingForUnit = {
  actual_load?: number | string | null;
  actual_load_unit?: string | null;
  entered_value?: number | string | null;
  entered_unit?: string | null;
  normalized_kg?: number | string | null;
  normalized_lb?: number | string | null;
  actual_load_kg?: number | string | null;
  actual_load_lb?: number | string | null;
} | null | undefined;

export type PersistedLoad = {
  value: number | null;
  unit: WUnit;
};

export const LB_PER_KG = 2.2046226218;

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function knownUnit(value: unknown): WUnit | null {
  return value === "kg" || value === "lb" ? value : null;
}

/** The unit attached to the original entered value, falling back to legacy. */
export function originalUnit(existing: ExistingForUnit): WUnit | null {
  if (!existing) return null;
  return knownUnit(existing.entered_unit) ?? knownUnit(existing.actual_load_unit);
}

/** The original raw number that the user entered, falling back to legacy. */
export function originalValue(existing: ExistingForUnit): number | null {
  if (!existing) return null;
  return finite(existing.entered_value) ?? finite(existing.actual_load);
}

export function convertLoad(value: number, from: WUnit, to: WUnit): number {
  if (from === to) return value;
  return from === "kg" ? value * LB_PER_KG : value / LB_PER_KG;
}

/**
 * Resolve a persisted result into a physical kg value. Prefer the canonical
 * normalized mirror, then derive from the original entered pair.
 */
export function physicalKg(existing: ExistingForUnit): number | null {
  if (!existing) return null;
  const normalized = finite(existing.normalized_kg) ?? finite(existing.actual_load_kg);
  if (normalized != null) return normalized;
  const raw = originalValue(existing);
  const unit = originalUnit(existing);
  if (raw == null || unit == null) return null;
  return unit === "kg" ? raw : raw / LB_PER_KG;
}

/**
 * Display a persisted result in `targetUnit` without mutating its original
 * entered pair. Prefer normalized values so old and new rows behave alike.
 */
export function displayLoadInUnit(existing: ExistingForUnit, targetUnit: WUnit): number | null {
  if (!existing) return null;
  const direct = targetUnit === "kg"
    ? finite(existing.normalized_kg) ?? finite(existing.actual_load_kg)
    : finite(existing.normalized_lb) ?? finite(existing.actual_load_lb);
  if (direct != null) return direct;
  const kg = physicalKg(existing);
  if (kg != null) return targetUnit === "kg" ? kg : kg * LB_PER_KG;
  const raw = originalValue(existing);
  const unit = originalUnit(existing);
  return raw != null && unit != null ? convertLoad(raw, unit, targetUnit) : null;
}

function samePhysicalLoad(
  valueA: number | null,
  unitA: WUnit,
  valueB: number | null,
  unitB: WUnit,
): boolean {
  if (valueA == null || valueB == null) return valueA == null && valueB == null;
  const kgA = unitA === "kg" ? valueA : valueA / LB_PER_KG;
  const kgB = unitB === "kg" ? valueB : valueB / LB_PER_KG;
  // UI renders converted loads to four decimals, so compare within half a
  // display increment in kg. This still treats any meaningful typed edit as
  // a new physical load while accepting e.g. 90 kg ↔ 198.415 lb.
  return Math.abs(kgA - kgB) < 0.001;
}

/**
 * Resolve the durable entered pair for a display value.
 *
 * When the display value represents the same physical load as the stored row,
 * retain the original entered pair exactly. This makes KG/LB toggles and
 * refetches cosmetic. A genuinely changed physical load adopts the active
 * display unit as its new original unit.
 */
export function persistedLoadForDisplayValue(
  displayValue: string,
  displayUnit: WUnit,
  existing: ExistingForUnit,
): PersistedLoad {
  const next = displayValue.trim() === "" ? null : finite(displayValue);
  const storedValue = originalValue(existing);
  const storedUnit = originalUnit(existing);
  if (storedValue != null && storedUnit != null && samePhysicalLoad(next, displayUnit, storedValue, storedUnit)) {
    return { value: storedValue, unit: storedUnit };
  }
  return { value: next, unit: displayUnit };
}

/**
 * Backward-compatible unit-only facade for legacy call sites. New writes must
 * use `persistedLoadForDisplayValue` so they retain both number and unit.
 */
export function persistedUnitForValue(
  loadValue: string,
  nextUnit: WUnit,
  existing: ExistingForUnit,
): WUnit {
  return persistedLoadForDisplayValue(loadValue, nextUnit, existing).unit;
}

/** Compare two display-state values by physical load for autosave gating. */
export function equalDisplayLoads(
  a: { load: string; unit: WUnit },
  b: { load: string; unit: WUnit },
): boolean {
  const av = a.load.trim() === "" ? null : finite(a.load);
  const bv = b.load.trim() === "" ? null : finite(b.load);
  return samePhysicalLoad(av, a.unit, bv, b.unit);
}
