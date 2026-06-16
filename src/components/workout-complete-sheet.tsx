import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

const RATING_LABELS = ["Rough", "Below Avg", "Solid", "Great", "Excellent"];

export type WorkoutCompletePayload = {
  session_rating: number;
  session_weight_total: number | null;
  session_weight_unit: "kg" | "lb" | null;
  client_notes: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultUnit?: "kg" | "lb";
  initial?: Partial<WorkoutCompletePayload>;
  submitting?: boolean;
  onSubmit: (payload: WorkoutCompletePayload) => Promise<void> | void;
};

export function WorkoutCompleteSheet({
  open,
  onOpenChange,
  defaultUnit = "lb",
  initial,
  submitting = false,
  onSubmit,
}: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [weight, setWeight] = useState<string>("");
  const [unit, setUnit] = useState<"kg" | "lb">(defaultUnit);
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setRating(initial?.session_rating ?? null);
    setWeight(
      initial?.session_weight_total != null ? String(initial.session_weight_total) : "",
    );
    setUnit((initial?.session_weight_unit as "kg" | "lb") ?? defaultUnit);
    setNote(initial?.client_notes ?? "");
  }, [open, initial?.session_rating, initial?.session_weight_total, initial?.session_weight_unit, initial?.client_notes, defaultUnit]);

  const canSubmit = rating != null && !submitting;

  const submit = async () => {
    if (!canSubmit || rating == null) return;
    const parsed = weight.trim() === "" ? null : Number(weight);
    await onSubmit({
      session_rating: rating,
      session_weight_total: parsed != null && Number.isFinite(parsed) && parsed > 0 ? parsed : null,
      session_weight_unit: parsed != null && Number.isFinite(parsed) && parsed > 0 ? unit : null,
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
            <SheetDescription>Quick rating and total weight lifted. Takes 5 seconds.</SheetDescription>
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

          {/* Total weight lifted */}
          <div className="space-y-2">
            <Label htmlFor="wc-total" className="text-sm font-bold">
              Total weight lifted <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="flex items-stretch gap-2">
              <Input
                id="wc-total"
                inputMode="decimal"
                placeholder="e.g. 12000"
                value={weight}
                onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))}
                className="h-11 flex-1 text-base"
              />
              <div className="inline-flex overflow-hidden rounded-md border border-border">
                {(["lb", "kg"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUnit(u)}
                    aria-pressed={unit === u}
                    className={cn(
                      "px-4 text-sm font-bold uppercase tracking-wide transition-colors",
                      unit === u
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-muted-foreground hover:bg-secondary/40",
                    )}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>

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