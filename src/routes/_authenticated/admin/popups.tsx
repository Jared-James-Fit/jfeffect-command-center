import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Megaphone, Calendar as CalendarIcon, ListChecks, Cake, ExternalLink, Plus, Eye, Search,
  Smartphone, ClipboardCheck, Archive, Pencil, Trash2, Image as ImageIcon, UserCog, Activity, LayoutGrid,
} from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export const Route = createFileRoute("/_authenticated/admin/popups")({
  component: PopupsManager,
});

/* ============================================================
   OVERVIEW (unified list of every popup)
   ============================================================ */

type PopupType = "broadcast" | "event" | "task" | "birthday" | "install";

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
  broadcast: { label: "Broadcast", icon: Megaphone,   color: "#3b82f6" },
  event:     { label: "Event",     icon: CalendarIcon, color: "#a855f7" },
  task:      { label: "Task",      icon: ListChecks,  color: "#22c55e" },
  birthday:  { label: "Birthday",  icon: Cake,        color: "#ec4899" },
  install:   { label: "Install",   icon: Smartphone,  color: "#0ea5e9" },
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
  const [bc, ev, tk, bd, ip, bcSeen, evAcks, bdViews] = await Promise.all([
    supabase.from("broadcasts").select("id,title,type,audience_scope,status,publish_at,expires_at,created_at"),
    supabase.from("events").select("id,name,importance,audience_scope,status,event_date").in("importance", ["High", "Critical"]),
    supabase.from("tasks").select("id,title,status,quadrant").eq("status", "open"),
    sb.from("client_birthday_cards").select("id,client_id,enabled,template_key,headline,clients(full_name)"),
    sb.from("setup_prompts").select("id,title,audience_scope,enabled,sort_order"),
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

  for (const p of (ip.data ?? []) as any[]) {
    const tone: UnifiedPopup["statusTone"] = p.enabled ? "active" : "off";
    out.push({
      popupType: "install",
      id: p.id,
      title: p.title || "(untitled install prompt)",
      audience: p.audience_scope ?? "everyone",
      status: p.enabled ? "Enabled" : "Disabled",
      statusTone: tone,
      enabled: !!p.enabled,
      canToggle: true,
      editPath: `/admin/popups?tab=install&edit=${p.id}`,
      seenCount: null,
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
    const { error } = await sb.from("events").update({ status: next ? "Active" : "Archived" }).eq("id", row.id);
    if (error) throw error;
  } else if (row.popupType === "birthday") {
    const { error } = await sb.from("client_birthday_cards").update({ enabled: next }).eq("id", row.id);
    if (error) throw error;
  } else if (row.popupType === "install") {
    const { error } = await sb.from("setup_prompts").update({ enabled: next }).eq("id", row.id);
    if (error) throw error;
  }
}

function OverviewPanel({ onJumpToTab }: { onJumpToTab: (tab: string) => void }) {
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
      install:   { total: 0, active: 0 },
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

  function handleEdit(row: UnifiedPopup) {
    if (row.popupType === "install") {
      onJumpToTab("install");
      return;
    }
    navigate({ to: row.editPath as any });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
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

      <Card className="p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Quick create</div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate({ to: "/admin/broadcasts" })}>
            <Plus className="mr-1 h-3.5 w-3.5" /><Megaphone className="mr-1 h-3.5 w-3.5" /> New Broadcast
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate({ to: "/admin/events" })}>
            <Plus className="mr-1 h-3.5 w-3.5" /><CalendarIcon className="mr-1 h-3.5 w-3.5" /> New Event
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate({ to: "/admin/tasks" })}>
            <Plus className="mr-1 h-3.5 w-3.5" /><ListChecks className="mr-1 h-3.5 w-3.5" /> New Task
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate({ to: "/admin/clients" })}>
            <Plus className="mr-1 h-3.5 w-3.5" /><Cake className="mr-1 h-3.5 w-3.5" /> Birthday Card
          </Button>
          <Button size="sm" variant="outline" onClick={() => onJumpToTab("install")}>
            <Plus className="mr-1 h-3.5 w-3.5" /><Smartphone className="mr-1 h-3.5 w-3.5" /> New Install Prompt
          </Button>
        </div>
      </Card>

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
              <SelectItem value="install">Install prompts</SelectItem>
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
                      <Button size="sm" variant="outline" onClick={() => handleEdit(r)}>
                        <ExternalLink className="mr-1 h-3.5 w-3.5" />
                        {r.popupType === "install" ? "Edit" : "Open"}
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
  );
}

