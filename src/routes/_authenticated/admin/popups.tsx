import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Megaphone, Calendar, ListChecks, Cake, ExternalLink, Plus, Eye, Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/popups")({
  component: PopupsManager,
});

type PopupType = "broadcast" | "event" | "task" | "birthday";

type UnifiedPopup = {
  popupType: PopupType;
  id: string;
  title: string;
  audience: string;
  status: string;
  statusTone: "active" | "scheduled" | "expired" | "draft" | "off" | "system";
  enabled: boolean;
  canToggle: boolean;
  editPath: string;
  seenCount: number | null;
  sentAt: string | null;
};

const TYPE_META: Record<PopupType, { label: string; icon: typeof Megaphone; color: string }> = {
  broadcast: { label: "Broadcast", icon: Megaphone,  color: "#3b82f6" },
  event:     { label: "Event",     icon: Calendar,   color: "#a855f7" },
  task:      { label: "Task",      icon: ListChecks, color: "#22c55e" },
  birthday:  { label: "Birthday",  icon: Cake,       color: "#ec4899" },
};

function toneClass(t: UnifiedPopup["statusTone"]) {
  switch (t) {
    case "active":    return "bg-emerald-500/15 text-emerald-600 border-emerald-500/40";
    case "scheduled": return "bg-blue-500/15 text-blue-600 border-blue-500/40";
    case "expired":   return "bg-muted text-muted-foreground border-border";
    case "draft":     return "bg-amber-500/15 text-amber-600 border-amber-500/40";
    case "off":       return "bg-muted text-muted-foreground border-border";
    case "system":    return "bg-violet-500/15 text-violet-600 border-violet-500/40";
  }
}

