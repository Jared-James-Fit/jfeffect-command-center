import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AuthorLine, LockInHero, PostMedia, ReactionBar, TrainingNowPill, WorkoutHero, audienceNote } from "@/components/community/post-card";
import { CommentThread } from "@/components/community/comments-sheet";
import {
  SCOPE_WORD,
  formatExerciseBest,
  formatWorkoutDuration,
  isTrainingNow,
  lockInTimeLabel,
  postTimeLabel,
  reactionEmoji,
  type CommunityAuthor,
  type CommunityPost,
  type ReactionKey,
} from "@/lib/community";
import { usePostDetail, usePostMediaUrls, useReact } from "@/lib/community.queries";
import { formatTonnage } from "@/lib/training-records";

/**
 * The activity page: one shared workout in full — photo, the numbers, every
 * exercise with its best set and records, then props and comments.
 */
export function PostDetailDialog({
  postId,
  unit,
  viewerIsStaff,
  onClose,
  onOpenAuthor,
}: {
  postId: string | null;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onClose: () => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
}) {
  return (
    <Dialog open={!!postId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,920px)] sm:max-w-[520px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none focus:outline-none focus-visible:outline-none [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Shared workout</DialogTitle>
        <DialogDescription className="sr-only">The full workout, reactions and comments.</DialogDescription>
        {postId && <Body postId={postId} unit={unit} viewerIsStaff={viewerIsStaff} onClose={onClose} onOpenAuthor={onOpenAuthor} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ postId, unit, viewerIsStaff, onClose, onOpenAuthor }: { postId: string; unit: "kg" | "lb"; viewerIsStaff: boolean; onClose: () => void; onOpenAuthor?: (a: CommunityAuthor) => void }) {
  const { data: post, isLoading, isError } = usePostDetail(postId);
  const { data: urls } = usePostMediaUrls(post ? [post] : []);
  const thumb = post ? urls?.[post.media_thumb_path ?? (post.media_type === "image" ? post.media_path ?? "" : "")] ?? null : null;

  return (
    <>
      <header className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 pb-2" style={{ paddingTop: "max(env(safe-area-inset-top), 0.6rem)" }}>
        <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full hover:bg-muted" aria-label="Back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-[15px] font-black">Workout</div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),1rem)]">
        {isLoading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10 w-48 rounded-full" />
            <Skeleton className="h-72 w-full rounded-3xl" />
            <Skeleton className="h-40 w-full rounded-3xl" />
          </div>
        ) : isError || !post ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">This post isn't available any more.</div>
        ) : (
          <Detail post={post} thumb={thumb} unit={unit} viewerIsStaff={viewerIsStaff} onOpenAuthor={onOpenAuthor} />
        )}
      </div>
    </>
  );
}

function Detail({
  post,
  thumb,
  unit,
  viewerIsStaff,
  onOpenAuthor,
}: {
  post: NonNullable<ReturnType<typeof usePostDetail>["data"]>;
  thumb: string | null;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpenAuthor?: (a: CommunityAuthor) => void;
}) {
  const react = useReact(post, viewerIsStaff);
  const s = post.stats;
  const onReact = (_p: CommunityPost, next: ReactionKey | null) => react.mutate(next, { onError: () => toast.error("Couldn't save that reaction") });

  const tiles = s
    ? [
        formatWorkoutDuration(s.duration_min) && { label: "Time", value: formatWorkoutDuration(s.duration_min)! },
        s.working_sets > 0 && { label: "Sets", value: String(s.working_sets) },
        s.tonnage_kg > 0 && { label: "Volume", value: formatTonnage(s.tonnage_kg, unit) },
        s.pr_count > 0 && { label: s.pr_count === 1 ? "PR" : "PRs", value: String(s.pr_count), gold: true },
        (s.month_sessions ?? 0) > 0 && { label: "This month", value: `#${s.month_sessions}` },
      ].filter(Boolean) as { label: string; value: string; gold?: boolean }[]
    : [];

  return (
    <div>
      <div className="px-4 py-3">
        <AuthorLine
          author={post.author}
          size={44}
          sub={[postTimeLabel(post.created_at), s ? new Date(s.completed_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : null, audienceNote(post)].filter(Boolean).join(" · ")}
          onOpen={onOpenAuthor ? () => onOpenAuthor(post.author) : undefined}
        />
      </div>

      {post.media_type ? (
        <PostMedia post={post} thumbUrl={thumb} full />
      ) : s ? (
        <div className="px-4"><div className="overflow-hidden rounded-3xl"><WorkoutHero stats={s} unit={unit} size="detail" /></div></div>
      ) : post.locked_in_at ? (
        <div className="px-4"><div className="overflow-hidden rounded-3xl"><LockInHero post={post} size="detail" /></div></div>
      ) : null}

      {post.media_type && !s && post.locked_in_at && (
        <div className="flex items-center gap-2 px-4 pt-4">
          <h2 className="font-display text-[28px] uppercase leading-none">Locked in</h2>
          {isTrainingNow(post) ? <TrainingNowPill /> : <span className="text-[13px] font-bold text-muted-foreground">{lockInTimeLabel(post.locked_in_at)}</span>}
        </div>
      )}

      {post.caption && (
        <p className="whitespace-pre-line px-4 pt-3 text-[15px] leading-snug">
          <span className="font-bold">{post.author.name}</span> {post.caption}
        </p>
      )}

      {s && post.media_type && <h2 className="font-display px-4 pt-4 text-[28px] uppercase leading-none">{s.workout_title}</h2>}

      {tiles.length > 0 && (
        <div className="grid grid-cols-3 gap-2 px-4 pt-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl border border-border/70 bg-card px-3 py-2.5">
              <div className={cn("font-display truncate uppercase leading-none", t.value.length > 7 ? "text-[19px]" : "text-[24px]", t.gold && "text-amber-600 dark:text-amber-400")}>{t.value}</div>
              <div className="mt-1 truncate text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {post.exercises.length > 0 && (
        <section className="px-4 pt-5">
          <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">The work</div>
          <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card">
            {post.exercises.map((e, i) => (
              <div key={`${e.name}-${i}`} className="flex items-center gap-3 px-3.5 py-3">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-black text-muted-foreground">{i + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-bold">{e.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {e.sets} working {e.sets === 1 ? "set" : "sets"}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn("font-display text-[19px] uppercase leading-none", e.pr && "text-amber-600 dark:text-amber-400")}>{formatExerciseBest(e, unit)}</div>
                  {e.pr && <div className="mt-1 text-[9px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">{SCOPE_WORD[e.pr]}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(post.coach_reactions.length > 0 || post.coach_commented) && (
        <div className="px-4 pt-4">
          <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1.5 text-[13px] font-bold text-primary">
            Coach {post.coach_reactions[0]?.name ?? ""} {post.coach_reactions[0] ? reactionEmoji(post.coach_reactions[0].emoji) : ""}
            {post.coach_commented ? " · replied below" : ""}
          </div>
        </div>
      )}

      <div className="px-2 pt-2">
        <ReactionBar post={post} onReact={onReact} />
      </div>

      <section className="border-t border-border/60">
        <div className="px-4 pt-3 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">Comments</div>
        <CommentThread post={post} viewerIsStaff={viewerIsStaff} inline />
      </section>
    </div>
  );
}
