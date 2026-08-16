/**
 * Display-only mapping of the existing deterministic 0–100 application score
 * to a 1–5 "Lead Score". The stored 0–100 score is never modified.
 *
 * Lead Score is a prioritization aid — it ranks follow-up order, it is not a
 * judgement of the person.
 */

export const LEAD_SCORE_DISCLAIMER =
  "Lead Score is a prioritization aid, not a judgment of the applicant.";

export function toLeadScore5(score: unknown): number | null {
  const n = typeof score === "number" ? score : Number(score);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(100, n));
  return Math.min(5, Math.max(1, Math.ceil(clamped / 20)));
}

type Breakdown = Record<string, { score: number; max: number; reason: string }>;

/** Concise deterministic reason: strongest + weakest scoring categories. */
export function leadScoreReason(scoring: unknown): string {
  const breakdown = (scoring as { breakdown?: Breakdown } | null)?.breakdown;
  if (!breakdown || typeof breakdown !== "object") return "No scoring detail recorded.";
  const entries = Object.entries(breakdown).filter(
    ([, v]) => v && typeof v.score === "number" && typeof v.max === "number" && v.max > 0,
  );
  if (entries.length === 0) return "No scoring detail recorded.";
  const ranked = [...entries].sort((a, b) => b[1].score / b[1].max - a[1].score / a[1].max);
  const best = ranked[0]!;
  const worst = ranked[ranked.length - 1]!;
  if (best[0] === worst[0]) return `Strongest: ${best[1].reason}.`;
  return `Strongest: ${best[1].reason}. Weakest: ${worst[1].reason}.`;
}
