/**
 * WorkoutCompleteSheet — post-workout review.
 *
 * Fast tap-based review: rating, strength feel, fatigue, pain, hit target,
 * optional coach note. Should take under 20 seconds to complete.
 *
 * All fields except rating are optional.
 */
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
  strength_feel?: string | null;
  fatigue_feel?: string | null;
  pain?: boolean | null;
  hit_target?: string | null;
  client_notes: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<WorkoutCompletePayload>;
  submitting?: boolean;
  onSubmit: (payload: WorkoutCompletePayload) => Promise<void> | void;
};

function QuickTapGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-bold">{label}</legend>
      <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cn(
              "rounded-xl border px-2 py-2.5 text-xs font-bold transition-colors",
              value === o.value
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-secondary/40",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function WorkoutCompleteSheet({
  open,
  onOpenChange,
  initial,
  submitting = false,
  onSubmit,
}: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [strengthFeel, setStrengthFeel] = useState<string | null>(null);
  const [fatigueFeel, setFatigueFeel] = useState<string | null>(null);
  const [pain, setPain] = useState<string | null>(null);
  const [hitTarget, setHitTarget] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setRating(initial?.session_rating ?? null);
    setStrengthFeel(initial?.strength_feel ?? null);
    setFatigueFeel(initial?.fatigue_feel ?? null);
    setPain(initial?.pain != null ? (initial.pain ? "Yes" : "No") : null);
    setHitTarget(initial?.hit_target ?? null);
    setNote(initial?.client_notes ?? "");
  }, [open, initial?.session_rating, initial?.client_notes]);

  const canSubmit = rating != null && !submitting;

  const submit = async () => {
    if (!canSubmit || rating == null) return;
    await onSubmit({
      session_rating: rating,
      strength_feel: strengthFeel ?? null,
      fatigue_feel: fatigueFeel ?? null,
      pain: pain === "Yes" ? true : pain === "No" ? false : null,
      hit_target: hitTarget ?? null,
      client_notes: note.trim() ? note.trim() : null,
    });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v); }}>
      <SheetContent
        side="bottom"
        className="z-[70] max-h-[92svh] overflow-y-auto rounded-t-3xl p-0 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="px-5 pt-5">
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="text-xl font-black">Workout Complete</SheetTitle>
            <SheetDescription>Quick tap review — takes under 20 seconds.</SheetDescription>
          </SheetHeader>
        </div>

        <div className="space-y-5 px-5 pb-4 pt-5">
          {/* 1. Rating */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold">How was this workout? <span className="text-destructive">*</span></legend>
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

          {/* 2. Strength feel */}
          <QuickTapGroup
            label="How did your strength feel?"
            options={[
              { value: "Weak", label: "Weak" },
              { value: "Normal", label: "Normal" },
              { value: "Strong", label: "Strong" },
            ]}
            value={strengthFeel as any}
            onChange={setStrengthFeel}
          />

          {/* 3. Fatigue */}
          <QuickTapGroup
            label="How tired did you feel?"
            options={[
              { value: "Fresh", label: "Fresh" },
              { value: "Normal", label: "Normal" },
              { value: "Drained", label: "Drained" },
            ]}
            value={fatigueFeel as any}
            onChange={setFatigueFeel}
          />

          {/* 4. Pain */}
          <QuickTapGroup
            label="Any pain or discomfort?"
            options={[
              { value: "No", label: "No" },
              { value: "Mild", label: "Mild" },
              { value: "Yes", label: "Yes" },
            ]}
            value={pain as any}
            onChange={setPain}
          />

          {/* 5. Hit target */}
          <QuickTapGroup
            label="Did you hit the target reps/RIR?"
            options={[
              { value: "Yes", label: "Yes" },
              { value: "Mostly", label: "Mostly" },
              { value: "No", label: "No" },
            ]}
            value={hitTarget as any}
            onChange={setHitTarget}
          />

          {/* 6. Optional coach note */}
          <div className="space-y-2">
            <Label htmlFor="wc-note" className="text-sm font-bold">
              Anything your coach should know? <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="wc-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for your coach…"
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
