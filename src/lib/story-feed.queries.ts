import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { COMMUNITY_BUCKET, removeCommunityFiles } from "@/lib/community-media";
import { invalidateCommunity } from "@/lib/community.queries";
import { postSlides, type CommunityPost } from "@/lib/community";
import { feedCopyPath, feedMedia, storyFeedVerdict, storyFilesToCopy } from "@/lib/story-feed";

const db = supabase as any;

/**
 * Share to feed (a story's ⋯): the feed gets its own post with its own copies
 * of the story's files (copied inside the bucket, never downloaded), the same
 * words, shape and framing, for the same audience. The story stays as it is.
 * A copy the database turns down is removed again.
 */
export function useShareStoryToFeed(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (post: CommunityPost): Promise<string> => {
      const verdict = storyFeedVerdict(post);
      if (!verdict.ok) throw new Error(verdict.reason);
      if (!userId) throw new Error("Sign in again to post");
      const stamp = Date.now();
      const copies = new Map<string, string>();
      const made: string[] = [];
      let sent = false;
      try {
        for (const [i, from] of storyFilesToCopy(postSlides(post)).entries()) {
          const to = feedCopyPath(from, userId, stamp, `${crypto.randomUUID().slice(0, 8)}${i}`);
          const { error } = await supabase.storage.from(COMMUNITY_BUCKET).copy(from, to);
          if (error) throw new Error("Couldn't copy that to your feed. Try again.");
          copies.set(from, to);
          made.push(to);
        }
        sent = true;
        const { data, error } = await db.rpc("community_create_post", {
          _caption: post.caption ?? "",
          _media: feedMedia(post, copies),
          _visibility: verdict.audience,
        });
        if (error) throw error;
        return (data as { id: string }).id;
      } catch (e) {
        // nothing posted: the copies belong to nothing (not after a dropped connection, where the post may have landed)
        if (made.length && (!sent || (e as { code?: string } | null)?.code)) await removeCommunityFiles(made);
        throw e;
      }
    },
    onSuccess: () => invalidateCommunity(qc),
  });
}
