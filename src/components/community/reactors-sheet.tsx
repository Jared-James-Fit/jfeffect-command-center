import { X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NameMarks } from "@/components/name-marks";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { StoryAvatar } from "@/components/community/story-ring";
import { cn } from "@/lib/utils";
import { REACTION, likedByLine, reactionEmoji, reactionKinds, reactorsSeenAs, type CommunityAuthor, type CommunityPost } from "@/lib/community";
import { usePostReactors, usePovViewer, usePrefetchPostReactors } from "@/lib/community.queries";
import { FollowButton } from "@/components/community/follow-button";
import { useOpenedOnce } from "@/hooks/use-opened-once";

/**
 * Instagram's Likes: everyone who liked a post, for anyone who can see it
 * (community_post_reactors over community_post_likers: you first, then
 * people you follow, then the rest, newest first; never someone blocked
 * either way, deleted or deactivated, the same people the post's "Liked by"
 * and its count read). A ❤️ is the like itself, so only another reaction sits on
 * the photo. Tap someone for their profile; Follow right from the list.
 * Swipe down, ✕ or a tap above it closes it.
 */
type ReactorsSheetProps = {
  postId: string | null;
  onClose: () => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
  title?: string;
};

export function ReactorsSheet(props: ReactorsSheetProps) {
  // mounted the first time it opens (then kept, for its closing slide): every post carries one
  return useOpenedOnce(!!props.postId) ? <ReactorsSheetBody {...props} /> : null;
}

function ReactorsSheetBody({ postId, onClose, onOpenAuthor, title = "Likes" }: ReactorsSheetProps) {
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
                {/* another reaction sits on the photo (a ❤️ is the like itself), so it lines up whatever the Follow button says;
                    the photo plays their story when they have one up */}
                <span className="relative ml-3 shrink-0">
                  <StoryAvatar userId={r.author.user_id} src={r.author.avatar_url} name={r.author.name} size={44} onPress={open} pressLabel={`${r.author.name}'s profile`} />
                  {other && (
                    <span className="pointer-events-none absolute -bottom-1 -right-1 grid h-[20px] w-[20px] place-items-center rounded-full bg-background text-[12px] leading-none shadow-sm" aria-label={`Reacted ${other}`}>
                      {other}
                    </span>
                  )}
                </span>
                <button type="button" disabled={!open} onClick={open} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-2 text-left active:bg-muted disabled:active:bg-transparent">
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1 text-[14px] font-semibold">
                      <span className="truncate">{r.is_me ? "You" : r.author.name}</span>
                      <NameMarks person={r.author as any} userId={r.author.user_id} />
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
 * post card's row has it under its buttons; a post's sheet, under its words;
 * a post's own screen in the feed (`variant="page"`), in the one quiet line
 * under its words, where the names give way before the faces and the count.
 */
export function LikedBy({ post, onOpen, highlight = false, className, variant = "row" }: { post: CommunityPost; onOpen: () => void; highlight?: boolean; className?: string; variant?: "row" | "page" }) {
  const pov = usePovViewer();
  const prefetch = usePrefetchPostReactors();
  const people = reactorsSeenAs(post.reactors ?? [], pov, (r) => r.user_id);
  const line = likedByLine({ ...post, reactors: people });
  if (!line) return null;
  const onScreen = variant === "page";
  // the little ❤️🔥😂 beside the names, once it's not just hearts
  const kinds = reactionKinds(post);
  // (not on a post's screen: its reactions rise out of the heart there, and the width is the names')
  const showKinds = !onScreen && (kinds.length > 1 || (kinds.length === 1 && kinds[0] !== REACTION.emoji));
  const faces = [...people].sort((a, b) => Number(!!b.is_me) - Number(!!a.is_me)).slice(0, 3);
  // on a post's screen: "marc and 12 others" can lose its tail to the width, never the "and N others" that is the count
  const tail = onScreen ? line.who.match(/^(.*?)( and \d[\d,]* others?)$/) : null;
  return (
    <button
      type="button"
      onPointerDown={() => prefetch(post.id)}
      onClick={(e) => {
        // on a post's screen the tap is the Likes', never the post's (no like, no pause)
        e.stopPropagation();
        onOpen();
      }}
      className={cn(
        "flex max-w-full min-w-0 items-center gap-1.5 rounded-full text-left active:opacity-70",
        onScreen ? "relative -my-1 py-1 pr-1 after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']" : "py-1 pl-1.5 pr-2 hover:bg-muted",
        highlight && "engage-chip",
        className,
      )}
      aria-label={`${line.lead} ${line.who}. See who liked this`}
      data-who-reacted
      data-liked-by={variant}
    >
      {faces.length > 0 && (
        <span className="flex shrink-0 -space-x-1.5">
          {faces.map((r) => (
            <span key={r.user_id} className={cn("rounded-full ring-2", onScreen ? "ring-black/60" : "ring-card")}>
              <UserAvatar src={r.avatar_url} name={r.is_me ? "You" : r.name} size={onScreen ? 20 : 22} expandable={false} />
            </span>
          ))}
        </span>
      )}
      {showKinds && <span className="shrink-0 text-[13px] leading-none tracking-[-0.15em]">{kinds.join("")}</span>}
      {tail ? (
        <span className="flex min-w-0 items-baseline text-[13px] text-foreground/75">
          <span className="shrink-0">{line.lead}&nbsp;</span>
          <span className="min-w-0 truncate font-semibold text-foreground">{tail[1]}</span>
          <span className="shrink-0 whitespace-pre font-semibold text-foreground">{tail[2]}</span>
        </span>
      ) : (
        <span className={cn("truncate text-[13px]", onScreen ? "text-foreground/75" : "text-muted-foreground")}>
          {line.lead} <span className="font-semibold text-foreground">{line.who}</span>
        </span>
      )}
    </button>
  );
}
