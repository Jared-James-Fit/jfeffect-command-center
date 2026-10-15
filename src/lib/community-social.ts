import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CommunityAuthor } from "@/lib/community";

const db = supabase as any;

/* ---- Follow ------------------------------------------------------------
 * Instagram-style. A public account's crew posts reach the whole crew and
 * anyone can follow it; a private account's reach only the followers it
 * approved (a follow is a request until it's confirmed). Automatic workout
 * stories stay crew-wide either way. Close Friends is a list you pick: a
 * Close Friends post or story reaches only them (green ring). Profiles show
 * follower / following counts; the lists open on a public account, or on a
 * private one you follow. Someone who follows you can message you without a
 * request. The server decides all of it; the app only reads it. All RPCs.
 */

export type FollowState = {
  following: string[];
  followers: string[];
  /** My follow requests a private account hasn't answered yet. */
  requested: string[];
  /** People asking to follow me (private account). */
  requests: string[];
  close_friends: string[];
  is_private: boolean;
};

export const EMPTY_FOLLOW_STATE: FollowState = { following: [], followers: [], requested: [], requests: [], close_friends: [], is_private: false };

const toState = (d: any): FollowState => ({
  following: d?.following ?? [],
  followers: d?.followers ?? [],
  requested: d?.requested ?? [],
  requests: d?.requests ?? [],
  close_friends: d?.close_friends ?? [],
  is_private: !!d?.is_private,
});

export const followKeys = { state: ["community-follows"] as const, list: (userId: string, kind: FollowListKind) => ["community-follow-list", userId, kind] as const };

export function useFollowState(enabled = true) {
  return useQuery({
    queryKey: followKeys.state,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<FollowState> => {
      const { data, error } = await db.rpc("community_follow_state");
      if (error) throw error;
      return toState(data);
    },
  });
}

/** A follow-state change that answers with the new state, applied instantly (rolled back if the save fails). */
function useFollowAction<V>(
  rpc: (v: V) => PromiseLike<{ data: any; error: any }>,
  guess: (s: FollowState, v: V) => FollowState,
  /** It changes which posts you can see (or who sees yours). */
  feed = false,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V): Promise<FollowState> => {
      const { data, error } = await rpc(v);
      if (error) throw error;
      return toState(data);
    },
    onMutate: async (v: V) => {
      await qc.cancelQueries({ queryKey: followKeys.state });
      const before = qc.getQueryData<FollowState>(followKeys.state);
      qc.setQueryData<FollowState>(followKeys.state, (s) => guess(s ?? EMPTY_FOLLOW_STATE, v));
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(followKeys.state, ctx.before);
    },
    onSuccess: (state) => {
      qc.setQueryData(followKeys.state, state);
      // counts, lists and what a private profile shows change with it
      qc.invalidateQueries({ queryKey: ["community-profile"] });
      qc.invalidateQueries({ queryKey: ["community-follow-list"] });
      if (feed) qc.invalidateQueries({ queryKey: ["community-feed"] });
    },
  });
}

/** Follow / unfollow (or cancel a request). Pass isPrivate when you know it, so the button says "Requested" straight away. */
export function useFollow() {
  return useFollowAction(
    ({ userId, on }: { userId: string; on: boolean; isPrivate?: boolean }) => db.rpc("community_follow", { _user_id: userId, _on: on }),
    (s, { userId, on, isPrivate }) => applyFollow(s, userId, on, isPrivate),
    true,
  );
}

/** Confirm (approve) or delete someone's request to follow you. */
export function useRespondToFollow() {
  return useFollowAction(
    ({ userId, approve }: { userId: string; approve: boolean }) => db.rpc("community_follow_respond", { _user_id: userId, _approve: approve }),
    (s, { userId, approve }) => ({
      ...s,
      requests: s.requests.filter((id) => id !== userId),
      followers: approve ? [userId, ...s.followers.filter((id) => id !== userId)] : s.followers,
    }),
  );
}

/** Take someone off your followers (they aren't told). */
export function useRemoveFollower() {
  return useFollowAction(
    ({ userId }: { userId: string }) => db.rpc("community_remove_follower", { _user_id: userId }),
    (s, { userId }) => ({ ...s, followers: s.followers.filter((id) => id !== userId) }),
  );
}

/** Private account on / off (going public confirms every waiting request). */
export function useSetPrivate() {
  return useFollowAction(
    (on: boolean) => db.rpc("community_set_private", { _on: on }),
    (s, on) => ({ ...s, is_private: on }),
    true,
  );
}

/** Add someone to / take them off your Close Friends (they're never told). */
export function useSetCloseFriend() {
  return useFollowAction(
    ({ userId, on }: { userId: string; on: boolean }) => db.rpc("community_set_close_friend", { _user_id: userId, _on: on }),
    (s, { userId, on }) => {
      const rest = s.close_friends.filter((id) => id !== userId);
      return { ...s, close_friends: on ? [userId, ...rest] : rest };
    },
  );
}

export type FollowListKind = "followers" | "following";

/** Someone's followers / following (empty on a private account you don't follow). */
export function useFollowList(userId: string | null, kind: FollowListKind, enabled = true) {
  return useQuery({
    queryKey: followKeys.list(userId ?? "", kind),
    enabled: enabled && !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<CommunityAuthor[]> => {
      const { data, error } = await db.rpc("community_follow_list", { _user_id: userId, _kind: kind });
      if (error) throw error;
      return (data ?? []) as CommunityAuthor[];
    },
  });
}

/**
 * The state after following (on) or unfollowing someone (pure, tested). A
 * private account turns a follow into a request; unfollowing also cancels one.
 */
export function applyFollow(s: FollowState, userId: string, on: boolean, isPrivate = false): FollowState {
  const following = s.following.filter((id) => id !== userId);
  const requested = s.requested.filter((id) => id !== userId);
  if (!on) return { ...s, following, requested };
  return isPrivate && !s.following.includes(userId) ? { ...s, following, requested: [userId, ...requested] } : { ...s, following: [userId, ...following], requested };
}

/** How the Follow button reads for someone. */
export function followLabel(s: FollowState | undefined, userId: string): "Following" | "Requested" | "Follow back" | "Follow" {
  if (s?.following.includes(userId)) return "Following";
  if (s?.requested.includes(userId)) return "Requested";
  return s?.followers.includes(userId) ? "Follow back" : "Follow";
}

