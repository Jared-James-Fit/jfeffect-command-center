import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listAppointments, createAppointment, markAppointmentStatus } from "@/lib/appointments.functions";
import { getGoogleBusy } from "@/lib/google-cal.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Calendar as CalendarIcon, Plus, Video, MapPin, Phone, X, CheckCircle2, AlertTriangle, Link2, Download, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { AppointmentCalendarGrid } from "@/components/appointments/appointment-week-grid";
import { SendBookingLinkDialog } from "@/components/appointments/send-booking-link-dialog";
import { RescheduleDialog } from "@/components/appointments/reschedule-dialog";
import { CancelAppointmentDialog } from "@/components/appointments/cancel-dialog";
import { SlotPicker } from "@/components/appointments/slot-picker";
import { tzWallToUtcISO } from "@/lib/tz";
import { buildAppointmentIcs, downloadIcs } from "@/lib/appointments-ics";

export const Route = createFileRoute("/_authenticated/admin/appointments")({ component: AppointmentsPage });

const APPT_TYPES = [
  "Coaching Call","Check-In Call","Onboarding Call","Strategy Call",
  "Consultation","In-Person Session","Assessment","Nutrition Review",
  "Program Review","Custom",
] as const;

function AppointmentsPage() {
  const [tab, setTab] = useState<"today" | "upcoming" | "past" | "calendar">("upcoming");
  const [open, setOpen] = useState(false);
  const [presetDate, setPresetDate] = useState<string | undefined>(undefined);
  const [sendOpen, setSendOpen] = useState(false);
  const list = useServerFn(listAppointments);
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["appointments", tab],
    queryFn: () => list({ data: { range: tab } as any }),
    enabled: tab !== "calendar",
  });

  return (
    <>
      <PageHeader
        title="Appointments"
        subtitle="Calls, sessions, and bookings synced with Google Calendar."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}><Link2 className="mr-2 h-4 w-4" /> Send Booking Link</Button>
            <Link to="/admin/google-calendar"><Button size="sm" variant="outline">Google Calendar</Button></Link>
            <Link to="/admin/booking-links"><Button size="sm" variant="outline">Booking Links</Button></Link>
            <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New Appointment
            </Button>
          </div>
        }
      />
      <div className="p-6 md:p-8 space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-4">
            {tab === "calendar" ? (
              <AppointmentCalendarGrid
                onPickDate={(d) => {
                  const y = d.getFullYear();
                  const m = String(d.getMonth() + 1).padStart(2, "0");
                  const day = String(d.getDate()).padStart(2, "0");
                  setPresetDate(`${y}-${m}-${day}`);
                  setOpen(true);
                }}
              />
            ) : isLoading ? (
              <Card className="border-border bg-card p-6 text-sm text-muted-foreground">Loading…</Card>
            ) : data.length === 0 ? (
              <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">
                <CalendarIcon className="mx-auto mb-2 h-6 w-6" />
                No {tab} appointments.
              </Card>
            ) : (
              <div className="space-y-2">
                {data.map((a: any) => <ApptRow key={a.id} a={a} onChange={() => qc.invalidateQueries({ queryKey: ["appointments"] })} />)}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <NewAppointmentDialog
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) setPresetDate(undefined); }}
        presetDate={presetDate}
        onCreated={() => qc.invalidateQueries({ queryKey: ["appointments"] })}
      />
      <SendBookingLinkDialog open={sendOpen} onOpenChange={setSendOpen} />
    </>
  );
}

function statusTone(s: string) {
  switch (s) {
    case "Completed": return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
    case "Cancelled": return "bg-muted text-muted-foreground border-border";
    case "NoShow": return "bg-rose-500/10 text-rose-300 border-rose-500/30";
    default: return "bg-primary/10 text-primary border-primary/30";
  }
}

