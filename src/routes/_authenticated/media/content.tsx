import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MediaHeader } from "@/components/media/media-header";
import { useContentDrawer } from "@/components/media/content-drawer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  listContent, createContent, archiveContent, patchContent, deleteContent,
  PRODUCTION_STAGES, STAGE_LABELS, APPROVAL_LABELS, type ContentRecord, type ProductionStatus,
} from "@/lib/media-content";
import {
  Plus, LayoutGrid, List as ListIcon, Archive, Trash2, ChevronDown,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/media/content")({
  component: ContentLibraryPage,
});

type View = "grid" | "list";
type SortKey = "updated" | "due" | "publish" | "title";

function ContentLibraryPage() {
  const qc = useQueryClient();
  const { open } = useContentDrawer();
  const [view, setView] = useState<View>("grid");
  const [filter, setFilter] = useState("");
  const [platform, setPlatform] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [approval, setApproval] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["media-content-records", "library", archived],
    queryFn: () => listContent({ archived, limit: 1000 }),
    staleTime: 15_000,
  });

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    let rows = (data ?? []).filter((r) => {
      if (status !== "all" && r.production_status !== status) return false;
      if (approval !== "all" && r.approval_status !== approval) return false;
      if (platform !== "all" && (r.platform ?? "") !== platform) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.platform ?? "").toLowerCase().includes(q) ||
        (r.pillar ?? "").toLowerCase().includes(q)
      );
    });
    rows.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "due") return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
      if (sort === "publish") return (a.publish_date ?? "9999").localeCompare(b.publish_date ?? "9999");
      return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    });
    return rows;
  }, [data, filter, status, approval, platform, sort]);

  const platforms = useMemo(() => {
    const s = new Set<string>();
    (data ?? []).forEach((r) => { if (r.platform) s.add(r.platform); });
    return Array.from(s).sort();
  }, [data]);

  const allOnPage = filtered.map((r) => r.id);
  const allSelected = allOnPage.length > 0 && allOnPage.every((id) => selected.has(id));

  function toggleAll() {
    setSelected((cur) => {
      const next = new Set(cur);
      if (allSelected) allOnPage.forEach((id) => next.delete(id));
      else allOnPage.forEach((id) => next.add(id));
      return next;
    });
  }
  function toggleOne(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function onNew() {
    const c = await createContent({ title: "Untitled content", production_status: "idea" });
    qc.invalidateQueries({ queryKey: ["media-content-records"] });
    open(c.id);
  }

  async function bulkArchive(value: boolean) {
    if (selected.size === 0) return;
    await archiveContent(Array.from(selected), value);
    setSelected(new Set());
    toast.success(value ? "Archived" : "Restored");
    qc.invalidateQueries({ queryKey: ["media-content-records"] });
  }
  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Permanently delete ${selected.size} content item(s)?`)) return;
    await Promise.all(Array.from(selected).map(deleteContent));
    setSelected(new Set());
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["media-content-records"] });
  }
  async function bulkStatus(s: ProductionStatus) {
    await Promise.all(Array.from(selected).map((id) => patchContent(id, { production_status: s } as any)));
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["media-content-records"] });
  }
  async function bulkSetField(field: "campaign_id" | "assignee_id", value: string) {
    await Promise.all(Array.from(selected).map((id) => patchContent(id, { [field]: value || null } as any)));
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["media-content-records"] });
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <MediaHeader
        title="Content Library"
        description="Every content project — drafts, in-production, scheduled, and published."
        actions={
          <Button size="sm" onClick={onNew}>
            <Plus className="mr-1.5 h-4 w-4" /> New Content
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search content…"
          className="h-9 w-64"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {PRODUCTION_STAGES.map((s) => (
              <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={approval} onValueChange={setApproval}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Approval" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All approvals</SelectItem>
            {Object.entries(APPROVAL_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Platform" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {platforms.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Recently updated</SelectItem>
            <SelectItem value="due">Due date</SelectItem>
            <SelectItem value="publish">Publish date</SelectItem>
            <SelectItem value="title">Title (A→Z)</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={archived ? "default" : "outline"}
          size="sm"
          onClick={() => setArchived((v) => !v)}
        >
          <Archive className="mr-1 h-4 w-4" /> {archived ? "Archived" : "Active"}
        </Button>
        <div className="ml-auto flex gap-1">
          <Button variant={view === "grid" ? "default" : "outline"} size="icon" onClick={() => setView("grid")} aria-label="Grid">
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button variant={view === "list" ? "default" : "outline"} size="icon" onClick={() => setView("list")} aria-label="List">
            <ListIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
        <span className="text-muted-foreground">
          {selected.size > 0 ? `${selected.size} selected` : "Select all on page"}
        </span>
        {selected.size > 0 && (
          <div className="ml-auto flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  Bulk status <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {PRODUCTION_STAGES.map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => bulkStatus(s)}>
                    {STAGE_LABELS[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <BulkInline label="Bulk assign" onSubmit={(v) => bulkSetField("assignee_id", v)} placeholder="user id" />
            <BulkInline label="Bulk campaign" onSubmit={(v) => bulkSetField("campaign_id", v)} placeholder="campaign id" />
            <Button size="sm" variant="outline" onClick={() => bulkArchive(!archived)}>
              <Archive className="mr-1 h-4 w-4" /> {archived ? "Restore" : "Archive"}
            </Button>
            <Button size="sm" variant="destructive" onClick={bulkDelete}>
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
          </div>
        )}
      </div>

      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>}
      {!isLoading && filtered.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">No content. Create one to begin.</Card>
      )}

      {view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((r) => (
            <ContentCard
              key={r.id}
              record={r}
              selected={selected.has(r.id)}
              onSelect={() => toggleOne(r.id)}
              onOpen={() => open(r.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md border divide-y">
          {filtered.map((r) => (
            <ContentRow
              key={r.id}
              record={r}
              selected={selected.has(r.id)}
              onSelect={() => toggleOne(r.id)}
              onOpen={() => open(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContentCard({
  record, selected, onSelect, onOpen,
}: { record: ContentRecord; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[16/9] bg-muted">
        {record.thumbnail_url ? (
          <img src={record.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No thumbnail</div>
        )}
        <div className="absolute left-2 top-2">
          <Checkbox checked={selected} onCheckedChange={onSelect} aria-label="Select" className="bg-background/80" />
        </div>
      </div>
      <button onClick={onOpen} className="block w-full p-3 text-left hover:bg-accent">
        <div className="truncate font-medium text-sm">{record.title}</div>
        <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
          <Badge variant="secondary">{STAGE_LABELS[record.production_status as ProductionStatus] ?? record.production_status}</Badge>
          <Badge variant="outline">{APPROVAL_LABELS[record.approval_status as keyof typeof APPROVAL_LABELS] ?? record.approval_status}</Badge>
          {record.platform && <Badge variant="outline">{record.platform}</Badge>}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {record.campaign_id && <span className="truncate">Campaign</span>}
          {record.assignee_id && <span className="truncate">Assigned</span>}
          {record.due_date && <span>Due {record.due_date}</span>}
          {record.publish_date && <span>Publish {record.publish_date}</span>}
          <span className="col-span-2">{(record.linked_task_ids?.length ?? 0)} task(s)</span>
        </div>
      </button>
    </Card>
  );
}

function ContentRow({
  record, selected, onSelect, onOpen,
}: { record: ContentRecord; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  return (
    <div className="flex items-center gap-3 p-3 hover:bg-accent">
      <Checkbox checked={selected} onCheckedChange={onSelect} aria-label="Select" />
      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <div className="truncate text-sm font-medium">{record.title}</div>
        <div className="text-xs text-muted-foreground truncate">
          {STAGE_LABELS[record.production_status as ProductionStatus] ?? record.production_status}
          {" · "}
          {APPROVAL_LABELS[record.approval_status as keyof typeof APPROVAL_LABELS] ?? record.approval_status}
          {record.platform ? ` · ${record.platform}` : ""}
          {record.due_date ? ` · Due ${record.due_date}` : ""}
          {record.publish_date ? ` · Publish ${record.publish_date}` : ""}
        </div>
      </button>
    </div>
  );
}

function BulkInline({
  label, onSubmit, placeholder,
}: { label: string; onSubmit: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{label}</Button>;
  }
  return (
    <div className="flex items-center gap-1">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="h-8 w-40" />
      <Button size="sm" onClick={() => { onSubmit(v); setOpen(false); setV(""); }}>Apply</Button>
      <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setV(""); }}>Cancel</Button>
    </div>
  );
}