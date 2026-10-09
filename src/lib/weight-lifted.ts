export type WeightUnit = "lb" | "kg";

const LB_PER_KG = 2.2046226;

/** Compact tonnage for stat tiles from a pound total: 842 lb, 12k lb, 1.3M kg. */
export function formatWeightLifted(lb: number, unit: WeightUnit = "lb"): string {
  const v = unit === "kg" ? lb / LB_PER_KG : lb;
  if (!Number.isFinite(v) || v <= 0) return `0 ${unit}`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M ${unit}`;
  if (v >= 10_000) return `${Math.round(v / 1000).toLocaleString()}k ${unit}`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k ${unit}`;
  return `${Math.round(v).toLocaleString()} ${unit}`;
}
