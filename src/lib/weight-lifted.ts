const LB_PER_KG = 2.2046226;

/** Compact tonnage for stat tiles: 842 lb, 12.4k lb, 1.3M lb. */
export function formatWeightLifted(lb: number): string {
  if (!Number.isFinite(lb) || lb <= 0) return "0 lb";
  if (lb >= 1_000_000) return `${(lb / 1_000_000).toFixed(lb >= 10_000_000 ? 0 : 1)}M lb`;
  if (lb >= 10_000) return `${Math.round(lb / 1000).toLocaleString()}k lb`;
  if (lb >= 1000) return `${(lb / 1000).toFixed(1)}k lb`;
  return `${Math.round(lb).toLocaleString()} lb`;
}

/** Same total in kg, as a secondary line for athletes who train in kg. */
export function formatWeightLiftedKg(lb: number): string {
  if (!Number.isFinite(lb) || lb <= 0) return "0 kg";
  const kg = lb / LB_PER_KG;
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(kg >= 10_000_000 ? 0 : 1)}M kg`;
  if (kg >= 10_000) return `${Math.round(kg / 1000).toLocaleString()}k kg`;
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}k kg`;
  return `${Math.round(kg).toLocaleString()} kg`;
}
