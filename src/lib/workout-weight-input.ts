/**
 * Weight input helpers for the workout set logger.
 *
 * Micro-fix scope: picker/type modes, a bodyweight (BW) option and a soft
 * weight cap. No storage/analytics semantics live here — BW is persisted as
 * `is_bodyweight = true` with a 0 numeric load by the SetRow autosave.
 */
export type WUnit = "kg" | "lb";

/** Soft cap: picker never exceeds it, typed entry warns above it. */
export const WEIGHT_CAP: Record<WUnit, number> = { lb: 1000, kg: 450 };

/** Standard plate-ish jumps per unit. */
export const WEIGHT_STEP: Record<WUnit, number> = { lb: 5, kg: 2.5 };

/** Picker values for a unit: 0 then unit-appropriate jumps up to the cap. */
export function weightPickerValues(unit: WUnit): number[] {
  const step = WEIGHT_STEP[unit];
  const cap = WEIGHT_CAP[unit];
  const out: number[] = [];
  for (let v = 0; v <= cap + 1e-9; v += step) out.push(Math.round(v * 10) / 10);
  return out;
}

export type WeightValidation =
  | { ok: true; value: number; aboveCap: boolean }
  | { ok: false; error: string };

/** Validate a typed weight. Rejects letters, negatives and absurd values. */
export function validateTypedWeight(raw: string, unit: WUnit): WeightValidation {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "Enter a valid weight or choose BW." };
  if (!/^\d*\.?\d+$/.test(trimmed)) return { ok: false, error: "Enter a valid weight or choose BW." };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return { ok: false, error: "Enter a valid weight or choose BW." };
  // Hard absurdity guard — 10× the soft cap is never a real lift.
  if (value > WEIGHT_CAP[unit] * 10) return { ok: false, error: "Enter a valid weight or choose BW." };
  return { ok: true, value, aboveCap: value > WEIGHT_CAP[unit] };
}

export type WeightInputMode = "picker" | "type";
const MODE_KEY = "workout-weight-input-mode";

export function readWeightInputMode(): WeightInputMode {
  if (typeof window === "undefined") return "picker";
  try {
    return window.localStorage.getItem(MODE_KEY) === "type" ? "type" : "picker";
  } catch {
    return "picker";
  }
}

export function saveWeightInputMode(mode: WeightInputMode): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
}

/** Display string for a logged weight (BW-aware). */
export function formatWeightDisplay(load: string, isBodyweight: boolean, unit: WUnit): string {
  if (isBodyweight) return "BW";
  return load || unit;
}
