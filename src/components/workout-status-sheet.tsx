import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Circle, Loader2, Play, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { setWorkoutStatus as setWorkoutStatusFn } from "@/lib/workout-completion.functions";
import { useClientImpersonation } from "@/lib/client-impersonation";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WorkoutStatusKey = "not_started" | "in_progress" | "completed";

/**
 * Shared "Set workout status" bottom sheet — mirrors the status switcher
 * already present inside the opened workout (WorkoutDayView). Reused from
 * any card-level three-dot menu so a user can update status without
 * leaving the calendar/list.
 */
export function WorkoutStatusSheet({
  open,
  onOpenChange,
  dayId,
  clientId,
  completion,
  invalidateKeys = [],
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
  invalidateKeys?: readonly (readonly unknown[])[];
}) {
  const qc = useQueryClient();
  const setStatusSrv = useServerFn(setWorkoutStatusFn);
  const { isImpersonating, client: povClient } = useClientImpersonation();
  const current: WorkoutStatusKey = completion?.completed_at
    ? "completed"
    : completion?.in_progress_at || completion?.started_at
      ? "in_progress"
      : "not_started";

  const [selected, setSelected] = useState<WorkoutStatusKey>(current);
  const [saving, setSaving] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<WorkoutStatusKey | null>(null);

  // Reset selection whenever the sheet opens
  function handleOpen(v: boolean) {
    if (v) setSelected(current);
    onOpenChange(v);
  }

  const hasLogs = !!(completion?.started_at || completion?.in_progress_at || completion?.completed_at);

  async function applyStatus(next: WorkoutStatusKey) {
    setSaving(true);
    try {
      // Route every status flip through the shared server fn so coach/admin
      // POV writes bypass RLS via the service-role writer (pl_day_completions
      // INSERT/UPDATE policies are scoped to the client's own auth.uid).
      const actAsClientId =
        isImpersonating && povClient?.id === clientId ? clientId : null;
      await setStatusSrv({
        data: { dayId, status: next, actAsClientId } as any,
      });
      // Refresh every cache surface that renders workout status.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] }),
        qc.invalidateQueries({ queryKey: ["my-workouts", clientId] }),
        ...invalidateKeys.map((k) => qc.invalidateQueries({ queryKey: k as unknown[] })),
      ]);
      toast.success(`Status set: ${labelFor(next)}`);
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Workout status could not be updated. Try again.", {
        description: err?.message,
      });
      // Restore previous visible selection on failure.
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
    // Confirmations: Completed always confirms; Not Started confirms only
    // when prior activity exists (so the user knows logs aren't lost).
    if (selected === "completed") { setConfirmTarget("completed"); return; }
    if (selected === "not_started" && hasLogs) { setConfirmTarget("not_started"); return; }
    void applyStatus(selected);
  }

  const options: { key: WorkoutStatusKey; label: string; icon: React.ReactNode; tone: string }[] = [
    { key: "not_started", label: "Not Started", icon: <Circle className="h-5 w-5" />, tone: "text-muted-foreground" },
    { key: "in_progress", label: "In Progress", icon: <Play className="h-5 w-5" />, tone: "text-amber-500" },
    { key: "completed", label: "Completed", icon: <CheckCircle2 className="h-5 w-5" />, tone: "text-emerald-500" },
  ];

  return (
    <>
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
                    {isCurrent && (
                      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Current
                      </span>
                    )}
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

      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(v) => { if (!v) setConfirmTarget(null); }}
      >
        <AlertDialogContent>
          {confirmTarget === "completed" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Mark this workout as completed?</AlertDialogTitle>
                <AlertDialogDescription>
                  Some sets may still be incomplete. You can mark the workout
                  completed, but it will stay labelled as partially logged.
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
          {confirmTarget === "not_started" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Change status to Not Started?</AlertDialogTitle>
                <AlertDialogDescription>
                  This workout already has logged activity. Changing the status
                  will not delete your logs.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={saving}
                  onClick={(e) => { e.preventDefault(); void applyStatus("not_started"); }}
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Change Status
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function labelFor(k: WorkoutStatusKey) {
  return k === "not_started" ? "Not Started" : k === "in_progress" ? "In Progress" : "Completed";
}