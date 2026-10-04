/**
 * Performance League scoring — single source for the rules shown to clients
 * and for how points are displayed. Mirrors get_monthly_athlete_rankings().
 */

export const LEAGUE_RULES = [
  { key: "workout", label: "Completed workout", points: 10 },
  { key: "logging", label: "Fully logged workout", points: 5 },
  { key: "bodyweight", label: "Bodyweight log", points: 5, note: "1 per day" },
  { key: "atpr", label: "New ATPR", points: 10, note: "all-time record" },
  { key: "program_pr", label: "PROGRAM PR", points: 5 },
  { key: "block_pr", label: "BLOCK PR", points: 3 },
] as const;

/** Record points: best record per lift, per month, capped monthly (DB: league_month_scores). */
export const LEAGUE_RECORD_CAP = 40;
export const LEAGUE_RECORDS_NOTE = `Records: best one per lift, per month · up to ${LEAGUE_RECORD_CAP} pts a month.`;
/** Months before this used the old "beat your best (e1RM)" rule. */
export const LEAGUE_RECORDS_START = "2026-10-01";

/** The RPC encodes points × 1000 (monthly_xp, strength_score). */
export function leaguePointsFromEncoded(encoded: number | string | null | undefined): number {
  const n = Number(encoded ?? 0) / 1000;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Whole numbers wherever possible; otherwise half points only.
 * 55 → "55", 7.5 → "7.5", 18.8 → "19", 21.3 → "21.5", 1250 → "1,250".
 */
export function formatLeaguePoints(points: number | null | undefined): string {
  const n = Number(points ?? 0);
  if (!Number.isFinite(n)) return "0";
  const half = Math.round(n * 2) / 2;
  const clean = Object.is(half, -0) ? 0 : half;
  return clean.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(clean) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}
