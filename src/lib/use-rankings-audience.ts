import { useCallback, useSyncExternalStore } from "react";
import { usePortalUserId } from "@/lib/client-impersonation";
import { DEFAULT_AUDIENCE, readStoredAudience, subscribeAudience, writeStoredAudience, type RankingsAudience } from "@/lib/rankings-audience";

/** The remembered choice (null until they've made one) and the audience shown (the default until then). */
export function useRankingsAudience() {
  const userId = usePortalUserId();
  const stored = useSyncExternalStore(
    subscribeAudience,
    () => readStoredAudience(userId),
    () => null,
  );
  const setAudience = useCallback((a: RankingsAudience) => writeStoredAudience(userId, a), [userId]);
  return { stored, audience: stored ?? DEFAULT_AUDIENCE, setAudience };
}
