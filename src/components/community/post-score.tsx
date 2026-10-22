import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useClientImpersonation } from "@/lib/client-impersonation";
import type { CommunityPost } from "@/lib/community";
import { usePostScore } from "@/lib/post-scores.queries";
import {
  PART_LABEL,
  kindLabel,
  rankLine,
  scoreBand,
  scoreDrivers,
  scoreLines,
  scoreTitle,
  type PostScore,
  type ScorePart,
  type ScoreTone,
} from "@/lib/post-scores";
import { cn } from "@/lib/utils";

export const TONE: Record<ScoreTone, { badge: string; bar: string; ring: string }> = {
  top: { badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-500", ring: "stroke-emerald-500" },
  good: { badge: "bg-sky-500/15 text-sky-700 dark:text-sky-300", bar: "bg-sky-500", ring: "stroke-sky-500" },
  mid: { badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300", bar: "bg-amber-500", ring: "stroke-amber-500" },
  low: { badge: "bg-rose-500/15 text-rose-700 dark:text-rose-300", bar: "bg-rose-500", ring: "stroke-rose-500" },
  early: { badge: "bg-muted text-muted-foreground", bar: "bg-muted-foreground/50", ring: "stroke-muted-foreground/60" },
};

const PART_NOTE: Record<ScorePart, { carried: string; held: string }> = {
  reach: {
    carried: "More of the crew saw it than your other posts.",
    held: "Fewer of the crew saw it than your other posts. When it went up and how high it sat in the feed decide most of that.",
  },
  engagement: {
    carried: "People who saw it liked, commented, saved or shared more than usual.",
    held: "People saw it, but fewer liked, commented, saved or shared it than your other posts.",
  },
  attention: {
    carried: "People stopped on it, stayed on it and kept scrolling after.",
    held: "People scrolled past it quickly, or left Crew on it.",
  },
};

/** The score as a pill: the number, coloured by how it did. */
export function ScoreBadge({ score, className }: { score: Pick<PostScore, "score" | "early">; className?: string }) {
  const band = scoreBand(score);
  return (
    <span className={cn("inline-flex h-6 min-w-[2.25rem] shrink-0 items-center justify-center rounded-full px-2 text-[12px] font-black tabular-nums", TONE[band.tone].badge, className)}>
      {score.score}
    </span>
  );
}

/**
 * A coach's line under a feed post: its score, what it means and Insights
 * (the breakdown). Never in View as client, never on a story or an
 * automatic workout story (they aren't feed posts).
 */
export function PostScoreRow({ post }: { post: CommunityPost }) {
  const { isImpersonating } = useClientImpersonation();
  const scorable = !post.story && !post.auto && !post.archived_at && !isImpersonating;
  const { data } = usePostScore(post.id, scorable);
  const [open, setOpen] = useState(false);
  if (!scorable || !data) return null;
  const band = scoreBand(data);
  const { carried, heldBack } = scoreDrivers(data);
  const note = data.early
    ? "still counting"
    : carried
      ? `${PART_LABEL[carried]} carried it`
      : heldBack
        ? `${PART_LABEL[heldBack]} held it back`
        : data.kind_n > 1
          ? `${kindLabel(data.kind_key)} average ${data.kind_avg}`
          : null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-3.5 mb-2 flex w-[calc(100%-1.75rem)] min-w-0 items-center gap-2 rounded-xl py-1 text-left text-[12px] text-muted-foreground active:opacity-70"
        aria-label={`Post score ${data.score}, ${band.label}. See insights`}
        data-post-score
      >
        <ScoreBadge score={data} />
        <span className="shrink-0 font-bold text-foreground">{band.label}</span>
        {note && <span className="min-w-0 truncate">· {note}</span>}
        <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 font-bold text-foreground/80">
          Insights <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </button>
      <PostScoreSheet score={data} open={open} onOpenChange={setOpen} />
    </>
  );
}

function ScoreRing({ score }: { score: PostScore }) {
  const band = scoreBand(score);
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-[84px] w-[84px] shrink-0">
      <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="42" cy="42" r={r} fill="none" strokeWidth="8" className="stroke-muted" />
        <circle cx="42" cy="42" r={r} fill="none" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(Math.max(2, score.score) / 100) * c} ${c}`} className={TONE[band.tone].ring} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[26px] font-black tabular-nums">{score.score}</span>
    </div>
  );
}

function PartRow({ part, pct, line, tone }: { part: ScorePart; pct: number | null; line: string; tone: ScoreTone }) {
  const p = pct == null ? null : Math.round(pct * 100);
  return (
    <div className="py-3" data-score-part={part}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-black">{PART_LABEL[part]}</span>
        <span className="text-[12px] font-semibold text-muted-foreground">{rankLine(pct)}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
        {p != null && <div className={cn("h-full rounded-full", TONE[tone].bar)} style={{ width: `${Math.max(3, p)}%` }} />}
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{line}</p>
    </div>
  );
}

/** "Oct 22" */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** A post's insights: the score, its three parts in plain words, its kind's average, and what carried it or held it back. */
export function PostScoreSheet({ score, open, onOpenChange }: { score: PostScore; open: boolean; onOpenChange: (o: boolean) => void }) {
  const band = scoreBand(score);
  const lines = scoreLines(score);
  const { carried, heldBack } = scoreDrivers(score);
  const since = score.attention_since ? shortDate(score.attention_since) : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-[24px] px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-5 sm:mx-auto sm:max-w-[520px]" data-post-score-sheet>
        <SheetHeader className="space-y-0.5 text-left">
          <SheetTitle className="text-[17px] font-black">Post insights</SheetTitle>
          <SheetDescription className="line-clamp-1 text-[12px]">
            {kindLabel(score.kind_key)} · {shortDate(score.created_at)} · {scoreTitle(score)}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex items-center gap-4">
          <ScoreRing score={score} />
          <div className="min-w-0">
            <div className="text-[20px] font-black leading-tight">{band.label}</div>
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
              {score.early
                ? "Up less than a day. The score settles as the crew sees it."
                : score.total && score.total > 1
                  ? `Scored against your other ${score.total - 1} feed posts from the last 120 days.`
                  : "Scored against your other feed posts from the last 120 days."}
            </p>
          </div>
        </div>

        <div className="mt-2 divide-y divide-border/70">
          <PartRow part="reach" pct={score.pct.reach} line={lines.reach} tone={band.tone} />
          <PartRow part="engagement" pct={score.pct.engagement} line={lines.engagement} tone={band.tone} />
          <PartRow
            part="attention"
            pct={score.pct.attention}
            line={
              lines.attention && score.pct.attention != null
                ? lines.attention
                : lines.attention
                  ? `${lines.attention}. Counts in the score once 3 people's time on it is recorded.`
                  : `Not recorded for this post. Time on a post and who kept scrolling are recorded from ${since ?? "today"} on.`
            }
            tone={band.tone}
          />
        </div>

        {(carried || heldBack) && !score.early && (
          <div className="mt-2 space-y-2">
            {carried && (
              <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-[13px] leading-snug">
                <span className="font-black">What carried it: {PART_LABEL[carried].toLowerCase()}.</span> {PART_NOTE[carried].carried}
              </p>
            )}
            {heldBack && (
              <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[13px] leading-snug">
                <span className="font-black">What held it back: {PART_LABEL[heldBack].toLowerCase()}.</span> {PART_NOTE[heldBack].held}
              </p>
            )}
          </div>
        )}

        {score.kind_n > 1 && (
          <p className="mt-3 text-[13px] text-muted-foreground">
            {kindLabel(score.kind_key)} average <span className="font-black text-foreground">{score.kind_avg}</span> across {score.kind_n} posts.
          </p>
        )}
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">Coaches are never counted: not as viewers, not in likes or comments.</p>
      </SheetContent>
    </Sheet>
  );
}
