/**
 * Save and Repost, Instagram's way (20261207090000_crew_saves_reposts.sql).
 *
 * Save is private: Saved ("All posts" plus your own albums) is only ever
 * yours. Repost puts someone's crew post in front of your followers, with an
 * optional note that floats on it. Both change the post on screen straight
 * away (patchPost) and put it back if the server says no.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fireAppEvent } from "@/lib/push/app-events.functions";
import { communityKeys, patchPost, POST_LIST_KEYS } from "@/lib/community.queries";
import { cleanRepostNote, nextFeedCursor, type CommunityFeedPage, type CommunityPost } from "@/lib/community";

const db = supabase as any;

export const SAVED_PAGE_SIZE = 24;

/** A small picture (or a few words) standing for a saved post on an album tile. */
export type SaveCover = { id: string; path: string | null; text: string | null; kind: "note" | "workout" };
export type SavedAlbum = { id: string; name: string; count: number; covers: SaveCover[]; updated_at: string; has_post?: boolean | null };
export type SavedOverview = { all: { count: number; covers: SaveCover[] }; albums: SavedAlbum[] };

export const savedKeys = {
  overview: (postId: string | null = null) => ["community-saved-albums", postId] as const,
  posts: (albumId: string | null) => ["community-saved", albumId ?? "all"] as const,
  reposts: (userId: string | null) => ["community-user-reposts", userId] as const,
};

type QC = ReturnType<typeof useQueryClient>;

function snapshotLists(qc: QC) {
  return POST_LIST_KEYS.flatMap((k) => qc.getQueriesData<InfiniteData<CommunityFeedPage>>({ queryKey: [...k] }));
}
function restore(qc: QC, snap: ReturnType<typeof snapshotLists>, postId: string, detail: unknown) {
  snap.forEach(([key, data]) => qc.setQueryData(key, data));
  if (detail !== undefined) qc.setQueryData(communityKeys.post(postId), detail);
}

/* ---- Save ----------------------------------------------------------- */

/** Save / unsave (optionally straight into an album). Unsaving says which albums it left, for Undo. */
export function useSavePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { post: Pick<CommunityPost, "id">; on: boolean; albumId?: string | null }) => {
      const { data, error } = await db.rpc("community_save", { _post_id: v.post.id, _on: v.on, ...(v.albumId ? { _album_id: v.albumId } : {}) });
      if (error) throw error;
      return (data ?? { saved: v.on, albums: [] }) as { saved: boolean; albums: string[]; removed_from?: string[] };
    },
    onMutate: async (v) => {
      await Promise.all(POST_LIST_KEYS.map((k) => qc.cancelQueries({ queryKey: [...k] })));
      const snap = snapshotLists(qc);
      const detail = qc.getQueryData(communityKeys.post(v.post.id));
      patchPost(qc, v.post.id, (p) => ({ ...p, saved: v.on }));
      return { snap, detail };
    },
    onError: (_e, v, ctx) => ctx && restore(qc, ctx.snap, v.post.id, ctx.detail),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["community-saved-albums"] });
      void qc.invalidateQueries({ queryKey: ["community-saved"] });
    },
  });
}

/** Saved at a glance: All posts and your albums (with whether each holds `postId`). */
export function useSavedOverview(enabled = true, postId: string | null = null) {
  return useQuery({
    queryKey: savedKeys.overview(postId),
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<SavedOverview> => {
      const { data, error } = await db.rpc("community_saved_albums", postId ? { _post_id: postId } : {});
      if (error) throw error;
      return (data ?? { all: { count: 0, covers: [] }, albums: [] }) as SavedOverview;
    },
  });
}

/** The posts in All (albumId null) or one album, newest saved first. */
export function useSavedPosts(albumId: string | null, enabled = true) {
  return useInfiniteQuery({
    queryKey: savedKeys.posts(albumId),
    enabled,
    initialPageParam: null as { at: string; id: string } | null,
    staleTime: 30_000,
    queryFn: async ({ pageParam }): Promise<CommunityFeedPage> => {
      const { data, error } = await db.rpc("community_saved_posts", {
        _limit: SAVED_PAGE_SIZE,
        ...(albumId ? { _album_id: albumId } : {}),
        ...(pageParam ? { _before_at: pageParam.at, _before_id: pageParam.id } : {}),
      });
      if (error) throw error;
      return (data ?? { posts: [], has_more: false }) as CommunityFeedPage;
    },
    getNextPageParam: (last) => nextFeedCursor(last),
  });
}

function refreshSaved(qc: QC) {
  void qc.invalidateQueries({ queryKey: ["community-saved-albums"] });
  void qc.invalidateQueries({ queryKey: ["community-saved"] });
  // anything saved along the way shows its bookmark filled
  void qc.invalidateQueries({ queryKey: ["community-feed"] });
}

