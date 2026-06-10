import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listBookingLinks, upsertBookingLink, deleteBookingLink } from "@/lib/booking-links.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Copy, Plus, Pencil, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/booking-links")({ component: BookingLinksPage });

const APPT_TYPES = [
  "Coaching Call","Check-In Call","Onboarding Call","Strategy Call",
  "Consultation","In-Person Session","Assessment","Nutrition Review",
  "Program Review","Custom",
] as const;
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function BookingLinksPage() {
  const list = useServerFn(listBookingLinks);
  const del = useServerFn(deleteBookingLink);
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["booking-links"], queryFn: () => list() });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["booking-links"] }); },
  });

  return (
    <>
      <PageHeader
        title="Booking Links"
        subtitle="Share self-serve booking pages with clients and external attendees."
        actions={
          <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> New Link
          </Button>
        }
      />
      <div className="p-6 md:p-8 space-y-3">
        {isLoading ? (
          <Card className="p-6 text-sm text-muted-foreground border-border bg-card">Loading…</Card>
        ) : data.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground border-border bg-card">No booking links yet.</Card>
        ) : (
          data.map((l: any) => {
            const url = `${typeof window !== "undefined" ? window.location.origin : ""}/book/${l.slug}`;
            return (
              <Card key={l.id} className="border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline">{l.appointment_type}</Badge>
                      <Badge variant={l.active ? "default" : "outline"}>{l.active ? "Active" : "Inactive"}</Badge>
                    </div>
                    <div className="font-semibold">{l.name}</div>
                    <div className="text-xs text-muted-foreground">{l.duration_minutes}m · {l.host_coach?.full_name ?? "—"} · {l.timezone}</div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">{url}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(url); toast.success("Link copied"); }}>
                      <Copy className="mr-2 h-3 w-3" /> Copy
                    </Button>
                    <a href={`/book/${l.slug}`} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline"><ExternalLink className="mr-2 h-3 w-3" /> Preview</Button>
                    </a>
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(l); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete "${l.name}"?`)) remove.mutate(l.id); }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
      <EditDialog open={open} onOpenChange={setOpen} editing={editing} onSaved={() => qc.invalidateQueries({ queryKey: ["booking-links"] })} />
    </>
  );
}

function EditDialog({ open, onOpenChange, editing, onSaved }: any) {
  const upsert = useServerFn(upsertBookingLink);
  const { data: coaches = [] } = useQuery({
    queryKey: ["coaches-active"],
    queryFn: async () => {
      const { data } = await supabase.from("coaches").select("id, full_name").eq("archived", false).eq("status","Active").order("full_name");
      return data ?? [];
    },
  });

  const [form, setForm] = useState<any>(() => init(editing));
  function init(e: any) {
    if (!e) return {
      name: "", appointment_type: "Coaching Call", host_coach_id: "",
      duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 15,
      max_per_day: null, min_notice_hours: 2, max_advance_days: 60,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      meet_enabled: true, collect_phone: true, collect_notes: true,
      sms_reminders_enabled: true, allow_reschedule: true, allow_cancel: true, active: true,
      description: "",
      availability: [1,2,3,4,5].map((d) => ({ day_of_week: d, start_time: "09:00", end_time: "17:00" })),
    };
    return {
      id: e.id, name: e.name, appointment_type: e.appointment_type, host_coach_id: e.host_coach_id,
      duration_minutes: e.duration_minutes, buffer_before_minutes: e.buffer_before_minutes, buffer_after_minutes: e.buffer_after_minutes,
      max_per_day: e.max_per_day, min_notice_hours: e.min_notice_hours, max_advance_days: e.max_advance_days,
      timezone: e.timezone, meet_enabled: e.meet_enabled, collect_phone: e.collect_phone, collect_notes: e.collect_notes,
      sms_reminders_enabled: e.sms_reminders_enabled, allow_reschedule: e.allow_reschedule, allow_cancel: e.allow_cancel,
      active: e.active, description: e.description || "",
      availability: (e.availability ?? []).map((a: any) => ({ day_of_week: a.day_of_week, start_time: String(a.start_time).slice(0,5), end_time: String(a.end_time).slice(0,5) })),
    };
  }

  // Reinit when editing changes
  useState(() => { setForm(init(editing)); });

  const save = useMutation({
    mutationFn: () => upsert({ data: form as any }),
    onSuccess: () => { toast.success("Saved"); onOpenChange(false); onSaved(); },
    onError: (e: any) => toast.error(e.message),
  });

  function toggleDay(d: number, start = "09:00", end = "17:00") {
    const exists = form.availability.some((a: any) => a.day_of_week === d);
    setForm({
      ...form,
      availability: exists
        ? form.availability.filter((a: any) => a.day_of_week !== d)
        : [...form.availability, { day_of_week: d, start_time: start, end_time: end }].sort((a: any, b: any) => a.day_of_week - b.day_of_week),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? "Edit booking link" : "New booking link"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Free Consultation" />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.appointment_type} onValueChange={(v) => setForm({ ...form, appointment_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{APPT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Host coach</Label>
            <Select value={form.host_coach_id} onValueChange={(v) => setForm({ ...form, host_coach_id: v })}>
              <SelectTrigger><SelectValue placeholder="Me" /></SelectTrigger>
              <SelectContent>{coaches.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Duration (min)</Label><Input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} /></div>
          <div><Label>Buffer before (min)</Label><Input type="number" value={form.buffer_before_minutes} onChange={(e) => setForm({ ...form, buffer_before_minutes: Number(e.target.value) })} /></div>
          <div><Label>Buffer after (min)</Label><Input type="number" value={form.buffer_after_minutes} onChange={(e) => setForm({ ...form, buffer_after_minutes: Number(e.target.value) })} /></div>
          <div><Label>Min notice (hours)</Label><Input type="number" value={form.min_notice_hours} onChange={(e) => setForm({ ...form, min_notice_hours: Number(e.target.value) })} /></div>
          <div><Label>Max advance (days)</Label><Input type="number" value={form.max_advance_days} onChange={(e) => setForm({ ...form, max_advance_days: Number(e.target.value) })} /></div>
          <div><Label>Max per day (optional)</Label><Input type="number" value={form.max_per_day ?? ""} onChange={(e) => setForm({ ...form, max_per_day: e.target.value ? Number(e.target.value) : null })} /></div>
          <div className="md:col-span-2"><Label>Timezone</Label><Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></div>
          <div className="md:col-span-2">
            <Label>Description (shown on booking page)</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>

          <div className="md:col-span-2">
            <Label className="mb-2 block">Weekly availability</Label>
            <div className="space-y-2">
              {DAYS.map((label, d) => {
                const window = form.availability.find((a: any) => a.day_of_week === d);
                return (
                  <div key={d} className="flex items-center gap-2">
                    <Switch checked={!!window} onCheckedChange={() => toggleDay(d)} />
                    <div className="w-12 text-sm">{label}</div>
                    {window ? (
                      <>
                        <Input type="time" className="w-32" value={window.start_time} onChange={(e) => setForm({ ...form, availability: form.availability.map((a: any) => a.day_of_week === d ? { ...a, start_time: e.target.value } : a) })} />
                        <span className="text-xs text-muted-foreground">to</span>
                        <Input type="time" className="w-32" value={window.end_time} onChange={(e) => setForm({ ...form, availability: form.availability.map((a: any) => a.day_of_week === d ? { ...a, end_time: e.target.value } : a) })} />
                      </>
                    ) : <span className="text-xs text-muted-foreground">Unavailable</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <Toggle label="Google Meet link" v={form.meet_enabled} on={(v) => setForm({ ...form, meet_enabled: v })} />
          <Toggle label="Collect phone" v={form.collect_phone} on={(v) => setForm({ ...form, collect_phone: v })} />
          <Toggle label="Collect notes" v={form.collect_notes} on={(v) => setForm({ ...form, collect_notes: v })} />
          <Toggle label="SMS reminders" v={form.sms_reminders_enabled} on={(v) => setForm({ ...form, sms_reminders_enabled: v })} />
          <Toggle label="Allow reschedule" v={form.allow_reschedule} on={(v) => setForm({ ...form, allow_reschedule: v })} />
          <Toggle label="Allow cancel" v={form.allow_cancel} on={(v) => setForm({ ...form, allow_cancel: v })} />
          <Toggle label="Active" v={form.active} on={(v) => setForm({ ...form, active: v })} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()} className="bg-gradient-primary">{editing ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({ label, v, on }: { label: string; v: boolean; on: (b: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border p-3">
      <div className="text-sm font-semibold">{label}</div>
      <Switch checked={v} onCheckedChange={on} />
    </div>
  );
}