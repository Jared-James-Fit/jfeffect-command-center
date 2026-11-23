/**
 * Plan quality for cardio and nutrition (Nov 23 2026): one score out of 100,
 * a sentence on why, and a breakdown by category, each worked out by code from
 * what's on file (cardio/quality.ts, nutrition-targets/plan-quality.ts). It
 * rates how well the prescription suits this person and their goal, never how
 * aggressive or elaborate it is, and says how sure it is: a category with
 * nothing to judge is left out (never guessed), and a plan with too little to
 * go on reads "not enough data" instead of a number. It is a coaching check,
 * not a validated or clinical measure, and the coach can always publish their
 * own plan over it.
 */
export type QualityCategory = {
  key: string;
  label: string;
  /** 0–100, or null when there's nothing to judge it on. */
  score: number | null;
  weight: number;
  /** What lowered it, or what it's good at; plain words, one line each. */
  notes: string[];
};

export type QualityConfidence = "high" | "moderate" | "low" | "insufficient";

export type QualityScore = {
  /** 0–100, null when there isn't enough to score. */
  score: number | null;
  band: "strong" | "good" | "fair" | "weak" | null;
  confidence: QualityConfidence;
  summary: string;
  categories: QualityCategory[];
  /** What would make the read surer. */
  missing: string[];
  /** The ask "Optimize with Cleo" puts in the box (null when nothing's worth changing). */
  optimize: string | null;
};

export const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function bandOf(score: number | null): QualityScore["band"] {
  if (score == null) return null;
  if (score >= 85) return "strong";
  if (score >= 70) return "good";
  if (score >= 55) return "fair";
  return "weak";
}

export const BAND_LABEL: Record<NonNullable<QualityScore["band"]>, string> = {
  strong: "Strong",
  good: "Good",
  fair: "Fair",
  weak: "Needs work",
};

/** The weighted score of the categories that could be judged. */
export function combine(categories: QualityCategory[]): number | null {
  const judged = categories.filter((c) => c.score != null && c.weight > 0);
  if (!judged.length) return null;
  const w = judged.reduce((a, c) => a + c.weight, 0);
  return clampScore(judged.reduce((a, c) => a + c.weight * (c.score as number), 0) / w);
}

export function confidenceFrom(points: number, judged: number, total: number): QualityConfidence {
  if (judged === 0) return "insufficient";
  if (judged < Math.ceil(total / 2)) return "low";
  if (points >= 4) return "high";
  if (points >= 2) return "moderate";
  return "low";
}

/** "Strong goal alignment. Recovery compatibility is the weak spot: hard cardio the day before heavy squats." */
export function summaryOf(categories: QualityCategory[], score: number | null): string {
  const judged = categories.filter((c) => c.score != null);
  if (score == null || !judged.length) return "Not enough on file to score this plan yet.";
  const sorted = judged.slice().sort((a, b) => (a.score as number) - (b.score as number));
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  if ((worst.score as number) >= 85) return `Well suited across the board. Best: ${best.label.toLowerCase()}.`;
  const why = worst.notes[0] ? `: ${worst.notes[0].replace(/\.$/, "")}` : "";
  return `${best.label} is strong. ${worst.label} is the weak spot${why}.`;
}

/** The categories that pulled the score down, as one ask for Cleo. */
export function optimizeAsk(categories: QualityCategory[], what: string): string | null {
  const weak = categories.filter((c) => c.score != null && (c.score as number) < 80 && c.notes.length);
  if (!weak.length) return null;
  const items = weak
    .sort((a, b) => (a.score as number) - (b.score as number))
    .slice(0, 3)
    .map((c) => `${c.label.toLowerCase()} (${c.notes[0].replace(/\.$/, "")})`);
  return `Optimize the ${what}: improve ${items.join("; ")}. Keep everything that's already working, and explain each change.`;
}
