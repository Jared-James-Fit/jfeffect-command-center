/**
 * The finished workout's one card, at the top of the log: its status
 * (Completed, or completed with the review still to do), how long it took, the
 * review button and View score. The log itself is the page under it.
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
  /** More of the same card under the status row (the session time line). */
  children?: ReactNode;
};

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
  children,
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

  return (
    <>
      <Card className="space-y-2.5 p-3" data-testid="completed-workout-card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto flex min-w-0 items-center gap-2 text-sm font-semibold">
            {hasReview ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
            ) : (
              <MessageSquare className="h-4 w-4 shrink-0 text-warning" aria-hidden />
            )}
            <span>{hasReview ? "Completed" : "Completed · review pending"}</span>
            {meta ? <span className="font-normal tabular-nums text-muted-foreground">· {meta}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            {hasReview && onOpenScore && (
              <Button variant="outline" onClick={onOpenScore} className="h-10">
                <Trophy className="h-4 w-4" />
                View score
              </Button>
            )}
            <Button
              variant={hasReview ? "ghost" : "default"}
              onClick={() => setReviewOpen(true)}
              className={hasReview ? "h-10 text-muted-foreground" : "h-10"}
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
        </div>
        {children}
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