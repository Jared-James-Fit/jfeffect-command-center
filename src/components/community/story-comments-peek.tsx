import { useEffect, useMemo, useState } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { compactNumber, type CommunityComment, type CommunityPost } from "@/lib/community";
import { useComments, useCommentsRealtime, useSyncCommentCount } from "@/lib/community.queries";
import { STORY_COMMENTS_DWELL_MS, commentCountWords, isStickerText, peekComments } from "@/lib/story-comments";

/**
 * A story's comments, live, for the moment on screen (Nov 26 2026): read once
 * it has been showing a beat (quick taps through a story never fetch), or at
 * once while its comments panel is open, and kept in step with everyone's new
 * comments, likes and deletes (one realtime channel per story). The count and
 * the preview on the story follow along (useSyncCommentCount), so the bar's
 * 💬 count, the floating comments and the panel always agree.
 */
export function useStoryCommentsLive(postId: string | null | undefined, panelOpen: boolean): CommunityComment[] | undefined {
  const [dwelt, setDwelt] = useState<string | null>(null);
  useEffect(() => {
    if (!postId) return;
    const t = window.setTimeout(() => setDwelt(postId), STORY_COMMENTS_DWELL_MS);
    return () => window.clearTimeout(t);
  }, [postId]);
  const id = postId ?? "";
  const on = !!postId && (panelOpen || dwelt === postId);
  const list = useComments(id, on);
  useCommentsRealtime(id, on);
  useSyncCommentCount(id, on ? list.data : undefined);
  return on ? list.data : undefined;
}

/**
 * The newest public comments floating over a story's bottom-left, Instagram's:
 * a small photo, the name and the words, on a soft dark pill so the story stays
 * the picture. The newest sits lowest; a new one rises in. A tap anywhere on
 * them opens every comment (the story's own panel). Never over the controls:
 * it sits inside the story's bottom bar, above the caption and the reply row,
 * and only the pills take a tap.
 */
export function StoryCommentsPeek({
  post,
  live,
  onOpen,
  max,
  className,
}: {
  post: CommunityPost;
  live: CommunityComment[] | undefined;
  onOpen: () => void;
  /** How many float (fewer under a sticker, so nothing sits on it). */
  max?: number;
  className?: string;
}) {
  const items = useMemo(() => peekComments(post.comment_preview, live, max), [post.comment_preview, live, max]);
  const total = post.comment_count ?? 0;
  if (!items.length) return null;
  const more = total > items.length;
  return (
    <div className={cn("pointer-events-none flex flex-col items-start gap-1.5", className)} data-story-comments-peek>
      <button
        type="button"
        onClick={onOpen}
        className="pointer-events-auto flex max-w-[82%] flex-col items-start gap-1.5 text-left active:opacity-80"
        aria-label={`${commentCountWords(total)}. Open comments`}
      >
        {items.map((c) => {
          const sticker = !c.media && isStickerText(c.body);
          return (
            <span
              key={c.id}
              className={cn(
                "flex min-w-0 max-w-full items-start gap-2 rounded-[18px] bg-black/40 py-1.5 pl-1.5 pr-3 ring-1 ring-white/10 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none",
                c.pending && "opacity-70",
              )}
              data-story-peek-comment
            >
              <UserAvatar src={c.author.avatar_url} name={c.author.name} size={22} expandable={false} className="mt-px shrink-0" />
              <span className="line-clamp-2 min-w-0 break-words text-[13px] leading-[18px] text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
                <span className="mr-1.5 font-semibold">{c.author.name.split(" ")[0]}</span>
                {sticker ? <span className="text-[19px] leading-[18px]">{c.body}</span> : <span className="text-white/90">{c.body || c.media || ""}</span>}
              </span>
            </span>
          );
        })}
        {more && (
          <span className="pl-1 text-[12px] font-semibold text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.45)]" data-story-peek-more>
            View all {compactNumber(total)}
          </span>
        )}
      </button>
    </div>
  );
}
