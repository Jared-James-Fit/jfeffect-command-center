import { useMemo, useState } from "react";
import { Activity, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { activityDay, activityFaces, activityWeekSummary, isRealWin, pickWorkoutWin, postTimeLabel, type CommunityAuthor, type CommunityPost, type ReactionKey } from "@/lib/community";
import { useReact } from "@/lib/community.queries";
import { WIN_STYLE } from "@/components/community/pulse-style";
import { ReactionButton } from "@/components/community/reaction-button";
import { ReactorsSheet } from "@/components/community/reactors-sheet";

/**
 * Feed → Activity: the crew's finished sessions (posted by themselves), as
 * ONE bubble in the story row, right after "Post", so they take no room from
 * the feed. Its tag is the week's PRs; its ring is lit while there's a
 * session you haven't watched. Tap it and it plays like a story (the crew's
 * last day, see activityStory and the StoryRail); "All activity" in it (or the
 * bubble on a week with nothing to play) opens ActivitySheet: the week in
 * numbers, then its Wins (PRs, milestones, streaks; never a wall of routine
 * sessions) or All, by day.
 *
 * Celebrating is the app's own like: tap the heart (hold for 👍 ‼️ 🔥 😂),
 * same as any post, so it's one gesture everywhere. On your own rows you see
 * who celebrated (faces + count; tap for everyone). The face opens the
 * athlete, the row opens the workout.
 */
export function ActivityBubble({ posts, weekComplete = true, unseen, onClick }: {
  posts: CommunityPost[];
  weekComplete?: boolean;
  /** Something in the Activity story they haven't watched: the ring is lit, like a story's. */
  unseen: boolean;
  onClick: () => void;
}) {
  const week = activityWeekSummary(posts);
  // the bubble's tag: this week's PRs (the headline), else its sessions
  const tag = week.prs > 0 ? `${week.prs}${weekComplete ? "" : "+"} PR${week.prs === 1 && weekComplete ? "" : "s"}` : week.sessions > 0 ? `${week.sessions}${weekComplete ? "" : "+"}` : null;
  const plus = weekComplete ? "" : "+";
  return (
    <button
      type="button"
      data-activity
      onClick={onClick}
      className="flex w-[64px] shrink-0 flex-col items-center gap-1 active:scale-95"
      aria-label={`Crew activity this week: ${week.sessions}${plus} sessions, ${week.prs}${plus} PRs${unseen ? ", new" : ""}`}
    >
      <span data-fresh={unseen ? "" : undefined} className={cn("relative grid h-[64px] w-[64px] place-items-center rounded-full p-[2.5px]", unseen ? "bg-[conic-gradient(from_200deg,#f59e0b,#ef3340,#f59e0b)]" : "bg-border")}>
        <span className="grid h-full w-full place-items-center rounded-full bg-background p-[2px]">
          <ActivityGlyph />
        </span>
        {tag && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-background bg-primary px-1.5 text-[9px] font-black leading-[14px] text-primary-foreground tabular-nums">
            {tag}
          </span>
        )}
      </span>
      <span className={cn("w-full truncate text-center text-[11px]", unseen ? "font-bold" : "font-medium text-muted-foreground")}>Activity</span>
    </button>
  );
}

/** Activity's face (the bubble, and the story's header). */
export function ActivityGlyph({ className }: { className?: string }) {
  return (
    <span className={cn("grid h-full w-full place-items-center rounded-full bg-gradient-to-br from-amber-400/25 via-primary/15 to-transparent", className)}>
      <Activity className="h-6 w-6 text-primary" strokeWidth={2.5} aria-hidden />
    </span>
  );
}

