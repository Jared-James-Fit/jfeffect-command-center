/**
 * IPF GL points (the "Goodlift" formula the IPF adopted in 2020):
 * points = result × 100 / (A − B·e^(−C·bodyweight)), bodyweight in kg; 0 under 35 kg.
 * Coefficients as published (and as OpenPowerlifting implements them).
 *
 * Its own small module so a screen that only needs the formula (the Hall of
 * Strength) doesn't load Program Intelligence with it; athlete-development.ts
 * re-exports it.
 */
export type GlSex = "M" | "F";

const GL: Record<"sbd" | "bench", Record<"classic" | "equipped", Record<GlSex, [number, number, number]>>> = {
  sbd: {
    classic: { M: [1199.72839, 1025.18162, 0.00921], F: [610.32796, 1045.59282, 0.03048] },
    equipped: { M: [1236.25115, 1449.21864, 0.01644], F: [758.63878, 949.31382, 0.02435] },
  },
  bench: {
    classic: { M: [320.98041, 281.40258, 0.01008], F: [142.40398, 442.52671, 0.04724] },
    equipped: { M: [381.22073, 733.79378, 0.02398], F: [221.82209, 357.00377, 0.02937] },
  },
};

export function glPoints(resultKg: number | null | undefined, bodyweightKg: number | null | undefined, sex: GlSex | null, event: "sbd" | "bench" = "sbd", equipment: "classic" | "equipped" = "classic"): number | null {
  if (!resultKg || !bodyweightKg || !sex || bodyweightKg < 35 || resultKg <= 0) return null;
  const [a, b, c] = GL[event][equipment][sex];
  const den = a - b * Math.exp(-c * bodyweightKg);
  if (den <= 0) return null;
  return Math.round(((resultKg * 100) / den) * 100) / 100;
}
