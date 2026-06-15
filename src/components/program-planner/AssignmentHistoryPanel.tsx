/**
 * Lists planner assignment batches for a client with safe undo.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listAssignmentBatchesFn, undoAssignmentBatchFn } from "@/lib/program-planner/planner.functions";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";

export function AssignmentHistoryPanel({ clientId }: { clientId: string }) {
  const list = useServerFn(listAssignmentBatchesFn);
  const undo = useServerFn(undoAssignmentBatchFn);
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["planner-history", clientId],
    queryFn: () => list({ data: { clientId } }),
  });

  const doUndo = async (id: string, force = false) => {
    try {
      await undo({ data: { batchId: id, force } });
      toast.success("Assignment undone");
      qc.invalidateQueries({ queryKey: ["planner-history", clientId] });
      qc.invalidateQueries({ queryKey: ["pl-blocks", clientId] });
      qc.invalidateQueries({ queryKey: ["assigned-blocks", clientId] });
    } catch (e: any) {
      if (String(e?.message ?? "").includes("force")) {
        if (confirm("Client has logged results from this assignment. Undo anyway?")) doUndo(id, true);
      } else {
        toast.error(e?.message ?? "Undo failed");
      }
    }
  };

  if (!rows || !(rows as any[]).length) {
    return <Card className="p-4 text-sm text-muted-foreground">No planner assignments yet.</Card>;
  }

  return (
    <Card className="p-3 space-y-2">
      <div className="text-sm font-semibold">Assignment history</div>
      <ul className="space-y-1">
        {(rows as any[]).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded border border-border bg-secondary/20 p-2 text-xs">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{r.pl_templates?.name ?? "Template"}</div>
              <div className="text-muted-foreground">
                {new Date(r.created_at).toLocaleString()} · {r.assignment_method ?? r.mode} ·
                <Badge variant="outline" className="ml-1">{r.publish_status}</Badge>
                {r.undone_at && <Badge variant="destructive" className="ml-1">undone</Badge>}
              </div>
              <div className="text-[10px] text-muted-foreground">
                +{r.workouts_added ?? 0} added · {r.workouts_replaced ?? 0} replaced · {r.workouts_skipped ?? 0} skipped · {r.workouts_moved ?? 0} moved
              </div>
            </div>
            {!r.undone_at && (r.created_block_ids?.length ?? 0) > 0 && (
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => doUndo(r.id)}>
                <Undo2 className="mr-1 h-3 w-3" />Undo
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}