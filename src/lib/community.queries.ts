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
  type CommunityActivity,
  type CommunityAuthor,
  type CommunitySeries,
  type CommunityMember,
  type CommunityPost,
  type CommunityPostDetail,
  type CommunityProfile,
  type CommunityVisibility,
  type ReactionKey,
  type WorkoutShareStats,
  type WinsStats,
} from "@/lib/community";
import { fireAppEvent } from "@/lib/push/app-events.functions";
import { removeCommunityFiles, signCommunityPaths, uploadCommunityAvatar, type UploadedMedia } from "@/lib/community-media";

const db = supabase as any;

export const communityKeys = {
  feed: (authorUserId: string | null) => ["community-feed", authorUserId] as const,
  comments: (postId: string) => ["community-comments", postId] as const,
  preview: (completionId: string | null | undefined) => ["community-preview", completionId ?? null] as const,
  myPost: (completionId: string | null | undefined) => ["community-my-post", completionId ?? null] as const,
  post: (postId: string | null) => ["community-post", postId] as const,
  profile: (userId: string | null) => ["community-profile", userId] as const,
  activity: ["community-activity"] as const,
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
  qc.setQueryData<CommunityPostDetail | null>(communityKeys.post(postId), (old) => (old ? (patch(old) as CommunityPostDetail) : old));
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["community-feed"] });
      qc.invalidateQueries({ queryKey: communityKeys.post(post.id) });
    },
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
  locked_in_at: string | null;
  hide_loads: boolean;
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
        .select("id, caption, visibility, media_path, media_thumb_path, media_type, locked_in_at, hide_loads")
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
  /** Hide loads from everyone but you. Omitted = keep the current setting. */
  hideLoads?: boolean;
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
    _hide_loads: input.hideLoads ?? null,
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
  qc.invalidateQueries({ queryKey: ["community-recent-completions"] });
  qc.invalidateQueries({ queryKey: ["community-profile"] });
  qc.invalidateQueries({ queryKey: ["community-members"] });
}

/* ---- post detail / profile ------------------------------------------ */

/** One post + its full exercise breakdown (the Strava-style activity page). */
export function usePostDetail(postId: string | null) {
  return useQuery({
    queryKey: communityKeys.post(postId),
    enabled: !!postId,
    staleTime: 30_000,
    queryFn: async (): Promise<CommunityPostDetail | null> => {
      const { data, error } = await db.rpc("community_post", { _post_id: postId });
      if (error) throw error;
      return (data ?? null) as CommunityPostDetail | null;
    },
  });
}

export function useCommunityProfile(userId: string | null) {
  return useQuery({
    queryKey: communityKeys.profile(userId),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<CommunityProfile | null> => {
      const { data, error } = await db.rpc("community_profile", { _user_id: userId });
      if (error) throw error;
      return (data ?? null) as CommunityProfile | null;
    },
  });
}

export function useSetBio(userId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bio: string) => {
      const { error } = await db.rpc("community_set_bio", { _bio: bio });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: communityKeys.profile(userId) }),
  });
}

/* ---- coach notes + the weekly series ---------------------------------- */

export type SeriesItem = { id: string; mentor: string; body: string; quote: string | null; quote_source: string | null };
export type SeriesOverview = {
  paused: boolean;
  author: CommunityAuthor | null;
  next: Partial<Record<CommunitySeries, SeriesItem>>;
  library: Record<CommunitySeries, number>;
  history: { id: string; series: CommunitySeries; created_at: string; mentor: string | null; caption: string | null }[];
  this_week: Record<CommunitySeries, boolean>;
  /** Wednesday Wins is written from last week's training: what it would say right now. */
  wins_preview: { body: string; featured: number; trainers: number; week_of: string; next_week: boolean; stats?: WinsStats | null } | null;
};

export function useSeriesOverview(enabled: boolean) {
  return useQuery({
    queryKey: ["community-series"],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<SeriesOverview> => {
      const { data, error } = await db.rpc("community_series_overview");
      if (error) throw error;
      return data as SeriesOverview;
    },
  });
}

