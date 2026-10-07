import { useState } from "react";
import { Check, Circle, Loader2, Play, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkoutStatusChange, type WorkoutStatusKey } from "@/lib/workout-status-change";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type { WorkoutStatusKey } from "@/lib/workout-status-change";

/**
 * Shared "Set workout status" bottom sheet, reused by every workout card.
 *
 * Not Started means a fresh start: choosing it on a workout with activity
 * resets that one workout instance (logged sets, warm-ups, review) after a
 * confirm. Every change — including a reset — shows an Undo toast that
 * restores it exactly (server snapshot, see workout_set_status).
 *
 * `mode="reset"` skips the sheet and opens the reset confirmation directly
 * (the card's ⋯ "Reset workout").
 */
export function WorkoutStatusSheet({
  open,
  onOpenChange,
  dayId,
  clientId,
  completion,
  scheduledWorkoutId = null,
  invalidateKeys = [],
  loggedSets = null,
  mode = "status",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dayId: string;
  clientId: string;
  completion: {
    id?: string | null;
    started_at?: string | null;
    in_progress_at?: string | null;
    completed_at?: string | null;
  } | null | undefined;
  scheduledWorkoutId?: string | null;
  invalidateKeys?: readonly (readonly unknown[])[];
  /** Logged sets on this workout, when the caller knows (shown in the reset confirm). */
  loggedSets?: number | null;
  mode?: "status" | "reset";
}) {
  const { change } = useWorkoutStatusChange({ dayId, clientId, scheduledWorkoutId, invalidateKeys });
  const current: WorkoutStatusKey = completion?.completed_at
    ? "completed"
    : completion?.in_progress_at || completion?.started_at || (loggedSets ?? 0) > 0
      ? "in_progress"
      : "not_started";

  const [selected, setSelected] = useState<WorkoutStatusKey>(current);
  const [saving, setSaving] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<WorkoutStatusKey | null>(null);

  const hasActivity = current !== "not_started";
  const resetOnly = mode === "reset";
  const confirmOpen = resetOnly ? open : confirmTarget !== null;
  const confirming: WorkoutStatusKey | null = resetOnly ? "not_started" : confirmTarget;

  function handleOpen(v: boolean) {
    if (v) setSelected(current);
    onOpenChange(v);
  }

  async function applyStatus(next: WorkoutStatusKey) {
    setSaving(true);
    try {
      await change(next);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(
        next === "not_started" && hasActivity ? "Workout could not be reset. Try again." : "Workout status could not be updated. Try again.",
        { description: err?.message },
      );
      setSelected(current);
    } finally {
      setSaving(false);
      setConfirmTarget(null);
    }
  }

  function handleSave() {
    if (selected === current) {
      onOpenChange(false);
      return;
    }
    // Completed always confirms; Not Started confirms when it will reset
    // logged work. Both can be undone from the toast afterwards.
    if (selected === "completed") { setConfirmTarget("completed"); return; }
    if (selected === "not_started" && hasActivity) { setConfirmTarget("not_started"); return; }
    void applyStatus(selected);
  }

  const options: { key: WorkoutStatusKey; label: string; hint?: string; icon: React.ReactNode; tone: string }[] = [
    {
      key: "not_started",
      label: "Not Started",
      hint: hasActivity ? "Resets this workout — clears its logged sets" : undefined,
      icon: <Circle className="h-5 w-5" />,
      tone: "text-muted-foreground",
    },
    { key: "in_progress", label: "In Progress", icon: <Play className="h-5 w-5" />, tone: "text-amber-500" },
    { key: "completed", label: "Completed", icon: <CheckCircle2 className="h-5 w-5" />, tone: "text-emerald-500" },
  ];

  const setsPhrase = loggedSets && loggedSets > 0
    ? `${loggedSets} logged set${loggedSets === 1 ? "" : "s"}`
    : "the logged sets";

  return (
    <>
      {!resetOnly && (
        <Sheet open={open} onOpenChange={handleOpen}>
          <SheetContent
            side="bottom"
            className="rounded-t-2xl pb-[max(env(safe-area-inset-bottom),1rem)]"
          >
            <SheetHeader className="text-left">
              <SheetTitle>Set Workout Status</SheetTitle>
            </SheetHeader>

            <div className="mt-4 space-y-2">
              {options.map((opt) => {
                const isSelected = selected === opt.key;
                const isCurrent = current === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setSelected(opt.key)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors",
                      "min-h-[60px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-secondary/50",
                    )}
                    aria-pressed={isSelected}
                  >
                    <span className={cn("shrink-0", opt.tone)}>{opt.icon}</span>
                    <span className="flex-1">
                      <span className="block text-base font-bold">{opt.label}</span>
                      {isCurrent ? (
                        <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Current
                        </span>
                      ) : opt.hint ? (
                        <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                      ) : null}
                    </span>
                    {isSelected && <Check className="h-5 w-5 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>

            <SheetFooter className="mt-4 flex-row gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                className="h-11 flex-1 sm:flex-none"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                className="h-11 flex-1 sm:flex-none"
                onClick={handleSave}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Status
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(v) => {
          if (v || saving) return;
          if (resetOnly) onOpenChange(false);
          else setConfirmTarget(null);
        }}
      >
        <AlertDialogContent>
          {confirming === "completed" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Mark this workout as completed?</AlertDialogTitle>
                <AlertDialogDescription>
                  Some set logs may still be missing. Any missing logs stay
                  available in the workout. You can undo this right after.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={saving}>Go Back</AlertDialogCancel>
                <AlertDialogAction
                  disabled={saving}
                  onClick={(e) => { e.preventDefault(); void applyStatus("completed"); }}
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Mark Completed
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {confirming === "not_started" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset this workout?</AlertDialogTitle>
                <AlertDialogDescription>
                  Clears {setsPhrase}, warm-ups and the review for this workout
                  and sets it to Not Started. Other weeks aren't touched. You
                  can undo right after.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={saving}
                  onClick={(e) => { e.preventDefault(); void applyStatus("not_started"); }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Reset workout
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

