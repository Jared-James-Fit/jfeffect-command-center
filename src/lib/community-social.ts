import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CommunityMember } from "@/lib/community";

const db = supabase as any;

/* ---- Follow ------------------------------------------------------------
 * Private: you see who you follow and who follows you; nobody sees anyone
 * else's lists or any counts. It never decides what you can see (the crew
 * feed is club-wide); it orders Stories, powers "Following" and suggestions,
 * and sends one "followed you" to the bell. All through RPCs.
 */

export type FollowState = { following: string[]; followers: string[] };

export const followKeys = { state: ["community-follows"] as const };

export function useFollowState(enabled = true) {
  return useQuery({
    queryKey: followKeys.state,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<FollowState> => {
      const { data, error } = await db.rpc("community_follow_state");
      if (error) throw error;
      return { following: data?.following ?? [], followers: data?.followers ?? [] };
    },
  });
}

/** Follow / unfollow, instantly (rolled back if the save fails). */
export function useFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, on }: { userId: string; on: boolean }): Promise<FollowState> => {
      const { data, error } = await db.rpc("community_follow", { _user_id: userId, _on: on });
      if (error) throw error;
      return { following: data?.following ?? [], followers: data?.followers ?? [] };
    },
    onMutate: async ({ userId, on }) => {
      await qc.cancelQueries({ queryKey: followKeys.state });
      const before = qc.getQueryData<FollowState>(followKeys.state);
      qc.setQueryData<FollowState>(followKeys.state, (s) => applyFollow(s ?? { following: [], followers: [] }, userId, on));
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(followKeys.state, ctx.before);
    },
    onSuccess: (state) => {
      qc.setQueryData(followKeys.state, state);
    },
  });
}

/** The state after following (on) or unfollowing someone (pure, tested). */
export function applyFollow(s: FollowState, userId: string, on: boolean): FollowState {
  const rest = s.following.filter((id) => id !== userId);
  return { ...s, following: on ? [userId, ...rest] : rest };
}

/**
 * Who to suggest: crew members you don't follow yet. People who follow you
 * come first, then whoever trained most this week, then most recently.
 * Never you, never staff-linked duplicates (the members list already drops those).
 */
export function suggestAthletes(members: CommunityMember[], state: FollowState | undefined, limit = 8): CommunityMember[] {
  const following = new Set(state?.following ?? []);
  const followers = new Set(state?.followers ?? []);
  return members
    .filter((m) => !following.has(m.author.user_id))
    .map((m) => ({
      m,
      score: (followers.has(m.author.user_id) ? 100 : 0) + (m.week_days?.length ?? 0) * 10 + (m.trained_at ? 5 : 0) + (m.author.avatar_url ? 1 : 0),
      at: m.trained_at ? Date.parse(m.trained_at) : 0,
    }))
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .slice(0, limit)
    .map((x) => x.m);
}
