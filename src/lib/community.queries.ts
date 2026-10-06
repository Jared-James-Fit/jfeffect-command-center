/**
 * Community data access — thin wrappers over the RPCs in
 * 20261006090000_community_sharing.sql. Row-level security and the RPCs are
 * the real gate; nothing here is trusted for permissions.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  FEED_PAGE_SIZE,
  nextFeedCursor,
  type CommunityComment,
  type CommunityFeedPage,
  type CommunityPost,
  type CommunityVisibility,
  type ReactionKey,
  type WorkoutShareStats,
} from "@/lib/community";
import { fireAppEvent } from "@/lib/push/app-events.functions";
import { removeCommunityFiles, signCommunityPaths, type UploadedMedia } from "@/lib/community-media";

const db = supabase as any;

export const communityKeys = {
  feed: (authorUserId: string | null) => ["community-feed", authorUserId] as const,
  comments: (postId: string) => ["community-comments", postId] as const,
  preview: (completionId: string | null | undefined) => ["community-preview", completionId ?? null] as const,
  myPost: (completionId: string | null | undefined) => ["community-my-post", completionId ?? null] as const,
};

/* ---- feed ----------------------------------------------------------- */

export function useCommunityFeed(authorUserId: string | null = null) {
  return useInfiniteQuery({
    queryKey: communityKeys.feed(authorUserId),
    initialPageParam: null as { at: string; id: string } | null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ pageParam }): Promise<CommunityFeedPage> => {
      const { data, error } = await db.rpc("community_feed", {
        _limit: FEED_PAGE_SIZE,
        _before_at: pageParam?.at ?? null,
        _before_id: pageParam?.id ?? null,
        _author_user_id: authorUserId,
      });
      if (error) throw error;
      return (data ?? { posts: [], has_more: false }) as CommunityFeedPage;
    },
    getNextPageParam: (last) => nextFeedCursor(last),
  });
}

/** Signed URLs for one page of posts, resolved in a single storage call. */
export function usePostMediaUrls(posts: CommunityPost[]) {
  const paths = posts.flatMap((p) => [p.media_thumb_path ?? (p.media_type === "image" ? p.media_path : null)]);
  const key = paths.filter(Boolean).join("|");
  return useQuery({
    queryKey: ["community-media-urls", key],
    enabled: key.length > 0,
    staleTime: 45 * 60 * 1000,
    queryFn: () => signCommunityPaths(paths),
  });
}

/** Full-size URL for one post, fetched only when the viewer opens it. */
export function useFullMediaUrl(path: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["community-media-full", path ?? null],
    enabled: enabled && !!path,
    staleTime: 45 * 60 * 1000,
    queryFn: async () => (await signCommunityPaths([path]))[path!] ?? null,
  });
}

function patchPost(qc: ReturnType<typeof useQueryClient>, postId: string, patch: (p: CommunityPost) => CommunityPost) {
  qc.setQueriesData<InfiniteData<CommunityFeedPage>>({ queryKey: ["community-feed"] }, (old) =>
    old ? { ...old, pages: old.pages.map((pg) => ({ ...pg, posts: pg.posts.map((p) => (p.id === postId ? patch(p) : p)) })) } : old,
  );
}

/* ---- reactions ------------------------------------------------------ */

export function useReact(post: CommunityPost, viewerIsCoach: boolean) {
  const qc = useQueryClient();
  return useMutation({
    // `next` = the reaction to end up with (null removes it).
    mutationFn: async (next: ReactionKey | null) => {
      const { error } = await db.rpc("community_react", { _post_id: post.id, _emoji: next });
      if (error) throw error;
      // The one nudge the community ever sends: "your coach saw your training".
      if (next && viewerIsCoach && !post.is_mine) fireAppEvent("community_coach_recognition", post.id);
    },
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ["community-feed"] });
      const snapshot = qc.getQueriesData<InfiniteData<CommunityFeedPage>>({ queryKey: ["community-feed"] });
      patchPost(qc, post.id, (p) => {
        const reactions = { ...p.reactions };
        if (p.my_reaction) reactions[p.my_reaction] = Math.max(0, (reactions[p.my_reaction] ?? 1) - 1);
        if (next) reactions[next] = (reactions[next] ?? 0) + 1;
        return { ...p, reactions, my_reaction: next };
      });
      return { snapshot };
    },
    onError: (_e, _v, ctx) => ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["community-feed"] }),
  });
}