/* ============================================================
   SHARED BULK HELPERS
   ============================================================ */

function BulkBar({
  total, selectedCount, onToggleAll, onArchive, onDelete, archiveLabel = "Archive selected",
}: {
  total: number; selectedCount: number; onToggleAll: (checked: boolean) => void;
  onArchive?: () => void; onDelete: () => void; archiveLabel?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-secondary/30 p-2">
      <label className="flex items-center gap-2 text-xs font-semibold">
        <Checkbox checked={total > 0 && selectedCount === total} onCheckedChange={(c) => onToggleAll(!!c)} />
        Select all ({selectedCount}/{total})
      </label>
      <div className="flex flex-wrap gap-2">
        {onArchive && (
          <Button size="sm" variant="outline" disabled={selectedCount === 0} onClick={onArchive}>
            <Archive className="mr-1 h-3.5 w-3.5" /> {archiveLabel}
          </Button>
        )}
        <Button size="sm" variant="destructive" disabled={selectedCount === 0} onClick={onDelete}>
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete selected
        </Button>
      </div>
    </div>
  );
}

function ConfirmDialog({
  open, onOpenChange, title, description, confirmText = "Confirm", destructive, onConfirm,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description: string;
  confirmText?: string; destructive?: boolean; onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            onClick={onConfirm}
          >{confirmText}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ================= BROADCASTS BULK ================= */
function BroadcastsPanel() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["popups-broadcasts"],
    queryFn: async () => (await sb.from("broadcasts").select("*").order("publish_at", { ascending: false })).data ?? [],
  });

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(rows.map((r: any) => r.id)) : new Set());

  const doArchive = async () => {
    const ids = [...selected];
    const { error } = await sb.from("broadcasts").update({ status: "Archived" }).in("id", ids);
    if (error) toast.error(error.message); else toast.success(`Archived ${ids.length}`);
    setSelected(new Set()); setConfirm(null); qc.invalidateQueries({ queryKey: ["popups-broadcasts"] });
    qc.invalidateQueries({ queryKey: ["admin-popups"] });
  };
  const doDelete = async () => {
    const ids = [...selected];
    const { error } = await sb.from("broadcasts").delete().in("id", ids);
    if (error) toast.error(error.message); else toast.success(`Deleted ${ids.length}`);
    setSelected(new Set()); setConfirm(null); qc.invalidateQueries({ queryKey: ["popups-broadcasts"] });
    qc.invalidateQueries({ queryKey: ["admin-popups"] });
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">Popups that appear when clients open the app. Edit opens the full broadcast editor.</div>
        <Button asChild size="sm" variant="outline"><Link to="/admin/broadcasts">Open full editor</Link></Button>
      </div>
      <BulkBar total={rows.length} selectedCount={selected.size} onToggleAll={toggleAll}
        onArchive={() => setConfirm("archive")} onDelete={() => setConfirm("delete")} />
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No broadcasts.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r: any) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
              <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold">{r.title}</span>
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                  <Badge variant="outline" className="text-[10px]">{r.type}</Badge>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Publish {format(new Date(r.publish_at), "MMM d, yyyy h:mma")}{r.expires_at ? ` · Expires ${format(new Date(r.expires_at), "MMM d")}` : ""}
                </div>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/admin/broadcasts/$broadcastId" params={{ broadcastId: r.id }}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={confirm === "archive"} onOpenChange={(v) => !v && setConfirm(null)}
        title="Archive broadcasts?" description={`${selected.size} will be hidden from clients but kept.`}
        confirmText="Archive" onConfirm={doArchive} />
      <ConfirmDialog open={confirm === "delete"} onOpenChange={(v) => !v && setConfirm(null)}
        title="Delete broadcasts?" description={`${selected.size} will be permanently deleted.`}
        confirmText="Delete" destructive onConfirm={doDelete} />
    </Card>
  );
}

