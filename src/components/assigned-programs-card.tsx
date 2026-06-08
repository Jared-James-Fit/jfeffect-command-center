import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dumbbell, Target, ChevronRight, Layers, ArrowRight, Trash2 } from "lucide-react";
import { listClientPreps, listClientBlocks, countdownLabel, deletePrep, deleteBlock } from "@/lib/pl-programs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type Mode = "admin" | "client";

/**
 * Surfaces the training programs (preps + blocks) currently assigned to a
 * client. Used on the admin client profile (Training tab) and on the client
 * portal's program page so coaches and clients can immediately see what's
 * been assigned from the Program Library.
 */
export function AssignedProgramsCard({ clientId, mode }: { clientId: string; mode: Mode }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<{ kind: "prep" | "block"; id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["assigned-preps", clientId] });
    qc.invalidateQueries({ queryKey: ["assigned-blocks", clientId] });
    qc.invalidateQueries({ queryKey: ["pl-preps", clientId] });
    qc.invalidateQueries({ queryKey: ["pl-blocks", clientId] });
    qc.invalidateQueries({ queryKey: ["my-workouts"] });
  };

  const confirmRemove = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "prep") await deletePrep(pending.id);
      else await deleteBlock(pending.id);
      toast.success(`Removed "${pending.label}"`);
      setPending(null);
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't remove");
    } finally {
      setBusy(false);
    }
  };

  const { data: preps = [] } = useQuery({
    queryKey: ["assigned-preps", clientId],
    queryFn: () => listClientPreps(clientId),
  });
  const { data: blocks = [] } = useQuery({
    queryKey: ["assigned-blocks", clientId],
    queryFn: () => listClientBlocks(clientId),
  });

  const visibleBlocks = (blocks as any[]).filter(
    (b) => b.status !== "Archived" && (mode === "admin" || b.client_visible !== false),
  );
  const visiblePreps = (preps as any[]).filter(
    (p) => p.status !== "Archived" && (mode === "admin" || p.client_visible !== false),
  );

  if (visibleBlocks.length === 0 && visiblePreps.length === 0) {
    return (
      <Card className="border-border bg-card p-6 space-y-3 md:col-span-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Assigned Training Programs</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {mode === "admin"
                ? "No programs assigned yet. Assign a template from the Program Library or create a block."
                : "Your coach hasn't assigned a training program yet."}
            </p>
          </div>
          {mode === "admin" && (
            <div className="flex gap-2">
              <Link to="/admin/program-library"><Button size="sm" variant="outline"><Layers className="mr-1 h-4 w-4" /> Program Library</Button></Link>
              <Link to="/admin/client-programs/$clientId" params={{ clientId }}><Button size="sm"><Dumbbell className="mr-1 h-4 w-4" /> Open Programs</Button></Link>
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <>
    <Card className="border-border bg-card p-6 space-y-4 md:col-span-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Assigned Training Programs</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {mode === "admin"
              ? "Programs and blocks currently assigned to this client."
              : "Tap a block to view its weeks and workouts."}
          </p>
        </div>
        {mode === "admin" ? (
          <Link to="/admin/client-programs/$clientId" params={{ clientId }}>
            <Button size="sm" variant="outline"><Dumbbell className="mr-1 h-4 w-4" /> Manage Programs</Button>
          </Link>
        ) : (
          <Link to="/portal/workouts">
            <Button size="sm" variant="outline">Open Workouts <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </Link>
        )}
      </div>

      {visiblePreps.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Preps / Phases</div>
          <div className="grid gap-2 md:grid-cols-2">
            {visiblePreps.map((p: any) => {
              const cd = countdownLabel(p.event_date);
              const prepBlocks = visibleBlocks.filter((b: any) => b.prep_id === p.id);
              return (
                <div key={p.id} className="rounded-md border border-border bg-secondary/30 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-primary" />
                        <div className="font-bold truncate">{p.title}</div>
                      </div>
                      {p.goal_type && <div className="text-xs text-muted-foreground">{p.goal_type}</div>}
                      {p.event_name && (
                        <div className="mt-1 text-xs">
                          {p.event_name}
                          {p.event_date && <span className="text-muted-foreground"> · {p.event_date}</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                      {cd && <Badge variant="secondary" className="text-[10px]">{cd}</Badge>}
                      {mode === "admin" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:bg-destructive/10"
                          onClick={() => setPending({ kind: "prep", id: p.id, label: p.title })}
                          title="Remove prep (also detaches its blocks)"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {prepBlocks.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {prepBlocks.map((b: any) => (
                        <BlockRow key={b.id} block={b} mode={mode} onRemove={() => setPending({ kind: "block", id: b.id, label: b.name })} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {visibleBlocks.filter((b: any) => !b.prep_id).length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Standalone Blocks</div>
          <div className="grid gap-2">
            {visibleBlocks.filter((b: any) => !b.prep_id).map((b: any) => (
              <BlockRow key={b.id} block={b} mode={mode} onRemove={() => setPending({ kind: "block", id: b.id, label: b.name })} />
            ))}
          </div>
        </div>
      )}
    </Card>

    <AlertDialog open={!!pending} onOpenChange={(o) => !o && !busy && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove "{pending?.label}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.kind === "prep"
              ? "This deletes the prep. Any blocks inside it are detached but kept (they become standalone)."
              : "This permanently deletes the block, its weeks, days, exercise rows, and any client completions. This cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); void confirmRemove(); }}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Removing…" : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function BlockRow({ block, mode, onRemove }: { block: any; mode: Mode; onRemove?: () => void }) {
  const inner = (
    <div className="flex flex-1 items-center justify-between rounded border border-border bg-card p-2.5 hover:bg-secondary/40 transition">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Dumbbell className="h-3.5 w-3.5 text-primary shrink-0" />
          <div className="font-semibold text-sm truncate">{block.name}</div>
          <Badge variant="outline" className="text-[10px]">{block.status}</Badge>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {block.weeks ?? 0} weeks{block.training_focus ? ` · ${block.training_focus}` : ""}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </div>
  );
  const link =
    mode === "admin" ? (
      <Link to="/admin/blocks/$blockId" params={{ blockId: block.id }} className="flex-1 min-w-0">
        {inner}
      </Link>
    ) : (
      <Link to="/portal/workouts" className="flex-1 min-w-0">
        {inner}
      </Link>
    );
  if (mode !== "admin" || !onRemove) return link;
  return (
    <div className="flex items-stretch gap-1">
      {link}
      <Button
        variant="ghost"
        size="icon"
        className="h-auto w-9 text-destructive hover:bg-destructive/10"
        onClick={onRemove}
        title="Remove block"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}