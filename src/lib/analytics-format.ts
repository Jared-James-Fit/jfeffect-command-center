/**
 * Analytics display helpers — formatting + chart palette.
 *
 * IMPORTANT: these affect display only. Stored precision is untouched.
 */

/** Format a weight: integers show no decimal, halves show one. Never 47.4999. */
export function fmtNum(value: number | null | undefined, maxDecimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  // Round to maxDecimals first to kill floating-point noise (47.4999 → 47.5).
  const factor = Math.pow(10, maxDecimals);
  const rounded = Math.round(value * factor) / factor;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(maxDecimals).replace(/\.?0+$/, "");
}

export function fmtWeight(
  value: number | null | undefined,
  unit: string,
  maxDecimals = 1,
) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${fmtNum(value, maxDecimals)} ${unit}`;
}

export function fmtDelta(
  value: number | null | undefined,
  unit: string,
  maxDecimals = 1,
) {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtNum(value, maxDecimals)} ${unit}`;
}

/* -------------------------------------------------------------------------- */
/* Chart palette                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Semantic palette — resolved at runtime to CSS variables so the values
 * follow the theme (dark mode safe).
 * Keep these in lockstep with src/styles.css (--chart-1..5, --primary, etc.).
 */
export const ANALYTICS_COLORS = {
  red: "var(--chart-1)",      // JF red / primary performance
  amber: "var(--chart-2)",    // warning / fatigue
  green: "var(--chart-3)",    // PR / positive change
  blue: "var(--chart-4)",     // secondary strength
  purple: "var(--chart-5)",   // volume / hypertrophy
  cyan: "oklch(0.78 0.13 220)",
  muted: "var(--muted-foreground)",
} as const;

/** Competition-lift accents (consistent across the app). */
export const LIFT_COLORS: Record<string, string> = {
  squat: ANALYTICS_COLORS.red,
  bench: ANALYTICS_COLORS.blue,
  "bench press": ANALYTICS_COLORS.blue,
  deadlift: ANALYTICS_COLORS.purple,
};

/** Detect the competition lift family from an exercise name. */
export function liftFamily(name: string): "squat" | "bench" | "deadlift" | null {
  const n = (name || "").toLowerCase();
  if (/\bdead/.test(n)) return "deadlift";
  if (/\bbench\b/.test(n)) return "bench";
  if (/\bsquat\b/.test(n)) return "squat";
  return null;
}

/** Stable color for an exercise based on lift family or muscle group. */
export function exerciseColor(name: string, muscleGroup?: string | null): string {
  const lf = liftFamily(name);
  if (lf) return LIFT_COLORS[lf];
  return muscleColor(muscleGroup ?? "");
}

/** Stable, hashed muscle-group color from the palette (no random per render). */
const MUSCLE_PALETTE = [
  ANALYTICS_COLORS.red,
  ANALYTICS_COLORS.blue,
  ANALYTICS_COLORS.purple,
  ANALYTICS_COLORS.green,
  ANALYTICS_COLORS.amber,
  ANALYTICS_COLORS.cyan,
];
export function muscleColor(muscle: string): string {
  const key = (muscle || "other").toLowerCase().trim();
  // Stable hash so the same muscle group is always the same color.
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return MUSCLE_PALETTE[Math.abs(h) % MUSCLE_PALETTE.length];
}

/** Friendly short label for long muscle group strings on mobile axes. */
export function shortMuscleLabel(name: string): string {
  const raw = (name || "").trim();
  if (!raw) return "Other";
  // Collapse multi-word groupings, keep first chunk.
  const first = raw.split(/[,/]| and /i)[0]!.trim();
  // Capitalize.
  return first
    .split(" ")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/** Categorise an exercise into a group label for selector grouping. */
export function exerciseGroup(name: string, category?: string | null): string {
  const lf = liftFamily(name);
  if (lf === "squat") return "Squat Variations";
  if (lf === "bench") return "Bench Variations";
  if (lf === "deadlift") return "Deadlift Variations";
  const c = (category || "").toLowerCase();
  if (c.includes("upper")) return "Upper Body";
  if (c.includes("lower")) return "Lower Body";
  if (c.includes("machine")) return "Machines";
  if (c.includes("accessor")) return "Accessories";
  return "Other";
}