/* ================= EVENTS BULK ================= */
function EventsPanel() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["popups-events"],
    queryFn: async () => (await sb.from("events").select("id, name, event_type, event_date, status, audience_scope, importance, archived_at").order("event_date", { ascending: false })).data ?? [],
  });

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(rows.map((r: any) => r.id)) : new Set());

  const doArchive = async () => {
    const ids = [...selected];
    const { error } = await sb.from("events").update({ archived_at: new Date().toISOString(), status: "Archived" }).in("id", ids);
    if (error) toast.error(error.message); else toast.success(`Archived ${ids.length}`);
    setSelected(new Set()); setConfirm(null); qc.invalidateQueries({ queryKey: ["popups-events"] });
    qc.invalidateQueries({ queryKey: ["admin-popups"] });
  };
  const doDelete = async () => {
    const ids = [...selected];
    const { error } = await sb.from("events").delete().in("id", ids);
    if (error) toast.error(error.message); else toast.success(`Deleted ${ids.length}`);
    setSelected(new Set()); setConfirm(null); qc.invalidateQueries({ queryKey: ["popups-events"] });
    qc.invalidateQueries({ queryKey: ["admin-popups"] });
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">Events that surface as popups based on reminders/deadlines.</div>
        <Button asChild size="sm" variant="outline"><Link to="/admin/events">Open full editor</Link></Button>
      </div>
      <BulkBar total={rows.length} selectedCount={selected.size} onToggleAll={toggleAll}
        onArchive={() => setConfirm("archive")} onDelete={() => setConfirm("delete")} />
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No events.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r: any) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
              <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold">{r.name}</span>
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                  <Badge variant="outline" className="text-[10px]">{r.event_type}</Badge>
                  <Badge variant="outline" className="text-[10px]">{r.importance}</Badge>
                  {r.archived_at && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {format(new Date(r.event_date + "T00:00:00"), "MMM d, yyyy")} · {r.audience_scope}
                </div>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/admin/events/$id" params={{ id: r.id }}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={confirm === "archive"} onOpenChange={(v) => !v && setConfirm(null)}
        title="Archive events?" description={`${selected.size} will be archived.`}
        confirmText="Archive" onConfirm={doArchive} />
      <ConfirmDialog open={confirm === "delete"} onOpenChange={(v) => !v && setConfirm(null)}
        title="Delete events?" description={`${selected.size} will be permanently deleted (including popups, deadlines, assignments).`}
        confirmText="Delete" destructive onConfirm={doDelete} />
    </Card>
  );
}

