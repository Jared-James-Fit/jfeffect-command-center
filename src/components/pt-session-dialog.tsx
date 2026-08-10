import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SESSION_TYPES, SESSION_STATUSES, COMMON_TIMEZONES } from "@/lib/pt-sessions";
import { AlertTriangle, Repeat, CalendarDays } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId?: string;
  clients?: Array<{ id: string; full_name: string; timezone?: string | null; default_session_location?: string | null; package_tracking_enabled?: boolean | null; sessions_purchased?: number | null; sessions_used?: number | null }>;
  initial?: any;
};

const DOW = [
  { key: 0, short: "Sun" },
  { key: 1, short: "Mon" },
  { key: 2, short: "Tue" },
  { key: 3, short: "Wed" },
  { key: 4, short: "Thu" },
  { key: 5, short: "Fri" },
  { key: 6, short: "Sat" },
];

function computeRecurringDates(startISO: string, weekdays: number[], weeks: number, includeStart: boolean): string[] {
  if (!weekdays.length || weeks <= 0) return [];
  const start = new Date(startISO + "T00:00:00");
  const startDow = start.getDay();
  const end = new Date(start);
  end.setDate(end.getDate() + weeks * 7 - 1);
  const out: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    const isStart = cur.getTime() === start.getTime();
    if (weekdays.includes(dow) && (includeStart || !isStart || dow !== startDow)) {
      out.push(cur.toISOString().slice(0, 10));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function PtSessionDialog({ open, onOpenChange, clientId, clients = [], initial }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOverbook, setConfirmOverbook] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmOverbook(false);
    if (initial) {
      setForm({ ...initial, _isRecurring: false, _weekdays: [], _weeks: 4, _includeStartDate: true });
      return;
    }
    const c = clients.find((x) => x.id === clientId);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dow = new Date(tomorrow + "T00:00:00").getDay();
    setForm({
      client_id: clientId ?? "",
      title: "Personal Training Session",
      session_type: "Personal Training Session",
      custom_type: "",
      session_date: tomorrow,
      start_time: "09:00",
      end_time: "10:00",
      timezone: c?.timezone ?? "America/Winnipeg",
      location: c?.default_session_location ?? "Iron Image Gym",
      notes: "",
      client_visible_notes: true,
      status: "Scheduled",
      visible_to_client: true,
      reminders_enabled: true,
      send_confirmation_email: true,
      _isRecurring: false,
      _weekdays: [dow],
      _weeks: 4,
      _includeStartDate: true,
    });
  }, [open, initial, clientId, clients]);

  const selectedClient = form ? clients.find((c) => c.id === form.client_id) : undefined;
  const tracking = !!selectedClient?.package_tracking_enabled;
  // Ledger-driven credit balance. Booking reserves 1 credit per session
  // (already netted out of `remaining`); completing converts reserved → used;
  // cancelling releases the reservation back to available.
  const { data: balanceRows } = useQuery<any[]>({
    queryKey: ["pt-balance", form?.client_id ?? null],
    enabled: open && !!form?.client_id,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("session_balance", { _client_id: form.client_id });
      return (data ?? []) as any[];
    },
  });
  const remaining = (balanceRows ?? []).reduce((sum, r) => sum + Math.max(Number(r.remaining ?? 0), 0), 0);
  const hasCredits = (balanceRows ?? []).some((r) => Number(r.granted ?? 0) > 0);

  const previewDates = useMemo(() => {
    if (!form || !form._isRecurring) return [form?.session_date].filter(Boolean) as string[];
    return computeRecurringDates(form.session_date, form._weekdays, form._weeks, form._includeStartDate);
  }, [form]);

  if (!form) return null;
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });
  const toggleWeekday = (d: number) => {
    const next = form._weekdays.includes(d)
      ? form._weekdays.filter((x: number) => x !== d)
      : [...form._weekdays, d].sort();
    set("_weekdays", next);
  };

  const isNewBooking = !form.id;
  const bookingCount = isNewBooking ? previewDates.length : 0;
  const willReserve = (tracking || hasCredits) && isNewBooking && form.status === "Scheduled" ? bookingCount : 0;
  const overbook = willReserve > remaining;

  const save = async () => {
    if (!form.client_id) return toast.error("Pick a client first");
    if (!form.title) return toast.error("Title is required");
    if (form._isRecurring && previewDates.length === 0) return toast.error("Pick at least one weekday");
    if (overbook && !confirmOverbook) {
      toast.error(`Only ${remaining} credit${remaining === 1 ? "" : "s"} available — top up or confirm overbooking`);
      return;
    }
    setSaving(true);

    const basePayload: any = {
      client_id: form.client_id,
      title: form.title,
      session_type: form.session_type,
      custom_type: form.session_type === "Custom Session" ? form.custom_type : null,
      start_time: form.start_time,
      end_time: form.end_time,
      timezone: form.timezone,
      location: form.location,
      notes: form.notes,
      client_visible_notes: form.client_visible_notes,
      status: form.status,
      visible_to_client: form.visible_to_client,
      reminders_enabled: form.reminders_enabled,
      send_confirmation_email: form.send_confirmation_email,
    };

    let error: any = null;
    if (form.id) {
      const { error: e } = await supabase
        .from("pt_sessions")
        .update({ ...basePayload, session_date: form.session_date })
        .eq("id", form.id);
      error = e;
    } else {
      const rows = previewDates.map((d) => ({ ...basePayload, session_date: d }));
      const { error: e } = await supabase.from("pt_sessions").insert(rows);
      error = e;
    }

    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(
      form.id
        ? "Session updated"
        : previewDates.length > 1
          ? `Booked ${previewDates.length} sessions`
          : "Session booked",
    );
    qc.invalidateQueries({ queryKey: ["pt-sessions"] });
    qc.invalidateQueries({ queryKey: ["pt-sessions", form.client_id] });
    qc.invalidateQueries({ queryKey: ["pt-balance", form.client_id] });
    qc.invalidateQueries({ queryKey: ["client", form.client_id] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit / Reschedule Session" : "Book Personal Training Session"}</DialogTitle>
        </DialogHeader>

        {(tracking || hasCredits) && isNewBooking && (
          <div className={`rounded-md border px-3 py-2 text-sm ${overbook ? "border-destructive/60 bg-destructive/10" : remaining <= 2 ? "border-amber-500/60 bg-amber-500/10" : "border-primary/40 bg-primary/10"}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {overbook ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <CalendarDays className="h-4 w-4" />}
                <span>
                  <strong>{remaining}</strong> credit{remaining === 1 ? "" : "s"} available
                  {willReserve > 0 && <> · booking reserves <strong>{willReserve}</strong></>}
                </span>
              </div>
              {overbook && (
                <div className="flex items-center gap-2">
                  <Switch checked={confirmOverbook} onCheckedChange={setConfirmOverbook} />
                  <Label className="text-xs">Overbook</Label>
                </div>
              )}
            </div>
            {overbook && (
              <p className="mt-1 text-xs text-muted-foreground">
                No session credits available. Add sessions from the Personal Training panel, or toggle Overbook to book anyway (tracked as a negative balance).
              </p>
            )}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {!clientId && (
            <div className="md:col-span-2">
              <Label>Client</Label>
              <Select value={form.client_id} onValueChange={(v) => set("client_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="md:col-span-2">
            <Label>Session title</Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div>
            <Label>Session type</Label>
            <Select value={form.session_type} onValueChange={(v) => set("session_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SESSION_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SESSION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.session_type === "Custom Session" && (
            <div className="md:col-span-2">
              <Label>Custom type</Label>
              <Input value={form.custom_type ?? ""} onChange={(e) => set("custom_type", e.target.value)} />
            </div>
          )}
          <div>
            <Label>{form._isRecurring ? "Start date" : "Date"}</Label>
            <Input type="date" value={form.session_date} onChange={(e) => set("session_date", e.target.value)} />
          </div>
          <div>
            <Label>Client time zone</Label>
            <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{COMMON_TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Start time</Label>
            <Input type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)} />
          </div>
          <div>
            <Label>End time</Label>
            <Input type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Location</Label>
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
          </div>

          {isNewBooking && (
            <div className="md:col-span-2 rounded-md border border-border bg-secondary/30 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 text-primary" />
                  <Label className="text-sm font-semibold">Repeat weekly</Label>
                </div>
                <Switch checked={form._isRecurring} onCheckedChange={(v) => set("_isRecurring", v)} />
              </div>
              {form._isRecurring && (
                <>
                  <div>
                    <Label className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">Days of week</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {DOW.map((d) => (
                        <Button
                          key={d.key}
                          type="button"
                          size="sm"
                          variant={form._weekdays.includes(d.key) ? "default" : "outline"}
                          onClick={() => toggleWeekday(d.key)}
                          className="min-w-[3.5rem]"
                        >
                          {d.short}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Number of weeks</Label>
                      <Input
                        type="number"
                        min={1}
                        max={26}
                        value={form._weeks}
                        onChange={(e) => set("_weeks", Math.max(1, Math.min(26, parseInt(e.target.value || "1", 10))))}
                      />
                    </div>
                    <div className="flex items-end justify-between rounded-md border border-border bg-background/60 px-3 py-2">
                      <Label className="text-xs">Include start date if it matches</Label>
                      <Switch checked={form._includeStartDate} onCheckedChange={(v) => set("_includeStartDate", v)} />
                    </div>
                  </div>
                  <div className="rounded-md border border-dashed border-border p-2 text-xs">
                    <div className="mb-1 font-semibold text-muted-foreground">
                      Will book {previewDates.length} session{previewDates.length === 1 ? "" : "s"}:
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {previewDates.slice(0, 24).map((d) => (
                        <span key={d} className="rounded bg-secondary px-1.5 py-0.5">
                          {new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      ))}
                      {previewDates.length > 24 && <span className="text-muted-foreground">+{previewDates.length - 24} more</span>}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="md:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <Toggle label="Show notes to client" checked={form.client_visible_notes} onChange={(v) => set("client_visible_notes", v)} />
          <Toggle label="Show session in client calendar" checked={form.visible_to_client} onChange={(v) => set("visible_to_client", v)} />
          <Toggle label="Send 24h + 1h reminder emails" checked={form.reminders_enabled} onChange={(v) => set("reminders_enabled", v)} />
          <Toggle label="Send booking confirmation email" checked={form.send_confirmation_email} onChange={(v) => set("send_confirmation_email", v)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={save}
            disabled={saving || (overbook && !confirmOverbook)}
            className="bg-gradient-primary font-bold uppercase"
          >
            {saving
              ? "Saving…"
              : form.id
                ? "Save Session"
                : previewDates.length > 1
                  ? `Book ${previewDates.length} Sessions`
                  : "Book Session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
      <Label className="text-xs">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
