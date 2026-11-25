/**
 * Who a Rankings board is of (Crew → Rankings, both boards; 20270527101500_league_hall_audience.sql):
 * JF Effect Athletes (the coach's active coaching clients, the default) or Community (everyone eligible
 * today: coaching clients and members). Eligibility is automatic from the account, never a list anyone
 * manages. The choice is remembered per person on this phone (like the theme music); the database does
 * the filtering and the ranking among whoever is on the audience.
 */
export type RankingsAudience = "coaching" | "community";

export const DEFAULT_AUDIENCE: RankingsAudience = "coaching";

/** The switch's two options, named for who is on them. */
export const AUDIENCE_OPTIONS: readonly (readonly [RankingsAudience, string])[] = [
  ["coaching", "JF Effect Athletes"],
  ["community", "Community"],
];

export const audienceLabel = (a: RankingsAudience): string => (a === "coaching" ? "JF Effect Athletes" : "Community");

export function parseAudience(raw: unknown): RankingsAudience | null {
  return raw === "coaching" || raw === "community" ? raw : null;
}

/** One key per person, so a phone shared by a coach "viewing as" a client keeps each one's own choice. */
export const audienceStorageKey = (userId: string | null | undefined) => `jf-rankings-audience:${userId ?? "anon"}`;

export function readStoredAudience(userId: string | null | undefined): RankingsAudience | null {
  try {
    return parseAudience(window.localStorage.getItem(audienceStorageKey(userId)));
  } catch {
    return null;
  }
}

export function writeStoredAudience(userId: string | null | undefined, audience: RankingsAudience) {
  try { window.localStorage.setItem(audienceStorageKey(userId), audience); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}

const listeners = new Set<() => void>();
export const subscribeAudience = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith("jf-rankings-audience:")) l(); };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
};

/**
 * Could this person be on that audience's boards? Everyone is on Community; JF Effect Athletes is coaching
 * clients. A member (or anyone not yet known) reads that board without a "you" and is told where they rank.
 */
export function onAudience(audience: RankingsAudience, tier: "coaching" | "self_serve" | null): boolean {
  return audience === "community" || tier === "coaching";
}

/**
 * The audience for a surface that speaks about the person's own week (the Monday card in Crew's feed): their
 * remembered choice, else the audience they are actually on (a member has no JF Effect Athletes week, so
 * theirs is Community's).
 */
export function ownAudience(stored: RankingsAudience | null, tier: "coaching" | "self_serve" | null): RankingsAudience {
  if (stored) return stored;
  return tier === "self_serve" ? "community" : DEFAULT_AUDIENCE;
}
