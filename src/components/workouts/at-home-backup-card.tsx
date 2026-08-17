import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Home, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { toLocalISO, localStartOfToday } from "@/lib/today";
import {
  listAtHomeBackupDefinitions,
  startAtHomeBackupSession,
} from "@/lib/at-home-backup.functions";
import { AT_HOME_BACKUP_BADGE } from "@/lib/at-home-backup";

/**
 * Client-facing entry point for the At-Home Backup workouts.
 * Additive: renders nothing when the client has no definitions configured.
 */
export function AtHomeBackupCard({
  clientId,
  readonly = false,
  hasPrimaryWorkoutToday = false,
}: {
  clientId: string;
  readonly?: boolean;
  /** A backup never replaces this workout; it only controls the confirmation copy. */
  hasPrimaryWorkoutToday?: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pendingDefinitionId, setPendingDefinitionId] = useState<string | null>(null);

  const fetchDefinitions = useServerFn(listAtHomeBackupDefinitions);
  const startSession = useServerFn(startAtHomeBackupSession);

  const { data, isLoading } = useQuery({
    queryKey: ["at-home-backup-definitions", clientId],
    staleTime: 5 * 60_000,
    queryFn: () => fetchDefinitions({ data: { clientId } }),
  });
  const definitions = data?.definitions ?? [];

  const start = useMutation({
    mutationFn: (definitionDayId: string) =>
      startSession({
        data: { clientId, definitionDayId, date: toLocalISO(localStartOfToday()) },
      }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["my-workouts", clientId] });
      qc.invalidateQueries({ queryKey: ["at-home-backup-sessions", clientId] });
      setOpen(false);
      navigate({
        to: "/portal/workouts/$dayId",
        params: { dayId: res.dayId },
        search: res.scheduledWorkoutId ? ({ instance: res.scheduledWorkoutId } as any) : ({} as any),
      });
    },
    onError: (e: any) => toast.error(e?.message || "Could not start the backup workout"),
  });

  const requestStart = (definitionDayId: string) => {
    if (hasPrimaryWorkoutToday) {
      setPendingDefinitionId(definitionDayId);
      return;
    }
    start.mutate(definitionDayId);
  };

  if (!isLoading && definitions.length === 0) return null;

  return (
    <>
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-muted-foreground">Can't make it to the gym?</div>
            <div className="mt-1 flex items-center gap-2">
              <Home className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-bold">At-Home Backup</span>
              <Badge variant="outline" className="text-[10px]">Optional</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Use a simple dumbbell workout instead.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={readonly || isLoading}
            onClick={() => setOpen(true)}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Choose Workout"}
          </Button>
        </div>
      </Card>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto">
          <SheetHeader className="pl-0 text-left">
            <SheetTitle>At-Home Backup</SheetTitle>
            <SheetDescription>Choose a full-body backup session for today.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3 pb-8">
            {definitions.map((def: any) => (
              <Card key={def.dayId} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-bold">{def.title}</div>
                    <div className="text-xs text-muted-foreground">{def.summary}</div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {AT_HOME_BACKUP_BADGE}
                  </Badge>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {def.exercises.map((ex: any) => (
                    <li key={ex.id} className="flex items-baseline justify-between gap-3">
                      <span className="truncate">{ex.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {ex.sets ? `${ex.sets} × ` : ""}
                        {ex.reps ?? (ex.durationSeconds ? `${ex.durationSeconds}s` : "")}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-3 w-full"
                  disabled={readonly || start.isPending}
                  onClick={() => requestStart(def.dayId)}
                >
                  {start.isPending && start.variables === def.dayId ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  Start
                </Button>
              </Card>
            ))}
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog open={pendingDefinitionId !== null} onOpenChange={(next) => !next && setPendingDefinitionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use this as today's backup?</AlertDialogTitle>
            <AlertDialogDescription>Your scheduled gym workout will stay on your program.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={start.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={start.isPending || !pendingDefinitionId}
              onClick={(event) => {
                event.preventDefault();
                if (pendingDefinitionId) start.mutate(pendingDefinitionId);
                setPendingDefinitionId(null);
              }}
            >
              Use Backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}