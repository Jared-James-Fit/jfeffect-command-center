/**
 * Queries for coach lessons and story stickers (lessons.ts). Everything goes
 * through the RPCs in 20261129110000_community_lessons.sql; the coach's
 * screens refresh the plan and the feed after every change.
 */
import { useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { communityKeys, invalidateCommunity, patchPost } from "@/lib/community.queries";
import type { CommunityFeedPage, CommunityPost } from "@/lib/community";
import { answerSticker, type LessonItem, type LessonsOverview, type PostSticker, type StickerSpec } from "@/lib/lessons";

const db = supabase as any;

export const lessonKeys = {
  overview: ["community-lessons"] as const,
  library: ["community-lesson-library"] as const,
};

/* ---- stickers ------------------------------------------------------- */

/** Answer a story sticker: the result shows at once, then the server's tally. */
export function useAnswerSticker(post: Pick<CommunityPost, "id">) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { choice?: number | null; value?: number; body?: string }) => {
      const { data, error } = await db.rpc("community_sticker_answer", {
        _post_id: post.id,
        ...(a.choice !== undefined ? { _choice: a.choice } : {}),
        ...(a.value !== undefined ? { _value: a.value } : {}),
        ...(a.body !== undefined ? { _body: a.body } : {}),
      });
      if (error) throw error;
      return data as PostSticker | null;
    },
    onMutate: async (a) => {
      await qc.cancelQueries({ queryKey: ["community-feed"] });
      const snapshot = qc.getQueriesData<InfiniteData<CommunityFeedPage>>({ queryKey: ["community-feed"] });
      const detail = qc.getQueryData(communityKeys.post(post.id));
      patchPost(qc, post.id, (p) => (p.sticker ? { ...p, sticker: answerSticker(p.sticker, a) } : p));
      return { snapshot, detail };
    },
    onSuccess: (sticker) => {
      if (sticker) patchPost(qc, post.id, (p) => ({ ...p, sticker }));
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      if (ctx?.detail !== undefined) qc.setQueryData(communityKeys.post(post.id), ctx.detail);
    },
  });
}

/** Mark a response to your question answered by the story you just posted (Instagram's Share response). */
export async function markStickerAnswered(qc: ReturnType<typeof useQueryClient>, a: { postId: string; userId: string; replyPostId: string }) {
  const { data, error } = await db.rpc("community_sticker_mark_answered", { _post_id: a.postId, _user_id: a.userId, _reply_post_id: a.replyPostId });
  if (error) throw error;
  const sticker = (data ?? null) as PostSticker | null;
  if (sticker) patchPost(qc, a.postId, (p) => ({ ...p, sticker }));
  return sticker;
}

/** Put a sticker on your own post (null takes it off). */
export async function setPostSticker(postId: string, sticker: StickerSpec | null): Promise<PostSticker | null> {
  const { data, error } = await db.rpc("community_set_sticker", { _post_id: postId, _sticker: sticker });
  if (error) throw error;
  return (data ?? null) as PostSticker | null;
}

export function useSetSticker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { postId: string; sticker: StickerSpec | null }) => setPostSticker(a.postId, a.sticker),
    onSuccess: (sticker, a) => patchPost(qc, a.postId, (p) => ({ ...p, sticker })),
  });
}

/* ---- the coach's plan ----------------------------------------------- */

/** The plan, settings, library counts and how lessons are doing (tops up the plan as it loads). */
export function useLessonsOverview(enabled = true) {
  return useQuery({
    queryKey: lessonKeys.overview,
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<LessonsOverview> => {
      const { data, error } = await db.rpc("community_lessons_overview");
      if (error) throw error;
      return data as LessonsOverview;
    },
  });
}

export type LessonAction =
  | { kind: "approve"; id: string; body?: string; sticker?: StickerSpec | null; stickerSet?: boolean; media?: unknown[] }
  | { kind: "save"; id: string; body?: string; sticker?: StickerSpec | null; stickerSet?: boolean; media?: unknown[] }
  | { kind: "unapprove" | "skip" | "restore" | "post_now"; id: string }
  | { kind: "swap"; id: string; itemId?: string | null }
  | { kind: "reschedule"; id: string; postAt: string };

export function useLessonAct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: LessonAction) => {
      const args: Record<string, unknown> = { _id: a.id, _action: a.kind };
      if (a.kind === "approve" || a.kind === "save") {
        if (a.body !== undefined) args._body = a.body;
        if (a.media !== undefined) args._media = a.media;
        if (a.stickerSet !== undefined) {
          args._sticker_set = a.stickerSet;
          args._sticker = a.sticker ?? null;
        }
      }
      if (a.kind === "swap" && a.itemId) args._item_id = a.itemId;
      if (a.kind === "reschedule") args._post_at = a.postAt;
      const { data, error } = await db.rpc("community_lesson_act", args);
      if (error) throw error;
      return data as { status: string; post_id?: string; as?: "lesson" | "data" } | null;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: lessonKeys.overview });
      qc.invalidateQueries({ queryKey: lessonKeys.library });
      qc.invalidateQueries({ queryKey: ["community-pulse"] });
      if (r?.post_id) invalidateCommunity(qc);
    },
  });
}

/** Review mode or let lessons go out on their own; a fixed posting time or the learned one. */
export function useLessonsSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { mode?: "review" | "auto"; time?: string | null }) => {
      const { error } = await db.rpc("community_lessons_settings", {
        ...(a.mode ? { _mode: a.mode } : {}),
        ...(a.time === null ? { _clear_time: true } : a.time ? { _time: a.time } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: lessonKeys.overview });
      qc.invalidateQueries({ queryKey: ["community-pulse"] });
    },
  });
}

export function useLessonLibrary(enabled: boolean) {
  return useQuery({
    queryKey: lessonKeys.library,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<LessonItem[]> => {
      const { data, error } = await db.rpc("community_lesson_library");
      if (error) throw error;
      return (data ?? []) as LessonItem[];
    },
  });
}

/** Add a lesson to the library (id null) or change one. */
export function useSaveLessonItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { id: string | null; body: string; data: Partial<LessonItem>; active?: boolean }) => {
      const { id: _id, body: _b, use_count: _u, last_used_at: _l, planned: _p, active: _a, media: _m, ...data } = a.data;
      const { data: out, error } = await db.rpc("community_lesson_item_save", {
        _id: a.id,
        _body: a.body,
        _data: data,
        ...(a.active !== undefined ? { _active: a.active } : {}),
      });
      if (error) throw error;
      return out as LessonItem;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: lessonKeys.library });
      qc.invalidateQueries({ queryKey: lessonKeys.overview });
    },
  });
}
