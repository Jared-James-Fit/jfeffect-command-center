import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

const RATING_LABELS = ["Rough", "Below Avg", "Solid", "Great", "Excellent"];

export type WorkoutCompletePayload = {
  session_rating: number;
  client_notes: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<WorkoutCompletePayload>;
  submitting?: boolean;
  onSubmit: (payload: WorkoutCompletePayload) => Promise<void> | void;
};

export function WorkoutCompleteSheet({
  open,
  onOpenChange,
  initial,
  submitting = false,
  onSubmit,
}: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setRating(initial?.session_rating ?? null);
    setNote(initial?.client_notes ?? "");
  }, [open, initial?.session_rating, initial?.client_notes]);

  const canSubmit = rating != null && !submitting;

  const submit = async () => {
    if (!canSubmit || rating == null) return;
    await onSubmit({
      session_rating: rating,
      client_notes: note.trim() ? note.trim() : null,
    });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v); }}>
      <SheetContent
        side="bottom"
        className="z-[70] max-h-[88svh] overflow-y-auto rounded-t-3xl p-0 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="px-5 pt-5">
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="text-xl font-black">Workout Complete</SheetTitle>
            <SheetDescription>One quick rating and you're done.</SheetDescription>
          </SheetHeader>
        </div>

        <div className="space-y-6 px-5 pb-4 pt-5">
          {/* Rating */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold">Session rating</legend>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-pressed={rating === n}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 transition-colors",
                    rating === n
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-secondary/40",
                  )}
                >
                  <span className="text-lg font-black text-foreground">{n}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide">
                    {RATING_LABELS[n - 1]}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          {/* Optional note */}
          <div className="space-y-2">
            <Label htmlFor="wc-note" className="text-sm font-bold">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="wc-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything quick to remember…"
              rows={2}
              maxLength={400}
            />
          </div>
        </div>

        <SheetFooter className="sticky bottom-0 z-10 border-t bg-background/95 px-5 py-3 backdrop-blur">
          <Button className="h-12 w-full text-base font-bold" onClick={submit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit Workout
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}