async function fetchAllPopups(): Promise<UnifiedPopup[]> {
  const [bc, ev, tk, bd, bcSeen, evAcks, bdViews] = await Promise.all([
    supabase.from("broadcasts").select("id,title,type,audience_scope,status,publish_at,expires_at,created_at"),
    supabase.from("events").select("id,name,importance,audience_scope,status,event_date").in("importance", ["High", "Critical"]),
    supabase.from("tasks").select("id,title,status,quadrant").eq("status", "open"),
    (supabase.from("client_birthday_cards") as any).select("id,client_id,enabled,template_key,headline,clients(full_name)"),
    supabase.from("broadcast_seen").select("broadcast_id"),
    supabase.from("event_popup_acks").select("event_id"),
    supabase.from("client_birthday_card_views").select("client_id"),
  ]);

  const bcCount = new Map<string, number>();
  (bcSeen.data ?? []).forEach((r: any) => bcCount.set(r.broadcast_id, (bcCount.get(r.broadcast_id) ?? 0) + 1));
  const evCount = new Map<string, number>();
  (evAcks.data ?? []).forEach((r: any) => evCount.set(r.event_id, (evCount.get(r.event_id) ?? 0) + 1));
  const bdCount = new Map<string, number>();
  (bdViews.data ?? []).forEach((r: any) => bdCount.set(r.client_id, (bdCount.get(r.client_id) ?? 0) + 1));

  const now = Date.now();
  const out: UnifiedPopup[] = [];

  for (const b of (bc.data ?? []) as any[]) {
    const expired = b.expires_at && new Date(b.expires_at).getTime() < now;
    const scheduled = b.publish_at && new Date(b.publish_at).getTime() > now;
    const isActive = (b.status === "Active") && !expired && !scheduled;
    const tone: UnifiedPopup["statusTone"] =
      b.status === "Draft" ? "draft" :
      b.status === "Archived" ? "off" :
      expired ? "expired" :
      scheduled ? "scheduled" :
      isActive ? "active" : "off";
    out.push({
      popupType: "broadcast",
      id: b.id,
      title: b.title || "(untitled broadcast)",
      audience: b.audience_scope ?? "—",
      status: tone === "expired" ? "Expired" : tone === "scheduled" ? "Scheduled" : (b.status ?? "—"),
      statusTone: tone,
      enabled: b.status === "Active",
      canToggle: true,
      editPath: `/admin/broadcasts/${b.id}`,
      seenCount: bcCount.get(b.id) ?? 0,
      sentAt: b.publish_at ?? b.created_at ?? null,
    });
  }

  for (const e of (ev.data ?? []) as any[]) {
    const past = e.event_date && new Date(e.event_date).getTime() < now - 24 * 3600 * 1000;
    const tone: UnifiedPopup["statusTone"] =
      e.status === "Active" && !past ? "active" :
      e.status === "Draft" ? "draft" :
      past || e.status === "Completed" || e.status === "Archived" ? "expired" : "off";
    out.push({
      popupType: "event",
      id: e.id,
      title: e.name || "(untitled event)",
      audience: e.audience_scope ?? "—",
      status: past ? "Past" : (e.status ?? "—"),
      statusTone: tone,
      enabled: e.status === "Active",
      canToggle: true,
      editPath: `/admin/events/${e.id}`,
      seenCount: evCount.get(e.id) ?? 0,
      sentAt: e.event_date ?? null,
    });
  }

  // Tasks popup is a single system-level popup (one per dashboard scope).
  const openCount = (tk.data ?? []).length;
  out.push({
    popupType: "task",
    id: "system:admin",
    title: `Daily Task Summary — Admin / Coach (${openCount} open)`,
    audience: "admins + coaches",
    status: "System",
    statusTone: "system",
    enabled: true,
    canToggle: false,
    editPath: "/admin/tasks",
    seenCount: null,
    sentAt: null,
  });
  out.push({
    popupType: "task",
    id: "system:mm",
    title: `Daily Task Summary — Media Manager`,
    audience: "media managers",
    status: "System",
    statusTone: "system",
    enabled: true,
    canToggle: false,
    editPath: "/media/action-items",
    seenCount: null,
    sentAt: null,
  });

  for (const c of (bd.data ?? []) as any[]) {
    const tone: UnifiedPopup["statusTone"] = c.enabled ? "active" : "off";
    out.push({
      popupType: "birthday",
      id: c.id,
      title: `${c.clients?.full_name ?? "Client"} — ${c.headline || c.template_key || "Birthday card"}`,
      audience: "client (1:1)",
      status: c.enabled ? "Enabled" : "Disabled",
      statusTone: tone,
      enabled: !!c.enabled,
      canToggle: true,
      editPath: `/admin/clients/${c.client_id}`,
      seenCount: bdCount.get(c.client_id) ?? 0,
      sentAt: null,
    });
  }

  return out;
}

async function togglePopup(row: UnifiedPopup, next: boolean): Promise<void> {
  if (row.popupType === "broadcast") {
    const { error } = await supabase.from("broadcasts").update({ status: next ? "Active" : "Archived" }).eq("id", row.id);
    if (error) throw error;
  } else if (row.popupType === "event") {
    const { error } = await (supabase.from("events") as any).update({ status: next ? "Active" : "Archived" }).eq("id", row.id);
    if (error) throw error;
  } else if (row.popupType === "birthday") {
    const { error } = await (supabase.from("client_birthday_cards") as any).update({ enabled: next }).eq("id", row.id);
    if (error) throw error;
  }
}