function ApptRow({ a, onChange }: { a: any; onChange: () => void }) {
  const markFn = useServerFn(markAppointmentStatus);
  const [reOpen, setReOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const mark = useMutation({
    mutationFn: (s: any) => markFn({ data: { id: a.id, status: s } }),
    onSuccess: () => { toast.success("Updated"); onChange(); },
    onError: (e: any) => toast.error(e.message),
  });
  const when = new Date(a.starts_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const attendeeName = a.client?.full_name || a.external_name || "—";
  function ics() { downloadIcs(`${a.title || "appointment"}.ics`, buildAppointmentIcs(a)); }
  return (
    <Card className="border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className={statusTone(a.status)}>{a.status}</Badge>
            <Badge variant="outline">{a.appointment_type}</Badge>
          </div>
          <div className="font-semibold truncate">{a.title}</div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <span>{when}</span>
            <span>With {attendeeName}</span>
            {a.host_coach?.full_name && <span>· {a.host_coach.full_name}</span>}
            {a.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {a.location}</span>}
            {(a.client?.phone || a.external_phone) && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {a.client?.phone || a.external_phone}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {a.meet_link && (
            <a href={a.meet_link} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline"><Video className="mr-2 h-3 w-3" /> Join Meet</Button>
            </a>
          )}
          <Button size="sm" variant="outline" onClick={ics}><Download className="mr-1 h-3 w-3" /> .ics</Button>
          {a.status === "Scheduled" && (
            <>
              <Button size="sm" variant="outline" onClick={() => setReOpen(true)}><CalendarClock className="mr-1 h-3 w-3" /> Reschedule</Button>
              <Button size="sm" variant="outline" onClick={() => mark.mutate("Completed")}><CheckCircle2 className="mr-1 h-3 w-3" /> Complete</Button>
              <Button size="sm" variant="outline" onClick={() => mark.mutate("NoShow")}><AlertTriangle className="mr-1 h-3 w-3" /> No-show</Button>
              <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)}><X className="mr-1 h-3 w-3" /> Cancel</Button>
            </>
          )}
        </div>
      </div>
      <RescheduleDialog open={reOpen} onOpenChange={setReOpen} appointment={a} onChanged={onChange} />
      <CancelAppointmentDialog open={cancelOpen} onOpenChange={setCancelOpen} appointment={a} onCancelled={onChange} />
    </Card>
  );
}

function NewAppointmentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (b: boolean) => void; onCreated: () => void }) {
  const create = useServerFn(createAppointment);
  const busyFn = useServerFn(getGoogleBusy);
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min-appts"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name, email, phone").eq("archived", false).order("full_name");
      return data ?? [];
    },
  });
  const { data: coaches = [] } = useQuery({
    queryKey: ["coaches-active"],
    queryFn: async () => {
      const { data } = await supabase.from("coaches").select("id, full_name").eq("archived", false).eq("status","Active").order("full_name");
      return data ?? [];
    },
  });

  const [form, setForm] = useState<any>(() => defaultForm());
  const durationMin = (() => {
    try {
      const [sh, sm] = form.startTime.split(":").map(Number);
      const [eh, em] = form.endTime.split(":").map(Number);
      const d = (eh * 60 + em) - (sh * 60 + sm);
      return d > 0 ? d : 30;
    } catch { return 30; }
  })();
  const startsAtISO = (() => { try { return tzWallToUtcISO(form.date, form.startTime, form.timezone); } catch { return null; } })();
  const endsAtISO = (() => { try { return tzWallToUtcISO(form.date, form.endTime, form.timezone); } catch { return null; } })();
  const { data: busy = [] } = useQuery({
    queryKey: ["gcal-busy", form.host_coach_id || "me", startsAtISO, endsAtISO],
    enabled: open && !!startsAtISO && !!endsAtISO,
    queryFn: () => busyFn({ data: { timeMin: startsAtISO!, timeMax: endsAtISO!, coach_id: form.host_coach_id || undefined } }),
    staleTime: 30_000,
  });
  const hasConflict = Array.isArray(busy) && busy.length > 0;

  function defaultForm() {
    const start = new Date(Math.ceil(Date.now() / 1800000) * 1800000);
    const end = new Date(start.getTime() + 30 * 60_000);
    return {
      host_coach_id: "",
      client_id: "",
      external_name: "",
      external_email: "",
      external_phone: "",
      appointment_type: "Coaching Call",
      title: "",
      date: start.toISOString().slice(0, 10),
      startTime: start.toTimeString().slice(0, 5),
      endTime: end.toTimeString().slice(0, 5),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      location: "",
      meet_enabled: true,
      attendee_notes: "",
      internal_notes: "",
      sms_reminders_enabled: true,
    };
  }

  const mut = useMutation({
    mutationFn: async () => {
      const startsAt = tzWallToUtcISO(form.date, form.startTime, form.timezone);
      const endsAt = tzWallToUtcISO(form.date, form.endTime, form.timezone);
      return create({ data: {
        host_coach_id: form.host_coach_id || undefined,
        client_id: form.client_id || null,
        external_name: form.external_name || null,
        external_email: form.external_email || null,
        external_phone: form.external_phone || null,
        appointment_type: form.appointment_type,
        title: form.title || `${form.appointment_type}`,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: form.timezone,
        location: form.location || null,
        meet_enabled: form.meet_enabled,
        attendee_notes: form.attendee_notes || null,
        internal_notes: form.internal_notes || null,
        sms_reminders_enabled: form.sms_reminders_enabled,
      } as any });
    },
    onSuccess: () => { toast.success("Appointment created"); onOpenChange(false); setForm(defaultForm()); onCreated(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Appointment</DialogTitle></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Onboarding call" />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.appointment_type} onValueChange={(v) => setForm({ ...form, appointment_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{APPT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Host Coach</Label>
            <Select value={form.host_coach_id} onValueChange={(v) => setForm({ ...form, host_coach_id: v })}>
              <SelectTrigger><SelectValue placeholder="Me (or pick)" /></SelectTrigger>
              <SelectContent>{coaches.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>Client (optional)</Label>
            <Select
              value={form.client_id || "__external__"}
              onValueChange={(v) => setForm({ ...form, client_id: v === "__external__" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="Choose a client, or fill external attendee below" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__external__">— External attendee —</SelectItem>
                {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!form.client_id && (
            <>
              <div><Label>Name</Label><Input value={form.external_name} onChange={(e) => setForm({ ...form, external_name: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={form.external_email} onChange={(e) => setForm({ ...form, external_email: e.target.value })} /></div>
              <div className="md:col-span-2"><Label>Phone</Label><Input value={form.external_phone} onChange={(e) => setForm({ ...form, external_phone: e.target.value })} /></div>
            </>
          )}
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Start</Label><Input type="time" step={900} value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
            <div><Label>End</Label><Input type="time" step={900} value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></div>
          </div>
          <SlotPicker
            date={form.date}
            tz={form.timezone}
            durationMin={durationMin}
            coachId={form.host_coach_id || undefined}
            selectedTime={form.startTime}
            customTime={form.startTime}
            onPick={(t) => {
              const [h, m] = t.split(":").map(Number);
              const endMin = h * 60 + m + durationMin;
              const eh = String(Math.floor(endMin / 60) % 24).padStart(2, "0");
              const em = String(endMin % 60).padStart(2, "0");
              setForm({ ...form, startTime: t, endTime: `${eh}:${em}` });
            }}
            onCustomTimeChange={(t) => setForm({ ...form, startTime: t })}
            onTzChange={(tz) => setForm({ ...form, timezone: tz })}
            onDurationChange={(d) => {
              const [h, m] = form.startTime.split(":").map(Number);
              const endMin = h * 60 + m + d;
              const eh = String(Math.floor(endMin / 60) % 24).padStart(2, "0");
              const em = String(endMin % 60).padStart(2, "0");
              setForm({ ...form, endTime: `${eh}:${em}` });
            }}
          />
          {hasConflict && (
            <div className="md:col-span-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              <div className="font-semibold mb-1 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Conflicts on Google Calendar</div>
              <ul className="space-y-0.5">
                {(busy as any[]).slice(0, 4).map((b, i) => (
                  <li key={i}>
                    {new Date(b.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    {" – "}
                    {new Date(b.end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="md:col-span-2"><Label>Location</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="In-person address or empty" /></div>
          <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border p-3">
            <div><div className="font-semibold text-sm">Add Google Meet link</div><div className="text-xs text-muted-foreground">Requires Google Calendar connected.</div></div>
            <Switch checked={form.meet_enabled} onCheckedChange={(v) => setForm({ ...form, meet_enabled: v })} />
          </div>
          <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border p-3">
            <div><div className="font-semibold text-sm">Send SMS reminders</div><div className="text-xs text-muted-foreground">24h, 2h before (15m if Meet).</div></div>
            <Switch checked={form.sms_reminders_enabled} onCheckedChange={(v) => setForm({ ...form, sms_reminders_enabled: v })} />
          </div>
          <div className="md:col-span-2"><Label>Attendee notes (visible to attendee)</Label><Textarea value={form.attendee_notes} onChange={(e) => setForm({ ...form, attendee_notes: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Internal coach notes</Label><Textarea value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()} className="bg-gradient-primary">Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}