export function useCreateAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { name: string; postIds?: string[] }) => {
      const { data, error } = await db.rpc("community_album_create", { _name: v.name, _post_ids: v.postIds ?? [] });
      if (error) throw error;
      return data as { id: string; name: string; count: number };
    },
    onSettled: () => refreshSaved(qc),
  });
}

export function useRenameAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; name: string }) => {
      const { data, error } = await db.rpc("community_album_rename", { _album_id: v.id, _name: v.name });
      if (error) throw error;
      return data as { id: string; name: string };
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["community-saved-albums"] }),
  });
}

export function useDeleteAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("community_album_delete", { _album_id: id });
      if (error) throw error;
    },
    onSettled: () => refreshSaved(qc),
  });
}

/** Put posts in an album (saving any that aren't yet) or take them out. */
export function useAlbumPosts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { albumId: string; postIds: string[]; add: boolean }) => {
      const { data, error } = await db.rpc("community_album_posts", { _album_id: v.albumId, _post_ids: v.postIds, _in: v.add });
      if (error) throw error;
      return data as { id: string; count: number };
    },
    onSettled: () => refreshSaved(qc),
  });
}

/* ---- Repost --------------------------------------------------------- */

/**
 * Repost / take it back, and set its note (`note` given = set it; empty
 * clears it). A new repost tells the author (grouped, rate limited).
 */
export function useRepost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { post: Pick<CommunityPost, "id" | "my_repost">; on: boolean; note?: string | null }) => {
      const setNote = v.note !== undefined;
      const { data, error } = await db.rpc("community_repost", {
        _post_id: v.post.id,
        _on: v.on,
        ...(setNote ? { _note: cleanRepostNote(v.note) ?? "", _set_note: true } : {}),
      });
      if (error) throw error;
      if (v.on && !v.post.my_repost) fireAppEvent("community_activity", v.post.id);
      return data as { reposted: boolean; note: string | null; at?: string; count: number };
    },
    onMutate: async (v) => {
      await Promise.all(POST_LIST_KEYS.map((k) => qc.cancelQueries({ queryKey: [...k] })));
      const snap = snapshotLists(qc);
      const detail = qc.getQueryData(communityKeys.post(v.post.id));
      patchPost(qc, v.post.id, (p) => {
        const had = !!p.my_repost;
        const note = v.note !== undefined ? cleanRepostNote(v.note) : (p.my_repost?.note ?? null);
        const my_repost = v.on ? { note, at: p.my_repost?.at ?? new Date().toISOString() } : null;
        const repost_count = Math.max(0, (p.repost_count ?? 0) + (v.on && !had ? 1 : !v.on && had ? -1 : 0));
        // your own note floats on it right away; taking it back takes you out of "reposted by"
        const others = (p.reposted_by ?? []).filter((r) => !r.is_me);
        const reposted_by = p.reposted_by && !v.on ? (others.length ? others : null) : p.reposted_by;
        return { ...p, my_repost, repost_count, reposted_by };
      });
      return { snap, detail };
    },
    onError: (_e, v, ctx) => ctx && restore(qc, ctx.snap, v.post.id, ctx.detail),
    onSuccess: (r, v) => patchPost(qc, v.post.id, (p) => ({ ...p, repost_count: r.count, my_repost: r.reposted ? { note: r.note, at: r.at ?? p.my_repost?.at ?? new Date().toISOString() } : null })),
    onSettled: () => {
      // never reload the feed under you (the post would jump to the top); your profile's Reposts and counts move
      void qc.invalidateQueries({ queryKey: ["community-user-reposts"] });
      void qc.invalidateQueries({ queryKey: ["community-profile"] });
    },
  });
}

/** What someone reposted, newest first (their profile's Reposts tab). */
export function useUserReposts(userId: string | null, enabled = true) {
  return useInfiniteQuery({
    queryKey: savedKeys.reposts(userId),
    enabled: enabled && !!userId,
    initialPageParam: null as { at: string; id: string } | null,
    staleTime: 30_000,
    queryFn: async ({ pageParam }): Promise<CommunityFeedPage> => {
      const { data, error } = await db.rpc("community_user_reposts", {
        _user_id: userId,
        _limit: SAVED_PAGE_SIZE,
        ...(pageParam ? { _before_at: pageParam.at, _before_id: pageParam.id } : {}),
      });
      if (error) throw error;
      return (data ?? { posts: [], has_more: false }) as CommunityFeedPage;
    },
    getNextPageParam: (last) => nextFeedCursor(last),
  });
}