function PopupsManager() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-popups"],
    queryFn: fetchAllPopups,
  });

  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | PopupType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "off">("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.popupType !== typeFilter) return false;
      if (statusFilter === "active" && !r.enabled) return false;
      if (statusFilter === "off" && r.enabled) return false;
      if (needle && !`${r.title} ${r.audience}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, typeFilter, statusFilter]);

  const stats = useMemo(() => {
    const by: Record<PopupType, { total: number; active: number }> = {
      broadcast: { total: 0, active: 0 },
      event:     { total: 0, active: 0 },
      task:      { total: 0, active: 0 },
      birthday:  { total: 0, active: 0 },
    };
    for (const r of rows) {
      by[r.popupType].total += 1;
      if (r.enabled) by[r.popupType].active += 1;
    }
    return by;
  }, [rows]);

  async function handleToggle(row: UnifiedPopup, next: boolean) {
    if (!row.canToggle) return;
    try {
      await togglePopup(row, next);
      toast.success(next ? "Popup enabled" : "Popup disabled", { description: row.title });
      qc.invalidateQueries({ queryKey: ["admin-popups"] });
    } catch (e: any) {
      toast.error("Couldn't update popup", { description: e?.message ?? "Unknown error" });
    }
  }

  return (
    <>
      <PageHeader
        title="Popups Manager"
        subtitle="View, control, and quick-create every popup that runs in the app."
      />
      <div className="space-y-5 p-4 pb-32 md:p-6 md:pb-8">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(Object.keys(TYPE_META) as PopupType[]).map((t) => {
            const Icon = TYPE_META[t].icon;
            const c = TYPE_META[t].color;
            return (
              <Card key={t} className="p-4" style={{ borderColor: `${c}55`, backgroundColor: `${c}0d` }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" style={{ color: c }} />
                    <span className="text-xs font-bold uppercase tracking-widest" style={{ color: c }}>
                      {TYPE_META[t].label}s
                    </span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{stats[t].active} live</Badge>
                </div>
                <div className="mt-2 text-3xl font-black">{stats[t].total}</div>
              </Card>
            );
          })}
        </div>

        {/* Quick-create */}
        <Card className="p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Quick create
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate({ to: "/admin/broadcasts" })}>
              <Plus className="mr-1 h-3.5 w-3.5" /><Megaphone className="mr-1 h-3.5 w-3.5" /> New Broadcast
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate({ to: "/admin/events" })}>
              <Plus className="mr-1 h-3.5 w-3.5" /><Calendar className="mr-1 h-3.5 w-3.5" /> New Event
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate({ to: "/admin/tasks" })}>
              <Plus className="mr-1 h-3.5 w-3.5" /><ListChecks className="mr-1 h-3.5 w-3.5" /> New Task
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate({ to: "/admin/clients" })}>
              <Plus className="mr-1 h-3.5 w-3.5" /><Cake className="mr-1 h-3.5 w-3.5" /> Birthday Card (pick client)
            </Button>
          </div>
        </Card>

        {/* Filters */}
        <Card className="p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search popups by title or audience…"
                className="pl-8"
              />
            </div>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
              <SelectTrigger className="md:w-44"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="broadcast">Broadcasts</SelectItem>
                <SelectItem value="event">Events</SelectItem>
                <SelectItem value="task">Tasks</SelectItem>
                <SelectItem value="birthday">Birthday cards</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="md:w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Live / enabled</SelectItem>
                <SelectItem value="off">Off / archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Table */}
        <Card className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-[160px]">Audience</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[100px] text-center"><Eye className="mx-auto h-3.5 w-3.5" /></TableHead>
                  <TableHead className="w-[100px] text-center">Enabled</TableHead>
                  <TableHead className="w-[120px] text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No popups match your filters.</TableCell></TableRow>
                ) : filtered.map((r) => {
                  const Icon = TYPE_META[r.popupType].icon;
                  const color = TYPE_META[r.popupType].color;
                  return (
                    <TableRow key={`${r.popupType}:${r.id}`}>
                      <TableCell>
                        <Badge variant="outline" className="gap-1.5" style={{ borderColor: `${color}80`, color }}>
                          <Icon className="h-3 w-3" />
                          {TYPE_META[r.popupType].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate font-medium" title={r.title}>{r.title}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.audience}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={toneClass(r.statusTone)}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-center text-sm tabular-nums">
                        {r.seenCount == null ? <span className="text-muted-foreground">—</span> : r.seenCount}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.canToggle ? (
                          <Switch checked={r.enabled} onCheckedChange={(v) => handleToggle(r, v)} />
                        ) : (
                          <Badge variant="outline" className="text-[10px]">system</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to={r.editPath as any}>
                            <ExternalLink className="mr-1 h-3.5 w-3.5" />Open
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </>
  );
}
