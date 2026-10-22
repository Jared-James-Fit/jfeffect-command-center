import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PostScore, PostScores } from "@/lib/post-scores";

const db = supabase as any;

export const postScoreKeys = {
  one: (id: string) => ["post-score", id] as const,
  board: ["post-score-board"] as const,
};

/**
 * The feed asks for a page of scores at once: every card's request in the
 * same moment goes as one call (a score is ranked against all the posts, so
 * asking one at a time would repeat that work per card).
 */
let waiting: { id: string; resolve: (s: PostScore | null) => void; reject: (e: unknown) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  timer = undefined;
  const batch = waiting.splice(0, 60);
  if (waiting.length) timer = setTimeout(flush, 0);
  if (!batch.length) return;
  const ids = [...new Set(batch.map((b) => b.id))];
  void db.rpc("community_post_scores", { _post_ids: ids, _days: 120 }).then(
    ({ data, error }: { data: PostScores | null; error: unknown }) => {
      if (error) return batch.forEach((b) => b.reject(error));
      const by = new Map((data?.posts ?? []).map((p) => [p.post_id, { ...p, total: data?.total, attention_since: data?.attention_since ?? null }]));
      batch.forEach((b) => b.resolve(by.get(b.id) ?? null));
    },
    (e: unknown) => batch.forEach((b) => b.reject(e)),
  );
}

export function loadPostScore(id: string): Promise<PostScore | null> {
  return new Promise((resolve, reject) => {
    waiting.push({ id, resolve, reject });
    if (timer === undefined) timer = setTimeout(flush, 40);
  });
}

/** One post's score (null: not a scored feed post), for a coach. */
export function usePostScore(postId: string, enabled: boolean) {
  return useQuery({
    queryKey: postScoreKeys.one(postId),
    queryFn: () => loadPostScore(postId),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** Every feed post of the last 120 days, scored, for the coach's board. */
export function usePostScoreBoard(enabled = true) {
  return useQuery({
    queryKey: postScoreKeys.board,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PostScores> => {
      const { data, error } = await db.rpc("community_post_scores", { _post_ids: null, _days: 120 });
      if (error) throw error;
      const d = data as PostScores;
      return { ...d, posts: (d?.posts ?? []).map((p) => ({ ...p, total: d.total, attention_since: d.attention_since })) };
    },
  });
}
