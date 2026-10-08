/**
 * Community data access — thin wrappers over the RPCs in
 * 20261006090000_community_sharing.sql. Row-level security and the RPCs are
 * the real gate; nothing here is trusted for permissions.
 */
import { useCallback } from "react";
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
  type PostPointsStatus,
  type ReactionKey,
  type WorkoutShareStats,
  type WinsStats,
  type Reactor,
  reactionTotal,
  planDetail,
  pickLockInSession,
} from "@/lib/community";
import { fireAppEvent } from "@/lib/push/app-events.functions";
import { getClientTodayItems } from "@/lib/today-dashboard.functions";
import { cleanDayTitle, computeTodayState } from "@/lib/workout-today";
import { pickMedia, releasePicked, removeCommunityFiles, signCommunityPaths, uploadCommunityAvatar, uploadPicked, type UploadedMedia } from "@/lib/community-media";

const db = supabase as any;

export const communityKeys = {
  feed: (authorUserId: string | null) => ["community-feed", authorUserId] as const,
  comments: (postId: string) => ["community-comments", postId] as const,
  preview: (completionId: string | null | undefined) => ["community-preview", completionId ?? null] as const,
  myPost: (completionId: string | null | undefined) => ["community-my-post", completionId ?? null] as const,
  post: (postId: string | null) => ["community-post", postId] as const,
  reactors: (postId: string | null) => ["community-reactors", postId] as const,
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
        const had = !!p.my_reaction;
        const total = reactionTotal(p) + (next && !had ? 1 : !next && had ? -1 : 0);
        // "You" shows up in the who-reacted line straight away
        const others = (p.reactors ?? []).filter((r) => !r.is_me);
        const reactors = next ? [{ user_id: "me", name: "You", avatar_url: null, is_coach: false, is_me: true } as Reactor, ...others] : others;
        return { ...p, reactions, my_reaction: next, reaction_count: Math.max(0, total), reactors };
      });
      return { snapshot };
    },
    onError: (_e, _v, ctx) => ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["community-feed"] });
      qc.invalidateQueries({ queryKey: communityKeys.post(post.id) });
      qc.invalidateQueries({ queryKey: communityKeys.reactors(post.id) });
    },
  });
}

/** Everyone who reacted to a post (and with what), for the "who reacted" sheet. */
export function usePostReactors(postId: string | null) {
  return useQuery({
    queryKey: communityKeys.reactors(postId),
    enabled: !!postId,
    staleTime: 15_000,
    queryFn: async (): Promise<{ author: CommunityAuthor; is_me: boolean; emoji: string | null; created_at: string }[]> => {
      const { data, error } = await db.rpc("community_post_reactors", { _post_id: postId });
      if (error) throw error;
      return (data ?? []) as any;
    },
  });
}

/* ---- one-time tips (e.g. "double-tap to like") ------------------------ */

const HINTS_KEY = ["community-hints"] as const;

/** The tips this account has already got. Kept on the account, so a tip doesn't come back on another device. */
export function useHintsSeen() {
  return useQuery({
    queryKey: HINTS_KEY,
    staleTime: Infinity,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await db.from("community_hints_seen").select("hint");
      if (error) throw error;
      return ((data ?? []) as { hint: string }[]).map((r) => r.hint);
    },
  });
}

/** Mark a tip as got (once; it disappears straight away). */
export function useMarkHintSeen() {
  const qc = useQueryClient();
  return useCallback(
    (hint: string) => {
      const cur = qc.getQueryData<string[]>(HINTS_KEY);
      if (cur?.includes(hint)) return;
      qc.setQueryData<string[]>(HINTS_KEY, [...(cur ?? []), hint]);
      void db
        .from("community_hints_seen")
        .upsert({ hint }, { onConflict: "user_id,hint", ignoreDuplicates: true })
        .then(({ error }: { error: unknown }) => {
          if (error) console.warn("[community] couldn't save tip", error);
        });
    },
    [qc],
  );
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
      invalidateCommunity(qc);
      qc.invalidateQueries({ queryKey: ["community-archived"] });
    },
  });
}

/**
 * Post (or update) the community post for a session in one go: upload the
 * photo if there's a new one, save, and tidy up the old photo. No photo =
 * keep whatever the post already has.
 */
export async function shareToCommunity(
  qc: ReturnType<typeof useQueryClient>,
  i: { userId: string; completionId: string; caption: string; visibility: CommunityVisibility; hideLoads?: boolean; photo: File | null; existing: MyPostRow | null | undefined },
): Promise<void> {
  let media: SavePostInput["media"] = { action: "keep" };
  if (i.photo) {
    const res = await pickMedia(i.photo);
    if (!res.ok) throw new Error(res.reason);
    try {
      media = { action: "set", ...(await uploadPicked(res.media, i.userId)) };
    } finally {
      releasePicked(res.media);
    }
  }
  await saveCommunityPost({ completionId: i.completionId, caption: i.caption, visibility: i.visibility, media, hideLoads: i.hideLoads });
  if (media.action === "set" && i.existing?.media_path) await removeCommunityFiles([i.existing.media_path, i.existing.media_thumb_path]);
  invalidateCommunity(qc);
}