/* ================= BIRTHDAY CARDS BULK ================= */
function BirthdaysPanel() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["popups-birthdays"],
    queryFn: async () => {
      const { data } = await sb
        .from("client_birthday_cards")
        .select("id, client_id, enabled, headline, template_key, updated_at, clients!inner(id, full_name, date_of_birth)")
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(rows.map((r: any) => r.id)) : new Set());

  const doArchive = async () => {
    const ids = [...selected];
    const { error } = await sb.from("client_birthday_cards").update({ enabled: false }).in("id", ids);
    if (error) toast.error(error.message); else toast.success(`Disabled ${ids.length}`);
    setSelected(new Set()); setConfirm(null); qc.invalidateQueries({ queryKey: ["popups-birthdays"] });
    qc.invalidateQueries({ queryKey: ["admin-popups"] });
  };
  const doDelete = async () => {
    const ids = [...selected];
    const { error } = await sb.from("client_birthday_cards").delete().in("id", ids);
    if (error) toast.error(error.message); else toast.success(`Deleted ${ids.length}`);
    setSelected(new Set()); setConfirm(null); qc.invalidateQueries({ queryKey: ["popups-birthdays"] });
    qc.invalidateQueries({ queryKey: ["admin-popups"] });
  };

  return (
    <Card className="p-4">
      <div className="mb-3 text-xs text-muted-foreground">
        Birthday cards shown to clients on their birthday. "Archive" disables the card without deleting it.
      </div>
      <BulkBar total={rows.length} selectedCount={selected.size} onToggleAll={toggleAll}
        onArchive={() => setConfirm("archive")} onDelete={() => setConfirm("delete")}
        archiveLabel="Disable selected" />
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No birthday cards configured.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r: any) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
              <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold">{r.clients?.full_name ?? "Client"}</span>
                  <Badge variant="outline" className="text-[10px]">{r.enabled ? "Enabled" : "Disabled"}</Badge>
                  {r.template_key && <Badge variant="outline" className="text-[10px]">{r.template_key}</Badge>}
                </div>
                <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                  {r.headline ?? "(default headline)"}
                  {r.clients?.date_of_birth ? ` · DOB ${r.clients.date_of_birth}` : ""}
                </div>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/clients/$id" params={{ id: r.client_id }}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit client
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/client-pov">
                    <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={confirm === "archive"} onOpenChange={(v) => !v && setConfirm(null)}
        title="Disable birthday cards?" description={`${selected.size} cards will be hidden from clients.`}
        confirmText="Disable" onConfirm={doArchive} />
      <ConfirmDialog open={confirm === "delete"} onOpenChange={(v) => !v && setConfirm(null)}
        title="Delete birthday cards?" description={`${selected.size} cards will be permanently deleted.`}
        confirmText="Delete" destructive onConfirm={doDelete} />
    </Card>
  );
}

/* ================= INSTALL PROMPTS (Add to Home Screen) ================= */
type InstallPrompt = {
  id: string;
  title: string;
  body: string | null;
  video_embed_url: string | null;
  video_url: string | null;
  link_url: string | null;
  link_label: string | null;
  ios_steps: string[];
  android_steps: string[];
  audience_scope: string;
  enabled: boolean;
  sort_order: number;
};

function emptyPrompt(): Partial<InstallPrompt> {
  return {
    title: "",
    body: "",
    video_embed_url: "",
    video_url: "",
    link_url: "",
    link_label: "",
    ios_steps: [],
    android_steps: [],
    audience_scope: "everyone",
    enabled: true,
    sort_order: 0,
  };
}

