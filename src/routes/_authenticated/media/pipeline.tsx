import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MediaHeader } from "@/components/media/media-header";
import { useContentDrawer } from "@/components/media/content-drawer";
import {
  listContent, patchContent, archiveContent, createContent, deleteContent,
  PRODUCTION_STAGES, STAGE_LABELS, APPROVAL_LABELS, PRIORITY_LABELS,
  type ContentRecord, type ProductionStatus,
} from "@/lib/media-content";
import { Plus, Trash2, Archive } from "lucide-react";

export const Route = createFileRoute("/_authenticated/media/pipeline")({
  component: PipelinePage,
});

function PipelinePage() {
  const qc = useQueryClient();
  const { open } = useContentDrawer();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["media-content-records", "pipeline"],
    queryFn: () => listContent({ archived: false, limit: 1000 }),
    staleTime: 15_000,
  });

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    return (data ?? []).filter((r) =>
      !q || r.title.toLowerCase().includes(q) || (r.platform ?? "").toLowerCase().includes(q));
  }, [data, filter]);

  const byStage = useMemo(() => {
    const m = new Map<string, ContentRecord[]>();
    for (const s of PRODUCTION_STAGES) m.set(s, []);
    for (const r of filtered) {
      const stage = PRODUCTION_STAGES.includes(r.production_status as ProductionStatus)
        ? r.production_status : "idea";
      m.get(stage as string)!.push(r);
    }
    return m;
  }, [filtered]);

  const move = async (id: string, stage: ProductionStatus, prevStage: string) => {
    qc.setQueryData<ContentRecord[]>(["media-content-records", "pipeline"], (old) =>
      (old ?? []).map((r) => r.id === id ? { ...r, production_status: stage } : r));
    try { await patchContent(id, { production_status: stage } as any); }
    catch (e: any) {
      toast.error(e?.message ?? "Move failed");
      qc.setQueryData<ContentRecord[]>(["media-content-records", "pipeline"], (old) =>
        (old ?? []).map((r) => r.id === id ? { ...r, production_status: prevStage } : r));
    }
    qc.invalidateQueries({ queryKey: ["media-content-records"] });
  };

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const selectAllVisible = () => setSelected(new Set(filtered.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  const bulkMove = async (stage: ProductionStatus) => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => patchContent(id, { production_status: stage } as any)));
      toast.success(`Moved ${ids.length} to ${STAGE_LABELS[stage]}`);
      clearSelection();
      qc.invalidateQueries({ queryKey: ["media-content-records"] });
    } catch (e: any) { toast.error(e?.message ?? "Bulk move failed"); }
  };
  const bulkArchive = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await archiveContent(ids, true);
      toast.success(`Archived ${ids.length}`);
      clearSelection();
      qc.invalidateQueries({ queryKey: ["media-content-records"] });
    } catch (e: any) { toast.error(e?.message ?? "Archive failed"); }
  };
  const bulkDelete = async () => {
    const ids = Array.from(selected);
    try {
      await Promise.all(ids.map((id) => deleteContent(id)));
      toast.success(`Deleted ${ids.length}`);
      clearSelection();
      setConfirmDelete(false);
      qc.invalidateQueries({ queryKey: ["media-content-records"] });
    } catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
  };

  const quickCreate = async (stage: ProductionStatus) => {
    try {
      const c = await createContent({ title: "Untitled content", production_status: stage });
      qc.invalidateQueries({ queryKey: ["media-content-records"] });
      open(c.id);
    } catch (e: any) { toast.error(e?.message ?? "Create failed"); }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 md:p-6">
      <MediaHeader title="Content Pipeline" description="Drag cards between stages. Multi-select for bulk actions." />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button size="sm" variant="outline" onClick={selectAllVisible}>Select all visible</Button>
        {selected.size > 0 && (
          <>
            <Badge variant="secondary">{selected.size} selected</Badge>
            <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
            <Button size="sm" variant="outline" onClick={bulkArchive}>
              <Archive className="mr-1.5 h-4 w-4" /> Archive
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Delete
            </Button>
            <BulkMoveMenu onMove={bulkMove} />
          </>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-3 lg:grid-cols-5"><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {PRODUCTION_STAGES.map((stage) => {
            const items = byStage.get(stage) ?? [];
            const isCollapsed = collapsed.has(stage) && items.length === 0;
            return (
              <Card key={stage} className="min-w-[280px] flex-1 p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/plain");
                  const prev = e.dataTransfer.getData("text/stage");
                  if (id && prev !== stage) move(id, stage, prev);
                }}>
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <button className="text-left text-sm font-semibold"
                    onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(stage) ? n.delete(stage) : n.add(stage); return n; })}>
                    {STAGE_LABELS[stage]}
                  </button>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary">{items.length}</Badge>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => quickCreate(stage)}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {!isCollapsed && (
                  <ul className="space-y-1.5">
                    {items.length === 0 && (
                      <li className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
                        Drop here
                      </li>
                    )}
                    {items.map((r) => (
                      <PipelineCard key={r.id} r={r} stage={stage}
                        selected={selected.has(r.id)} onToggle={() => toggle(r.id)} onOpen={() => open(r.id)} />
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} item{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={bulkDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PipelineCard({ r, stage, selected, onToggle, onOpen }:
  { r: ContentRecord; stage: string; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  const overdue = r.due_date && new Date(r.due_date) < new Date() && r.production_status !== "published";
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", r.id);
        e.dataTransfer.setData("text/stage", stage);
      }}
      className="cursor-grab rounded border bg-card p-2 text-xs hover:border-primary/50 active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <Checkbox checked={selected} onCheckedChange={onToggle} onClick={(e) => e.stopPropagation()} className="mt-0.5" />
        <button className="flex-1 text-left" onClick={onOpen}>
          {r.thumbnail_url && (
            <img src={r.thumbnail_url} alt="" className="mb-1.5 h-20 w-full rounded object-cover" />
          )}
          <div className="line-clamp-2 font-medium">{r.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {r.platform && <Badge variant="outline" className="text-[10px]">{r.platform}</Badge>}
            {r.content_type && <Badge variant="outline" className="text-[10px]">{r.content_type}</Badge>}
            {r.approval_status !== "not_submitted" && (
              <Badge variant={r.approval_status === "approved" ? "default" : "secondary"} className="text-[10px]">
                {APPROVAL_LABELS[r.approval_status as keyof typeof APPROVAL_LABELS] ?? r.approval_status}
              </Badge>
            )}
            {r.priority >= 3 && <Badge variant="destructive" className="text-[10px]">{PRIORITY_LABELS[r.priority]}</Badge>}
            {r.production_status === "blocked" && <Badge variant="destructive" className="text-[10px]">Blocked</Badge>}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{r.publish_date ? `📅 ${r.publish_date}` : ""}</span>
            <span className={overdue ? "text-destructive font-medium" : ""}>
              {r.due_date ? `due ${r.due_date}` : ""}
            </span>
          </div>
        </button>
      </div>
    </li>
  );
}

function BulkMoveMenu({ onMove }: { onMove: (s: ProductionStatus) => void }) {
  return (
    <div className="flex gap-1">
      {PRODUCTION_STAGES.slice(0, 6).map((s) => (
        <Button key={s} size="sm" variant="ghost" onClick={() => onMove(s)} className="text-xs">
          → {STAGE_LABELS[s]}
        </Button>
      ))}
    </div>
  );
}