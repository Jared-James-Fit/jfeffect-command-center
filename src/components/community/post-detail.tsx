import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import { Archive, ChevronDown, ChevronLeft, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AuthorLine, AutoPostCaption, AutoPostHero, LockInHero, NoteBody, NoteExtras, PostMedia, ReactionBar, TrainingNowPill, audienceNote, isPhotoPost } from "@/components/community/post-card";
import { isAutoPost } from "@/lib/community";
import { InlineFollow } from "@/components/community/follow-button";
import { CommentThread } from "@/components/community/comments-sheet";
import { MentionText } from "@/components/community/mentions";
import { PostActions } from "@/components/community/post-actions";
import { ReactionBurst, useBurst, useDoubleTap } from "@/components/community/reaction-button";
import { useHoldToPause } from "@/components/community/clip-gestures";
import { CLIP_HOLD_EVENT } from "@/components/community/inline-video";
import {
  REACTION,
  exerciseBestLines,
  isTrainingNow,
  lockInTimeLabel,
  monthWorkoutLine,
  postTimeLabel,
  reactionEmoji,
  type CommunityAuthor,
  type CommunityPost,
  type ReactionKey,
  workoutHeadline,
  workoutSubtitle,
} from "@/lib/community";
import { PostViewsRow, useViewOnOpen } from "@/components/community/post-views";
import { PostScoreRow } from "@/components/community/post-score";
import { PostExtras } from "@/components/community/post-attach";
import { useMarkHintSeen, usePostDetail, usePostMediaUrls, useReact } from "@/lib/community.queries";
import { RECAP_MAX_LIFTS, recapExercises, recapKeyLifts, recapMoreLabel, recapPr, summaryStats } from "@/lib/workout-recap";
import { WorkoutSetList } from "@/components/community/workout-details";
import { WeightOther } from "@/components/dual-weight";
import { useMediaPinchZoom } from "@/hooks/use-media-pinch-zoom";

/**
 * The activity page: one shared workout in full — photo, the numbers, every
 * exercise with its best set and records, then props and comments.
 * `at="workout"` (View workout from the feed): it opens scrolled to the
 * workout itself, past the picture they were just looking at.
 */
