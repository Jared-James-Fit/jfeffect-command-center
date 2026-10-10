import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, MessageCircle, Play } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { CoachBadge } from "@/components/community/post-card";
import { signCommunityPaths } from "@/lib/community-media";
import { VoiceMemoPlayer } from "@/components/community/voice-memo";
import { cn } from "@/lib/utils";
import type { CommentMedia, CommunityAuthor, SharedComment } from "@/lib/community";

/** Ask the community screen to open a post (a shared comment's original). */
export { OPEN_POST_EVENT, openCommunityPost } from "@/lib/community-notifications";

/**
 * Someone's comment, shared as its own post: who said it, on whose post, and
 * the words (plus their photo / video). Live: if the comment is hidden or
 * deleted, so is this.
 */
export function SharedCommentCard({
  shared,
  className,
  onOpenPost,
}: {
  shared: SharedComment | { author: CommunityAuthor; body: string; media?: CommentMedia | null; post_author?: string | null; post_id?: string; gone?: undefined };
  className?: string;
  /** Show "See the post" (the feed and the post page; not the share preview). */
  onOpenPost?: (postId: string) => void;
}) {
  if (shared.gone) {
    return (
      <div className={cn("flex items-center gap-2 rounded-2xl border border-dashed border-border px-3.5 py-3 text-[13px] text-muted-foreground", className)}>
        <MessageCircle className="h-4 w-4 shrink-0" /> This comment isn't available anymore.
      </div>
    );
  }
  const postId = "post_id" in shared ? shared.post_id : undefined;
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-muted/40 px-3.5 py-3", className)}>
      <div className="flex min-w-0 items-center gap-2">
        <UserAvatar src={shared.author.avatar_url} name={shared.author.name} size={30} expandable={false} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[13px] font-bold leading-tight">{shared.author.name}</span>
            {shared.author.is_coach && <CoachBadge className="h-3.5 w-3.5" />}
          </div>
          {shared.post_author && <div className="truncate text-[11px] leading-tight text-muted-foreground">Commented on {shared.post_author}'s post</div>}
        </div>
      </div>
      {shared.body && <p className="mt-2 whitespace-pre-line break-words text-[16px] font-medium leading-snug">{shared.body}</p>}
      {shared.media && <SharedMedia media={shared.media} />}
      {onOpenPost && postId && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenPost(postId);
          }}
          className="mt-2.5 inline-flex h-9 items-center gap-1 rounded-full bg-background px-3 text-[12px] font-bold shadow-sm ring-1 ring-border/70"
        >
          See the post <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function SharedMedia({ media }: { media: CommentMedia }) {
  // a GIF's link or a voice memo's file; else the photo's thumb
  const path = media.type === "gif" || media.type === "audio" ? media.path : media.thumb ?? (media.type === "image" ? media.path : null);
  const { data: url } = useQuery({
    queryKey: ["community-media-full", path],
    enabled: !!path,
    staleTime: 45 * 60 * 1000,
    queryFn: async () => (await signCommunityPaths([path]))[path!] ?? null,
  });
  if (media.type === "audio") return <VoiceMemoPlayer src={url ?? null} duration={media.duration} className="mt-2" />;
  if (media.type === "gif") return url ? <img src={url} alt="GIF" loading="lazy" className="mt-2 block max-h-48 max-w-[240px] rounded-xl bg-muted object-cover" /> : null;
  const ratio = media.width && media.height ? Math.min(Math.max(media.width / media.height, 0.6), 1.6) : 1;
  return (
    <div data-pinch-zoom className="relative mt-2 overflow-hidden rounded-xl bg-muted" style={{ width: ratio >= 1 ? 240 : Math.round(260 * ratio), maxWidth: "100%", aspectRatio: String(ratio) }}>
      {url && <img src={url} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />}
      {media.type === "video" && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white">
            <Play className="ml-0.5 h-4 w-4 fill-white" />
          </span>
        </span>
      )}
    </div>
  );
}
