/**
 * Reads the `unified_workouts` row from `app_settings` and answers
 * "should this user see the new unified workout UI yet?".
 *
 * Phase 1: nothing reads the result yet. Phase 3 onward gates the member
 * workout pages on it. Kept tiny so it can be inlined into route loaders
 * later without a network round-trip multiplier.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface UnifiedWorkoutsFlag {
  enabled: boolean;
  pilot_user_ids: string[];
}

const DEFAULT: UnifiedWorkoutsFlag = { enabled: false, pilot_user_ids: [] };

function parseFlag(raw: string | null | undefined): UnifiedWorkoutsFlag {
  if (!raw) return DEFAULT;
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: !!parsed?.enabled,
      pilot_user_ids: Array.isArray(parsed?.pilot_user_ids)
        ? parsed.pilot_user_ids.filter((x: unknown): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return DEFAULT;
  }
}

export function useUnifiedWorkoutsFlag(userId: string | null | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ["app-settings", "unified_workouts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "unified_workouts")
        .maybeSingle();
      return parseFlag(data?.value);
    },
    staleTime: 60_000,
  });
  const flag = data ?? DEFAULT;
  const enabledForUser =
    !!userId && (flag.enabled || flag.pilot_user_ids.includes(userId));
  return { flag, enabledForUser, isLoading };
}

export type { UnifiedWorkoutsFlag };
export { parseFlag };