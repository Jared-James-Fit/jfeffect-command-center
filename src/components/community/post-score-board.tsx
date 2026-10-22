import { useState } from "react";
import { BarChart3, ChevronRight, RotateCcw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PostDetailDialog } from "@/components/community/post-detail";
import { ScoreBadge, TONE, shortDate } from "@/components/community/post-score";
import { usePostScoreBoard } from "@/lib/post-scores.queries";
import { kindAverages, kindLabel, scoreBand, scoreTitle, type PostScore } from "@/lib/post-scores";
import { useWeightUnit } from "@/lib/use-weight-unit";
import { cn } from "@/lib/utils";

/**
 * The coach's board (Crew → Insights): every feed post of the last 120 days,
 * scored. Which kinds of post keep the crew interested (average by kind), the
 * best and the ones that didn't land; tap one to open it.
 */
export function PostScoreBoard() {
  const { data, isLoading, isError, refetch } = usePostScoreBoard();
  const { unit } = useWeightUnit();
  const [openPost, setOpenPost] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const settled = (data?.posts ?? []).filter((p) => !p.early);
  const kinds = kindAverages(data?.posts ?? []);
  const top = settled.slice(0, showAll ? settled.length : 5);
  const low = settled.length > 8 && !showAll ? settled.slice(-3).reverse() : [];
  const since = data?.attention_since ? shortDate(data.attention_since) : null;
  const maxAvg = Math.max(1, ...kinds.map((k) => k.avg));

  const row = (p: PostScore, i: number) => (
    <button key={p.post_id} type="button" onClick={() => setOpenPost(p.post_id)} className="flex w-full min-w-0 items-center gap-3 py-2.5 text-left active:opacity-70" data-score-board-post={i}>
      <ScoreBadge score={p} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold">{scoreTitle(p)}</div>
        <div className="truncate text-[12px] text-muted-foreground">
          {kindLabel(p.kind_key)} · {shortDate(p.created_at)} · seen by {p.viewers}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );

  return (
    <section className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm" data-post-score-board>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <BarChart3 className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-black leading-tight">Post scores</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">What keeps the crew interested: every feed post of the last 120 days, scored on reach, engagement and attention against your others.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-5/6" />
          <Skeleton className="h-6 w-4/6" />
        </div>
      ) : isError ? (
        <button type="button" onClick={() => void refetch()} className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-muted-foreground">
          <RotateCcw className="h-4 w-4" /> Couldn't load. Tap to try again
        </button>
      ) : !settled.length ? (
        <p className="mt-4 text-[13px] text-muted-foreground">No feed posts to score yet.</p>
      ) : (
        <>
          <h3 className="mt-4 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">By kind of post</h3>
          <div className="mt-2 space-y-2.5" data-score-kinds>
            {kinds.map((k) => (
              <div key={k.kind_key}>
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{k.label}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{k.n} {k.n === 1 ? "post" : "posts"}</span>
                  <span className="w-7 shrink-0 text-right text-[13px] font-black tabular-nums">{k.avg}</span>
                </div>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full", TONE[scoreBand({ score: k.avg, early: false }).tone].bar)} style={{ width: `${Math.max(4, (k.avg / maxAvg) * 100)}%` }} />
                </span>
              </div>
            ))}
          </div>

          <h3 className="mt-5 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">{showAll ? "All posts, best first" : "Best posts"}</h3>
          <div className="divide-y divide-border/60">{top.map(row)}</div>
          {low.length > 0 && (
            <>
              <h3 className="mt-4 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">Didn't land</h3>
              <div className="divide-y divide-border/60">{low.map(row)}</div>
            </>
          )}
          {settled.length > 5 && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-2 h-10 w-full rounded-full bg-muted text-[13px] font-bold">
              {showAll ? "Show less" : `See all ${settled.length}`}
            </button>
          )}
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            {since ? `Attention (time on a post, who kept scrolling) is recorded from ${since}.` : "Attention (time on a post, who kept scrolling) is recorded from today."} Coaches are never counted.
          </p>
        </>
      )}
      <PostDetailDialog postId={openPost} unit={unit} viewerIsStaff onClose={() => setOpenPost(null)} />
    </section>
  );
}