/* ---- comments ------------------------------------------------------- */

export function useComments(postId: string, enabled: boolean) {
  return useQuery({
    queryKey: communityKeys.comments(postId),
    enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<CommunityComment[]> => {
      const { data, error } = await db.rpc("community_comments", { _post_id: postId });
      if (error) throw error;
      return (data ?? []) as CommunityComment[];
    },
  });
}

export function useAddComment(postId: string, viewerIsCoach: boolean, postIsMine: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const { error } = await db.rpc("community_add_comment", { _post_id: postId, _body: body });
      if (error) throw error;
      if (viewerIsCoach && !postIsMine) fireAppEvent("community_coach_recognition", postId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: communityKeys.comments(postId) });
      qc.invalidateQueries({ queryKey: ["community-feed"] });
    },
  });
}

export function useDeleteComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await db.rpc("community_delete_comment", { _comment_id: commentId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: communityKeys.comments(postId) });
      qc.invalidateQueries({ queryKey: ["community-feed"] });
    },
  });
}

/* ---- composer ------------------------------------------------------- */

/** The athlete's own finished workout, in post shape (also the share-card source). */
export function useCompletionPreview(completionId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: communityKeys.preview(completionId),
    enabled: enabled && !!completionId,
    staleTime: 60_000,
    queryFn: async (): Promise<WorkoutShareStats | null> => {
      const { data, error } = await db.rpc("community_completion_preview", { _completion_id: completionId });
      if (error) throw error;
      return (data ?? null) as WorkoutShareStats | null;
    },
  });
}

export type MyPostRow = {
  id: string;
  caption: string | null;
  visibility: CommunityVisibility;
  media_path: string | null;
  media_thumb_path: string | null;
  media_type: "image" | "video" | null;
};

/** The post (if any) already made for this workout — so reopening Share edits it instead of duplicating. */
export function useMyPostForCompletion(completionId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: communityKeys.myPost(completionId),
    enabled: enabled && !!completionId,
    staleTime: 0,
    queryFn: async (): Promise<MyPostRow | null> => {
      const { data, error } = await db
        .from("community_posts")
        .select("id, caption, visibility, media_path, media_thumb_path, media_type")
        .eq("completion_id", completionId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as MyPostRow | null;
    },
  });
}

export type SavePostInput = {
  completionId: string;
  caption: string;
  visibility: CommunityVisibility;
  media: { action: "keep" } | { action: "remove" } | ({ action: "set" } & UploadedMedia);
};

export async function saveCommunityPost(input: SavePostInput): Promise<string> {
  const m = input.media;
  const { data, error } = await db.rpc("community_save_post", {
    _completion_id: input.completionId,
    _caption: input.caption,
    _visibility: input.visibility,
    _media_action: m.action,
    _media_path: m.action === "set" ? m.media_path : null,
    _media_thumb_path: m.action === "set" ? m.media_thumb_path : null,
    _media_type: m.action === "set" ? m.media_type : null,
    _media_width: m.action === "set" ? m.media_width : null,
    _media_height: m.action === "set" ? m.media_height : null,
  });
  if (error) throw error;
  return (data as { id: string }).id;
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (post: { id: string; media_path: string | null; media_thumb_path: string | null; is_mine: boolean }) => {
      const { error } = await db.from("community_posts").delete().eq("id", post.id);
      if (error) throw error;
      if (post.is_mine) await removeCommunityFiles([post.media_path, post.media_thumb_path]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["community-feed"] });
      qc.invalidateQueries({ queryKey: ["community-my-post"] });
    },
  });
}

export function invalidateCommunity(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["community-feed"] });
  qc.invalidateQueries({ queryKey: ["community-my-post"] });
}
