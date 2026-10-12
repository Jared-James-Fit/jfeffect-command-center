const LB_PER_KG = 2.2046226218;

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * Display-only dual-unit load: "225 lb / 102.5 kg".
 *
 * The value in the athlete's active unit is shown exactly as prescribed; the
 * other unit is a rounded convenience figure (nearest 0.5 kg / nearest 1 lb) so
 * the athlete can load whichever plates are in front of them without tapping the
 * unit toggle. It is never stored and never used for logging, so what gets
 * saved is unchanged. Order is always "lb / kg".
 */
export function formatDualLoad(value: number, unit: "kg" | "lb"): string {
  if (!Number.isFinite(value)) return "";
  if (unit === "lb") {
    // A kg prescription shown in lb (175 kg → 385.81 lb) reads to the nearest
    // half pound; a real lb prescription (225, 132.5) is unchanged by it.
    const lb = Math.round(value * 2) / 2;
    const kg = Math.round((value / LB_PER_KG) * 2) / 2;
    return `${trim(lb)} lb / ${trim(kg)} kg`;
  }
  const lb = Math.round(value * LB_PER_KG);
  return `${trim(lb)} lb / ${trim(value)} kg`;
}
