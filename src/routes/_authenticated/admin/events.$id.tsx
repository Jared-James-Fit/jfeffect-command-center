import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Trash2, Plus, ExternalLink, Copy, Eye, Archive as ArchiveIcon, Save, Users, ChevronUp, ChevronDown, CalendarClock,
} from "lucide-react";
import { toast } from "sonner";
import {
  EVENT_TYPES, EVENT_IMPORTANCE, EVENT_STATUSES, EVENT_LINK_TYPES, REMINDER_OFFSETS,
  getEvent, guessLinkType, guessLinkTitle, computeCountdown,
  type EventRow, type QuickLink, type Deadline, type Reminder, type EventType, type EventImportance,
  type EventStatus, type EventLinkType, type AudienceScope, type ReminderOffsetKey,
  parseFormattedEvent,
} from "@/lib/events";
import { ClientEventDetail } from "@/components/events/client-event-detail";
import { DoubleConfirmDeleteDialog } from "@/components/double-confirm-delete-dialog";
import { deleteEventAndCalendar, saveEventAndSyncCalendar } from "@/lib/events.functions";

export const Route = createFileRoute("/_authenticated/admin/events/$id")({
  component: EventEditorPage,
});

function EventEditorPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const saveEventFn = useServerFn(saveEventAndSyncCalendar);
  const deleteEventFn = useServerFn(deleteEventAndCalendar);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-event", id],
    queryFn: () => getEvent(id),
  });

  const [ev, setEv] = useState<EventRow | null>(null);
  useEffect(() => { if (data?.event) setEv(data.event); }, [data?.event]);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [parseOpen, setParseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isLoading || !ev) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const evt: EventRow = ev;
  const links = data?.links ?? [];
  const deadlines = data?.deadlines ?? [];
  const reminders = data?.reminders ?? [];
  const assignments = data?.assignments ?? [];

  const update = (patch: Partial<EventRow>) => setEv((cur) => (cur ? { ...cur, ...patch } : cur));

  async function save() {
    if (!evt) return;
    try {
      const result = await saveEventFn({ data: {
        id: evt.id, name: evt.name, event_type: evt.event_type, event_date: evt.event_date,
        start_time: evt.start_time || null, end_time: evt.end_time || null, timezone: evt.timezone || null,
        location: evt.location || null, description: evt.description || null,
        client_facing_notes: evt.client_facing_notes || null, internal_notes: evt.internal_notes || null,
        importance: evt.importance, status: evt.status, audience_scope: evt.audience_scope,
        google_calendar_transparency: evt.google_calendar_transparency ?? "transparent",
      } as any });
      toast.success(result.calendarSynced ? "Event saved and added to Google Calendar" : "Event saved");
      if (!result.calendarSynced && result.calendarError) toast.warning(`Calendar sync skipped: ${result.calendarError}`);
      qc.invalidateQueries({ queryKey: ["admin-event", id] });
      qc.invalidateQueries({ queryKey: ["admin-events"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save event");
    }
  }

  async function duplicate() {
    const { data: u } = await supabase.auth.getUser();
    const { data: ins, error } = await (supabase.from("events") as any).insert({
      name: evt.name + " (copy)", event_type: evt.event_type, event_date: evt.event_date,
      start_time: evt.start_time, end_time: evt.end_time, location: evt.location,
      description: evt.description, client_facing_notes: evt.client_facing_notes,
      internal_notes: evt.internal_notes, importance: evt.importance, status: "Draft",
      audience_scope: evt.audience_scope, created_by: u.user?.id,
    }).select("id").single();
    if (error) { toast.error(error.message); return; }
    if (links.length) await (supabase.from("event_quick_links") as any).insert(
      links.map((l) => ({ ...l, id: undefined, event_id: ins.id })),
    );
    if (deadlines.length) await (supabase.from("event_deadlines") as any).insert(
      deadlines.map((d) => ({ ...d, id: undefined, event_id: ins.id })),
    );
    if (reminders.length) await (supabase.from("event_reminders") as any).insert(
      reminders.map((r) => ({ ...r, id: undefined, event_id: ins.id, last_fired_on: null })),
    );
    toast.success("Event duplicated");
    nav({ to: "/admin/events/$id", params: { id: ins.id } });
  }

  async function archive() {
    const { error } = await (supabase.from("events") as any)
      .update({ status: "Archived", archived_at: new Date().toISOString() })
      .eq("id", evt.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Event archived");
    qc.invalidateQueries({ queryKey: ["admin-event", id] });
    qc.invalidateQueries({ queryKey: ["admin-events"] });
    nav({ to: "/admin/events" });
  }

  async function removeEvent() {
    try {
      await deleteEventFn({ data: { id: evt.id } });
      toast.success("Event deleted");
      nav({ to: "/admin/events" });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete event");
    }
  }

  function applyParsed(p: ReturnType<typeof parseFormattedEvent>) {
    update({
      name: p.name ?? evt.name,
      event_type: p.event_type ?? evt.event_type,
      event_date: p.event_date ?? evt.event_date,
      start_time: p.start_time ?? evt.start_time,
      end_time: p.end_time ?? evt.end_time,
      location: p.location ?? evt.location,
      importance: p.importance ?? evt.importance,
      description: p.description ?? evt.description,
      client_facing_notes: p.client_facing_notes ?? evt.client_facing_notes,
      internal_notes: p.internal_notes ?? evt.internal_notes,
    });
    // Insert links/deadlines/reminders
    (async () => {
      if (p.quick_links.length) {
        const rows = p.quick_links.map((l, i) => ({ ...l, event_id: evt.id, sort_order: (links.length + i) }));
        await (supabase.from("event_quick_links") as any).insert(rows);
      }
      if (p.deadlines.length) {
        const rows = p.deadlines.map((d, i) => ({ ...d, event_id: evt.id, sort_order: (deadlines.length + i) }));
        await (supabase.from("event_deadlines") as any).insert(rows);
      }
      for (const [key, msg] of Object.entries(p.reminders)) {
        await (supabase.from("event_reminders") as any).upsert({
          event_id: evt.id, offset_key: key, enabled: true, message: msg,
          visible_to_client: p.reminders_visible_to_client ?? true,
        }, { onConflict: "event_id,offset_key" });
      }
      qc.invalidateQueries({ queryKey: ["admin-event", id] });
      toast.success("Parsed event applied");
    })();
  }

  const countdown = computeCountdown(evt.event_date);

  return (
    <div className="space-y-4">
      <PageHeader
        title={evt.name || "Untitled event"}
        subtitle={`${evt.event_type} · ${countdown.label}`}
        backTo="/admin/events"
        backLabel="All events"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}><Eye className="mr-1 h-4 w-4" />Preview as client</Button>
            <Button variant="outline" size="sm" onClick={() => setParseOpen(true)}>Paste & Parse</Button>
            <Button variant="outline" size="sm" onClick={duplicate}><Copy className="mr-1 h-4 w-4" />Duplicate</Button>
            <Button variant="outline" size="sm" onClick={archive}><ArchiveIcon className="mr-1 h-4 w-4" />Archive</Button>
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
            <Button size="sm" onClick={save}><Save className="mr-1 h-4 w-4" />Save</Button>
          </div>
        }
      />

      <Tabs defaultValue="details">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="links">Quick Links</TabsTrigger>
          <TabsTrigger value="deadlines">Deadlines</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          <TabsTrigger value="assign">Assign ({assignments.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <Card className="grid gap-4 p-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label>Event name</Label>
              <Input value={evt.name} onChange={(e) => update({ name: e.target.value })} />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={evt.event_type} onValueChange={(v) => update({ event_type: v as EventType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Importance</Label>
              <Select value={evt.importance} onValueChange={(v) => update({ importance: v as EventImportance })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EVENT_IMPORTANCE.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={evt.event_date} onChange={(e) => update({ event_date: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Start time</Label>
                <Input type="time" value={evt.start_time ?? ""} onChange={(e) => update({ start_time: e.target.value || null })} />
              </div>
              <div>
                <Label>End time</Label>
                <Input type="time" value={evt.end_time ?? ""} onChange={(e) => update({ end_time: e.target.value || null })} />
              </div>
            </div>
            <div className="md:col-span-2">
              <Label>Location</Label>
              <Input value={evt.location ?? ""} onChange={(e) => update({ location: e.target.value })} placeholder="Venue, city" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={evt.status} onValueChange={(v) => update({ status: v as EventStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EVENT_STATUSES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">Clients only see Active or Completed events.</p>
            </div>
            <div>
              <Label>Audience</Label>
              <Select value={evt.audience_scope} onValueChange={(v) => update({ audience_scope: v as AudienceScope })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="selected_clients">Selected clients only</SelectItem>
                  <SelectItem value="all_coaching">All active coaching clients</SelectItem>
                  <SelectItem value="app_members">All app members</SelectItem>
                  <SelectItem value="program_only">Program-only members</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2 rounded-md border border-border bg-secondary/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2">
                  <CalendarClock className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label>Google Calendar availability</Label>
                    <p className="text-xs text-muted-foreground">
                      This event is added to your connected calendar. Default is free so it does not block bookings.
                    </p>
                    {evt.google_event_link && (
                      <a href={evt.google_event_link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                        Open Google event <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {evt.google_sync_error && <p className="mt-1 text-xs text-destructive">Last sync failed: {evt.google_sync_error}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Free</span>
                  <Switch
                    checked={(evt.google_calendar_transparency ?? "transparent") === "opaque"}
                    onCheckedChange={(checked) => update({ google_calendar_transparency: checked ? "opaque" : "transparent" })}
                  />
                  <span className="text-xs font-medium text-muted-foreground">Busy</span>
                </div>
              </div>
            </div>
            <div className="md:col-span-2">
              <Label>Client-facing description</Label>
              <Textarea rows={4} value={evt.description ?? ""} onChange={(e) => update({ description: e.target.value })} placeholder="Short description clients will see on the event page." />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="space-y-4">
          <Card className="space-y-2 p-4">
            <Label>Client-facing notes</Label>
            <Textarea rows={5} value={evt.client_facing_notes ?? ""} onChange={(e) => update({ client_facing_notes: e.target.value })} />
            <p className="text-xs text-muted-foreground">Visible to assigned clients on the event detail page.</p>
          </Card>
          <Card className="space-y-2 p-4">
            <Label>Internal coach notes</Label>
            <Textarea rows={5} value={evt.internal_notes ?? ""} onChange={(e) => update({ internal_notes: e.target.value })} />
            <p className="text-xs text-muted-foreground">Hidden from clients. Coach/admin only.</p>
          </Card>
        </TabsContent>

        <TabsContent value="links">
          <QuickLinksEditor eventId={evt.id} links={links} onChange={() => qc.invalidateQueries({ queryKey: ["admin-event", id] })} />
        </TabsContent>

        <TabsContent value="deadlines">
          <DeadlinesEditor eventId={evt.id} deadlines={deadlines} onChange={() => qc.invalidateQueries({ queryKey: ["admin-event", id] })} />
        </TabsContent>

        <TabsContent value="reminders">
          <RemindersEditor eventId={evt.id} reminders={reminders} onChange={() => qc.invalidateQueries({ queryKey: ["admin-event", id] })} />
        </TabsContent>

        <TabsContent value="assign">
          <AssignmentsEditor eventId={evt.id} assignments={assignments} onChange={() => qc.invalidateQueries({ queryKey: ["admin-event", id] })} />
        </TabsContent>
      </Tabs>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Preview as client</DialogTitle></DialogHeader>
          <div className="max-h-[70vh] overflow-auto">
            <ClientEventDetail
              event={evt}
              links={links.filter((l) => l.visible_to_client)}
              deadlines={deadlines.filter((d) => d.visible_to_client)}
              reminders={reminders.filter((r) => r.visible_to_client && r.enabled)}
              hideActions
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={parseOpen} onOpenChange={setParseOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Paste formatted event</DialogTitle></DialogHeader>
          <ParseForm onApply={(p) => { applyParsed(p); setParseOpen(false); }} />
        </DialogContent>
      </Dialog>

      <DoubleConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete event?"
        message="This permanently removes the event, its links, deadlines, reminders, and assignments. This cannot be undone."
        strongWarning={`You are deleting "${evt.name}".`}
        confirmLabel="Delete event"
        onConfirm={removeEvent}
      />
    </div>
  );
}

/* ---------------- sub-components ---------------- */

function QuickLinksEditor({
  eventId, links, onChange,
}: { eventId: string; links: QuickLink[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ title: string; url: string; link_type: EventLinkType; visible_to_client: boolean }>({
    title: "", url: "", link_type: "Event Website", visible_to_client: true,
  });

  function onPasteUrl(text: string) {
    if (!/^https?:\/\//i.test(text)) return;
    const ty = guessLinkType(text);
    setDraft({ title: guessLinkTitle(text, ty), url: text, link_type: ty, visible_to_client: true });
    setAdding(true);
  }

  async function saveDraft() {
    if (!draft.title || !draft.url) { toast.error("Title and URL required"); return; }
    const { error } = await (supabase.from("event_quick_links") as any).insert({
      event_id: eventId, ...draft, sort_order: links.length,
    });
    if (error) { toast.error(error.message); return; }
    setDraft({ title: "", url: "", link_type: "Event Website", visible_to_client: true });
    setAdding(false);
    onChange();
  }

  async function updateLink(id: string, patch: Partial<QuickLink>) {
    const { error } = await (supabase.from("event_quick_links") as any).update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    onChange();
  }

  async function removeLink(id: string) {
    const { error } = await (supabase.from("event_quick_links") as any).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    onChange();
  }

  async function reorder(id: string, dir: -1 | 1) {
    const idx = links.findIndex((l) => l.id === id);
    const other = links[idx + dir];
    if (!other) return;
    await (supabase.from("event_quick_links") as any).update({ sort_order: other.sort_order }).eq("id", id);
    await (supabase.from("event_quick_links") as any).update({ sort_order: links[idx].sort_order }).eq("id", other.id);
    onChange();
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">Quick Links</div>
          <div className="text-xs text-muted-foreground">Paste a URL to auto-fill, or click Add Link.</div>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" />Add Link</Button>
      </div>

      <Input
        placeholder="Paste URL here to auto-create…"
        onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t) onPasteUrl(t); }}
      />

      {adding && (
        <Card className="space-y-2 border-primary/40 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <Input placeholder="https://…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            <Select value={draft.link_type} onValueChange={(v) => setDraft({ ...draft, link_type: v as EventLinkType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EVENT_LINK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch checked={draft.visible_to_client} onCheckedChange={(v) => setDraft({ ...draft, visible_to_client: v })} />
              <Label className="text-sm">Visible to client</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={saveDraft}>Save Link</Button>
          </div>
        </Card>
      )}

      {links.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No links yet.</div>
      ) : (
        <div className="space-y-2">
          {links.map((l, i) => (
            <Card key={l.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <Input value={l.title} onChange={(e) => updateLink(l.id, { title: e.target.value })} className="font-medium" />
                <div className="mt-1 flex items-center gap-2">
                  <Input value={l.url} onChange={(e) => updateLink(l.id, { url: e.target.value })} className="h-8 text-xs" />
                  <a href={l.url} target="_blank" rel="noreferrer" className="text-muted-foreground"><ExternalLink className="h-4 w-4" /></a>
                </div>
              </div>
              <Select value={l.link_type} onValueChange={(v) => updateLink(l.id, { link_type: v as EventLinkType })}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>{EVENT_LINK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Switch checked={l.visible_to_client} onCheckedChange={(v) => updateLink(l.id, { visible_to_client: v })} />
                <span className="text-xs text-muted-foreground">{l.visible_to_client ? "Client" : "Internal"}</span>
              </div>
              <div className="flex items-center">
                <Button size="icon" variant="ghost" onClick={() => reorder(l.id, -1)} disabled={i === 0}><ChevronUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => reorder(l.id, 1)} disabled={i === links.length - 1}><ChevronDown className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => navigator.clipboard.writeText(l.url)}><Copy className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => removeLink(l.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}

function DeadlinesEditor({
  eventId, deadlines, onChange,
}: { eventId: string; deadlines: Deadline[]; onChange: () => void }) {
  async function add() {
    const { error } = await (supabase.from("event_deadlines") as any).insert({
      event_id: eventId, title: "New deadline", visible_to_client: true, sort_order: deadlines.length,
    });
    if (error) { toast.error(error.message); return; }
    onChange();
  }
  async function update(id: string, patch: Partial<Deadline>) {
    const { error } = await (supabase.from("event_deadlines") as any).update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    onChange();
  }
  async function remove(id: string) {
    const { error } = await (supabase.from("event_deadlines") as any).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    onChange();
  }
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Key deadlines</div>
        <Button size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Add</Button>
      </div>
      {deadlines.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No deadlines yet.</div>
      ) : (
        <div className="space-y-2">
          {deadlines.map((d) => (
            <Card key={d.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_180px_140px_auto]">
              <Input value={d.title} onChange={(e) => update(d.id, { title: e.target.value })} />
              <Input type="date" value={d.due_date ?? ""} onChange={(e) => update(d.id, { due_date: e.target.value || null })} />
              <div className="flex items-center gap-2">
                <Switch checked={d.visible_to_client} onCheckedChange={(v) => update(d.id, { visible_to_client: v })} />
                <span className="text-xs text-muted-foreground">{d.visible_to_client ? "Client" : "Internal"}</span>
              </div>
              <Button size="icon" variant="ghost" onClick={() => remove(d.id)}><Trash2 className="h-4 w-4" /></Button>
              <Textarea
                className="sm:col-span-4"
                rows={2}
                placeholder="Notes (optional)"
                value={d.notes ?? ""}
                onChange={(e) => update(d.id, { notes: e.target.value })}
              />
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}

function RemindersEditor({
  eventId, reminders, onChange,
}: { eventId: string; reminders: Reminder[]; onChange: () => void }) {
  const byKey = useMemo(() => {
    const m = new Map<ReminderOffsetKey, Reminder>();
    for (const r of reminders) m.set(r.offset_key, r);
    return m;
  }, [reminders]);

  async function upsert(key: ReminderOffsetKey, patch: Partial<Reminder>) {
    const existing = byKey.get(key);
    if (existing) {
      const { error } = await (supabase.from("event_reminders") as any).update(patch).eq("id", existing.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await (supabase.from("event_reminders") as any).insert({
        event_id: eventId, offset_key: key, enabled: true, visible_to_client: true, ...patch,
      });
      if (error) { toast.error(error.message); return; }
    }
    onChange();
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="font-semibold">Reminder schedule</div>
      <p className="text-xs text-muted-foreground">Toggle each reminder, customize the message, and control client visibility.</p>
      <div className="space-y-2">
        {REMINDER_OFFSETS.map(({ key, label }) => {
          const r = byKey.get(key);
          const enabled = r ? r.enabled : true;
          return (
            <Card key={key} className="grid gap-2 p-3 sm:grid-cols-[160px_1fr_160px_auto]">
              <div className="font-medium text-sm self-center">{label}</div>
              <Input
                placeholder="Reminder message (optional)"
                value={r?.message ?? ""}
                onChange={(e) => upsert(key, { message: e.target.value })}
              />
              <div className="flex items-center gap-2">
                <Switch checked={r?.visible_to_client ?? true} onCheckedChange={(v) => upsert(key, { visible_to_client: v })} />
                <span className="text-xs text-muted-foreground">Client</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={enabled} onCheckedChange={(v) => upsert(key, { enabled: v })} />
                <span className="text-xs text-muted-foreground">{enabled ? "On" : "Off"}</span>
              </div>
            </Card>
          );
        })}
      </div>
    </Card>
  );
}

function AssignmentsEditor({
  eventId, assignments, onChange,
}: { eventId: string; assignments: { client_id: string; assigned_at: string }[]; onChange: () => void }) {
  const [search, setSearch] = useState("");

  const { data: clients } = useQuery({
    queryKey: ["events-assign-clients"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("clients") as any)
        .select("id, full_name, profile_picture_url, status, archived")
        .eq("archived", false).eq("status", "Active")
        .order("full_name");
      if (error) throw error;
      return data as { id: string; full_name: string; profile_picture_url: string | null }[];
    },
  });

  const assignedSet = useMemo(() => new Set(assignments.map((a) => a.client_id)), [assignments]);
  const filtered = useMemo(() => {
    const list = clients ?? [];
    const q = search.toLowerCase();
    return q ? list.filter((c) => (c.full_name ?? "").toLowerCase().includes(q)) : list;
  }, [clients, search]);

  async function toggle(cid: string) {
    if (assignedSet.has(cid)) {
      await (supabase.from("event_assignments") as any).delete().eq("event_id", eventId).eq("client_id", cid);
    } else {
      const { data: u } = await supabase.auth.getUser();
      await (supabase.from("event_assignments") as any).insert({ event_id: eventId, client_id: cid, assigned_by: u.user?.id });
    }
    onChange();
  }

  async function selectAllVisible() {
    const { data: u } = await supabase.auth.getUser();
    const toAdd = filtered.filter((c) => !assignedSet.has(c.id))
      .map((c) => ({ event_id: eventId, client_id: c.id, assigned_by: u.user?.id }));
    if (toAdd.length) await (supabase.from("event_assignments") as any).insert(toAdd);
    onChange();
  }

  async function clearAll() {
    await (supabase.from("event_assignments") as any).delete().eq("event_id", eventId);
    onChange();
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold inline-flex items-center gap-2"><Users className="h-4 w-4" />Assigned clients ({assignments.length})</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAllVisible}>Select all visible</Button>
          <Button variant="outline" size="sm" onClick={clearAll}>Clear all</Button>
        </div>
      </div>
      <Input placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="grid max-h-[60vh] gap-1 overflow-auto">
        {filtered.map((c) => {
          const on = assignedSet.has(c.id);
          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className={`flex items-center justify-between gap-2 rounded-md border p-2 text-left transition-colors ${
                on ? "border-primary/50 bg-primary/5" : "border-border hover:bg-secondary"
              }`}
            >
              <span className="truncate">{c.full_name}</span>
              {on && <Badge>Assigned</Badge>}
            </button>
          );
        })}
        {filtered.length === 0 && <div className="text-sm text-muted-foreground p-4 text-center">No clients found.</div>}
      </div>
    </Card>
  );
}

function ParseForm({ onApply }: { onApply: (p: ReturnType<typeof parseFormattedEvent>) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="space-y-3">
      <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste formatted event text from ChatGPT here…" />
      <p className="text-xs text-muted-foreground">Uses the Event Formatting Guide. Parsed values fill the form so you can review before saving.</p>
      <DialogFooter>
        <Button onClick={() => onApply(parseFormattedEvent(text))}>Parse Event</Button>
      </DialogFooter>
    </div>
  );
}
