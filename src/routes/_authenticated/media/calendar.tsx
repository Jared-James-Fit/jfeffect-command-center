import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaHeader } from "@/components/media/media-header";
import { useContentDrawer } from "@/components/media/content-drawer";
import { listContent, patchContent, type ContentRecord, STAGE_LABELS } from "@/lib/media-content";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/media/calendar")({
  component: CalendarWorkspace,
});

type ViewKind = "month" | "week" | "agenda" | "events";
const STORAGE_KEY = "media-calendar-view";

function CalendarWorkspace() {
  const qc = useQueryClient();
  const { open } = useContentDrawer();
  const [view, setView] = useState<ViewKind>(() => {
    if (typeof window === "undefined") return "month";
    return (window.localStorage.getItem(STORAGE_KEY) as ViewKind) || "month";
  });
  useEffect(() => { try { window.localStorage.setItem(STORAGE_KEY, view); } catch {} }, [view]);
  const [anchor, setAnchor] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("");

  const contentQ = useQuery({
    queryKey: ["media-calendar-content"],
    queryFn: () => listContent({ archived: false, limit: 1000 }),
    staleTime: 15_000,
  });
  const eventsQ = useQuery({
    queryKey: ["media-calendar-events"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("events")
        .select("id, name, event_date, start_time, end_time, status, event_type")
        .order("event_date", { ascending: true });
      return data ?? [];
    },
    staleTime: 15_000,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (contentQ.data ?? []).filter((r) => {
      if (q && !r.title.toLowerCase().includes(q)) return false;
      if (platformFilter && r.platform !== platformFilter) return false;
      return true;
    });
  }, [contentQ.data, search, platformFilter]);

  const scheduled = filtered.filter((r) => r.publish_date || r.due_date);
  const unscheduled = filtered.filter((r) => !r.publish_date && !r.due_date);

  const onDropDate = async (id: string, isoDate: string) => {
    qc.setQueryData<ContentRecord[]>(["media-calendar-content"], (old) =>
      (old ?? []).map((r) => r.id === id ? { ...r, publish_date: isoDate } : r));
    try {
      await patchContent(id, { publish_date: isoDate } as any);
      toast.success("Rescheduled");
      qc.invalidateQueries({ queryKey: ["media-content-records"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
      qc.invalidateQueries({ queryKey: ["media-calendar-content"] });
    }
  };

  const stepAnchor = (dir: number) => {
    const d = new Date(anchor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "week") d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setAnchor(d);
  };

  const platforms = Array.from(new Set((contentQ.data ?? []).map((r) => r.platform).filter(Boolean))) as string[];

  return (
    <div className="mx-auto w-full max-w-[1400px] p-4 md:p-6">
      <MediaHeader title="Content Calendar"
        description="Shared schedule for content, events, deadlines, and launches." />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(["month","week","agenda","events"] as ViewKind[]).map((v) => (
          <Button key={v} size="sm" variant={view === v ? "default" : "outline"} onClick={() => setView(v)} className="capitalize">{v}</Button>
        ))}
        <div className="mx-2 h-6 w-px bg-border" />
        <Button size="icon" variant="outline" onClick={() => stepAnchor(-1)}><ChevronLeft className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" onClick={() => setAnchor(new Date())}>Today</Button>
        <Button size="icon" variant="outline" onClick={() => stepAnchor(1)}><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-2 text-sm font-medium">{anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <div className="ml-auto flex items-center gap-2">
          <Input className="w-40" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="rounded border bg-background px-2 py-1 text-sm" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
            <option value="">All platforms</option>
            {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div>
          {view === "month" && <MonthView anchor={anchor} content={scheduled} events={eventsQ.data ?? []} onOpen={open} onDropDate={onDropDate} />}
          {view === "week" && <WeekView anchor={anchor} content={scheduled} events={eventsQ.data ?? []} onOpen={open} onDropDate={onDropDate} />}
          {view === "agenda" && <AgendaView content={scheduled} events={eventsQ.data ?? []} onOpen={open} />}
          {view === "events" && <EventsListView events={eventsQ.data ?? []} />}
        </div>
        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Unscheduled</h3>
            <Badge variant="secondary">{unscheduled.length}</Badge>
          </div>
          <ul className="space-y-1.5">
            {unscheduled.length === 0 && <li className="text-xs text-muted-foreground">All scheduled.</li>}
            {unscheduled.slice(0, 50).map((r) => (
              <li key={r.id} draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
                className="cursor-grab rounded border bg-card p-2 text-xs hover:border-primary/50"
                onClick={() => open(r.id)}>
                <div className="line-clamp-2 font-medium">{r.title}</div>
                {r.platform && <div className="text-muted-foreground">{r.platform}</div>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

function MonthView({ anchor, content, events, onOpen, onDropDate }: {
  anchor: Date; content: ContentRecord[]; events: any[]; onOpen: (id: string) => void;
  onDropDate: (id: string, iso: string) => void;
}) {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const startDow = start.getDay();
  const gridStart = new Date(start);
  gridStart.setDate(start.getDate() - startDow);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  const byDate = new Map<string, ContentRecord[]>();
  for (const r of content) {
    const key = r.publish_date ?? r.due_date;
    if (!key) continue;
    const arr = byDate.get(key) ?? [];
    arr.push(r); byDate.set(key, arr);
  }
  const evByDate = new Map<string, any[]>();
  for (const e of events) {
    const arr = evByDate.get(e.event_date) ?? [];
    arr.push(e); evByDate.set(e.event_date, arr);
  }
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 bg-muted/40 text-center text-xs font-medium">
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const key = isoDate(d);
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = isoDate(new Date()) === key;
          const items = byDate.get(key) ?? [];
          const evs = evByDate.get(key) ?? [];
          return (
            <div key={i}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const id = e.dataTransfer.getData("text/plain"); if (id) onDropDate(id, key); }}
              className={`min-h-[96px] border border-border/40 p-1 text-xs ${inMonth ? "" : "bg-muted/20 text-muted-foreground"}`}>
              <div className={`mb-1 inline-block rounded px-1 ${isToday ? "bg-primary text-primary-foreground" : ""}`}>{d.getDate()}</div>
              <ul className="space-y-0.5">
                {items.slice(0, 3).map((r) => (
                  <li key={r.id} draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
                    onClick={() => onOpen(r.id)}
                    className="cursor-pointer truncate rounded bg-primary/15 px-1 text-[10px] text-primary hover:bg-primary/25">
                    {r.title}
                  </li>
                ))}
                {evs.slice(0, 2).map((e) => (
                  <li key={e.id} className="truncate rounded bg-amber-200/40 px-1 text-[10px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    {e.name}
                  </li>
                ))}
                {items.length + evs.length > 5 && <li className="text-[10px] text-muted-foreground">+{items.length + evs.length - 5}</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WeekView({ anchor, content, events, onOpen, onDropDate }: {
  anchor: Date; content: ContentRecord[]; events: any[]; onOpen: (id: string) => void;
  onDropDate: (id: string, iso: string) => void;
}) {
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - anchor.getDay());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i); return d;
  });
  return (
    <Card className="p-2">
      <div className="grid grid-cols-7 gap-2">
        {days.map((d) => {
          const key = isoDate(d);
          const items = content.filter((r) => (r.publish_date ?? r.due_date) === key);
          const evs = events.filter((e) => e.event_date === key);
          return (
            <div key={key} onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const id = e.dataTransfer.getData("text/plain"); if (id) onDropDate(id, key); }}
              className="min-h-[200px] rounded border p-1.5">
              <div className="mb-1 text-xs font-medium">{d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}</div>
              <ul className="space-y-1">
                {items.map((r) => (
                  <li key={r.id} onClick={() => onOpen(r.id)}
                    className="cursor-pointer rounded bg-primary/15 px-1.5 py-1 text-[11px] text-primary hover:bg-primary/25">
                    <div className="font-medium">{r.title}</div>
                    {r.publish_time && <div className="text-[10px]">{r.publish_time}</div>}
                  </li>
                ))}
                {evs.map((e) => (
                  <li key={e.id} className="rounded bg-amber-200/40 px-1.5 py-1 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{e.name}</li>
                ))}
                {items.length + evs.length === 0 && <li className="text-[10px] text-muted-foreground">—</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AgendaView({ content, events, onOpen }: {
  content: ContentRecord[]; events: any[]; onOpen: (id: string) => void;
}) {
  type Row = { date: string; kind: "content" | "event"; item: any };
  const rows: Row[] = [
    ...content.map((r) => ({ date: (r.publish_date ?? r.due_date)!, kind: "content" as const, item: r })),
    ...events.map((e) => ({ date: e.event_date, kind: "event" as const, item: e })),
  ].filter((r) => !!r.date).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Card className="divide-y">
      {rows.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No scheduled items.</div>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3 p-2.5">
          <div className="w-24 shrink-0 text-xs font-medium">{r.date}</div>
          {r.kind === "content" ? (
            <button onClick={() => onOpen(r.item.id)} className="flex-1 text-left">
              <div className="text-sm font-medium">{r.item.title}</div>
              <div className="text-xs text-muted-foreground">{r.item.platform ?? "Content"} · {STAGE_LABELS[r.item.production_status as keyof typeof STAGE_LABELS] ?? r.item.production_status}</div>
            </button>
          ) : (
            <div className="flex-1">
              <div className="text-sm font-medium">{r.item.name}</div>
              <div className="text-xs text-muted-foreground">Event · {r.item.event_type ?? ""}</div>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

function EventsListView({ events }: { events: any[] }) {
  return (
    <Card className="divide-y">
      {events.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No events.</div>}
      {events.map((e) => (
        <div key={e.id} className="flex items-center justify-between p-2.5">
          <div>
            <div className="text-sm font-medium">{e.name}</div>
            <div className="text-xs text-muted-foreground">{e.event_date}{e.start_time ? ` · ${e.start_time}` : ""}</div>
          </div>
          <Badge variant="outline">{e.event_type}</Badge>
        </div>
      ))}
    </Card>
  );
}