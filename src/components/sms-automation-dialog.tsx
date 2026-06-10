import { useEffect, useMemo, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { upsertSmsAutomation, testSmsAutomation } from "@/lib/sms.functions";
import { toast } from "sonner";
import { Zap, Send } from "lucide-react";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/save-status";

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
  ["account_created", "New account created"],
  ["subscription_purchased", "Subscription purchased (Stripe)"],
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
  ["new_members", "New members / subscribers (auto)"],
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
  const testFn = useServerFn(testSmsAutomation);
  const [f, setF] = useState<AutomationRow>(empty);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [savedId, setSavedId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setF(initial ?? empty);
      setSavedId(initial?.id);
    }
  }, [open, initial]);

  const upd = (k: keyof AutomationRow, v: any) => setF((s) => ({ ...s, [k]: v }));

  // Auto-save: requires a valid name + body. Persist edits as the user types.
  const autosaveValue = useMemo(() => {
    if (!open) return null;
    if (!f.name.trim() || !f.body.trim()) return null;
    return { ...f, id: savedId } as AutomationRow;
  }, [open, f, savedId]);

  const saveCb = useCallback(async (v: AutomationRow | null) => {
    if (!v) return;
    const res: any = await save({ data: v as any });
    if (res?.id && !savedId) setSavedId(res.id);
    onSaved?.();
  }, [save, savedId, onSaved]);

  const autosave = useAutosave<AutomationRow | null>({
    key: savedId ? `sms-auto:${savedId}` : "sms-auto:new",
    value: autosaveValue,
    enabled: !!autosaveValue,
    onSave: saveCb,
    delay: 700,
  });

  const doTest = async () => {
    if (!testTo.trim()) return toast.error("Enter a phone number to test");
    if (!f.body.trim()) return toast.error("Add a message body first");
    setTesting(true);
    try {
      await testFn({ data: { to: testTo.trim(), body: f.body } });
      toast.success("Test SMS sent");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setTesting(false); }
  };

  const showSetupTagHint =
    f.trigger_type === "account_created" || f.trigger_type === "subscription_purchased";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><Zap className="h-5 w-5" />{savedId ? "Edit" : "Create"} SMS Automation</span>
            <SaveStatus state={autosave.state} savedAt={autosave.savedAt} />
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {showSetupTagHint && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="font-semibold mb-1">Setup-link automation</div>
              <div className="text-muted-foreground">
                This trigger fires automatically when a {f.trigger_type === "account_created" ? "new app member account is created" : "JF Membership subscription is purchased through Stripe"}.
                Include the <code className="px-1 rounded bg-background">{"{setup_link}"}</code> tag in your message — it inserts a one-time link the recipient taps to finish setting up their app account.
              </div>
            </div>
          )}
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
              <span>Tags: {"{first_name}"} {"{full_name}"} {"{brand}"} {"{setup_link}"}</span>
              <span>{f.body.length}/1000</span>
            </div>
          </div>

          <div className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Test this automation</Label>
            </div>
            <div className="flex gap-2">
              <Input
                type="tel"
                placeholder="+15551234567"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                className="max-w-[220px]"
              />
              <Button type="button" variant="outline" size="sm" onClick={doTest} disabled={testing}>
                <Send className="mr-1 h-3.5 w-3.5" />{testing ? "Sending…" : "Send test SMS"}
              </Button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Sends the current message body to the number above using sample values
              (e.g. <code>{"{first_name}"}</code> = "Alex", <code>{"{setup_link}"}</code> = a sample link).
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
          <div className="flex w-full items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {!f.name.trim() || !f.body.trim()
                ? "Fill in a name and message body to start auto-saving."
                : "Changes save automatically."}
            </div>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}