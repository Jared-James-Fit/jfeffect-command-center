export type DisplayUnit = "lb" | "kg";

const LB_PER_KG = 2.2046226;

/** Convert a stored LB value into the user's display unit. */
export function convFromLb(lb: number, to: DisplayUnit): number {
  return to === "kg" ? lb / LB_PER_KG : lb;
}

/** Convert an entered value into LB (canonical storage unit). */
export function convToLb(value: number, from: DisplayUnit): number {
  return from === "kg" ? value * LB_PER_KG : value;
}