/** What a Community post earns right now (today banked? weekly cap?). */
export function usePostPointsStatus(enabled = true) {
  return useQuery({
    queryKey: ["community-post-points"],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<PostPointsStatus | null> => {
      const { data, error } = await db.rpc("community_post_points_status");
      if (error) throw error;
      return (data ?? null) as PostPointsStatus | null;
    },
  });
}

export function invalidateCommunity(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["community-feed"] });
  qc.invalidateQueries({ queryKey: ["community-post-points"] });
  qc.invalidateQueries({ queryKey: ["athlete-rankings-monthly-view"] });
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

/** The author edits a workout post: caption, who it's for, hide weights. */
export function useEditPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { postId: string; caption: string; visibility: CommunityVisibility; hideLoads: boolean }) => {
      const { error } = await db.rpc("community_edit_post", { _post_id: a.postId, _caption: a.caption, _visibility: a.visibility, _hide_loads: a.hideLoads });
      if (error) throw error;
    },
    onSuccess: (_d, a) => {
      invalidateCommunity(qc);
      qc.invalidateQueries({ queryKey: communityKeys.post(a.postId) });
    },
  });
}

/** Archive (only you can see it, in Archived) or restore it to who it was for. */
export function useArchivePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { postId: string; archive: boolean }) => {
      const { error } = await db.rpc("community_archive_post", { _post_id: a.postId, _archive: a.archive });
      if (error) throw error;
    },
    onSuccess: (_d, a) => {
      invalidateCommunity(qc);
      qc.invalidateQueries({ queryKey: communityKeys.post(a.postId) });
      qc.invalidateQueries({ queryKey: ["community-archived"] });
      qc.invalidateQueries({ queryKey: ["community-activity"] });
    },
  });
}

/** Your archived posts, newest archived first. */
export function useMyArchived(enabled: boolean) {
  return useQuery({
    queryKey: ["community-archived"],
    enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<CommunityPost[]> => {
      const { data, error } = await db.rpc("community_my_archived");
      if (error) throw error;
      return (data ?? []) as CommunityPost[];
    },
  });
}

/** A day's exercises in order, for the "Today's plan" lock-in card. */
export function useDayPlan(dayId: string | null | undefined) {
  return useQuery({
    queryKey: ["community-day-plan", dayId ?? null],
    enabled: !!dayId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ name: string; detail: string }[]> => {
      const { data, error } = await supabase
        .from("pl_exercise_rows")
        .select("sort_order, sets, reps_text, duration_seconds, exercise_name_override, exercises(name)")
        .eq("day_id", dayId!)
        .order("sort_order");
      if (error) throw error;
      return ((data ?? []) as any[])
        .map((r) => ({ name: (r.exercise_name_override || r.exercises?.name || "").trim(), detail: planDetail(r) }))
        .filter((r) => r.name);
    },
  });
}

export type TodaySession = {
  dayId: string;
  scheduledWorkoutId: string | null;
  title: string;
  /** The session's row, if one exists. It can be a placeholder that was never started. */
  completionId: string | null;
  /** Really started (started_at / in_progress_at), so posting to it is allowed. */
  started: boolean;
  athleteName: string | null;
};

/**
 * Today's workout for the signed-in client, so Lock In works from the
 * Community tab too: one really in progress (started in the last 12h) or
 * the one scheduled today. Null on a rest day, with no program, or once
 * today's session is finished — never an old unfinished session.
 */
export function useTodaySession(enabled: boolean) {
  return useQuery({
    queryKey: ["community-today-session"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<TodaySession | null> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data: client } = await supabase.from("clients").select("id, full_name, preferred_training_days, preferred_rest_days").eq("user_id", auth.user.id).maybeSingle();
      if (!client) return null;
      const items = await getClientTodayItems(client.id);
      // A rest day means nothing to lock into (same rule as the Home card).
      if (computeTodayState(items, client as any).kind === "rest_day") return null;
      const it = pickLockInSession(items);
      if (!it) return null;
      return { dayId: it.day.id, scheduledWorkoutId: it.scheduledWorkoutId ?? null, title: cleanDayTitle(it.day.title, it.day.day_index), completionId: it.completion?.id ?? null, started: !!(it.completion?.started_at || it.completion?.in_progress_at), athleteName: (client as any).full_name ?? null };
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
