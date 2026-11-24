export type RankingsBoard = "monthly" | "strength";

/**
 * Which board a link asks for: `#rankings=strength` / `#league=strength` (Home's
 * Hall of Strength tile) → Strength; `#rankings`, `#league`, `#league=standings`
 * → Monthly; anything else → null (not a Rankings link). Its own module so Crew
 * can read a link without loading the Rankings tab itself (league-hub.tsx).
 */
export function rankingsFromHash(hash = typeof window === "undefined" ? "" : window.location.hash): RankingsBoard | null {
  if (!/#(rankings|league)/.test(hash)) return null;
  return /(rankings|league)=strength/.test(hash) ? "strength" : "monthly";
}
