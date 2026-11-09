import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteProgram, programDeleteFacts } from "@/lib/pl-programs";
import { deleteProgramCopy } from "@/lib/program-delete";
import { todayISO, type ScheduleBlock } from "@/lib/block-schedule-model";

/**
 * Delete a program from the client's Training tab. Says what will happen before the tap:
 * deleted (with what's in it and whether it's on their calendar), or archived when anything in
 * it is logged, so their history is never wiped.
 */
export function DeleteProgramDialog({
  block, firstName, open, onOpenChange, onDone,
}: {
  block: ScheduleBlock;
  firstName: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const facts = useQuery({ queryKey: ["program-delete-facts", block.id], queryFn: () => programDeleteFacts(block.id), enabled: open, staleTime: 0 });
  const copy = facts.data
    ? deleteProgramCopy({
        name: block.name ?? null,
        firstName,
        weeks: block.weeks ?? null,
        workouts: facts.data.workouts,
        logged: facts.data.logged,
        archived: block.status_derived === "Archived" || !!block.archived,
        start: block.effective_start,
        end: block.effective_end,
        today: todayISO(),
      })
    : null;

  const run = async () => {
    setBusy(true);
    try {
      const outcome = await deleteProgram(block.id);
      const name = block.name ?? "Program";
      if (outcome === "archived") toast.success(`Archived "${name}"`, { description: "It has logged workouts, so their history stays." });
      else toast.success(`Deleted "${name}"`);
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't delete the program");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <AlertDialogContent data-delete-program>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy?.title ?? `Delete "${block.name ?? "this program"}"?`}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {facts.isLoading ? (
                <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Checking what's in it…</div>
              ) : facts.error ? (
                <p>Couldn't check what's in it. Anything logged is never deleted: a program with logged workouts is archived instead.</p>
              ) : (
                copy?.lines.map((l) => <p key={l}>{l}</p>)
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="min-h-[44px]">{copy?.outcome === "none" ? "Close" : "Cancel"}</AlertDialogCancel>
          {copy?.outcome !== "none" && (
            <Button
              variant="destructive"
              className="min-h-[44px]"
              disabled={busy || facts.isLoading}
              onClick={run}
              data-confirm-delete-program
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {copy?.action ?? "Delete program"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
