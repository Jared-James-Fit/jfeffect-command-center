import { useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  useWorkoutStatusChange,
  useWorkoutVersions,
  versionReason,
  versionSummary,
  versionWhen,
  type WorkoutVersion,
} from "@/lib/workout-status-change";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// Supabase RPC errors are plain objects with a message, not Error instances.
const errorMessage = (e: unknown) => (e as { message?: string } | null)?.message;

/**
 * Version history for one workout — restore it to an earlier point, like
 * Google Sheets. Versions are saved on the server automatically while logging
 * and before every status change, reset or restore; this sheet loads their
 * summaries only while open. Restoring saves the current state first, and the
 * toast offers Undo.
 */
export function WorkoutHistorySheet({
  open,
  onOpenChange,
  dayId,
  clientId,
  scheduledWorkoutId = null,
  invalidateKeys = [],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dayId: string;
  clientId: string;
  scheduledWorkoutId?: string | null;
  invalidateKeys?: readonly (readonly unknown[])[];
}) {
  const scope = { dayId, clientId, scheduledWorkoutId };
  const { data: versions = [], isLoading, isError, error } = useWorkoutVersions(scope, open);
  const { restore } = useWorkoutStatusChange({ ...scope, invalidateKeys });
  const [pending, setPending] = useState<WorkoutVersion | null>(null);
  const [restoring, setRestoring] = useState(false);

  const confirmRestore = async () => {
    if (!pending) return;
    setRestoring(true);
    try {
      await restore(pending.id, versionWhen(pending.created_at));
      setPending(null);
      onOpenChange(false);
    } catch (err) {
      toast.error("Couldn't restore that version", { description: errorMessage(err) });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="flex max-h-[85svh] flex-col rounded-t-2xl pb-[max(env(safe-area-inset-bottom),1rem)]"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-muted-foreground" /> Version history
            </SheetTitle>
            <SheetDescription>
              Put this workout back to an earlier point. Your current version is saved first, so
              nothing is lost.
            </SheetDescription>
          </SheetHeader>

          <div
            className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain"
            data-testid="workout-version-list"
          >
            <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">Now</div>
                <div className="text-xs text-muted-foreground">Current version</div>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading versions…
              </div>
            ) : isError ? (
              <p className="py-6 text-center text-sm text-destructive">
                {errorMessage(error) ?? "Couldn't load versions."}
              </p>
            ) : versions.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No earlier versions yet. They're saved automatically as you log, and before any
                status change or reset.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold tabular-nums">
                        {versionWhen(v.created_at)}
                      </div>
                      <div className="truncate text-xs text-foreground/80">{versionSummary(v)}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {versionReason(v)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 gap-1.5 rounded-lg"
                      onClick={() => setPending(v)}
                      aria-label={`Restore the version from ${versionWhen(v.created_at)}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="px-2 pt-3 text-center text-[11px] text-muted-foreground">
              Versions are kept for 45 days (up to 30 per workout).
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!pending}
        onOpenChange={(v) => {
          if (!v && !restoring) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending && (
                <>
                  The workout goes back to how it was at {versionWhen(pending.created_at)} (
                  {versionSummary(pending)}). Your current version is saved first, so you can undo.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              onClick={(e) => {
                e.preventDefault();
                void confirmRestore();
              }}
            >
              {restoring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
