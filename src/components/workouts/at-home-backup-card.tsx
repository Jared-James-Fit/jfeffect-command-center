import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, Home, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  listAtHomeBackupDefinitions,
  startAtHomeBackupSession,
} from "@/lib/at-home-backup.functions";
import {
  AT_HOME_BACKUP_CONFIRM_ACCEPT,
  AT_HOME_BACKUP_CONFIRM_BODY,
  AT_HOME_BACKUP_CONFIRM_CANCEL,
  AT_HOME_BACKUP_CONFIRM_TITLE,
  shouldConfirmBackupStart,
} from "@/lib/at-home-backup";
import { toLocalISO } from "@/lib/today";

/**
 * Contextual client entry point for an optional At-Home Backup. It deliberately
 * renders after the selected primary/rest card rather than competing with the
 * primary program above Calendar and Block View.
 */
export function AtHomeBackupCard({
  clientId,
  date,
  readonly = false,
  hasPrimaryWorkout = false,
}: {
  clientId: string;
  date: Date;
  readonly?: boolean;
  /** A backup never replaces this workout; this controls confirmation copy only. */
  hasPrimaryWorkout?: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pendingDefinitionId, setPendingDefinitionId] = useState<string | null>(null);

  const fetchDefinitions = useServerFn(listAtHomeBackupDefinitions);
  const startSession = useServerFn(startAtHomeBackupSession);
  const dateISO = toLocalISO(date);

  const { data, isLoading } = useQuery({
    queryKey: ["at-home-backup-definitions", clientId],
    staleTime: 5 * 60_000,
    queryFn: () => fetchDefinitions({ data: { clientId } }),
  });
  const definitions = data?.definitions ?? [];

  const refreshClientWorkoutSurfaces = () => {
    qc.invalidateQueries({ queryKey: ["my-workouts", clientId] });
    qc.invalidateQueries({ queryKey: ["at-home-backup-sessions", clientId] });
    qc.invalidateQueries({ queryKey: ["workouts-priority-rows", clientId] });
    qc.invalidateQueries({ queryKey: ["scheduled-workouts", clientId] });
    qc.invalidateQueries({ predicate: (q) => {
      const key = q.queryKey?.[0];
      return typeof key === "string" && (
        key.startsWith("training-analytics") ||
        key.startsWith("workout-") ||
        key.startsWith("pl-")
      );
    } });
  };

  const start = useMutation({
    mutationFn: (definitionDayId: string) =>
      startSession({ data: { clientId, definitionDayId, date: dateISO } }),
    onSuccess: (res: any) => {
      refreshClientWorkoutSurfaces();
      setOpen(false);
      navigate({
        to: "/portal/workouts/$dayId",
        params: { dayId: res.dayId },
        search: res.scheduledWorkoutId
          ? ({ instance: res.scheduledWorkoutId } as any)
          : ({} as any),
      });
    },
    onError: (e: any) => toast.error(e?.message || "Could not start the backup workout"),
  });

  const requestStart = (definitionDayId: string) => {
    if (shouldConfirmBackupStart(hasPrimaryWorkout)) {
      setPendingDefinitionId(definitionDayId);
      return;
    }
    start.mutate(definitionDayId);
  };

  if (!isLoading && definitions.length === 0) return null;

  const prompt = hasPrimaryWorkout
    ? { eyebrow: "Can't make it to the gym?", action: "Use At-Home Backup" }
    : { eyebrow: "Want to train anyway?", action: "Choose At-Home Workout" };

  return (
    <>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-dashed bg-muted/25 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{prompt.eyebrow}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold">
            <Home className="h-3.5 w-3.5 text-muted-foreground" />
            <span>At-Home Backup</span>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={readonly || isLoading}
          onClick={() => setOpen(true)}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{prompt.action}<span aria-hidden> ›</span></>}
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto px-4 pb-6 sm:mx-auto sm:max-w-xl sm:rounded-t-xl">
          <div className="flex items-start gap-3 pr-9">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-0.5 h-8 shrink-0 px-2"
              onClick={() => setOpen(false)}
            >
              <ChevronLeft className="mr-0.5 h-4 w-4" /> Back
            </Button>
            <SheetHeader className="min-w-0 pt-0.5 text-left">
              <SheetTitle>At-Home Backup</SheetTitle>
              <SheetDescription>Choose a workout for today.</SheetDescription>
            </SheetHeader>
          </div>
          <div className="mt-4 space-y-2 pb-2">
            {definitions.map((def: any) => (
              <div key={def.dayId} className="rounded-lg border bg-card px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{def.title.replace(/^At-Home Backup\s*[·—-]?\s*/i, "")}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{def.summary}</div>
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0"
                    disabled={readonly || start.isPending}
                    onClick={() => requestStart(def.dayId)}
                  >
                    {start.isPending && start.variables === def.dayId ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 h-4 w-4" />
                    )}
                    Start
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog open={pendingDefinitionId !== null} onOpenChange={(next) => !next && setPendingDefinitionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{AT_HOME_BACKUP_CONFIRM_TITLE}</AlertDialogTitle>
            <AlertDialogDescription>{AT_HOME_BACKUP_CONFIRM_BODY}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={start.isPending}>{AT_HOME_BACKUP_CONFIRM_CANCEL}</AlertDialogCancel>
            <AlertDialogAction
              disabled={start.isPending || !pendingDefinitionId}
              onClick={(event) => {
                event.preventDefault();
                if (pendingDefinitionId) start.mutate(pendingDefinitionId);
                setPendingDefinitionId(null);
              }}
            >
              {AT_HOME_BACKUP_CONFIRM_ACCEPT}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
