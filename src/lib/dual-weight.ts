/**
 * A weight in a post, read the same by everyone: in the unit the athlete
 * typed it in (the primary, as typed), with the other unit beside it (the
 * secondary, converted, one decimal). Pure (tested); every Crew surface that
 * shows a weight goes through it, so a viewer's own unit never changes how
 * someone else's lift reads.
 *
 * The stored number is kg (to 4 decimals, the database's mirror), so the
 * primary is converted back and rounded to 2 decimals: 315 lb → 142.8816 kg →
 * "315 lb", never a plate-rounded or double-converted value. The secondary is
 * always worked out from that same stored kg, never from the rounded primary.
 */

export type WeightUnit = "kg" | "lb";

export const LB_PER_KG = 2.2046226218;

/**
 * The unit a crew-wide total (Wins / Recap volume: many athletes' sets added
 * up, no single recorded unit) leads with: 94% of the crew's logged sets and
 * volume in the 90 days to Nov 17 2026 were in lb.
 */
export const CREW_UNIT: WeightUnit = "lb";

export const otherUnit = (u: WeightUnit): WeightUnit => (u === "kg" ? "lb" : "kg");

/** The unit a weight was recorded in, when it says, else the fallback. */
export function recordedUnit(u: unknown, fallback: WeightUnit): WeightUnit {
  return u === "kg" || u === "lb" ? u : fallback;
}

export function kgIn(kg: number, unit: WeightUnit): number {
  return unit === "lb" ? kg * LB_PER_KG : kg;
}

/** 315 → "315", 142.88 → "142.88", 20.0 → "20" (at most `decimals`). */
export function weightNumber(n: number, decimals: number): string {
  const f = 10 ** decimals;
  const r = Math.round(n * f) / f;
  return String(Object.is(r, -0) ? 0 : r);
}

export type DualWeight = { unit: WeightUnit; primary: string; secondary: string };

/**
 * A load: "315 lb" over "142.9 kg". `exact` (the default) is for a weight
 * whose unit is known: it reads back as typed, to 2 decimals. A weight whose
 * unit isn't known (an older set that never said it) is shown in the fallback
 * unit to the nearest plate step instead (0.5 lb, 0.25 kg), as it always was,
 * so 102 kg never reads "224.87 lb".
 */
export function dualLoad(kg: number, unit: WeightUnit, exact = true): DualWeight {
  const other = otherUnit(unit);
  const v = kgIn(kg, unit);
  const step = unit === "lb" ? 2 : 4;
  return {
    unit,
    primary: `${exact ? weightNumber(v, 2) : weightNumber(Math.round(v * step) / step, 2)} ${unit}`,
    secondary: `${weightNumber(kgIn(kg, other), 1)} ${other}`,
  };
}

/**
 * A set's load in the unit it was recorded in when it says (exact), else in
 * the fallback (to a plate step): the one way a post reads a lift.
 */
export function recordedLoad(kg: number, recorded: unknown, fallback: WeightUnit): DualWeight {
  const known = recorded === "kg" || recorded === "lb";
  return dualLoad(kg, known ? (recorded as WeightUnit) : fallback, known);
}

/** A load in one line of text: "315 lb (142.9 kg)". */
export function dualLoadText(kg: number, unit: WeightUnit): string {
  const d = dualLoad(kg, unit);
  return `${d.primary} (${d.secondary})`;
}

/** A total (volume): whole numbers with separators, "17,902 lb" over "8,120 kg". */
export function dualTotal(kg: number, unit: WeightUnit): DualWeight {
  const other = otherUnit(unit);
  const n = (v: number) => Math.round(v).toLocaleString("en-US");
  return { unit, primary: `${n(kgIn(kg, unit))} ${unit}`, secondary: `${n(kgIn(kg, other))} ${other}` };
}

/**
 * The other unit for a label that already names its weight in the unit it was
 * typed in ("455 lb × 1 @ RPE 6", "BW + 20 kg × 8", a film slide's caption):
 * "206.4 kg", or null when the label names no weight.
 */
