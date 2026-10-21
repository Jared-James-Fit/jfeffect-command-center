import { useEffect, useRef, useState, type ReactNode } from "react";
import { BadgeCheck, Eye, Heart, Repeat2, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { FollowButton } from "@/components/community/follow-button";
import { cn } from "@/lib/utils";
import { activityNote, activityPeople, reactionEmoji, type ActivityFilter, type ActivityPerson, type CommunityAuthor, type CommunityPost } from "@/lib/community";
import { useDeletePost, usePostActivity } from "@/lib/community.queries";
import { followLabel, useFollowState } from "@/lib/community-social";

/**
 * Instagram's viewers for your own story: swipe up (or tap Seen by) and the
 * story shrinks to the top, your other moments beside it (tap one to see
 * its viewers, tap the one you're on to go back to it), and under it how
 * many saw it and liked it, then everyone who saw it by name, likers first
 * with a ❤️ on their photo. Tap someone for their profile. A story you made
 * in the camera can be deleted from here (the bin, top right).
 */
export function StoryViewersPanel({
  post,
  moments,
  onPick,
  onClose,
  onOpenAuthor,
  renderPreview,
  onDeleted,
}: {
  post: CommunityPost;
  /** Your story's moments, oldest first. */
  moments: CommunityPost[];
  onPick: (id: string) => void;
  onClose: () => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
  /** The moment itself, drawn full size (it's scaled down here). */
  renderPreview: (m: CommunityPost) => ReactNode;
  /** It was deleted: the story closes. */
  onDeleted?: () => void;
}) {
  const { data, isLoading, isError, refetch } = usePostActivity(post.id);
  const del = useDeletePost();
  const [asking, setAsking] = useState(false);
  // a story made in the camera can go; a feed post or an automatic workout story is managed from the post
  const canDelete = !!post.story && !post.auto && !!onDeleted;
  const strip = useRef<HTMLDivElement>(null);
  // the moment you're on sits in the middle of the strip
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-moment="${post.id}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [post.id]);
  // Esc goes back to the story (the story viewer itself waits while this is open)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !asking) onClose();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose, asking]);
  const remove = async () => {
    setAsking(false);
    try {
      await del.mutateAsync(post);
      toast.success("Story deleted");
      onDeleted?.();
    } catch {
      toast.error("Couldn't delete it. Try again.");
    }
  };
  const people = data?.people ?? [];
  return (
    <div className="absolute inset-0 z-[60] flex flex-col bg-black text-white animate-in fade-in duration-200" style={{ paddingTop: "var(--story-safe-top, 0.6rem)" }} data-story-interactive data-story-viewers>
      {/* the story, small, with your other moments beside it */}
      <div ref={strip} className="flex shrink-0 items-end gap-2.5 overflow-x-auto px-[calc(50%-54px)] pb-4 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-viewers-moments>
        {moments.map((m, i) => {
          const on = m.id === post.id;
          return (
            <button
              key={m.id}
              type="button"
              data-moment={m.id}
              onClick={() => (on ? onClose() : onPick(m.id))}
              aria-label={on ? "Back to your story" : `Moment ${i + 1}`}
              aria-current={on || undefined}
              className={cn("relative shrink-0 overflow-hidden rounded-xl bg-zinc-900 transition-[width,height,opacity] duration-200 active:scale-95", on ? "h-[192px] w-[108px] ring-2 ring-white" : "h-[150px] w-[84px] opacity-55")}
            >
              <MomentPreview scale={on ? 108 / 360 : 84 / 360}>{renderPreview(m)}</MomentPreview>
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-t-[22px] bg-background text-foreground">
        <div className="flex h-14 shrink-0 items-center gap-4 border-b border-border/60 px-4" data-viewers-head>
          <span className="inline-flex items-center gap-1.5 text-[15px] font-bold tabular-nums" aria-label={`${data?.views ?? 0} views`}>
            <Eye className="h-[22px] w-[22px]" strokeWidth={2} /> {data?.views ?? post.views?.count ?? 0}
          </span>
          {(data?.likes ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[15px] font-bold tabular-nums" aria-label={`${data!.likes} likes`}>
              <Heart className="h-[21px] w-[21px] fill-[#ef3340] text-[#ef3340]" strokeWidth={2} /> {data!.likes}
            </span>
          )}
          <span className="ml-auto" />
          {canDelete && (
            <button type="button" onClick={() => setAsking(true)} disabled={del.isPending} className="grid h-10 w-10 place-items-center rounded-full active:bg-muted disabled:opacity-50" aria-label="Delete story" data-viewers-delete>
              <Trash2 className="h-[21px] w-[21px]" />
            </button>
          )}
          <button type="button" onClick={onClose} className="-mr-1.5 grid h-10 w-10 place-items-center rounded-full active:bg-muted" aria-label="Back to your story">
            <X className="h-[22px] w-[22px]" />
          </button>
        </div>
        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),12px)]">
          {people.length > 0 && <p className="px-4 pb-1 pt-3 text-[15px] font-bold">Viewers</p>}
          {isLoading && <RowsLoading />}
          {isError && <LoadFailed onRetry={() => void refetch()} />}
          {people.map((p) => (
            <PersonRow key={p.user_id} p={p} onOpen={onOpenAuthor ? () => (onClose(), onOpenAuthor(p)) : undefined} />
          ))}
          {data && people.length === 0 && (
            <div className="flex flex-col items-center px-8 py-12 text-center" data-viewers-empty>
              <Eye className="h-9 w-9 text-muted-foreground" strokeWidth={1.6} />
              <p className="mt-3 text-[15px] font-bold">No viewers yet</p>
              <p className="mt-1 text-[13px] text-muted-foreground">When people see your story, they'll show up here.</p>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this story?</AlertDialogTitle>
            <AlertDialogDescription>It comes off your story for everyone. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A moment drawn at a phone's size (360 × 640) and scaled into its tile, so it looks exactly like the story. */
function MomentPreview({ scale, children }: { scale: number; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute left-0 top-0 flex h-[640px] w-[360px] origin-top-left flex-col bg-black" style={{ transform: `scale(${scale})` }} aria-hidden>
      {children}
    </div>
  );
}

const FILTERS: { f: ActivityFilter; Icon: typeof Eye; label: (n: number) => string; count: (d: { views: number; likes: number; shares: number; reposts: number }) => number }[] = [
  { f: "all", Icon: Eye, label: (n) => `${n} ${n === 1 ? "view" : "views"}`, count: (d) => d.views },
  { f: "likes", Icon: Heart, label: (n) => `${n} ${n === 1 ? "like" : "likes"}`, count: (d) => d.likes },
  { f: "shares", Icon: Send, label: (n) => `${n} ${n === 1 ? "share" : "shares"} to stories`, count: (d) => d.shares },
  { f: "reposts", Icon: Repeat2, label: (n) => `${n} ${n === 1 ? "repost" : "reposts"}`, count: (d) => d.reposts },
];

/**
 * Activity for your own feed post (the views row under it): one row of
 * counts, Instagram's icons (👁 views, ❤️ likes, ✈️ shares to stories,
 * 🔁 reposts), each one a tab for the people behind it, and the people with
 * what they did on their photo. Follow shows for anyone you don't follow yet.
 */
export function PostActivitySheet({ postId, start = "all", onClose, onOpenAuthor }: { postId: string | null; start?: ActivityFilter; onClose: () => void; onOpenAuthor?: (a: CommunityAuthor) => void }) {
  const { data, isLoading, isError, refetch } = usePostActivity(postId);
  const [filter, setFilter] = useState<ActivityFilter>(start);
  useEffect(() => {
    if (postId) setFilter(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!postId, start]);
  // a tab shows once there's something behind it (views always)
  const tabs = data ? FILTERS.filter((t) => t.f === "all" || t.count(data) > 0) : [];
  const people = data ? activityPeople(data.people, filter) : [];
  return (
    <Sheet open={!!postId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="flex max-h-[80dvh] flex-col gap-0 rounded-t-[22px] p-0 sm:mx-auto sm:max-w-[520px]" data-post-activity>
        <SheetHeader className="shrink-0 space-y-0 border-b border-border/60 px-4 pt-2 text-left">
          <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="text-[16px] font-bold">Activity</SheetTitle>
            <SheetDescription className="sr-only">Who viewed, liked, shared and reposted your post. Only you can see this.</SheetDescription>
            <SheetClose className="-mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-muted" aria-label="Close">
              <X className="h-5 w-5" />
            </SheetClose>
          </div>
          <div className="-mx-4 mt-1 flex px-2" role="tablist" aria-label="Show" data-activity-tabs>
            {tabs.map((t) => {
              const n = t.count(data!);
              const on = filter === t.f;
              return (
                <button
                  key={t.f}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-label={t.label(n)}
                  onClick={() => setFilter(t.f)}
                  className={cn("flex h-11 flex-1 items-center justify-center gap-1.5 border-b-2 text-[15px] font-bold tabular-nums", on ? "border-foreground text-foreground" : "border-transparent text-muted-foreground")}
                  data-activity-chip={t.f}
                >
                  <t.Icon className={cn("h-[19px] w-[19px]", t.f === "likes" && on && "fill-[#ef3340] text-[#ef3340]")} strokeWidth={2} />
                  {n}
                </button>
              );
            })}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 pb-[max(env(safe-area-inset-bottom),12px)]">
          {isLoading && <RowsLoading />}
          {isError && <LoadFailed onRetry={() => void refetch()} />}
          {people.map((p) => (
            <PersonRow key={p.user_id} p={p} follow onOpen={onOpenAuthor ? () => (onClose(), onOpenAuthor(p)) : undefined} />
          ))}
          {data && people.length === 0 && <p className="p-8 text-center text-[13px] text-muted-foreground">{filter === "all" ? "No views yet." : "Nobody yet."}</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One person: their photo with what they did on it (❤️ / their reaction, ✈️ shared, 🔁 reposted), the name, and a note when they shared it. */
function PersonRow({ p, onOpen, follow = false }: { p: ActivityPerson; onOpen?: () => void; follow?: boolean }) {
  const note = activityNote(p);
  const badge = p.shared_at ? (
    <Send className="h-2.5 w-2.5" strokeWidth={3} />
  ) : p.reposted_at ? (
    <Repeat2 className="h-2.5 w-2.5" strokeWidth={3} />
  ) : p.reaction ? (
    p.reaction === "heart" ? <Heart className="h-2.5 w-2.5 fill-white" strokeWidth={0} /> : <span className="text-[11px] leading-none">{reactionEmoji(p.reaction)}</span>
  ) : null;
  const tint = p.shared_at ? "bg-[#7c3aed]" : p.reposted_at ? "bg-emerald-500" : p.reaction === "heart" ? "bg-[#ef3340]" : "bg-background";
  return (
    <div className="flex items-center gap-3 px-4 py-2" data-activity-person>
      <button type="button" disabled={!onOpen} onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70 disabled:active:opacity-100">
        <span className="relative shrink-0">
          <UserAvatar src={p.avatar_url} name={p.name} size={48} expandable={false} />
          {badge && <span className={cn("absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full text-white ring-2 ring-background", tint)}>{badge}</span>}
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1 text-[14px] font-semibold">
            <span className="truncate">{p.name}</span>
            {p.is_coach && <BadgeCheck className="h-4 w-4 shrink-0 fill-primary text-primary-foreground" aria-label="Coach" />}
          </span>
          {note && <span className="block truncate text-[13px] text-muted-foreground">{note}</span>}
        </span>
      </button>
      {follow && <FollowIfNot p={p} />}
    </div>
  );
}

/** Follow, for someone you don't follow yet (people you follow get nothing: no column of "Following"). */
function FollowIfNot({ p }: { p: ActivityPerson }) {
  const { data: state } = useFollowState();
  const label = followLabel(state, p.user_id);
  if (!state || label === "Following" || label === "Requested") return null;
  return <FollowButton userId={p.user_id} name={p.name} avatarUrl={p.avatar_url} size="sm" tone="soft" />;
}

function RowsLoading() {
  return (
    <div className="space-y-3 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-4 w-32 rounded" />
        </div>
      ))}
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <button type="button" onClick={onRetry} className="w-full p-6 text-center text-[13px] text-muted-foreground">
      Couldn't load this. Tap to try again.
    </button>
  );
}
