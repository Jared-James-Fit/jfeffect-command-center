import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Lock, Pencil } from "lucide-react";

const RATING_OPTIONS: { value: number; label: string; emoji: string }[] = [
  { value: 1, label: "Rough", emoji: "😖" },
  { value: 2, label: "Below avg", emoji: "😕" },
  { value: 3, label: "Solid", emoji: "🙂" },
  { value: 4, label: "Great", emoji: "💪" },
  { value: 5, label: "Excellent", emoji: "🔥" },
];

const RPE_ANCHORS: { range: string; label: string }[] = [
  { range: "1–3", label: "Easy" },
  { range: "4–6", label: "Moderate" },
  { range: "7–8", label: "Hard" },
  { range: "9", label: "Very hard" },
  { range: "10", label: "Maximum" },
];

const BODY_AREAS = [
  "Lower back", "Upper back", "Neck",
  "Shoulder (L)", "Shoulder (R)",
  "Elbow (L)", "Elbow (R)",
  "Wrist (L)", "Wrist (R)",
  "Hip (L)", "Hip (R)",
  "Knee (L)", "Knee (R)",
  "Ankle/foot (L)", "Ankle/foot (R)",
  "Other",
];

export type ExistingFeedback = {
  id: string;
  overall_rating: number | null;
  session_rpe: number | null;
  pain: boolean | null;
  pain_level: number | null;
  pain_area: string | null;
  pain_note: string | null;
  client_note: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
} | null;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completionId: string | null;
  clientId: string;
  dayId: string;
  existing?: ExistingFeedback;
  workoutDate?: string | null;
  onSubmitted?: (submitted?: {
    overall_rating: number;
    session_rpe: number;
    pain: boolean;
    pain_level: number | null;
    pain_area: string | null;
    pain_note: string | null;
    client_note: string | null;
  }) => void;
};

