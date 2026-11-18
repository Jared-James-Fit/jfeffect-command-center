/**
 * The finished workout's one card, at the top of the log: its status
 * (Completed, or completed with the review still to do) on one line with when
 * the session ran (`status`, the logger's session time line), then the review
 * and View score side by side. The log itself is the page under it.
 *   - "Finish review" / "Edit review" → opens the shared `WorkoutReviewEditor`,
 *     prefilled with the existing review when one exists.
 *   - "View score" → the recap, once the review is in.
 *
 * `ctx` is the same discriminated context used by `submitOrEditReview`,
 * so the editor writes to the correct backing table (pl_workout_feedback
 * for clients, member_workout_reviews for members).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, MessageSquare, Pencil, Trophy } from "lucide-react";
import {
  WorkoutReviewEditor,
  type ReviewInitial,
} from "@/components/workout/shared/workout-review-editor";
import type { WorkoutCompletionCtx } from "@/lib/workout-completion.functions";
import { WorkoutFilmRow } from "@/components/workout/shared/workout-film";
import { PhoneCopyReminder } from "@/components/workout-day/set-video-phone-copy";

type Props = {
  ctx: WorkoutCompletionCtx;
  hasCoach?: boolean;
  initialReview?: ReviewInitial | null;
  onReviewSaved?: () => void;
  onViewScore?: (rating: number | null) => void;
  /** Optional: id of an element to scroll to when "View Log" is clicked. */
  logAnchorId?: string;
  /** Admin/coach POV: submit on behalf of this client id. */
  actAsClientId?: string | null;
  /**
   * Auto-open the shared review editor once when this flips truthy.
   * Used by the Finish Workout flow to hand the athlete directly into
   * the full review immediately after their completion is persisted —
   * so the initial review and Edit Review reuse the same component.
   */
  autoOpenReview?: boolean;
  onAutoOpenReviewConsumed?: () => void;
  /** Opens the score / recap; shown once the review is in. */
  onOpenScore?: () => void;
  /** e.g. "1h 5m", after the status. */
  meta?: string | null;
  /**
   * Draws the status row around its label (the logger puts the session time
   * beside "Completed", one tappable line). Without it the label stands alone.
   */
  status?: (label: ReactNode) => ReactNode;
  /** More of the same card under the actions. */
  children?: ReactNode;
  /** The athlete's own finished workout: its film (set videos) shows here, to post or see in the feed. */
  filmCompletionId?: string | null;
  /** When it finished: a film whose review never came posts by itself after FILM_REVIEW_WAIT_MS. */
  completedAt?: string | null;
};

/** How long a film waits for its review (where the athlete's switch is) before it posts by itself. */
const FILM_REVIEW_WAIT_MS = 15 * 60_000;

export function CompletedWorkoutActions({
  ctx,
  hasCoach,
  initialReview,
  onReviewSaved,
  onViewScore,
  logAnchorId,
  actAsClientId,
  autoOpenReview,
  onAutoOpenReviewConsumed,
  onOpenScore,
  meta,
  status,
  children,
  filmCompletionId,
  completedAt,
}: Props) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const hasReview = !!initialReview?.submittedAt;
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoOpenReview) return;
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    setReviewOpen(true);
    onAutoOpenReviewConsumed?.();
  }, [autoOpenReview, onAutoOpenReviewConsumed]);

  const label = (
    <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold">
      {hasReview ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
      ) : (
        <MessageSquare className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      )}
      <span>{hasReview ? "Completed" : "Completed · review pending"}</span>
      {meta ? <span className="font-normal tabular-nums text-muted-foreground">· {meta}</span> : null}
    </span>
  );

  return (
    <>
      <Card className="space-y-2 px-3 pb-3 pt-2" data-testid="completed-workout-card">
        {status ? status(label) : <div className="flex min-h-10 items-center">{label}</div>}
        <div className={hasReview && onOpenScore ? "grid grid-cols-2 gap-2" : "grid grid-cols-1"}>
          {hasReview && onOpenScore && (
            <Button variant="outline" onClick={onOpenScore} className="h-10" data-testid="completed-view-score">
              <Trophy className="h-4 w-4" />
              View score
            </Button>
          )}
          <Button
            variant={hasReview ? "outline" : "default"}
            onClick={() => setReviewOpen(true)}
            className="h-10"
            data-testid="completed-review"
          >
            {hasReview ? (
              <>
                <Pencil className="h-4 w-4" />
                Edit review
              </>
            ) : (
              <>
                <MessageSquare className="h-4 w-4" />
                Finish review
              </>
            )}
          </Button>
        </div>
        {children}
        {filmCompletionId && ctx.kind === "client" && (
          <WorkoutFilmRow
            completionId={filmCompletionId}
            dayId={ctx.dayId}
            // after the review (their switch is in it), or once they've clearly skipped it
            auto={hasReview || (!!completedAt && Date.now() - Date.parse(completedAt) > FILM_REVIEW_WAIT_MS)}
            className="border-t border-border/70 pt-2.5"
          />
        )}
        {filmCompletionId && ctx.kind === "client" && (
          <PhoneCopyReminder
            dayId={ctx.dayId}
            className="rounded-none border-0 border-t border-border/70 bg-transparent px-0 pb-0 pt-2.5"
          />
        )}
      </Card>
      <WorkoutReviewEditor
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        ctx={ctx}
        hasCoach={hasCoach}
        initial={initialReview ?? null}
        onSaved={onReviewSaved}
        onViewScore={onViewScore}
        actAsClientId={actAsClientId ?? null}
      />
    </>
  );
}