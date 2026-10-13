import { useState } from "react";
import { Activity, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { activityDay, activityFaces, activityPreview, activityWeekSummary, isRealWin, pickWorkoutWin, postTimeLabel, type CommunityAuthor, type CommunityPost, type ReactionKey } from "@/lib/community";
import { useReact } from "@/lib/community.queries";
import { WIN_STYLE } from "@/components/community/pulse-style";
import { ReactionButton } from "@/components/community/reaction-button";
import { ReactorsSheet } from "@/components/community/reactors-sheet";

/**
 * Feed → Activity: the crew's finished sessions (posted by themselves), in
 * one slim card at the top of the feed. It leads with the week's real wins
 * (PRs, milestones, streaks), never a wall of routine sessions; See all has
 * every session, by day.
 *
 * Celebrating is the app's own like: tap the heart (hold for 👍 ‼️ 🔥 😂),
 * same as any post, so it's one gesture everywhere. On your own rows you see
 * who celebrated (faces + count; tap for everyone). The face opens the
 * athlete, the row opens the workout.
 */
export function ActivitySection({ posts, unit, viewerIsStaff, onOpen, onOpenAuthor, weekComplete = true, hasMore, loadingMore, onLoadMore }: {
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
  const [all, setAll] = useState(false);
  const [listFor, setListFor] = useState<string | null>(null);
  const { rows } = activityPreview(posts);
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
  for (const p of posts) {
    const label = activityDay(p.created_at);
    if (days[days.length - 1]?.label === label) days[days.length - 1].posts.push(p);
    else days.push({ label, posts: [p] });
  }
  return (
    <section data-activity className="overflow-hidden rounded-3xl border border-border/80 bg-card">
      <button type="button" onClick={() => setAll(true)} className="flex w-full items-center gap-2 px-3.5 pb-1 pt-2.5 text-left active:bg-muted/50" aria-label="See all activity">
        <Activity className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-[13px] font-black">Activity</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          {week.sessions}{plus} {week.sessions === 1 && weekComplete ? "session" : "sessions"}
          {week.prs > 0 ? ` · ${week.prs}${plus} PR${week.prs === 1 && weekComplete ? "" : "s"}` : ""} this week
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      <ul className="divide-y divide-border/50 pb-1">
        {rows.map((p) => (
          <ActivityRow key={p.id} post={p} unit={unit} viewerIsStaff={viewerIsStaff} onOpen={onOpen} onOpenAuthor={onOpenAuthor} onCelebrators={setListFor} />
        ))}
      </ul>

      <Sheet open={all} onOpenChange={setAll}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-2xl px-0 pb-safe-bottom pt-5">
          <SheetHeader className="px-5 text-left">
            <SheetTitle>Activity</SheetTitle>
            <SheetDescription>
              Every session the crew finished{people > 0 ? `, ${people} ${people === 1 ? "person" : "people"} this week` : ""}. Tap ❤️ to celebrate.
            </SheetDescription>
          </SheetHeader>
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
    </section>
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
