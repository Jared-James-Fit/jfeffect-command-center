import { BadgeCheck, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { REACTION, likedByLine, reactionEmoji, reactionKinds, reactorsSeenAs, type CommunityAuthor, type CommunityPost } from "@/lib/community";
import { usePostReactors, usePovViewer } from "@/lib/community.queries";
import { FollowButton } from "@/components/community/follow-button";

/**
 * Instagram's Likes: everyone who liked a post, for anyone who can see it
 * (community_post_reactors: you first, then people you follow, then the
 * rest, newest first; never someone blocked either way, deleted or
 * deactivated). A ❤️ is the like itself, so only another reaction sits on
 * the photo. Tap someone for their profile; Follow right from the list.
 * Swipe down, ✕ or a tap above it closes it.
 */
export function ReactorsSheet({
  postId,
  onClose,
  onOpenAuthor,
  title = "Likes",
}: {
  postId: string | null;
  onClose: () => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
  title?: string;
}) {
  const { data, isLoading, isError, refetch } = usePostReactors(postId);
  // View as client: "You" is the client being previewed, never the coach's own like
  const pov = usePovViewer();
  const rows = data ? reactorsSeenAs(data, pov, (r) => r.author.user_id) : undefined;
  return (
    <Sheet open={!!postId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" swipeToClose hideCloseButton className="flex max-h-[75dvh] flex-col gap-0 rounded-t-[22px] p-0 sm:mx-auto sm:max-w-[520px]" data-likes-sheet>
        <SheetHeader className="shrink-0 space-y-0 border-b border-border/60 px-4 pb-2.5 pt-2 text-left">
          <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
          <div className="relative flex min-h-9 items-center justify-center">
            <SheetTitle className="text-[16px] font-semibold">
              {title}
              {rows && rows.length > 0 && <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{rows.length}</span>}
            </SheetTitle>
            <SheetDescription className="sr-only">Everyone who liked this post</SheetDescription>
            <SheetClose className="absolute -right-1.5 grid h-9 w-9 place-items-center rounded-full text-muted-foreground active:bg-muted" aria-label="Close">
              <X className="h-5 w-5" />
            </SheetClose>
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1 pb-[max(env(safe-area-inset-bottom),12px)]">
          {isLoading && (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-11 rounded-xl" />
              ))}
            </div>
          )}
          {isError && (
            <div className="flex flex-col items-center gap-3 p-8 text-center text-[13px] text-muted-foreground">
              Couldn't load who liked this.
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          )}
          {rows?.map((r) => {
            const other = r.emoji && r.emoji !== REACTION.key ? reactionEmoji(r.emoji) : null;
            const open = onOpenAuthor && !r.is_me ? () => (onClose(), onOpenAuthor(r.author)) : undefined;
            const sub = r.author.username ? `@${r.author.username}` : r.author.title;
            return (
              <div key={r.author.user_id} className="flex w-full items-center gap-2 rounded-xl pr-3" data-reactor-row>
                <button type="button" disabled={!open} onClick={open} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left active:bg-muted disabled:active:bg-transparent">
                  {/* another reaction sits on the photo (a ❤️ is the like itself), so it lines up whatever the Follow button says */}
                  <span className="relative shrink-0">
                    <UserAvatar src={r.author.avatar_url} name={r.author.name} size={44} expandable={false} />
                    {other && (
                      <span className="absolute -bottom-1 -right-1 grid h-[20px] w-[20px] place-items-center rounded-full bg-background text-[12px] leading-none shadow-sm" aria-label={`Reacted ${other}`}>
                        {other}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1 text-[14px] font-semibold">
                      <span className="truncate">{r.is_me ? "You" : r.author.name}</span>
                      {r.author.is_coach && <BadgeCheck className="h-4 w-4 shrink-0 fill-primary text-primary-foreground" aria-label="Coach" />}
                    </span>
                    {sub && <span className="block truncate text-[13px] text-muted-foreground">{sub}</span>}
                  </span>
                </button>
                {/* Instagram's likes list: follow people right from it */}
                {!r.is_me && <FollowButton userId={r.author.user_id} name={r.author.name} avatarUrl={r.author.avatar_url} size="sm" tone="soft" />}
              </div>
            );
          })}
          {rows && rows.length === 0 && <div className="p-8 text-center text-[13px] text-muted-foreground">No likes yet.</div>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Instagram's "Liked by" line: up to three faces, the other reactions once
 * it isn't only hearts, then "Liked by Marc and 12 others" in plain words.
 * A tap opens the Likes (`onOpen`). Nothing when nobody has liked it. The
 * post card's row has it under its buttons; a post's sheet, under its words.
 */
export function LikedBy({ post, onOpen, highlight = false, className }: { post: CommunityPost; onOpen: () => void; highlight?: boolean; className?: string }) {
  const pov = usePovViewer();
  const people = reactorsSeenAs(post.reactors ?? [], pov, (r) => r.user_id);
  const line = likedByLine({ ...post, reactors: people });
  if (!line) return null;
  // the little ❤️🔥😂 beside the names, once it's not just hearts
  const kinds = reactionKinds(post);
  const showKinds = kinds.length > 1 || (kinds.length === 1 && kinds[0] !== REACTION.emoji);
  const faces = [...people].sort((a, b) => Number(!!b.is_me) - Number(!!a.is_me)).slice(0, 3);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("flex max-w-full min-w-0 items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2 text-left hover:bg-muted active:opacity-70", highlight && "engage-chip", className)}
      aria-label={`${line.lead} ${line.who}. See who liked this`}
      data-who-reacted
    >
      {faces.length > 0 && (
        <span className="flex shrink-0 -space-x-1.5">
          {faces.map((r) => (
            <span key={r.user_id} className="rounded-full ring-2 ring-card">
              <UserAvatar src={r.avatar_url} name={r.is_me ? "You" : r.name} size={22} expandable={false} />
            </span>
          ))}
        </span>
      )}
      {showKinds && <span className="shrink-0 text-[13px] leading-none tracking-[-0.15em]">{kinds.join("")}</span>}
      <span className="truncate text-[13px] text-muted-foreground">
        {line.lead} <span className="font-semibold text-foreground">{line.who}</span>
      </span>
    </button>
  );
}