export function labelSecondary(label: string | null | undefined, kg: number | null | undefined): string | null {
  if (kg == null || !(Number(kg) > 0) || !label) return null;
  const m = /(?:^|\s)\d+(?:\.\d+)?\s?(kg|lb)\b/.exec(label);
  if (!m) return null;
  return dualLoad(Number(kg), m[1] as WeightUnit).secondary;
}

/**
 * A label with its other unit put right after the weight it converts:
 * "455 lb × 1 @ RPE 6" → "455 lb (206.4 kg) × 1 @ RPE 6".
 */
export function labelWithSecondary(label: string, kg: number | null | undefined): string {
  const other = labelSecondary(label, kg);
  if (!other) return label;
  return label.replace(/(\d+(?:\.\d+)?\s?(?:kg|lb)\b)/, `$1 (${other})`);
}

/**
 * A formatted set with its other unit put right after the weight, for one line
 * of text: ("455 lb × 1", "206.4 kg") → "455 lb (206.4 kg) × 1". Unchanged when
 * there's no other unit or no weight in it.
 */
export function withOther(detail: string, other: string | null | undefined): string {
  if (!other) return detail;
  const m = /\d+(?:[.,]\d+)*\s?(?:kg|lb)\b/i.exec(detail);
  if (!m) return detail;
  // keep the other unit in the same case as the line ("455 LB (206.4 KG) × 1" on a card)
  const o = detail === detail.toUpperCase() ? other.toUpperCase() : other;
  return `${detail.slice(0, m.index + m[0].length)} (${o})${detail.slice(m.index + m[0].length)}`;
}

/**
 * A line split right after its weight, so the other unit can sit there in its
 * own style: "Top set · 455 lb × 1 @ RPE 6" → { head: "Top set · 455 lb",
 * tail: " × 1 @ RPE 6" }. Null when the line names no weight.
 */
export function splitAtWeight(text: string): { head: string; tail: string } | null {
  const m = /\d+(?:[.,]\d+)*\s?(?:kg|lb)\b/i.exec(text);
  if (!m) return null;
  const end = m.index + m[0].length;
  return { head: text.slice(0, end), tail: text.slice(end) };
}

/** Numeric input and range displays share the exact conversion constant. */
export function inputKg(value: number, unit: WeightUnit): number {
  return unit === "lb" ? value / LB_PER_KG : value;
}

/** A range reads as one value when both ends match. Converted equivalents
 * use one decimal; the recorded unit retains up to two decimals. */
export function dualRange(loKg: number, hiKg: number | null, unit: WeightUnit, recorded?: WeightUnit): DualWeight {
  const other = otherUnit(unit);
  const part = (u: WeightUnit) => {
    const digits = u === recorded || (!recorded && u === unit) ? 2 : 1;
    const lo = weightNumber(kgIn(loKg, u), digits);
    const hi = hiKg == null ? lo : weightNumber(kgIn(hiKg, u), digits);
    return `${lo === hi ? lo : lo + "–" + hi} ${u}`;
  };
  return { unit, primary: part(unit), secondary: part(other) };
}

export function roundUpWeight(kg: number, incrementKg: number): number | null {
  if (!Number.isFinite(kg) || kg <= 0 || !Number.isFinite(incrementKg) || incrementKg <= 0) return null;
  const ratio = kg / incrementKg;
  if (Math.abs(ratio - Math.round(ratio)) < 1e-7) return null;
  return Number((Math.ceil(ratio) * incrementKg).toFixed(8));
}

/** Display the other unit for a numeric value already in the active unit.
 * Bodyweight-only sets, empty values, and invalid numbers have no equivalent.
 * This is display-only; the workout's original number and unit never change. */
export function displayedLoadOther(value: string | number | null | undefined, unit: WeightUnit, bodyweight = false): string | null {
  if (bodyweight || value == null || String(value).trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return dualLoad(inputKg(n, unit), unit).secondary;
}
