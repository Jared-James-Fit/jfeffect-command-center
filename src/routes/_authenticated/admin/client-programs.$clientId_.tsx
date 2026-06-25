import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ArrowLeft, Plus, Calendar, Target, Layers, History, BarChart3, BookOpen, CalendarClock, Wand2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { listClientPreps, listClientBlocks, createPrep, createBlock, countdownLabel, updatePrep, updateBlock, deleteBlock, deletePrep, GOAL_TYPES, PREP_STATUSES, BLOCK_STATUSES, type PrepStatus, type BlockStatus } from "@/lib/pl-programs";
import { useAuth } from "@/lib/auth";
import { BLOCK_PHASE_OPTIONS } from "@/lib/pl-template-blocks";
import { ClientTrainingIntelCard } from "@/components/client-training-intel-card";
import { AssignmentHistoryPanel } from "@/components/program-planner/AssignmentHistoryPanel";

export const Route = createFileRoute("/_authenticated/admin/client-programs/$clientId_")({ component: ClientProgramsPage });

function ClientProgramsPage() {
  const { clientId } = Route.useParams();
  const qc = useQueryClient();
  const [prepOpen, setPrepOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  const { data: client } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => (await supabase.from("clients").select("id, full_name").eq("id", clientId).maybeSingle()).data,
  });
  const { data: preps = [] } = useQuery({ queryKey: ["pl-preps", clientId], queryFn: () => listClientPreps(clientId) });
  const { data: blocks = [] } = useQuery({ queryKey: ["pl-blocks", clientId], queryFn: () => listClientBlocks(clientId) });

  const templateIds = Array.from(new Set([
    ...(preps as any[]).map((p) => p.source_template_id).filter(Boolean),
    ...(blocks as any[]).map((b) => b.source_template_id).filter(Boolean),
  ])) as string[];
  const { data: templateLookup = {} } = useQuery({
    queryKey: ["pl-templates-by-id", templateIds.sort().join(",")],
    enabled: templateIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any).from("pl_templates").select("id, name").in("id", templateIds);
      const map: Record<string, { id: string; name: string }> = {};
      for (const t of (data ?? []) as any[]) map[t.id] = t;
      return map;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pl-preps", clientId] });
    qc.invalidateQueries({ queryKey: ["pl-blocks", clientId] });
    // Programming library panels read from these — keep them in sync after edits/deletions.
    qc.invalidateQueries({ queryKey: ["pl-template-assignments"] });
    qc.invalidateQueries({ queryKey: ["admin-finder-assignments"] });
  };

  return (
    <>
      <PageHeader
        backTo="/admin/clients"
        backLabel={client?.full_name ? `Back to ${client.full_name}` : "Back to Clients"}
        breadcrumbs={[
          { label: "Clients", to: "/admin/clients" },
          ...(client?.full_name ? [{ label: client.full_name, to: `/admin/clients/${clientId}` }] : []),
          { label: "Training Program" },
        ]}
        title="Training Program"
        subtitle={client?.full_name ?? ""}
      />
      <div className="p-6 md:p-8 space-y-6">
        <Link to="/admin/clients/$id" params={{ id: clientId }} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to client
        </Link>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPrepOpen(true)}><Target className="mr-2 h-4 w-4" /> New Prep / Phase</Button>
          <Button onClick={() => setBlockOpen(true)} variant="outline"><Layers className="mr-2 h-4 w-4" /> New Block</Button>
          <Link to="/admin/program-assign/$clientId" params={{ clientId }}>
            <Button variant="default"><Wand2 className="mr-2 h-4 w-4" /> Assign from Library</Button>
          </Link>
          <Link to="/admin/client-programs/$clientId/history" params={{ clientId }}>
            <Button variant="outline"><History className="mr-2 h-4 w-4" /> History</Button>
          </Link>
          <Link to="/admin/client-programs/$clientId/analytics" params={{ clientId }}>
            <Button variant="outline"><BarChart3 className="mr-2 h-4 w-4" /> Analytics & PRs</Button>
          </Link>
        </div>

        <ClientTrainingIntelCard clientId={clientId} />

        <PrepsSection
          preps={preps as any[]}
          blocks={blocks as any[]}
          templateLookup={templateLookup as any}
          onRefresh={refresh}
        />

        <section>
          <BlocksSection
            blocks={blocks as any[]}
            templateLookup={templateLookup as any}
            onRefresh={refresh}
          />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">Recent Assignments</h2>
          <AssignmentHistoryPanel clientId={clientId} />
        </section>
      </div>

      <NewPrepDialog open={prepOpen} onOpenChange={setPrepOpen} clientId={clientId} onCreated={refresh} />
      <NewBlockDialog open={blockOpen} onOpenChange={setBlockOpen} clientId={clientId} preps={preps as any[]} onCreated={refresh} />
    </>
  );
}