export function WorkoutFeedbackSheet({ open, onOpenChange, completionId, clientId, dayId, existing, workoutDate, onSubmitted }: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const [pain, setPain] = useState<boolean | null>(null);
  const [painLevel, setPainLevel] = useState<number | null>(null);
  const [painArea, setPainArea] = useState<string[]>([]);
  const [painNote, setPainNote] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const isEdit = !!existing?.id;
  const isLocked = !!(existing?.reviewed_at || existing?.reviewed_by);

  // Reset / prefill whenever the sheet (re)opens for a different completion.
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setRating(existing.overall_rating ?? null);
      setRpe(existing.session_rpe ?? null);
      setPain(existing.pain ?? null);
      setPainLevel(existing.pain_level ?? null);
      setPainArea(existing.pain_area ? existing.pain_area.split(", ") : []);
      setPainNote(existing.pain_note ?? "");
      setNote(existing.client_note ?? "");
    } else {
      setRating(null); setRpe(null); setPain(null);
      setPainLevel(null); setPainArea([]); setPainNote(""); setNote("");
    }
    setSubmitting(false);
  }, [open, completionId, existing?.id]);

  const canSubmit = useMemo(() => {
    if (rating == null || rpe == null || pain == null) return false;
    if (pain && (painLevel == null || painArea.length === 0)) return false;
    return !submitting;
  }, [rating, rpe, pain, painLevel, painArea, submitting]);

  const submit = async () => {
    if (!completionId || !canSubmit || isLocked) return;
    setSubmitting(true);
    const fields = {
      overall_rating: rating!,
      session_rpe: rpe!,
      pain: pain!,
      pain_level: pain ? painLevel : null,
      pain_area: pain ? (painArea.length > 0 ? painArea.join(", ") : null) : null,
      pain_note: pain && painNote.trim() ? painNote.trim() : null,
      client_note: note.trim() ? note.trim() : null,
    };

    let error: any = null;
    if (isEdit && existing?.id) {
      const res = await (supabase as any)
        .from("pl_workout_feedback")
        .update(fields)
        .eq("id", existing.id);
      error = res.error;
    } else {
      const payload = {
        completion_id: completionId,
        client_id: clientId,
        day_id: dayId,
        ...fields,
      };
      const res = await (supabase as any).from("pl_workout_feedback").insert(payload);
      error = res.error;
      if (error && ((error.code === "23505") || /duplicate key|unique/i.test(String(error.message ?? "")))) {
        setSubmitting(false);
        toast.message("Feedback already submitted for this workout.");
        onSubmitted?.();
        onOpenChange(false);
        return;
      }
    }

    if (error) {
      setSubmitting(false);
      toast.error(isEdit ? "Couldn't update feedback" : "Couldn't save feedback", {
        description: error.message,
      });
      return;
    }
    toast.success(isEdit ? "Feedback updated." : "Workout logged. Feedback sent to your coach.");
    onSubmitted?.(fields);
    onOpenChange(false);
  };

  const skip = () => {
    if (completionId && !isEdit) {
      // Subtle once-per-completion dismissal — workout history may still show a
      // gentle reminder card, but the sheet will not auto-reopen on refresh.
      try { localStorage.setItem(`lov.wfb.skip:${completionId}`, "1"); } catch {}
    }
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) skip(); else onOpenChange(v); }}>
      <SheetContent
        side="bottom"
        className="z-[70] max-h-[92svh] overflow-y-auto rounded-t-3xl p-0 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="px-5 pt-5">
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="text-xl font-black">
              {isEdit ? "Edit workout feedback" : "Workout complete"}
            </SheetTitle>
            <SheetDescription>
              {isLocked
                ? "Your coach has reviewed this — it's locked."
                : isEdit
                  ? "Update anything that changed."
                  : "Quick feedback — under 10 seconds."}
            </SheetDescription>
            {workoutDate && (
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {workoutDate}
              </div>
            )}
          </SheetHeader>
          {isLocked && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              Reviewed by your coach — read-only.
            </div>
          )}
        </div>

        <fieldset disabled={isLocked} className="space-y-6 px-5 pb-4 pt-5 disabled:opacity-90">
          {/* Overall rating */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold">How was today's workout?</legend>
            <div className="grid grid-cols-5 gap-2">
              {RATING_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setRating(o.value)}
                  aria-pressed={rating === o.value}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[10px] font-bold uppercase tracking-wide transition-colors",
                    rating === o.value
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-secondary/40",
                  )}
                >
                  <span className="text-lg leading-none" aria-hidden>{o.emoji}</span>
                  <span className="text-base font-black text-foreground">{o.value}</span>
                  <span className="text-[10px]">{o.label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {/* Session RPE */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold">How hard did the full workout feel?</legend>
            <p className="text-xs text-muted-foreground">Session RPE — overall, not a single set.</p>
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
                      : "border-border bg-card text-foreground hover:bg-secondary/40",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {RPE_ANCHORS.map((a) => (
                <span key={a.range}><span className="font-bold text-foreground">{a.range}</span> {a.label}</span>
              ))}
            </div>
          </fieldset>

          {/* Pain check */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold">Did anything hurt during the workout?</legend>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setPain(false); setPainLevel(null); setPainArea([]); setPainNote(""); }}
                aria-pressed={pain === false}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors",
                  pain === false
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary/40",
                )}
              >
                No pain
              </button>
              <button
                type="button"
                onClick={() => setPain(true)}
                aria-pressed={pain === true}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors",
                  pain === true
                    ? "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary/40",
                )}
              >
                Yes
              </button>
            </div>

            {pain === true && (
              <div className="mt-3 space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Pain level
                  </Label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPainLevel(n)}
                        aria-pressed={painLevel === n}
                        className={cn(
                          "h-9 rounded-lg border text-sm font-black transition-colors",
                          painLevel === n
                            ? "border-amber-500 bg-amber-500 text-white"
                            : "border-border bg-card text-foreground hover:bg-secondary/40",
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Body area
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {BODY_AREAS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setPainArea(a)}
                        aria-pressed={painArea === a}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-bold transition-colors",
                          painArea === a
                            ? "border-amber-500 bg-amber-500/20 text-amber-800 dark:text-amber-200"
                            : "border-border bg-card text-muted-foreground hover:bg-secondary/40",
                        )}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pain-note" className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Anything to add? (optional)
                  </Label>
                  <Input
                    id="pain-note"
                    value={painNote}
                    onChange={(e) => setPainNote(e.target.value)}
                    placeholder="e.g. sharp on the second set"
                    maxLength={300}
                  />
                </div>
              </div>
            )}
          </fieldset>

          {/* Optional note */}
          <div className="space-y-2">
            <Label htmlFor="wfb-note" className="text-sm font-bold">Anything your coach should know?</Label>
            <Textarea
              id="wfb-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional — sleep, energy, anything off…"
              rows={3}
              maxLength={600}
            />
          </div>
        </fieldset>

        <SheetFooter className="sticky bottom-0 z-10 flex-row gap-2 border-t bg-background/95 px-5 py-3 backdrop-blur sm:flex-row">
          <Button variant="ghost" className="flex-1" onClick={skip} disabled={submitting}>
            {isLocked || isEdit ? "Close" : "Not now"}
          </Button>
          {!isLocked && (
            <Button className="flex-1" onClick={submit} disabled={!canSubmit}>
              {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {isEdit ? "Save changes" : "Submit feedback"}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function WorkoutFeedbackReminder({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-left transition-colors hover:bg-amber-500/10"
    >
      <div className="flex items-center gap-2 text-sm">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
        <span className="font-bold text-foreground">Rate this workout</span>
        <span className="ml-auto text-xs font-bold text-amber-700 dark:text-amber-300">Open →</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Takes under 10 seconds. Your coach uses it to adjust.</p>
    </button>
  );
}

export function WorkoutFeedbackEditButton({ onOpen, locked }: { onOpen: () => void; locked?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-left transition-colors hover:bg-emerald-500/10"
    >
      <div className="flex items-center gap-2 text-sm">
        {locked ? (
          <Lock className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
        ) : (
          <Pencil className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
        )}
        <span className="font-bold text-foreground">
          {locked ? "View workout feedback" : "View / edit feedback"}
        </span>
        <span className="ml-auto text-xs font-bold text-emerald-700 dark:text-emerald-300">Open →</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {locked
          ? "Reviewed by your coach — read-only."
          : "Update anything that changed since you submitted."}
      </p>
    </button>
  );
}