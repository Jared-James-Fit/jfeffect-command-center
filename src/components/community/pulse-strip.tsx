import { useState } from "react";
import { Activity, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { ACTIVITY_PREVIEW_ROWS, activityWeekSummary, pickWorkoutWin, postTimeLabel, reactionEmoji, type CommunityPost, type ReactionKey } from "@/lib/community";
import { useReact } from "@/lib/community.queries";
import { WIN_STYLE } from "@/components/community/pulse-style";

/**
 * Feed → Activity: every automatic post (a finished session, posted by itself)
 * in ONE compact section at the top of the feed. The 2 newest are shown with a
 * one-line summary of the week; "View all" opens the complete history, each
 * row with its props button and opening its full post (likes, comments). The
 * posts people made themselves follow below, newest first.
 */
export function ActivitySection({ posts, unit, viewerIsStaff, onOpen, weekComplete = true, hasMore, loadingMore, onLoadMore }: {
  posts: CommunityPost[];
  /** Everything from the last 7 days is loaded (otherwise the count reads "N+"). */
  weekComplete?: boolean;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpen: (p: CommunityPost) => void;
  /** The feed has older pages, so the history can keep going. */
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [all, setAll] = useState(false);
  const shown = posts.slice(0, ACTIVITY_PREVIEW_ROWS);
  const week = activityWeekSummary(posts);
  const open = (p: CommunityPost) => {
    setAll(false);
    onOpen(p);
  };
  return (
    <section data-activity className="overflow-hidden rounded-3xl border border-border/80 bg-card">
      <header className="flex items-center gap-2 px-4 pb-1.5 pt-3">
        <Activity className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-[13px] font-black">Activity</span>
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-muted-foreground">
          · {week.sessions}{weekComplete ? "" : "+"} {week.sessions === 1 && weekComplete ? "session" : "sessions"} this week{week.prs > 0 ? ` · ${week.prs}${weekComplete ? "" : "+"} PR${week.prs === 1 && weekComplete ? "" : "s"}` : ""}
        </span>
        <button type="button" onClick={() => setAll(true)} className="-mr-1 inline-flex min-h-8 shrink-0 items-center gap-0.5 rounded-full px-2 text-[12px] font-bold text-primary active:bg-muted">
          View all <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </header>
      <ul className="divide-y divide-border/60">
        {shown.map((p) => (
          <PulseRow key={p.id} post={p} unit={unit} viewerIsStaff={viewerIsStaff} onOpen={onOpen} />
        ))}
      </ul>

      <ActivityHistorySheet
        open={all}
        onOpenChange={setAll}
        posts={posts}
        unit={unit}
        viewerIsStaff={viewerIsStaff}
        onOpen={open}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
      />
    </section>
  );
}

/** Every finished session and PR from the crew, newest first (Stories' "All activity" and the Activity card). */
export function ActivityHistorySheet({ open, onOpenChange, posts, unit, viewerIsStaff, onOpen, hasMore, loadingMore, onLoadMore }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  posts: CommunityPost[];
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpen: (p: CommunityPost) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[88dvh] gap-0 overflow-y-auto overscroll-contain rounded-t-[24px] p-0 pb-safe-bottom sm:mx-auto sm:max-w-[520px]">
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 px-5 pb-3 pt-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="text-[16px] font-black">Activity</SheetTitle>
            <SheetDescription className="text-[12px]">Finished sessions and PRs from the crew, newest first.</SheetDescription>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>
        <ul className="divide-y divide-border/60 border-y border-border/60">
          {posts.map((p) => (
            <PulseRow key={p.id} post={p} unit={unit} viewerIsStaff={viewerIsStaff} onOpen={onOpen} />
          ))}
        </ul>
        {hasMore && (
          <div className="px-5 pt-3">
            <Button type="button" variant="outline" className="h-11 w-full rounded-xl" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? "Loading…" : "Show older"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PulseRow({ post, unit, viewerIsStaff, onOpen }: { post: CommunityPost; unit: "kg" | "lb"; viewerIsStaff: boolean; onOpen: (p: CommunityPost) => void }) {
  const react = useReact(post, viewerIsStaff);
  const s = post.stats!;
  const win = pickWorkoutWin(s, unit);
  const style = WIN_STYLE[win.kind];
  const give = (next: ReactionKey | null) => react.mutate(next, { onError: () => toast.error("Couldn't send that") });
  return (
    <li data-pulse-row={win.kind} data-post-id={post.id} className="flex scroll-mt-20 items-center gap-3 px-4 py-2.5">
      <button type="button" onClick={() => onOpen(post)} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70" aria-label={`${post.author.name}: ${win.headline}`}>
        <UserAvatar src={post.author.avatar_url} name={post.author.name} size={36} expandable={false} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
            {/* the name keeps its room; the win's label gives way */}
            <span className="min-w-0 shrink truncate font-bold">{post.is_mine ? "You" : post.author.name}</span>
            <span className={cn("inline-flex shrink-0 items-center gap-0.5 font-bold", style.text.replace("text-white/70", "text-muted-foreground"))}>
              <style.Icon className="h-3 w-3 shrink-0" />
              <span>{win.kind === "done" ? "Done" : win.label}</span>
            </span>
            <span className="shrink-0 text-muted-foreground">· {postTimeLabel(post.created_at)}</span>
          </div>
          {/* the win wraps to a second line instead of cutting off */}
          <div className="line-clamp-2 text-[14px] font-semibold leading-snug">
            {win.headline}
            {win.detail && <span className="text-muted-foreground"> · {win.detail}</span>}
          </div>
        </div>
      </button>
      {!post.is_mine && (
        <button
          type="button"
          data-props
          onClick={() => give(post.my_reaction ? null : "fire")}
          aria-pressed={!!post.my_reaction}
          aria-label={post.my_reaction ? "Props sent. Tap to take back" : "Give props"}
          className={cn("h-8 shrink-0 rounded-full px-3 text-[12px] font-black transition active:scale-95", post.my_reaction ? "bg-orange-500/15 text-orange-600 dark:text-orange-300" : "bg-foreground text-background")}
        >
          {post.my_reaction ? `${reactionEmoji(post.my_reaction) ?? "🔥"} Sent` : "🔥 Props"}
        </button>
      )}
      {post.is_mine && (post.reaction_count ?? 0) > 0 && <span className="shrink-0 text-[12px] font-bold text-muted-foreground">🔥 {post.reaction_count}</span>}
    </li>
  );
}