export function PostDetailDialog({
  postId,
  unit,
  viewerIsStaff,
  onClose,
  onOpenAuthor,
  at,
}: {
  postId: string | null;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onClose: () => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
  at?: "workout";
}) {
  // its pictures pinch-zoom wherever it opens (the coach's Insights and Needs you too, not only over Crew)
  useMediaPinchZoom(!!postId);
  return (
    <Dialog open={!!postId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,920px)] sm:max-w-[520px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none focus:outline-none focus-visible:outline-none [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Shared workout</DialogTitle>
        <DialogDescription className="sr-only">The full workout, reactions and comments.</DialogDescription>
        {postId && <Body postId={postId} unit={unit} viewerIsStaff={viewerIsStaff} onClose={onClose} onOpenAuthor={onOpenAuthor} at={at} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ postId, unit, viewerIsStaff, onClose, onOpenAuthor, at }: { postId: string; unit: "kg" | "lb"; viewerIsStaff: boolean; onClose: () => void; onOpenAuthor?: (a: CommunityAuthor) => void; at?: "workout" }) {
  const { data: post, isLoading, isError } = usePostDetail(postId);
  // opening a post counts as a view
  useViewOnOpen(post);
  const { data: urls } = usePostMediaUrls(post ? [post] : []);
  const thumb = post ? urls?.[post.media_thumb_path ?? (post.media_type === "image" ? post.media_path ?? "" : "")] ?? null : null;

  return (
    <>
      <header className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 pb-2" style={{ paddingTop: "max(env(safe-area-inset-top), 0.6rem)" }}>
        <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full hover:bg-muted" aria-label="Back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-[15px] font-bold">{post?.kind === "note" ? "Post" : "Workout"}</div>
        {post && <PostActions post={post} viewerIsStaff={viewerIsStaff} onGone={onClose} unit={unit} className="ml-auto grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-muted" />}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),1rem)]" data-detail-scroll>
        {isLoading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10 w-48 rounded-full" />
            <Skeleton className="h-72 w-full rounded-3xl" />
            <Skeleton className="h-40 w-full rounded-3xl" />
          </div>
        ) : isError || !post ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">This post isn't available any more.</div>
        ) : (
          <Detail post={post} thumb={thumb} unit={unit} viewerIsStaff={viewerIsStaff} onOpenAuthor={onOpenAuthor} at={at} />
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
  at,
}: {
  post: NonNullable<ReturnType<typeof usePostDetail>["data"]>;
  thumb: string | null;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpenAuthor?: (a: CommunityAuthor) => void;
  at?: "workout";
}) {
  const react = useReact(post, viewerIsStaff);
  const s = post.stats;
  const onReact = (_p: CommunityPost, next: ReactionKey | null) => react.mutate(next, { onError: () => toast.error("Couldn't save that reaction") });
  // Double-tap the photo / card for ❤️, same as in the feed.
  const [burst, fireBurst] = useBurst();
  const markHint = useMarkHintSeen();
  // a member's photo / clip post: the picture edge to edge, words under it (as in the feed)
  const photo = isPhotoPost(post);
  // an automated post: its picture, then its words (as in the feed)
  const auto = isAutoPost(post);
  // press and hold a clip: it pauses until you let go (Reels')
  const hold = useHoldToPause<Element>(
    (e) => {
      const t = e.target as Element | null;
      const clip = t?.closest?.("[data-inline-video]");
      return clip && !t?.closest?.("button") ? clip : null;
    },
    (clip, on) => clip.dispatchEvent(new CustomEvent(CLIP_HOLD_EVENT, { detail: on })),
  );
  const doubleTap = useDoubleTap((e) => {
    // the ❤️ springs in where the finger was
    fireBurst(e);
    if (!post.my_reaction) onReact(post, REACTION.key);
    markHint("double_tap");
  });
  const onHeroTap = (e: React.MouseEvent) => {
    if (!hold.justReleased()) doubleTap(e);
  };

  // View workout from the feed: open on the workout, past the picture they were just looking at
  // (the picture's frame has its own shape before it loads, so nothing moves under it afterwards).
  // Measured while the page is still zooming in, so the distance is read back at full size
  const workoutRef = useRef<HTMLElement | null>(null);
  const jumped = useRef(false);
  useLayoutEffect(() => {
    const el = workoutRef.current;
    const box = el?.closest<HTMLElement>("[data-detail-scroll]");
    if (jumped.current || at !== "workout" || !post.media_type || !el || !box) return;
    jumped.current = true;
    const b = box.getBoundingClientRect();
    const scale = box.offsetHeight > 0 && b.height > 0 ? b.height / box.offsetHeight : 1;
    box.scrollTop = Math.max(0, (el.getBoundingClientRect().top - b.top) / scale + box.scrollTop);
  }, [at, post.media_type]);

  return (
    <div>
      {post.archived_at && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-[12px] font-semibold text-muted-foreground">
          <Archive className="h-4 w-4 shrink-0" /> Archived. Only you can see this. Use ••• to show it on your profile again.
        </div>
      )}
      <div className="px-4 py-3">
        <AuthorLine
          author={post.author}
          size={44}
          sub={[postTimeLabel(post.created_at), post.kind === "note" ? new Date(post.created_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : null, post.edited_at ? "Edited" : null, s ? new Date(s.completed_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : null, audienceNote(post)].filter(Boolean).join(" · ")}
          onOpen={onOpenAuthor ? () => onOpenAuthor(post.author) : undefined}
          collaborators={post.collaborators}
          onOpenPerson={onOpenAuthor}
          trailing={!post.is_mine && onOpenAuthor ? <InlineFollow userId={post.author.user_id} name={post.author.name} /> : null}
        />
      </div>

      {auto ? (
        <>
          <div className="relative select-none [-webkit-touch-callout:none]" onClick={onHeroTap} {...hold.handlers}>
            <AutoPostHero post={post} thumbUrl={thumb} unit={unit} full />
            <ReactionBurst n={burst.n} x={burst.x} y={burst.y} emoji={reactionEmoji(post.my_reaction) ?? REACTION.emoji} />
          </div>
          <AutoPostCaption post={post} clamp={false} onOpenPerson={onOpenAuthor} className="px-4" />
        </>
      ) : post.kind === "note" && !photo ? (
        <>
          <NoteBody post={post} onOpenPerson={onOpenAuthor} cover={post.media_type ? <PostMedia post={post} thumbUrl={thumb} full /> : undefined} />
          <NoteExtras post={post} unit={unit} className="mx-4 mb-2 mt-2" />
        </>
      ) : post.media_type || (!s && post.locked_in_at) ? (
        <div className="relative select-none [-webkit-touch-callout:none]" onClick={onHeroTap} {...hold.handlers}>
          {post.media_type ? (
            <PostMedia post={post} thumbUrl={thumb} full />
          ) : (
            <div className="px-4"><div className="overflow-hidden rounded-3xl"><LockInHero post={post} size="detail" /></div></div>
          )}
          <ReactionBurst n={burst.n} x={burst.x} y={burst.y} emoji={reactionEmoji(post.my_reaction) ?? REACTION.emoji} />
        </div>
      ) : null}

      {post.media_type && !s && post.locked_in_at && (
        <div className="flex items-center gap-2 px-4 pt-4">
          <h2 className="text-[20px] font-semibold leading-tight">Locked in</h2>
          {isTrainingNow(post) ? <TrainingNowPill /> : <span className="text-[13px] font-bold text-muted-foreground">{lockInTimeLabel(post.locked_in_at)}</span>}
        </div>
      )}

      {post.caption && (post.kind !== "note" || photo) && (
        <p className="whitespace-pre-line px-4 pt-3 text-[15px] leading-snug">
          <span className="font-bold">{post.author.name}</span> <MentionText text={post.caption} mentions={post.mentions} onOpen={onOpenAuthor} />
        </p>
      )}
      {(post.kind !== "note" || photo) && <PostExtras post={post} className="px-4 pt-3" />}

      {s && !auto && !(post.kind === "note" && !photo) && (
        <WorkoutSummary
          ref={workoutRef}
          post={post}
          unit={unit}
          expanded={at === "workout"}
          // a workout with no picture: its summary is what two taps ❤️
          heroTap={post.media_type ? undefined : onHeroTap}
          burst={post.media_type ? null : <ReactionBurst n={burst.n} x={burst.x} y={burst.y} emoji={reactionEmoji(post.my_reaction) ?? REACTION.emoji} />}
        />
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
        <ReactionBar post={post} onReact={onReact} onOpenAuthor={onOpenAuthor} unit={unit} />
        <PostViewsRow post={post} onOpenAuthor={onOpenAuthor} />
        {viewerIsStaff && <PostScoreRow post={post} />}
      </div>

      <section className="border-t border-border/60">
        <h3 className="px-4 pt-4 text-[15px] font-semibold">Comments</h3>
        <CommentThread post={post} viewerIsStaff={viewerIsStaff} inline onOpenAuthor={onOpenAuthor} />
      </section>
    </div>
  );
}

/**
 * The workout on its page, read top to bottom: what it was (its name, where it
 * sits in the program, which workout of the month), its numbers in one quiet
 * row, then its key lifts with their best sets (the same as the feed's recap,
 * at most four) and "All 9 exercises" that opens every set right there
 * (WorkoutSetList, the post's sheet's Workout tab), so the reactions and
 * comments under it are never a long scroll away. Opened for the workout
 * (`expanded`), every set shows at once. Plain type in the app's text face,
 * sentence case, numbers in tabular figures at text size.
 */
const WorkoutSummary = forwardRef<
  HTMLElement,
  {
    post: NonNullable<ReturnType<typeof usePostDetail>["data"]>;
    unit: "kg" | "lb";
    expanded?: boolean;
    heroTap?: (e: React.MouseEvent) => void;
    burst: React.ReactNode;
  }
>(function WorkoutSummary({ post, unit, expanded = false, heroTap, burst }, ref) {
  const s = post.stats!;
  const meta = [workoutSubtitle(s), monthWorkoutLine(s)].filter(Boolean).join(" · ");
  // Time · Working sets · Volume (both units) · PRs
  const stats = summaryStats(s, unit);
  const exercises = recapExercises(post.exercises);
  const lifts = recapKeyLifts(exercises, s);
  const [open, setOpen] = useState(expanded);
  // nothing more to open (every lift on screen, no sets to show): the list as it is
  const all = open || (lifts.length >= exercises.length && exercises.every((e) => !e.set_list?.length));
  return (
    <section ref={ref} className="pt-5" data-workout-section>
      <div className={cn("relative px-4", heroTap && "select-none [-webkit-touch-callout:none]")} onClick={heroTap} data-workout-head>
        <h2 className="break-words text-[20px] font-semibold leading-tight tracking-[-0.01em]">{workoutHeadline(s)}</h2>
        {meta && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{meta}</p>}
        {stats.length > 0 && (
          // one row at the numbers' own widths (closer together on a small phone, so four still fit), a line of its own before anything's cut
          <dl className="mt-4 flex flex-wrap gap-x-4 gap-y-3 min-[375px]:gap-x-6" data-workout-stats>
            {stats.map((t) => (
              <div key={t.label} className="flex min-w-0 flex-col-reverse">
                <dt className="mt-0.5 text-[12px] text-muted-foreground">{t.label}</dt>
                {/* the other unit under the number; an empty line on the others, so the labels stay level */}
                {t.sub ? (
                  <WeightOther className="text-[12px] font-medium">{t.sub}</WeightOther>
                ) : stats.some((x) => x.sub) ? (
                  <span aria-hidden className="text-[12px]">
                    {"\u00a0"}
                  </span>
                ) : null}
                <dd className={cn("whitespace-nowrap text-[17px] font-semibold leading-tight tabular-nums", t.pr && "text-warning")}>{t.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {burst}
      </div>

      {exercises.length > 0 && (
        <div className="px-4 pt-5" data-workout-exercises>
          {all ? (
            <WorkoutSetList exercises={exercises} stats={s} unit={unit} totals={false} className="border-t border-border/60" />
          ) : (
            <>
              <ul className="divide-y divide-border/60 border-t border-border/60">
                {lifts.map(({ exercise: e, index }) => {
                  const best = exerciseBestLines(e, unit);
                  const pr = recapPr(e, s);
                  return (
                    <li key={`${e.name}-${index}`} className="flex items-center gap-3 py-3" data-workout-exercise>
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-[15px] font-medium leading-snug">{e.name}</div>
                        {pr && (
                          <div className={cn("mt-0.5 inline-flex items-center gap-1 text-[13px] leading-snug", pr.loud ? "font-medium text-warning" : "text-muted-foreground")} data-exercise-pr={pr.loud ? "headline" : "quiet"}>
                            {pr.loud && <Trophy className="h-3.5 w-3.5" aria-hidden />}
                            {pr.label}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="whitespace-nowrap text-[15px] font-semibold leading-snug tabular-nums">{best.main}</div>
                        {best.other && <div className="mt-0.5 whitespace-nowrap text-[12px] leading-snug tabular-nums text-muted-foreground">{best.other}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex h-11 w-full items-center justify-between gap-2 border-t border-border/60 text-[14px] font-medium text-muted-foreground transition-colors active:text-foreground"
                aria-expanded={false}
                data-workout-every-set
              >
                {recapMoreLabel(exercises.length, Math.min(RECAP_MAX_LIFTS, lifts.length))}
                <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
});
