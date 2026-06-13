import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, CalendarRange, Sparkles, Trash2, Archive, CheckSquare, Pencil } from "lucide-react";
import { EventCard } from "@/components/events/event-card";
import {
  EVENT_IMPORTANCE, EVENT_STATUSES, EVENT_TYPES,
  listAdminEvents, type EventStatus, type EventImportance, type EventType,
} from "@/lib/events";
import { createEventDraft, bulkDeleteEvents, bulkUpdateEventStatus } from "@/lib/events.functions";
import { toast } from "sonner";
import { useBulkSelection } from "@/hooks/use-bulk-selection";

export const Route = createFileRoute("/_authenticated/admin/events/")({
  component: EventsRedirect,
});

function EventsRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/calendar", search: { tab: "events" } as any, replace: true });
  }, [navigate]);
  return null;
}

export function AdminEventsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const createDraftFn = useServerFn(createEventDraft);
  const bulkDeleteFn = useServerFn(bulkDeleteEvents);
  const bulkStatusFn = useServerFn(bulkUpdateEventStatus);
  const [status, setStatus] = useState<EventStatus | "All">("Active");
  const [search, setSearch] = useState("");
  const [importance, setImportance] = useState<EventImportance | "All">("All");
  const [type, setType] = useState<EventType | "All">("All");
  const [selectMode, setSelectMode] = useState(false);

  const { data: events, isLoading } = useQuery({
    queryKey: ["admin-events", status],
    queryFn: () => listAdminEvents(status === "All" ? {} : { status }),
  });

  const filtered = useMemo(() => {
    let rows = events ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((e) => e.name.toLowerCase().includes(q) || (e.location ?? "").toLowerCase().includes(q));
    }
    if (importance !== "All") rows = rows.filter((e) => e.importance === importance);
    if (type !== "All") rows = rows.filter((e) => e.event_type === type);
    return rows;
  }, [events, search, importance, type]);

  const visibleIds = useMemo(() => filtered.map((e) => e.id), [filtered]);
  const selection = useBulkSelection(visibleIds);

  async function bulkDelete() {
    if (selection.count === 0) return;
    if (!confirm(`Delete ${selection.count} event${selection.count === 1 ? "" : "s"}? This cannot be undone.`)) return;
    try {
      await bulkDeleteFn({ data: { ids: selection.selectedIds } });
      toast.success(`Deleted ${selection.count} event${selection.count === 1 ? "" : "s"}`);
      selection.clear();
      qc.invalidateQueries({ queryKey: ["admin-events"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  }

  async function bulkSetStatus(newStatus: EventStatus) {
    if (selection.count === 0) return;
    try {
      await bulkStatusFn({ data: { ids: selection.selectedIds, status: newStatus } });
      toast.success(`Updated ${selection.count} event${selection.count === 1 ? "" : "s"} → ${newStatus}`);
      selection.clear();
      qc.invalidateQueries({ queryKey: ["admin-events"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    }
  }

  function bulkEdit() {
    if (selection.count !== 1) {
      toast.info("Pick a single event to edit");
      return;
    }
    nav({ to: "/admin/events/$id", params: { id: selection.selectedIds[0] } });
  }

  async function createDraft() {
    const tid = toast.loading("Creating event…");
    try {
      const data = await createDraftFn({ data: undefined as any });
      toast.dismiss(tid);
      if (!data?.id) throw new Error("Server did not return an event id");
      qc.invalidateQueries({ queryKey: ["admin-events"] });
      nav({ to: "/admin/events/$id", params: { id: data.id } });
    } catch (e: any) {
      toast.dismiss(tid);
      console.error("[events] createDraft failed", e);
      toast.error(e?.message ?? e?.toString?.() ?? "Could not create event");
    }
  }

  return (
    <div className="space-y-4">
      {!embedded && <PageHeader
        title="Events"
        subtitle="Plan upcoming meets, shoots, calls, and key client dates."
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={selectMode ? "default" : "outline"}
              onClick={() => { setSelectMode((v) => !v); selection.clear(); }}
            >
              <CheckSquare className="mr-1 h-4 w-4" />{selectMode ? "Done" : "Select"}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/events/format-guide"><Sparkles className="mr-1 h-4 w-4" />Format Guide</Link>
            </Button>
            <Button size="sm" onClick={createDraft}>
              <Plus className="mr-1 h-4 w-4" />New Event
            </Button>
          </div>
        }
      />

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={status} onValueChange={(v) => setStatus(v as EventStatus | "All")}>
            <TabsList>
              <TabsTrigger value="Active">Active</TabsTrigger>
              <TabsTrigger value="Draft">Drafts</TabsTrigger>
              <TabsTrigger value="Completed">Completed</TabsTrigger>
              <TabsTrigger value="Archived">Archived</TabsTrigger>
              <TabsTrigger value="All">All</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Input placeholder="Search events…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
            <Select value={importance} onValueChange={(v) => setImportance(v as EventImportance | "All")}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Importance" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All importance</SelectItem>
                {EVENT_IMPORTANCE.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={(v) => setType(v as EventType | "All")}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All types</SelectItem>
                {EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {selectMode && (
        <Card className="flex flex-wrap items-center gap-2 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <Checkbox
              checked={selection.allSelected || (selection.someSelected ? "indeterminate" : false)}
              onCheckedChange={selection.toggleAll}
            />
            {selection.count > 0 ? `${selection.count} selected` : "Select all"}
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={bulkEdit} disabled={selection.count !== 1}>
              <Pencil className="mr-1 h-4 w-4" />Edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkSetStatus("Archived")} disabled={selection.count === 0}>
              <Archive className="mr-1 h-4 w-4" />Archive
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkSetStatus("Active")} disabled={selection.count === 0}>
              Restore
            </Button>
            <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={selection.count === 0}>
              <Trash2 className="mr-1 h-4 w-4" />Delete
            </Button>
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0,1,2,3].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="grid place-items-center gap-3 p-12 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-secondary text-foreground">
            <CalendarRange className="h-6 w-6" />
          </div>
          <div>
            <div className="font-semibold">No events yet</div>
            <div className="text-sm text-muted-foreground">Create one to start planning.</div>
          </div>
          <Button onClick={createDraft}><Plus className="mr-1 h-4 w-4" />New Event</Button>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((ev) => (
            <EventCard
              key={ev.id}
              ev={ev}
              to="/admin/events/$id"
              params={{ id: ev.id }}
              selectable={selectMode}
              selected={selection.isSelected(ev.id)}
              onSelectedChange={(checked) => selection.setOne(ev.id, checked)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
