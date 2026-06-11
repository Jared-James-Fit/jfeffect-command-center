import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Archive, Eye, Megaphone, Pencil, Trash2, Calendar as CalendarIcon, Cake, ClipboardCheck, Image as ImageIcon, UserCog, Activity } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export const Route = createFileRoute("/_authenticated/admin/load-screens")({ component: LoadScreensPage });

function LoadScreensPage() {
  return (
    <>
      <PageHeader
        title="Load Screens & Setup"
        subtitle="All popups, prompts, and setup screens that show when clients open the app."
      />
      <div className="p-6 md:p-8 pb-32">
        <Tabs defaultValue="broadcasts" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="broadcasts" className="text-xs sm:text-sm"><Megaphone className="mr-1 h-3.5 w-3.5" />Broadcasts</TabsTrigger>
            <TabsTrigger value="events" className="text-xs sm:text-sm"><CalendarIcon className="mr-1 h-3.5 w-3.5" />Event Popups</TabsTrigger>
            <TabsTrigger value="birthdays" className="text-xs sm:text-sm"><Cake className="mr-1 h-3.5 w-3.5" />Birthday Cards</TabsTrigger>
            <TabsTrigger value="setup" className="text-xs sm:text-sm"><ClipboardCheck className="mr-1 h-3.5 w-3.5" />Setup Gates</TabsTrigger>
          </TabsList>
          <TabsContent value="broadcasts"><BroadcastsPanel /></TabsContent>
          <TabsContent value="events"><EventsPanel /></TabsContent>
          <TabsContent value="birthdays"><BirthdaysPanel /></TabsContent>
          <TabsContent value="setup"><SetupGatesPanel /></TabsContent>
        </Tabs>
      </div>
    </>
  );
}

/* -------- shared bulk toolbar -------- */
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

/* ================= BROADCASTS ================= */
function BroadcastsPanel() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["load-screens-broadcasts"],
    queryFn: async () => (await sb.from("broadcasts").select("*").order("publish_at", { ascending: false })).data ?? [],
  });

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(rows.map((r: any) => r.id)) : new Set());

  const doArchive = async () => {
    const ids = [...selected];
    const { error } = await sb.from("broadcasts").update({ status: "Archived" }).in("id", ids);
    if (error) toast.error(error.message); else toast.success(`Archived ${ids.length}`);
    setSelected(new Set()); setConfirm(null); qc.invalidateQueries({ queryKey: ["load-screens-broadcasts"] });
  };
  const doDelete = async () => {
    const ids = [...selected];
    const { error } = await sb.from("broadcasts").delete().in("id", ids);
    if (error) toast.error(error.message); else toast.success(`Deleted ${ids.length}`);
    setSelected(new Set()); setConfirm(null); qc.invalidateQueries({ queryKey: ["load-screens-broadcasts"] });
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

/* ================= EVENTS ================= */
function EventsPanel() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["load-screens-events"],
    queryFn: async () => (await sb.from("events").select("id, name, event_type, event_date, status, audience_scope, importance, archived_at").order("event_date", { ascending: false })).data ?? [],
  });

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(rows.map((r: any) => r.id)) : new Set());

  const doArchive = async () => {
    const ids = [...selected];
    const { error } = await sb.from("events").update({ archived_at: new Date().toISOString(), status: "Archived" }).in("id", ids);
    if (error) toast.error(error.message); else toast.success(`Archived ${ids.length}`);
    setSelected(new Set()); setConfirm(null); qc.invalidateQueries({ queryKey: ["load-screens-events"] });
  };
  const doDelete = async () => {
    const ids = [...selected];
    const { error } = await sb.from("events").delete().in("id", ids);
    if (error) toast.error(error.message); else toast.success(`Deleted ${ids.length}`);
    setSelected(new Set()); setConfirm(null); qc.invalidateQueries({ queryKey: ["load-screens-events"] });
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

/* ================= BIRTHDAY CARDS ================= */
function BirthdaysPanel() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["load-screens-birthdays"],
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
    setSelected(new Set()); setConfirm(null); qc.invalidateQueries({ queryKey: ["load-screens-birthdays"] });
  };
  const doDelete = async () => {
    const ids = [...selected];
    const { error } = await sb.from("client_birthday_cards").delete().in("id", ids);
    if (error) toast.error(error.message); else toast.success(`Deleted ${ids.length}`);
    setSelected(new Set()); setConfirm(null); qc.invalidateQueries({ queryKey: ["load-screens-birthdays"] });
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

/* ================= SETUP GATES ================= */
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
