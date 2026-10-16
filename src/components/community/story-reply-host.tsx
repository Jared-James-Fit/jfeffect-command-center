import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShareStudio, StudioShell } from "@/components/community/studio-chunks";
import type { StudioPost } from "@/components/community/share-studio";
import { markStickerAnswered } from "@/lib/lessons.queries";
import { STORY_REPLY_EVENT, type StoryReply } from "@/lib/story-reply";

/**
 * Where a reply to a question response is made (openStoryReply): the story
 * camera, straight into its editor with the response card on a backdrop and
 * the keyboard up. Posting puts it on your story and marks the response
 * answered. Mounted once on the Crew screen (never in a coach's "View as
 * client", where nothing posts).
 */
export function StoryReplyHost() {
  const qc = useQueryClient();
  const [reply, setReply] = useState<StoryReply | null>(null);
  useEffect(() => {
    const on = (e: Event) => setReply((e as CustomEvent<StoryReply>).detail ?? null);
    window.addEventListener(STORY_REPLY_EVENT, on);
    return () => window.removeEventListener(STORY_REPLY_EVENT, on);
  }, []);
  if (!reply) return null;
  const key = `reply:${reply.postId}:${reply.userId}`;
  // a story never uses onPost (the studio posts it itself)
  const post: StudioPost = { key, label: "Your story", onPost: async () => {} };
  const close = () => setReply(null);
  return (
    <StudioShell onClose={close}>
      <ShareStudio
        key={key}
        open
        onClose={close}
        card={null}
        post={post}
        startAs="story"
        allowNoPhoto={false}
        accept="image/*"
        reply={{
          question: reply.question,
          answer: reply.answer,
          onPosted: async (id) => {
            await markStickerAnswered(qc, { postId: reply.postId, userId: reply.userId, replyPostId: id });
          },
        }}
      />
    </StudioShell>
  );
}
