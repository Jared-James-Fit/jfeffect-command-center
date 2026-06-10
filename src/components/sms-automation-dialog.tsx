import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { upsertSmsAutomation } from "@/lib/sms.functions";
import { toast } from "sonner";
import { Zap } from "lucide-react";

export type AutomationRow = {
  id?: string;
  name: string;
  category: string;
  trigger_type: string;
  trigger_config: Record<string, any>;
  delay_minutes: number;
  audience_type: string;
  audience_config: Record<string, any>;
  body: string;
  active: boolean;
  max_per_client_per_day: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  respect_quiet_hours: boolean;
  internal_note?: string | null;
};

const TRIGGERS = [
  ["unread_message", "Unread app message"],
  ["missed_check_in", "Missed check-in"],
  ["missed_workout", "Missed workout"],
  ["payment_overdue", "Payment overdue"],
  ["birthday", "Client birthday"],
  ["renewal_soon", "Renewal coming up"],
  ["new_program", "New program assigned"],
  ["new_recipe", "New recipe added"],
  ["new_broadcast", "New broadcast sent"],
  ["inactive_days", "Client inactive for X days"],
  ["custom_datetime", "Specific date/time"],
  ["manual", "Manual trigger"],
  ["custom", "Custom reason"],
] as const;

const AUDIENCES = [
  ["all_active", "All active coaching clients"],
  ["app_members", "App members"],
  ["program_members", "Program-only members"],
  ["unread_clients", "Clients with unread messages"],
  ["missed_checkin", "Clients with missed check-ins"],
  ["missed_workout", "Clients with missed workouts"],
  ["overdue", "Clients with overdue payments"],
  ["renewing_soon", "Clients renewing soon"],
  ["birthdays_today", "Clients with birthdays today"],
  ["selected", "Specific selected clients"],
] as const;

const CATEGORIES = ["Check-In Reminder","Missed Check-In","Workout Reminder","Missed Workout","Unread Message","Payment Reminder","Renewal Reminder","Birthday","Onboarding","Motivation","Accountability","Custom"];

const empty: AutomationRow = {
  name: "", category: "Custom", trigger_type: "unread_message", trigger_config: {},
  delay_minutes: 60, audience_type: "all_active", audience_config: {},
  body: "Hi {first_name}, this is {brand}. Quick reminder — open the app when you can.",
  active: true, max_per_client_per_day: 1,
  quiet_hours_start: "21:00", quiet_hours_end: "08:00", respect_quiet_hours: true,
  internal_note: "",
};

export function SmsAutomationDialog({
  open, onOpenChange, initial, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  initial?: AutomationRow | null;
  onSaved?: () => void;
}) {
  const save = useServerFn(upsertSmsAutomation);
  const [f, setF] = useState<AutomationRow>(empty);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setF(initial ?? empty);
  }, [open, initial]);

  const upd = (k: keyof AutomationRow, v: any) => setF((s) => ({ ...s, [k]: v }));

  const doSave = async () => {
    if (!f.name.trim()) return toast.error("Name required");
    if (!f.body.trim()) return toast.error("Message body required");
    setBusy(true);
    try {
      await save({ data: f as any });
      toast.success("Automation saved");
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5" />{initial?.id ? "Edit" : "Create"} SMS Automation</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Automation name</Label>
              <Input value={f.name} onChange={(e) => upd("name", e.target.value)} placeholder="e.g. Unread reminder 1 hr" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={f.category} onValueChange={(v) => upd("category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Trigger</Label>
              <Select value={f.trigger_type} onValueChange={(v) => upd("trigger_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TRIGGERS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Audience</Label>
              <Select value={f.audience_type} onValueChange={(v) => upd("audience_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{AUDIENCES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {f.trigger_type === "custom" && (
            <div className="space-y-1.5">
              <Label>Custom trigger description</Label>
              <Input
                value={(f.trigger_config?.description as string) ?? ""}
                onChange={(e) => upd("trigger_config", { ...f.trigger_config, description: e.target.value })}
                placeholder="When should this send?"
              />
            </div>
          )}
          {f.trigger_type === "inactive_days" && (
            <div className="space-y-1.5">
              <Label>Inactive for (days)</Label>
              <Input type="number" min={1} value={(f.trigger_config?.days as number) ?? 7}
                onChange={(e) => upd("trigger_config", { ...f.trigger_config, days: Number(e.target.value) })} />
            </div>
          )}
          {f.trigger_type === "custom_datetime" && (
            <div className="space-y-1.5">
              <Label>Send at</Label>
              <Input type="datetime-local" value={(f.trigger_config?.when as string) ?? ""}
                onChange={(e) => upd("trigger_config", { ...f.trigger_config, when: e.target.value })} />
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Delay (minutes)</Label>
              <Input type="number" min={0} value={f.delay_minutes} onChange={(e) => upd("delay_minutes", Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Max per client / day</Label>
              <Input type="number" min={1} max={20} value={f.max_per_client_per_day}
                onChange={(e) => upd("max_per_client_per_day", Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Active</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch checked={f.active} onCheckedChange={(v) => upd("active", v)} />
                <span className="text-xs text-muted-foreground">{f.active ? "Sending" : "Paused"}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>SMS message body</Label>
            <Textarea rows={4} value={f.body} onChange={(e) => upd("body", e.target.value)} maxLength={1000} />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Tags: {"{first_name}"} {"{full_name}"} {"{brand}"}</span>
              <span>{f.body.length}/1000</span>
            </div>
          </div>

          <div className="rounded border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Quiet hours (client local time)</Label>
              <Switch checked={f.respect_quiet_hours} onCheckedChange={(v) => upd("respect_quiet_hours", v)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-[11px]">From</Label><Input type="time" value={f.quiet_hours_start} onChange={(e) => upd("quiet_hours_start", e.target.value)} /></div>
              <div><Label className="text-[11px]">To</Label><Input type="time" value={f.quiet_hours_end} onChange={(e) => upd("quiet_hours_end", e.target.value)} /></div>
            </div>
            <div className="text-[11px] text-muted-foreground">If a send falls during quiet hours, it waits until the next allowed time.</div>
          </div>

          <div className="space-y-1.5">
            <Label>Internal note (optional)</Label>
            <Textarea rows={2} value={f.internal_note ?? ""} onChange={(e) => upd("internal_note", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={doSave} disabled={busy}>{busy ? "Saving…" : "Save automation"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}