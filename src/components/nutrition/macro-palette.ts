/**
 * One colour per macro, shared by the daily targets ring and the per-meal
 * macro strips so a client learns the code once. Protein carries the brand
 * red on purpose: it's the macro coaches push hardest.
 */
export const MACRO_COLOR = {
  protein: "var(--primary)",
  carbs: "hsl(38 92% 50%)",
  fats: "hsl(217 91% 60%)",
  fibre: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)",
} as const;

/** Atwater factors (kcal per gram). */
export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fats: 9 } as const;

export function toMacroNumber(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Whole-number percentages of calories that always add up to 100
 * (largest-remainder rounding), so the ring and the labels agree.
 */
export function kcalShares(
  protein: number,
  carbs: number,
  fats: number,
): {
  kcal: number;
  shares: [number, number, number];
  pcts: [number, number, number];
} {
  const parts = [
    protein * KCAL_PER_GRAM.protein,
    carbs * KCAL_PER_GRAM.carbs,
    fats * KCAL_PER_GRAM.fats,
  ] as const;
  const kcal = parts[0] + parts[1] + parts[2];
  if (kcal <= 0) return { kcal: 0, shares: [0, 0, 0], pcts: [0, 0, 0] };
  const shares = parts.map((p) => p / kcal) as [number, number, number];
  const raw = shares.map((s) => s * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return { kcal, shares, pcts: floors as [number, number, number] };
}

export function formatKcal(n: number): string {
  return Math.round(n).toLocaleString("en-CA");
}
