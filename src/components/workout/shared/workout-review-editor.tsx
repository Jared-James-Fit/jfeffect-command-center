/**
 * Shared workout review editor. Used by both coaching clients and
 * membership users via the unified `submitOrEditReview` server fn. UI is
 * intentionally a slim sheet — the older `WorkoutFeedbackSheet` keeps
 * powering the client side for now (it has coach-locked semantics);
 * this component is for the new member flow and any future shared
 * surfaces.
 *
 * Wording flips on `hasCoach`:
 *   - hasCoach=true  → "Your coach can see this"
 *   - hasCoach=false → neutral "Anything you want to note?"
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { submitOrEditReview, type WorkoutCompletionCtx } from "@/lib/workout-completion.functions";

export type ReviewInitial = {
  overallRating?: number | null;
  sessionRpe?: number | null;
  pain?: boolean | null;
  painLevel?: number | null;
  painArea?: string | null;
  painNote?: string | null;
  clientNote?: string | null;
  editCount?: number | null;
  submittedAt?: string | null;
  strengthFeel?: string | null;
  fatigueFeel?: string | null;
  hitTarget?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctx: WorkoutCompletionCtx;
  hasCoach?: boolean;
  initial?: ReviewInitial | null;
  onSaved?: () => void;
  /** Admin/coach POV: submit on behalf of this client id. */
  actAsClientId?: string | null;
};

export function WorkoutReviewEditor({
  open,
  onOpenChange,
  ctx,
  hasCoach,
  initial,
  onSaved,
  actAsClientId,
}: Props) {
  const submit = useServerFn(submitOrEditReview);
  const isEdit = !!initial?.submittedAt;

  const [rating, setRating] = useState<number | null>(initial?.overallRating ?? null);
  const [rpe, setRpe] = useState<number | null>(initial?.sessionRpe ?? null);
  const [pain, setPain] = useState<boolean>(!!initial?.pain);
  const [painLevel, setPainLevel] = useState<number | null>(initial?.painLevel ?? null);
  const [note, setNote] = useState<string>(initial?.clientNote ?? "");
  const [strengthFeel, setStrengthFeel] = useState<string | null>(initial?.strengthFeel ?? null);
  const [fatigueFeel, setFatigueFeel] = useState<string | null>(initial?.fatigueFeel ?? null);
  const [hitTarget, setHitTarget] = useState<string | null>(initial?.hitTarget ?? null);

  useEffect(() => {
    if (!open) return;
    setRating(initial?.overallRating ?? null);
    setRpe(initial?.sessionRpe ?? null);
    setPain(!!initial?.pain);
    setPainLevel(initial?.painLevel ?? null);
    setNote(initial?.clientNote ?? "");
    setStrengthFeel(initial?.strengthFeel ?? null);
    setFatigueFeel(initial?.fatigueFeel ?? null);
    setHitTarget(initial?.hitTarget ?? null);
  }, [open, initial?.submittedAt]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (rating == null || rpe == null) throw new Error("Rating and session RPE are required");
      return submit({
        data: {
          ...ctx,
          overallRating: rating,
          sessionRpe: rpe,
          pain,
          painLevel: pain ? painLevel ?? null : null,
          painArea: null,
          painNote: null,
          clientNote: note.trim() ? note.trim() : null,
          strengthFeel,
          fatigueFeel,
          hitTarget,
          actAsClientId: actAsClientId ?? null,
        },
      });
    },
    onSuccess: (res: any) => {
      toast.success(res?.edited ? "Review updated." : "Review saved.");
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't save review"),
  });

  const canSubmit = rating != null && rpe != null && !mutation.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="z-[70] max-h-[92svh] overflow-y-auto rounded-t-3xl p-0 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="px-5 pt-5">
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="text-xl font-black">
              {isEdit ? "Edit your review" : "How was that workout?"}
            </SheetTitle>
            <SheetDescription>
              {hasCoach
                ? "Your coach can see this."
                : "Notes for your own records — only you can see them."}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="space-y-6 px-5 pb-4 pt-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold">Overall rating</legend>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-pressed={rating === n}
                  className={cn(
                    "h-12 rounded-xl border text-sm font-black transition-colors",
                    rating === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-secondary/40",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-bold">Session RPE (1–10)</legend>
            <div className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRpe(n)}
                  aria-pressed={rpe === n}
                  className={cn(
                    "h-10 rounded-lg border text-sm font-black transition-colors",
                    rpe === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-secondary/40",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-bold">Did anything hurt?</legend>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setPain(false); setPainLevel(null); }}
                aria-pressed={!pain}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors",
                  !pain
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary/40",
                )}
              >
                No
              </button>
              <button
                type="button"
                onClick={() => setPain(true)}
                aria-pressed={pain}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors",
                  pain
                    ? "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary/40",
                )}
              >
                Yes
              </button>
            </div>
            {pain && (
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPainLevel(n)}
                    aria-pressed={painLevel === n}
                    className={cn(
                      "h-9 rounded-lg border text-xs font-black transition-colors",
                      painLevel === n
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "border-border bg-card hover:bg-secondary/40",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <PillQuestion
            legend="How did your strength feel?"
            options={["Weak", "Normal", "Strong"]}
            value={strengthFeel}
            onChange={setStrengthFeel}
          />
          <PillQuestion
            legend="How tired did you feel?"
            options={["Fresh", "Normal", "Drained"]}
            value={fatigueFeel}
            onChange={setFatigueFeel}
          />
          <PillQuestion
            legend="Did you hit the target reps/RIR?"
            options={["Yes", "Mostly", "No"]}
            value={hitTarget}
            onChange={setHitTarget}
          />

          <div className="space-y-2">
            <Label htmlFor="review-note" className="text-sm font-bold">
              {hasCoach ? "Anything your coach should know?" : "Anything you want to note?"}
            </Label>
            <Textarea
              id="review-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
              rows={3}
              maxLength={600}
            />
          </div>

          {isEdit && initial?.editCount != null && initial.editCount > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Edited {initial.editCount} time{initial.editCount === 1 ? "" : "s"}.
            </p>
          )}
        </div>

        <SheetFooter className="sticky bottom-0 z-10 flex-row gap-2 border-t bg-background/95 px-5 py-3 backdrop-blur sm:flex-row">
          <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Close
          </Button>
          <Button className="flex-1" onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Submit review"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}