/** The whole week's activity as a list: what "All activity" opens. */
export function ActivitySheet({ open: isOpen, onOpenChange, posts, unit, viewerIsStaff, onOpen, onOpenAuthor, weekComplete = true, hasMore, loadingMore, onLoadMore }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  posts: CommunityPost[];
  /** Everything from the last 7 days is loaded (otherwise the count reads "N+"). */
  weekComplete?: boolean;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpen: (p: CommunityPost) => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
  /** The feed has older pages, so the history can keep going. */
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const all = isOpen;
  const setAll = onOpenChange;
  const [listFor, setListFor] = useState<string | null>(null);
  const wins = useMemo(() => posts.filter((p) => !!p.stats && isRealWin(pickWorkoutWin(p.stats, "kg").kind)), [posts]);
  const [view, setView] = useState<"wins" | "all">("wins");
  // a week with no wins yet opens on everything
  const shownView = wins.length ? view : "all";
  const week = activityWeekSummary(posts);
  const { people } = activityFaces(posts);
  const plus = weekComplete ? "" : "+";
  const open = (p: CommunityPost) => {
    setAll(false);
    onOpen(p);
  };
  const openAuthor = onOpenAuthor
    ? (a: CommunityAuthor) => {
        setAll(false);
        onOpenAuthor(a);
      }
    : undefined;
  // See all, by day
  const days: { label: string; posts: CommunityPost[] }[] = [];
  for (const p of shownView === "wins" ? wins : posts) {
    const label = activityDay(p.created_at);
    if (days[days.length - 1]?.label === label) days[days.length - 1].posts.push(p);
    else days.push({ label, posts: [p] });
  }
  return (
    <>
      <Sheet open={all} onOpenChange={setAll}>
        <SheetContent side="bottom" hideCloseButton className="max-h-[88dvh] gap-0 overflow-y-auto overscroll-contain rounded-t-[24px] p-0 pb-safe-bottom sm:mx-auto sm:max-w-[520px]">
          {/* our own close: the sheet's floating Back pill sat on top of the title */}
          <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 px-5 pb-1 pt-4 text-left">
            <div className="min-w-0">
              <SheetTitle className="text-[16px] font-black">Crew activity</SheetTitle>
              <SheetDescription className="text-[12px]">
                Every session the crew finished. Tap ❤️ to celebrate; they'll hear about it.
              </SheetDescription>
            </div>
            <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </SheetClose>
          </SheetHeader>
          <div className="mx-5 mt-3 px-0.5 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">This week</div>
          <div className="mx-5 mt-1.5 grid grid-cols-3 gap-2 text-center">
            {([
              [`${week.prs}${plus}`, week.prs === 1 && weekComplete ? "PR" : "PRs"],
              [`${week.sessions}${plus}`, week.sessions === 1 && weekComplete ? "session" : "sessions"],
              [`${people}${plus}`, people === 1 && weekComplete ? "athlete" : "athletes"],
            ] as const).map(([n, label]) => (
              <div key={label} className="rounded-xl bg-muted/50 px-1 py-2">
                <div className="text-lg font-black leading-tight tabular-nums">{n}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          {wins.length > 0 && (
            <div className="mx-5 mt-3 grid grid-cols-2 rounded-full bg-muted p-1 text-[13px] font-bold" role="tablist" aria-label="Show">
              {([["wins", `Wins · ${wins.length}`], ["all", `All · ${posts.length}`]] as const).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={shownView === k} onClick={() => setView(k)}
                  className={cn("h-9 rounded-full transition-colors", shownView === k ? "bg-background shadow-sm" : "text-muted-foreground")}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2">
            {days.map((d) => (
              <section key={d.label}>
                <div className="sticky top-0 z-10 bg-background/95 px-5 pb-1 pt-3 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">{d.label}</div>
                <ul className="divide-y divide-border/50">
                  {d.posts.map((p) => (
                    <ActivityRow key={p.id} post={p} unit={unit} viewerIsStaff={viewerIsStaff} onOpen={open} onOpenAuthor={openAuthor} onCelebrators={setListFor} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {hasMore && (
            <div className="px-5 pt-3">
              <Button type="button" variant="outline" className="h-11 w-full rounded-xl" disabled={loadingMore} onClick={onLoadMore}>
                {loadingMore ? "Loading…" : "Show older"}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <ReactorsSheet postId={listFor} onClose={() => setListFor(null)} onOpenAuthor={openAuthor} title="Celebrated by" />
    </>
  );
}

function ActivityRow({ post, unit, viewerIsStaff, onOpen, onOpenAuthor, onCelebrators }: {
  post: CommunityPost;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpen: (p: CommunityPost) => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
  onCelebrators: (postId: string) => void;
}) {
  const react = useReact(post, viewerIsStaff);
  const win = pickWorkoutWin(post.stats!, unit);
  const style = WIN_STYLE[win.kind];
  const real = isRealWin(win.kind);
  const name = post.is_mine ? "You" : post.author.name.split(" ")[0];
  const give = (_p: CommunityPost, next: ReactionKey | null) => react.mutate(next, { onError: () => toast.error("Couldn't send that") });
  const total = post.reaction_count ?? 0;
  const faces = (post.reactors ?? []).slice(0, 2);
  return (
    <li data-pulse-row={win.kind} data-post-id={post.id} className="flex scroll-mt-20 items-center gap-2.5 py-1.5 pl-3.5 pr-1.5">
      <button
        type="button"
        onClick={() => (onOpenAuthor && !post.is_mine ? onOpenAuthor(post.author) : onOpen(post))}
        className="shrink-0 rounded-full active:scale-95"
        aria-label={post.is_mine ? "Your workout" : `${post.author.name}'s profile`}
      >
        <UserAvatar src={post.author.avatar_url} name={post.author.name} size={34} expandable={false} />
      </button>
      <button type="button" onClick={() => onOpen(post)} className="min-w-0 flex-1 py-1 text-left active:opacity-70" aria-label={`${post.author.name}: ${win.headline}. Open the workout`}>
        <div className="truncate text-[13.5px] leading-snug">
          <span className="font-bold">{name}</span>{" "}
          <span className={cn(real ? "font-semibold" : "text-muted-foreground")}>{win.headline}</span>
          {win.detail && <span className="text-muted-foreground"> · {win.detail}</span>}
        </div>
        <div className="flex min-w-0 items-center gap-1 text-[11.5px] text-muted-foreground">
          <style.Icon className={cn("h-3 w-3 shrink-0", real ? style.text.replace("text-white/70", "text-muted-foreground") : "")} />
          <span className={cn("truncate", real && style.text.replace("text-white/70", "text-muted-foreground"), real && "font-semibold")}>{win.kind === "done" ? "Session done" : win.label}</span>
          <span className="shrink-0">· {postTimeLabel(post.created_at)}</span>
        </div>
      </button>
      {post.is_mine ? (
        // yours: who celebrated it (tap for everyone)
        total > 0 ? (
          <button type="button" onClick={() => onCelebrators(post.id)} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-2 active:bg-muted" aria-label={`${total} celebrated this. See who`} data-celebrators>
            <span className="flex -space-x-1.5">
              {faces.map((r) => (
                <span key={r.user_id} className="rounded-full ring-2 ring-card">
                  <UserAvatar src={r.avatar_url} name={r.name} size={24} expandable={false} />
                </span>
              ))}
            </span>
            <span className="text-[12px] font-black tabular-nums">❤️ {total}</span>
          </button>
        ) : null
      ) : (
        <ReactionButton post={post} onReact={give} size="sm" align="right" />
      )}
    </li>
  );
}
