import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { usePortalUserId, useViewingAsClient } from "@/lib/client-impersonation";
import { hasSeenFeature } from "@/lib/feature-seen";
import { spotlightSeenKey, type LeagueWeek, type WeekBaseline } from "@/lib/league-week";
import type { RankingsAudience } from "@/lib/rankings-audience";

const db = supabase as any;

/** Last week in the League for you (null when there's nothing honest to say: not in the League, a month's first week). */
export function useLeagueWeek(enabled = true, audience: RankingsAudience = "community") {
  const viewerId = usePortalUserId() ?? null;
  return useQuery({
    queryKey: ["league-week-spotlight", viewerId, audience],
    enabled: enabled && !!viewerId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<LeagueWeek | null> => {
      const { data, error } = await db.rpc("get_league_week_spotlight", { ...(viewerId ? { _as_user: viewerId } : {}), _audience: audience });
      if (error) throw error;
      // the card says whose board it is (and reads the same board's live standings for its chase line)
      return data ? ({ ...(data as LeagueWeek), audience }) : null;
    },
  });
}

/** Where the board stood when this week began (Monday 00:00), for its ▲ / ▼. Empty the week a month starts. */
export function useLeagueWeekBaseline(audience: RankingsAudience = "community") {
  const viewerId = usePortalUserId() ?? null;
  return useQuery({
    queryKey: ["league-week-movement", viewerId, audience],
    enabled: !!viewerId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<WeekBaseline[]> => {
      const { data, error } = await db.rpc("get_league_week_movement", { ...(viewerId ? { _as_user: viewerId } : {}), _audience: audience });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        client_id: r.client_id,
        rank: r.rank == null ? null : Number(r.rank),
        total_points: Number(r.total_points ?? 0),
        qualified: Boolean(r.qualified),
      }));
    },
  });
}

/**
 * Whether you've had this week's card (server-side, so it never replays on
 * another phone). A coach viewing as a client never reads or writes it: the
 * card shows for the preview and nothing is recorded.
 */
export function useLeagueWeekSeen(weekStart: string | null | undefined) {
  const { user } = useAuth();
  const preview = useViewingAsClient();
  return useQuery({
    queryKey: ["league-week-seen", user?.id, weekStart],
    enabled: !!user?.id && !!weekStart && !preview,
    staleTime: Infinity,
    queryFn: () => hasSeenFeature(user!.id, spotlightSeenKey(weekStart!)),
  });
}