/** Every coach-side write here refreshes the overview and the feed. */
export function useSeriesAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { kind: "pause"; paused: boolean } | { kind: "publish"; series: CommunitySeries } | { kind: "item"; id: string; body: string; active?: boolean } | { kind: "note"; body: string }) => {
      const call =
        a.kind === "pause"
          ? db.rpc("community_series_set_paused", { _paused: a.paused })
          : a.kind === "publish"
            ? db.rpc("community_publish_series", { _series: a.series, _force: true })
            : a.kind === "item"
              ? db.rpc("community_series_update_item", { _id: a.id, _body: a.body, _active: a.active ?? true })
              : db.rpc("community_create_note", { _body: a.body });
      const { data, error } = await call;
      if (error) throw error;
      return data as { status?: string } | null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["community-series"] });
      invalidateCommunity(qc);
    },
  });
}

/** Edit a published note's text (author or staff). */
export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { postId: string; body: string }) => {
      const { error } = await db.rpc("community_update_note", { _post_id: a.postId, _body: a.body });
      if (error) throw error;
    },
    onSuccess: (_d, a) => {
      invalidateCommunity(qc);
      qc.invalidateQueries({ queryKey: communityKeys.post(a.postId) });
    },
  });
}

/** Everyone in the community but you (Crew tab). */
export function useCommunityMembers(enabled: boolean) {
  return useQuery({
    queryKey: ["community-members"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<CommunityMember[]> => {
      const { data, error } = await db.rpc("community_members");
      if (error) throw error;
      return (data ?? []) as CommunityMember[];
    },
  });
}

/** Set (File) or clear (null) your own community photo. Old file is deleted. */
export function useSetCommunityAvatar(userId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File | null) => {
      if (!userId) throw new Error("Not signed in");
      const path = file ? await uploadCommunityAvatar(file, userId) : null;
      const { data, error } = await db.rpc("community_set_avatar", { _path: path });
      if (error) {
        if (path) await db.storage.from("avatars").remove([path]).catch(() => {});
        throw error;
      }
      const previous = (data as { previous?: string | null } | null)?.previous;
      if (previous && previous !== path) await db.storage.from("avatars").remove([previous]).catch(() => {});
    },
    onSuccess: () => invalidateCommunity(qc),
  });
}

/* ---- "new posts" badge (server-side seen state) --------------------- */

export function useCommunityActivity(enabled = true) {
  return useQuery({
    queryKey: communityKeys.activity,
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<CommunityActivity> => {
      const { data, error } = await db.rpc("community_activity");
      if (error) throw error;
      return (data ?? { enabled: false, unseen: 0, seen_at: null }) as CommunityActivity;
    },
  });
}

/** Opening the community clears the badge on every device. */
export async function markCommunitySeen(qc: ReturnType<typeof useQueryClient>) {
  try {
    await db.rpc("community_mark_seen");
  } finally {
    qc.setQueryData<CommunityActivity>(communityKeys.activity, (old) => (old ? { ...old, unseen: 0, seen_at: new Date().toISOString() } : old));
  }
}

/* ---- "Share a workout" picker --------------------------------------- */

export type RecentCompletion = {
  completion_id: string;
  completed_at: string;
  title: string;
  duration_min: number | null;
  post_id: string | null;
  visibility: CommunityVisibility | null;
  athlete_name: string | null;
};

/** The athlete's own finished sessions (last 30 days), with any post already made. */
export function useRecentCompletions(enabled: boolean) {
  return useQuery({
    queryKey: ["community-recent-completions"],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<RecentCompletion[]> => {
      const { data, error } = await db.rpc("community_recent_completions", { _limit: 8 });
      if (error) throw error;
      return (data ?? []) as RecentCompletion[];
    },
  });
}

/** The viewer's own unit for loads (athletes: their setting; coaches: app default lb). */
export function useViewerUnit(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["community-unit", userId ?? null],
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<"kg" | "lb"> => {
      const { data } = await supabase.from("clients").select("preferred_weight_unit").eq("user_id", userId!).maybeSingle();
      return (data as { preferred_weight_unit?: string } | null)?.preferred_weight_unit === "kg" ? "kg" : "lb";
    },
  });
}