function InstallPromptsPanel() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | "delete">(null);
  const [editing, setEditing] = useState<Partial<InstallPrompt> | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["popups-install"],
    queryFn: async () =>
      (await sb.from("setup_prompts").select("*").order("sort_order", { ascending: true })).data ?? [],
  });

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(rows.map((r: any) => r.id)) : new Set());

  const doDelete = async () => {
    const ids = [...selected];
    const { error } = await sb.from("setup_prompts").delete().in("id", ids);
    if (error) toast.error(error.message); else toast.success(`Deleted ${ids.length}`);
    setSelected(new Set()); setConfirm(null);
    qc.invalidateQueries({ queryKey: ["popups-install"] });
    qc.invalidateQueries({ queryKey: ["admin-popups"] });
  };

  const toggleEnabled = async (id: string, enabled: boolean) => {
    const { error } = await sb.from("setup_prompts").update({ enabled }).eq("id", id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["popups-install"] });
    qc.invalidateQueries({ queryKey: ["admin-popups"] });
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Setup popups that appear when users first open the app (Add to Home Screen, install guides, etc.). Disable to hide without deleting.
        </div>
        <Button size="sm" onClick={() => setEditing(emptyPrompt())}>
          <Plus className="mr-1 h-3.5 w-3.5" /> New prompt
        </Button>
      </div>
      <BulkBar total={rows.length} selectedCount={selected.size} onToggleAll={toggleAll}
        onDelete={() => setConfirm("delete")} />
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No install prompts.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r: any) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
              <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold">{r.title}</span>
                  <Badge variant="outline" className="text-[10px]">{r.audience_scope}</Badge>
                  <Badge variant="outline" className="text-[10px]">Order {r.sort_order}</Badge>
                </div>
                {r.body && <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{r.body}</div>}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Switch checked={r.enabled} onCheckedChange={(v) => toggleEnabled(r.id, v)} />
                  {r.enabled ? "On" : "Off"}
                </label>
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={confirm === "delete"} onOpenChange={(v) => !v && setConfirm(null)}
        title="Delete install prompts?" description={`${selected.size} will be permanently deleted.`}
        confirmText="Delete" destructive onConfirm={doDelete} />
      {editing && (
        <InstallPromptEditor
          value={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["popups-install"] });
            qc.invalidateQueries({ queryKey: ["admin-popups"] });
          }}
        />
      )}
    </Card>
  );
}

