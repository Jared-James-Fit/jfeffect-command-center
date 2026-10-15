import type { MyServiceTier } from "@/lib/service-tier";

/**
 * The last service tier this device saw for each person (sync, like the
 * cached role), so the portal's first frame is already the right one: never a
 * coaching screen that turns into the member one (or back) once the read lands.
 * Kept through sign-out (it's per person and says nothing private), so the
 * next sign-in here opens on the right portal too.
 */
const TIER_HINT_PREFIX = "jfeffect.serviceTier.";

export function readServiceTierHint(userId: string): MyServiceTier | null {
  if (typeof window === "undefined") return null;
  try {
    const v = JSON.parse(localStorage.getItem(TIER_HINT_PREFIX + userId) ?? "null");
    if (!v || typeof v.clientId !== "string" || (v.tier !== "coaching" && v.tier !== "self_serve")) return null;
    return { clientId: v.clientId, tier: v.tier, status: typeof v.status === "string" ? v.status : null };
  } catch {
    return null;
  }
}

export function writeServiceTierHint(userId: string, v: MyServiceTier | null): void {
  if (typeof window === "undefined") return;
  try {
    if (v) localStorage.setItem(TIER_HINT_PREFIX + userId, JSON.stringify({ clientId: v.clientId, tier: v.tier, status: v.status }));
    else localStorage.removeItem(TIER_HINT_PREFIX + userId);
  } catch {
    /* storage full or blocked: the read still answers */
  }
}
