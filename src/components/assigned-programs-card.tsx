import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dumbbell, Target, ChevronRight, Layers, ArrowRight, Trash2 } from "lucide-react";
import { listClientPreps, listClientBlocks, countdownLabel, deletePrep, deleteBlock } from "@/lib/pl-programs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { BlockSummaryCard } from "@/components/block-summary-card";
import { WorkoutArchiveSection } from "@/components/workout-archive-section";
import { BlockProgressSection } from "@/components/block-progress-section";

type Mode = "admin" | "client";

/** Tone classes for a program/block status badge. */
function statusTone(status?: string | null): string {
  switch (status) {
    case "Active":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
    case "Completed":
      return "border-sky-500/40 bg-sky-500/10 text-sky-500";
    case "Planned":
      return "border-amber-500/40 bg-amber-500/10 text-amber-500";
    case "Draft":
      return "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
    case "Archived":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    default:
      return "";
  }
}

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
  const [selectedPreps, setSelectedPreps] = useState<Set<string>>(new Set());
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const togglePrep = (id: string) =>
    setSelectedPreps((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleBlock = (id: string) =>
    setSelectedBlocks((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSelection = () => { setSelectedPreps(new Set()); setSelectedBlocks(new Set()); };

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

  const confirmBulkRemove = async () => {
    setBusy(true);
    let ok = 0, fail = 0;
    try {
      for (const id of selectedBlocks) {
        try { await deleteBlock(id); ok++; } catch { fail++; }
      }
      for (const id of selectedPreps) {
        try { await deletePrep(id); ok++; } catch { fail++; }
      }
      if (ok) toast.success(`Removed ${ok} item${ok === 1 ? "" : "s"}`);
      if (fail) toast.error(`${fail} failed to remove`);
      clearSelection();
      setBulkConfirm(false);
      invalidate();
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

  const allIds = [...visiblePreps.map((p: any) => `p:${p.id}`), ...visibleBlocks.map((b: any) => `b:${b.id}`)];
  const selectedCount = selectedPreps.size + selectedBlocks.size;
  const allSelected = allIds.length > 0 && selectedCount === allIds.length;
  const toggleAll = () => {
    if (allSelected) clearSelection();
    else {
      setSelectedPreps(new Set(visiblePreps.map((p: any) => p.id)));
      setSelectedBlocks(new Set(visibleBlocks.map((b: any) => b.id)));
    }
  };

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
        <WorkoutArchiveSection clientId={clientId} mode={mode} />
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
          <div className="flex flex-wrap items-center gap-2">
            {allIds.length > 0 && (
              <Button size="sm" variant="outline" onClick={toggleAll}>
                <Checkbox checked={allSelected} className="mr-2 pointer-events-none" />
                {allSelected ? "Clear all" : "Select all"}
              </Button>
            )}
            {selectedCount > 0 && (
              <Button size="sm" variant="destructive" onClick={() => setBulkConfirm(true)}>
                <Trash2 className="mr-1 h-4 w-4" /> Remove ({selectedCount})
              </Button>
            )}
            <Link to="/admin/client-programs/$clientId" params={{ clientId }}>
              <Button size="sm" variant="outline"><Dumbbell className="mr-1 h-4 w-4" /> Manage Programs</Button>
            </Link>
          </div>
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
                    <div className="min-w-0 flex items-start gap-2">
                      {mode === "admin" && (
                        <Checkbox
                          checked={selectedPreps.has(p.id)}
                          onCheckedChange={() => togglePrep(p.id)}
                          className="mt-1"
                        />
                      )}
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
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline" className={`text-[10px] ${statusTone(p.status)}`}>{p.status ?? "—"}</Badge>
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
                    <div className="mt-2 space-y-2">
                      {prepBlocks.map((b: any) => (
                        <div key={b.id} className="space-y-2">
                          <BlockSummaryCard
                            blockId={b.id}
                            mode={mode}
                            onRemove={() => setPending({ kind: "block", id: b.id, label: b.name })}
                          />
                          {mode === "admin" && <BlockProgressSection blockId={b.id} mode={mode} />}
                        </div>
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
          <div className="grid gap-3">
            {visibleBlocks.filter((b: any) => !b.prep_id).map((b: any) => (
              <div key={b.id} className="space-y-2">
                <BlockSummaryCard
                  blockId={b.id}
                  mode={mode}
                  onRemove={() => setPending({ kind: "block", id: b.id, label: b.name })}
                />
                {mode === "admin" && <BlockProgressSection blockId={b.id} mode={mode} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>

    <WorkoutArchiveSection clientId={clientId} mode={mode} />

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

    <AlertDialog open={bulkConfirm} onOpenChange={(o) => !o && !busy && setBulkConfirm(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {selectedCount} item{selectedCount === 1 ? "" : "s"}?</AlertDialogTitle>
          <AlertDialogDescription>
            Blocks will be permanently deleted along with their weeks, days, exercise rows, and any client completions.
            Preps will be removed; any blocks inside them that weren't selected become standalone. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); void confirmBulkRemove(); }}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Removing…" : `Remove ${selectedCount}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function BlockRow({
  block, mode, onRemove, selected, onToggleSelect,
}: { block: any; mode: Mode; onRemove?: () => void; selected?: boolean; onToggleSelect?: () => void }) {
  const inner = (
    <div className="flex flex-1 items-center justify-between rounded border border-border bg-card p-2.5 hover:bg-secondary/40 transition">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Dumbbell className="h-3.5 w-3.5 text-primary shrink-0" />
          <div className="font-semibold text-sm truncate">{block.name}</div>
          <Badge variant="outline" className={`text-[10px] ${statusTone(block.status)}`}>{block.status ?? "—"}</Badge>
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
      {onToggleSelect && (
        <div className="flex items-center px-1">
          <Checkbox checked={!!selected} onCheckedChange={onToggleSelect} />
        </div>
      )}
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