function InstallPromptEditor({
  value, onClose, onSaved,
}: { value: Partial<InstallPrompt>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<InstallPrompt>>(value);
  const [iosText, setIosText] = useState((value.ios_steps ?? []).join("\n"));
  const [andText, setAndText] = useState((value.android_steps ?? []).join("\n"));
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm(value); setIosText((value.ios_steps ?? []).join("\n")); setAndText((value.android_steps ?? []).join("\n")); }, [value]);

  const save = async () => {
    if (!form.title?.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      body: form.body || null,
      video_embed_url: form.video_embed_url || null,
      video_url: form.video_url || null,
      link_url: form.link_url || null,
      link_label: form.link_label || null,
      ios_steps: iosText.split("\n").map((s) => s.trim()).filter(Boolean),
      android_steps: andText.split("\n").map((s) => s.trim()).filter(Boolean),
      audience_scope: form.audience_scope || "everyone",
      enabled: form.enabled ?? true,
      sort_order: Number(form.sort_order ?? 0),
    };
    const q = form.id
      ? sb.from("setup_prompts").update(payload).eq("id", form.id)
      : sb.from("setup_prompts").insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit install prompt" : "New install prompt"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Title</Label>
            <Input value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div><Label className="text-xs">Body / description</Label>
            <Textarea rows={2} value={form.body ?? ""} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">YouTube embed URL</Label>
              <Input placeholder="https://www.youtube.com/embed/..." value={form.video_embed_url ?? ""} onChange={(e) => setForm({ ...form, video_embed_url: e.target.value })} />
            </div>
            <div><Label className="text-xs">External video link</Label>
              <Input placeholder="https://youtu.be/..." value={form.video_url ?? ""} onChange={(e) => setForm({ ...form, video_url: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">iOS steps (one per line)</Label>
              <Textarea rows={4} value={iosText} onChange={(e) => setIosText(e.target.value)} />
            </div>
            <div><Label className="text-xs">Android steps (one per line)</Label>
              <Textarea rows={4} value={andText} onChange={(e) => setAndText(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label className="text-xs">Audience</Label>
              <select className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={form.audience_scope ?? "everyone"}
                onChange={(e) => setForm({ ...form, audience_scope: e.target.value })}>
                <option value="everyone">Everyone</option>
                <option value="coaching_clients">Coaching clients</option>
                <option value="app_members">App members</option>
              </select>
            </div>
            <div><Label className="text-xs">Sort order</Label>
              <Input type="number" value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={form.enabled ?? true} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
              <span className="text-xs">{form.enabled ? "Enabled" : "Disabled"}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ================= SETUP GATES (info-only) ================= */
function SetupGatesPanel() {
  const gates = [
    {
      icon: ImageIcon,
      title: "Profile Picture",
      desc: "First-load gate that asks new clients to upload a profile picture. Reads clients.profile_picture_url — once set, the gate stops showing.",
      manage: "Per-client: edit on the client's profile page.",
      link: "/admin/clients" as const,
      linkLabel: "Open clients",
    },
    {
      icon: UserCog,
      title: "Basic Info",
      desc: "First-load gate collecting essentials (name, phone, DOB, address, etc.). Skips once required fields exist on the client record.",
      manage: "Per-client: edit fields on the client's profile page.",
      link: "/admin/clients" as const,
      linkLabel: "Open clients",
    },
    {
      icon: Activity,
      title: "Training Schedule",
      desc: "First-load gate where the client picks available training days. Powers auto-scheduling. Skips once the client has committed/available days set.",
      manage: "Per-client: edit training availability on the client's profile or the Workouts tab.",
      link: "/admin/clients" as const,
      linkLabel: "Open clients",
    },
  ];
  return (
    <Card className="p-4 space-y-3">
      <div className="text-xs text-muted-foreground">
        These prompts appear automatically when a client first opens the app, until each is completed. They live on the client record — no separate items to delete.
      </div>
      {gates.map((g) => (
        <div key={g.title} className="rounded-md border border-border bg-card p-3">
          <div className="flex items-start gap-3">
            <g.icon className="mt-0.5 h-5 w-5 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">{g.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{g.desc}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{g.manage}</div>
            </div>
            <Button asChild size="sm" variant="outline"><Link to={g.link}>{g.linkLabel}</Link></Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

/* ============================================================
   PAGE
   ============================================================ */
function PopupsManager() {
  const [tab, setTab] = useState<string>(() => {
    if (typeof window === "undefined") return "overview";
    const p = new URLSearchParams(window.location.search).get("tab");
    return p ?? "overview";
  });

  return (
    <>
      <PageHeader
        title="Popups"
        subtitle="Every popup, load-screen, and setup prompt that shows in the app — in one place."
      />
      <div className="space-y-5 p-4 pb-32 md:p-6 md:pb-8">
        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-6">
            <TabsTrigger value="overview" className="text-xs sm:text-sm"><LayoutGrid className="mr-1 h-3.5 w-3.5" />Overview</TabsTrigger>
            <TabsTrigger value="broadcasts" className="text-xs sm:text-sm"><Megaphone className="mr-1 h-3.5 w-3.5" />Broadcasts</TabsTrigger>
            <TabsTrigger value="events" className="text-xs sm:text-sm"><CalendarIcon className="mr-1 h-3.5 w-3.5" />Events</TabsTrigger>
            <TabsTrigger value="birthdays" className="text-xs sm:text-sm"><Cake className="mr-1 h-3.5 w-3.5" />Birthdays</TabsTrigger>
            <TabsTrigger value="install" className="text-xs sm:text-sm"><Smartphone className="mr-1 h-3.5 w-3.5" />Install</TabsTrigger>
            <TabsTrigger value="setup" className="text-xs sm:text-sm"><ClipboardCheck className="mr-1 h-3.5 w-3.5" />Setup Gates</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><OverviewPanel onJumpToTab={setTab} /></TabsContent>
          <TabsContent value="broadcasts"><BroadcastsPanel /></TabsContent>
          <TabsContent value="events"><EventsPanel /></TabsContent>
          <TabsContent value="birthdays"><BirthdaysPanel /></TabsContent>
          <TabsContent value="install"><InstallPromptsPanel /></TabsContent>
          <TabsContent value="setup"><SetupGatesPanel /></TabsContent>
        </Tabs>
      </div>
    </>
  );
}