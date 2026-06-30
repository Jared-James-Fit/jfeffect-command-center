/**
 * Shared post-completion action bar. Renders on completed workouts for
 * both coaching clients and membership users:
 *   - "View / Edit Log" → scrolls back to the log (which IS the page body).
 *   - "View / Edit Review" → opens the shared `WorkoutReviewEditor`,
 *     prefilled with the existing review when one exists.
 *
 * `ctx` is the same discriminated context used by `submitOrEditReview`,
 * so the editor writes to the correct backing table (pl_workout_feedback
 * for clients, member_workout_reviews for members).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MessageSquare, Pencil } from "lucide-react";
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
};

export function CompletedWorkoutActions({
  ctx,
  hasCoach,
  initialReview,
  onReviewSaved,
  logAnchorId,
  actAsClientId,
}: Props) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const hasReview = !!initialReview?.submittedAt;

  return (
    <>
      <Card className="flex flex-wrap items-center gap-2 border-emerald-500/30 bg-emerald-500/5 p-3">
        <div className="mr-auto text-sm font-bold text-emerald-700 dark:text-emerald-300">
          Workout completed
        </div>
        <Button
          variant={hasReview ? "outline" : "default"}
          size="sm"
          onClick={() => setReviewOpen(true)}
          className="h-9 gap-1.5"
        >
          {hasReview ? (
            <>
              <Pencil className="h-4 w-4" />
              Edit Review
            </>
          ) : (
            <>
              <MessageSquare className="h-4 w-4" />
              Mark Workout Complete
            </>
          )}
        </Button>
      </Card>
      <WorkoutReviewEditor
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        ctx={ctx}
        hasCoach={hasCoach}
        initial={initialReview ?? null}
        onSaved={onReviewSaved}
        actAsClientId={actAsClientId ?? null}
      />
    </>
  );
}