function BlocksSection({ blocks, templateLookup, onRefresh }: { blocks: any[]; templateLookup: any; onRefresh: () => void }) {
  // (component continues below)
  return _BlocksSectionImpl({ blocks, templateLookup, onRefresh });
}

function PrepsSection({
  preps,
  blocks,
  templateLookup,
  onRefresh,
}: {
  preps: any[];
  blocks: any[];
  templateLookup: any;
  onRefresh: () => void;
}) {
  const { role } = useAuth();
  const canDelete = role === "admin" || role === "coach";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmSelected, setConfirmSelected] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const ids = useMemo(() => preps.map((p) => p.id), [preps]);
  const archivedIds = useMemo(
    () => preps.filter((p) => p.status === "Archived" || p.status === "Completed").map((p) => p.id),
    [preps],
  );
  const allChecked = ids.length > 0 && ids.every((id) => selected.has(id));
  const someChecked = !allChecked && ids.some((id) => selected.has(id));

  const toggleAll = (next: boolean) => setSelected(next ? new Set(ids) : new Set());
  const toggleOne = (id: string, next: boolean) => {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id); else copy.delete(id);
      return copy;
    });
  };

  const runDelete = async (targetIds: string[]) => {
    if (targetIds.length === 0) return;
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of targetIds) {
      try {
        // Cascade: delete every block tied to this prep, then the prep.
        const linked = blocks.filter((b) => b.prep_id === id).map((b) => b.id);
        for (const bid of linked) {
          try { await deleteBlock(bid); } catch (e) { console.error("deleteBlock failed", bid, e); }
        }
        await deletePrep(id);
        ok++;
      } catch (e: any) {
        fail++;
        console.error("deletePrep failed", id, e);
      }
    }
    setBusy(false);
    setSelected(new Set());
    setConfirmSelected(false);
    setConfirmWipe(false);
    if (ok > 0) toast.success(`Deleted ${ok} prep${ok === 1 ? "" : "s"}`);
    if (fail > 0) toast.error(`Failed to delete ${fail} prep${fail === 1 ? "" : "s"}`);
    onRefresh();
  };

  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">Preps / Phases</h2>
      {preps.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No preps yet.</Card>
      ) : (
        <>
          {canDelete && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
              <Checkbox
                id="select-all-preps"
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                onCheckedChange={(v) => toggleAll(v === true)}
                aria-label="Select all preps"
              />
              <label htmlFor="select-all-preps" className="cursor-pointer text-xs font-medium text-muted-foreground">
                Select all
              </label>
              <span className="text-xs text-muted-foreground">
                {selected.size > 0 ? `${selected.size} selected` : `${ids.length} total`}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                {selected.size > 0 && (
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmSelected(true)}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete selected ({selected.size})
                  </Button>
                )}
                {archivedIds.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmWipe(true)}
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete all archived / completed ({archivedIds.length})
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {preps.map((p) => {
              const cd = countdownLabel(p.event_date);
              const blocksInPrep = blocks.filter((b) => b.prep_id === p.id);
              const isSelected = selected.has(p.id);
              return (
                <Card key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      {canDelete && (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(v) => toggleOne(p.id, v === true)}
                          aria-label={`Select ${p.title}`}
                          className="mt-1"
                        />
                      )}
                      <div>
                        <div className="font-bold text-lg">{p.title}</div>
                        <div className="text-xs text-muted-foreground">{p.goal_type}</div>
                        {p.source_template_id && (templateLookup as any)[p.source_template_id] && (
                          <Link
                            to="/admin/program-library/$templateId"
                            params={{ templateId: p.source_template_id }}
                            className="mt-1 inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                          >
                            <BookOpen className="h-2.5 w-2.5" /> From template: {(templateLookup as any)[p.source_template_id].name}
                          </Link>
                        )}
                      </div>
                    </div>
                    <Select value={p.status} onValueChange={async (v) => { await updatePrep(p.id, { status: v as PrepStatus }); onRefresh(); toast.success(`Status: ${v}`); }}>
                      <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{PREP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {p.event_name && (
                    <div className="mt-2 text-sm">
                      <Calendar className="mr-1 inline h-3 w-3" />{p.event_name}
                      {p.event_date && <span className="text-muted-foreground"> · {p.event_date}</span>}
                      {cd && <Badge className="ml-2" variant="secondary">{cd}</Badge>}
                    </div>
                  )}
                  {p.total_weeks && (
                    <div className="mt-1 text-xs text-muted-foreground">{p.total_weeks} weeks total · {blocksInPrep.length} block(s) programmed</div>
                  )}
                  <div className="mt-3 space-y-1">
                    {blocksInPrep.map((b) => (
                      <Link key={b.id} to="/admin/blocks/$blockId" params={{ blockId: b.id }} className="block rounded border border-border bg-secondary/30 p-2 text-sm hover:bg-secondary/50">
                        <span className="font-semibold">{b.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{b.weeks}w · {b.training_focus ?? "—"}</span>
                      </Link>
                    ))}
                    {blocksInPrep.length === 0 && <p className="text-xs italic text-muted-foreground">No blocks programmed yet.</p>}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <AlertDialog open={confirmSelected} onOpenChange={(v) => !busy && setConfirmSelected(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} prep{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected preps/phases AND every block, week, day, exercise, and logged result inside them. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); runDelete(Array.from(selected)); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmWipe} onOpenChange={(v) => !busy && setConfirmWipe(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ALL archived / completed preps?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes every prep marked Archived or Completed for this client — including all blocks, weeks, days, exercises, and logged results. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); runDelete(archivedIds); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : `Delete ${archivedIds.length} permanently`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function _BlocksSectionImpl({ blocks, templateLookup, onRefresh }: { blocks: any[]; templateLookup: any; onRefresh: () => void }) {
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const isPrevious = (b: any) => {
    if (b.status === "Completed" || b.status === "Archived") return true;
    if (b.end_date && new Date(b.end_date) < today) return true;
    return false;
  };
  const isUpcoming = (b: any) =>
    !isPrevious(b) && !!b.start_date && b.start_date > todayISO;
  const upcoming = blocks
    .filter(isUpcoming)
    .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""));
  const current = blocks.filter((b) => !isPrevious(b) && !isUpcoming(b));
  const previous = blocks.filter(isPrevious);

  if (blocks.length === 0) {
    return <Card className="p-6 text-sm text-muted-foreground">No blocks yet.</Card>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">Current Blocks</h2>
        {current.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No active blocks.</Card>
        ) : (
          <BlockGroup blocks={current} templateLookup={templateLookup} onRefresh={onRefresh} groupKey="current" />
        )}
      </div>
      {upcoming.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" /> Upcoming Blocks ({upcoming.length})
          </h2>
          <BlockGroup
            blocks={upcoming}
            templateLookup={templateLookup}
            onRefresh={onRefresh}
            groupKey="upcoming"
            rowBadge={(b) => {
              const daysUntil = Math.max(
                0,
                Math.ceil((new Date(b.start_date + "T00:00:00").getTime() - today.getTime()) / 86400000),
              );
              return `Starts in ${daysUntil}d`;
            }}
          />
        </div>
      )}
      {previous.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Previous Blocks
          </h2>
          <BlockGroup
            blocks={previous}
            templateLookup={templateLookup}
            onRefresh={onRefresh}
            groupKey="previous"
            includeWipeAll
          />
        </div>
      )}
    </div>
  );
}

function BlockGroup({
  blocks,
  templateLookup,
  onRefresh,
  groupKey,
  rowBadge,
  includeWipeAll,
}: {
  blocks: any[];
  templateLookup: any;
  onRefresh: () => void;
  groupKey: string;
  rowBadge?: (b: any) => string | null;
  includeWipeAll?: boolean;
}) {
  const { role } = useAuth();
  const canDelete = role === "admin" || role === "coach";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmSelected, setConfirmSelected] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const ids = useMemo(() => blocks.map((b) => b.id), [blocks]);
  const allChecked = ids.length > 0 && ids.every((id) => selected.has(id));
  const someChecked = !allChecked && ids.some((id) => selected.has(id));

  const toggleAll = (next: boolean) => {
    setSelected(next ? new Set(ids) : new Set());
  };
  const toggleOne = (id: string, next: boolean) => {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id); else copy.delete(id);
      return copy;
    });
  };

  const runDelete = async (targetIds: string[]) => {
    if (targetIds.length === 0) return;
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of targetIds) {
      try {
        await deleteBlock(id);
        ok++;
      } catch (e: any) {
        fail++;
        console.error("deleteBlock failed", id, e);
      }
    }
    setBusy(false);
    setSelected(new Set());
    setConfirmSelected(false);
    setConfirmWipe(false);
    if (ok > 0) toast.success(`Deleted ${ok} workout${ok === 1 ? "" : "s"}`);
    if (fail > 0) toast.error(`Failed to delete ${fail} workout${fail === 1 ? "" : "s"}`);
    onRefresh();
  };

  return (
    <div>
      {canDelete && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
          <Checkbox
            id={`select-all-${groupKey}`}
            checked={allChecked ? true : someChecked ? "indeterminate" : false}
            onCheckedChange={(v) => toggleAll(v === true)}
            aria-label="Select all workouts in this group"
          />
          <label htmlFor={`select-all-${groupKey}`} className="cursor-pointer text-xs font-medium text-muted-foreground">
            Select all
          </label>
          <span className="text-xs text-muted-foreground">
            {selected.size > 0 ? `${selected.size} selected` : `${ids.length} total`}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {selected.size > 0 && (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => setConfirmSelected(true)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete selected ({selected.size})
              </Button>
            )}
            {includeWipeAll && ids.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmWipe(true)}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete all previous / archived ({ids.length})
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="grid gap-2">
        {blocks.map((b) => {
          const badge = rowBadge?.(b) ?? null;
          return (
            <BlockRow
              key={b.id}
              b={b}
              templateLookup={templateLookup}
              onRefresh={onRefresh}
              selectable={canDelete}
              checked={selected.has(b.id)}
              onCheckedChange={(v) => toggleOne(b.id, v)}
              cornerBadge={badge}
            />
          );
        })}
      </div>

      <AlertDialog open={confirmSelected} onOpenChange={(v) => !busy && setConfirmSelected(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} workout{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected training blocks along with their weeks, days, exercises, and any logged results. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); runDelete(Array.from(selected)); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmWipe} onOpenChange={(v) => !busy && setConfirmWipe(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ALL previous / archived workouts?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes every completed, archived, or past-dated training block for this client — including weeks, days, exercises, and logged results. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); runDelete(ids); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : `Delete ${ids.length} permanently`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BlockRow({
  b,
  templateLookup,
  onRefresh,
  selectable,
  checked,
  onCheckedChange,
  cornerBadge,
}: {
  b: any;
  templateLookup: any;
  onRefresh: () => void;
  selectable?: boolean;
  checked?: boolean;
  onCheckedChange?: (v: boolean) => void;
  cornerBadge?: string | null;
}) {
  return (
    <Card className="relative p-3 flex items-center gap-3 hover:bg-secondary/30">
      {selectable && (
        <Checkbox
          checked={!!checked}
          onCheckedChange={(v) => onCheckedChange?.(v === true)}
          aria-label={`Select ${b.name}`}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <Link to="/admin/blocks/$blockId" params={{ blockId: b.id }} className="flex-1">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold">{b.name}</span>
            {b.training_focus && (
              <Badge variant="secondary" className="text-[10px] bg-primary/15 text-primary border-primary/30">
                {b.training_focus}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {b.weeks} weeks · {b.training_focus ?? "—"}
            {b.start_date && ` · ${b.start_date}`}{b.end_date && ` – ${b.end_date}`}
          </div>
          {b.source_template_id && templateLookup[b.source_template_id] && (
            <div className="mt-1 inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary">
              <BookOpen className="h-2.5 w-2.5" /> From template: {templateLookup[b.source_template_id].name}
            </div>
          )}
        </div>
      </Link>
      {cornerBadge && (
        <Badge variant="secondary" className="text-[10px]">{cornerBadge}</Badge>
      )}
      <Select value={b.status} onValueChange={async (v) => { await updateBlock(b.id, { status: v as BlockStatus }); onRefresh(); toast.success(`Status: ${v}`); }}>
        <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{BLOCK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
      </Select>
    </Card>
  );
}

function NewPrepDialog({ open, onOpenChange, clientId, onCreated }: any) {
  const [form, setForm] = useState({ title: "", goal_type: "Powerlifting Competition", event_name: "", event_date: "", total_weeks: 12, status: "Active" as PrepStatus });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Prep / Phase</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. NAPF 2026 Prep" /></div>
          <div><Label>Goal Type</Label>
            <Select value={form.goal_type} onValueChange={(v) => setForm({ ...form, goal_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{GOAL_TYPES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Event Name</Label><Input value={form.event_name} onChange={(e) => setForm({ ...form, event_name: e.target.value })} /></div>
            <div><Label>Event Date</Label><Input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Total Weeks</Label><Input type="number" value={form.total_weeks} onChange={(e) => setForm({ ...form, total_weeks: parseInt(e.target.value) || 0 })} /></div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as PrepStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["Planned", "Active", "Completed", "Archived"] as PrepStatus[]).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={async () => {
            if (!form.title) return toast.error("Title required");
            try {
              await createPrep({
                client_id: clientId, title: form.title, goal_type: form.goal_type,
                event_name: form.event_name || null, event_date: form.event_date || null,
                total_weeks: form.total_weeks || null, status: form.status,
              });
              toast.success("Prep created");
              onCreated(); onOpenChange(false);
            } catch (e: any) { toast.error(e.message); }
          }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewBlockDialog({ open, onOpenChange, clientId, preps, onCreated }: any) {
  const [form, setForm] = useState({ name: "", weeks: 4, training_focus: "Accumulation", prep_id: "none" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Block</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Volume / Positioning" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Weeks</Label><Input type="number" value={form.weeks} onChange={(e) => setForm({ ...form, weeks: parseInt(e.target.value) || 1 })} /></div>
            <div><Label>Focus</Label>
              <Select value={form.training_focus} onValueChange={(v) => setForm({ ...form, training_focus: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{BLOCK_PHASE_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Link to Prep (optional)</Label>
            <Select value={form.prep_id} onValueChange={(v) => setForm({ ...form, prep_id: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Standalone block —</SelectItem>
                {preps.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={async () => {
            if (!form.name) return toast.error("Name required");
            try {
              await createBlock({
                client_id: clientId, name: form.name, weeks: form.weeks,
                training_focus: form.training_focus, prep_id: form.prep_id === "none" ? null : form.prep_id,
              });
              toast.success("Block created with seeded weeks");
              onCreated(); onOpenChange(false);
            } catch (e: any) { toast.error(e.message); }
          }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}