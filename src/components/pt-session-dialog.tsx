import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { SESSION_TYPES, SESSION_STATUSES, COMMON_TIMEZONES } from "@/lib/pt-sessions";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId?: string;
  clients?: Array<{ id: string; full_name: string; timezone?: string | null; default_session_location?: string | null }>;
  initial?: any;
};

export function PtSessionDialog({ open, onOpenChange, clientId, clients = [], initial }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({ ...initial });
      return;
    }
    const c = clients.find((x) => x.id === clientId);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
    });
  }, [open, initial, clientId, clients]);

  if (!form) return null;
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

  const save = async () => {
    if (!form.client_id) return toast.error("Pick a client first");
    if (!form.title) return toast.error("Title is required");
    setSaving(true);
    const payload: any = {
      client_id: form.client_id,
      title: form.title,
      session_type: form.session_type,
      custom_type: form.session_type === "Custom Session" ? form.custom_type : null,
      session_date: form.session_date,
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
    const { error } = form.id
      ? await supabase.from("pt_sessions").update(payload).eq("id", form.id)
      : await supabase.from("pt_sessions").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Session updated" : "Session booked");
    qc.invalidateQueries({ queryKey: ["pt-sessions"] });
    qc.invalidateQueries({ queryKey: ["pt-sessions", form.client_id] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit Session" : "Book Personal Training Session"}</DialogTitle>
        </DialogHeader>
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
            <Label>Date</Label>
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
          <Button onClick={save} disabled={saving} className="bg-gradient-primary font-bold uppercase">
            {saving ? "Saving…" : form.id ? "Save Session" : "Book Session"}
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