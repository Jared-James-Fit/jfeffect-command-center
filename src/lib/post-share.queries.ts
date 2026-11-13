/**
 * The share sheet's two calls: who a post can go to (ranked, or matching a
 * search) and the send itself. Sends push each chat like any message and
 * refresh the chat lists (never the feed under you).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { directThreadsKey } from "@/lib/direct-chats";
import type { ShareResult, ShareTarget } from "@/lib/post-share";

const db = supabase as any;

export const shareTargetsKey = (postId: string | null, q: string) => ["share-targets", postId, q] as const;

/** The faces for a post's share sheet: the best guesses with no search, else whoever matches it. */
export function useShareTargets(postId: string | null, q: string, enabled: boolean) {
  const query = q.trim();
  return useQuery({
    queryKey: shareTargetsKey(postId, query),
    enabled: enabled && !!postId,
    staleTime: query ? 30_000 : 2 * 60_000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<ShareTarget[]> => {
      const { data, error } = await db.rpc("community_share_targets", {
        _post_id: postId,
        ...(query ? { _q: query } : {}),
        _limit: 30,
      });
      if (error) throw error;
      return Array.isArray(data) ? (data as ShareTarget[]) : [];
    },
  });
}

/** Send a post to the picked chats, with an optional message. */
export function useSharePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { postId: string; to: string[]; body: string }): Promise<ShareResult[]> => {
      const { data, error } = await db.rpc("community_share_post", { _post_id: v.postId, _to: v.to, _body: v.body });
      if (error) throw error;
      return Array.isArray(data?.results) ? (data.results as ShareResult[]) : [];
    },
    onSuccess: (results) => {
      // each one pushes like any message (never holding up the send)
      const fresh = results.filter((r) => r.ok && !r.repeat && r.message_id);
      if (fresh.length) {
        void (async () => {
          try {
            const ev = await import("@/lib/push/events.functions");
            await Promise.allSettled(
              fresh.map((r) =>
                r.route === "direct" || r.route === "group"
                  ? ev.notifyNewGroupMessage({ data: { messageId: r.message_id! } })
                  : ev.notifyNewMessage({ data: { messageId: r.message_id! } }),
              ),
            );
          } catch (e) {
            console.warn("[push] share push failed", e);
          }
        })();
      }
      void qc.invalidateQueries({ queryKey: directThreadsKey });
      void qc.invalidateQueries({ queryKey: ["chat-groups"] });
      void qc.invalidateQueries({ queryKey: ["share-targets"] });
      for (const r of fresh) if (r.client_id) void qc.invalidateQueries({ queryKey: ["messages", r.client_id] });
    },
  });
}
