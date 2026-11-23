/**
 * Weights on the analytics page, said the same way everywhere (pure, tested).
 *
 * Everything is worked out in lb (getClientResults' unit, the kg mirror
 * converted with the same factor the database uses) and only converted for
 * display, once, here:
 *  - a lift or a total: lb to the nearest whole pound, kg to the nearest
 *    0.5 kg (a meet's 242.5 kg stays 242.5, an estimate's 187.34 kg reads
 *    187.5), so a number never shows false precision in either unit;
 *  - a volume (weight × reps, summed): whole numbers with separators, or a
 *    compact "10.9M" where room is short;
 *  - the other unit beside it (`dualLoad`), always from the same lb value,
 *    never from the rounded number on screen.
 */
export type Unit = "lb" | "kg";
export const LB_PER_KG = 2.2046226;

export const otherUnit = (u: Unit): Unit => (u === "lb" ? "kg" : "lb");

/** lb → the unit (unrounded). */
export function inUnit(lb: number, unit: Unit): number {
  return unit === "kg" ? lb / LB_PER_KG : lb;
}

/** A lift or a total as a number in the unit: "535", "242.5". */
export function loadNum(lb: number, unit: Unit): string {
  if (!Number.isFinite(lb)) return "—";
  if (unit === "lb") return Math.round(lb).toLocaleString("en-US");
  const half = Math.round(inUnit(lb, "kg") * 2) / 2;
  return Number.isInteger(half)
    ? half.toLocaleString("en-US")
    : half.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "535 lb", "242.5 kg". */
export function loadText(lb: number, unit: Unit): string {
  return `${loadNum(lb, unit)} ${unit}`;
}

/** The unit on screen first, the other beside it: { main: "1,444 lb", other: "655 kg" }. */
export function dualLoad(lb: number, unit: Unit): { main: string; other: string } {
  return { main: loadText(lb, unit), other: loadText(lb, otherUnit(unit)) };
}

/** A change in a lift: "+18 lb", "−7.5 kg", "±0 lb". */
export function loadDelta(lb: number, unit: Unit): string {
  const v = unit === "lb" ? Math.round(lb) : Math.round(inUnit(lb, "kg") * 2) / 2;
  if (v === 0) return `±0 ${unit}`;
  const n = unit === "lb" ? Math.abs(v).toLocaleString("en-US") : loadNum(Math.abs(lb), "kg");
  return `${v > 0 ? "+" : "−"}${n} ${unit}`;
}

/** A volume (weight × reps, summed) in the unit: whole, with separators. */
export function volumeNum(lb: number, unit: Unit): string {
  return Math.round(inUnit(lb, unit)).toLocaleString("en-US");
}

/** A volume, compact: 10,852,411 → "10.9M", 48,200 → "48.2k", 950 → "950". */
export function volumeCompact(lb: number, unit: Unit): string {
  const v = inUnit(lb, unit);
  const a = Math.abs(v);
  const fix = (x: number) =>
    x >= 100 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toString();
  if (a >= 1e6) return `${fix(v / 1e6)}M`;
  if (a >= 1e3) return `${fix(v / 1e3)}k`;
  return Math.round(v).toString();
}
