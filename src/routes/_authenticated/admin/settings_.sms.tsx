import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { updateSmsSettings, sendTestSms, runReminderSweepNow, deleteSmsAutomation } from "@/lib/sms.functions";
import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Send, RefreshCw, Search, UserPlus, Zap, MessageSquare, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Link } from "@tanstack/react-router";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/save-status";
import { SmsPersonalDialog } from "@/components/sms-personal-dialog";
import { SmsAutomationDialog, type AutomationRow } from "@/components/sms-automation-dialog";

export const Route = createFileRoute("/_authenticated/admin/settings_/sms")({ component: SmsSettings });

type Step = { delay_minutes: number; enabled: boolean; template: string };

function SmsSettings() {
  const qc = useQueryClient();
  const update = useServerFn(updateSmsSettings);
  const test = useServerFn(sendTestSms);
  const sweep = useServerFn(runReminderSweepNow);
  const removeAuto = useServerFn(deleteSmsAutomation);
  const [recipSearch, setRecipSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [personalOpen, setPersonalOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoEditing, setAutoEditing] = useState<AutomationRow | null>(null);

  const { data: settings } = useQuery({
    queryKey: ["sms-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sms_settings").select("*").eq("singleton", true).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState<any>(null);
  useEffect(() => { if (settings && !form) setForm(settings); }, [settings, form]);
  const f = form ?? settings;

  const { data: recent } = useQuery({
    queryKey: ["sms-log-recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sms_log")
        .select("id, created_at, kind, reminder_step, status, to_phone, body, error, clients(full_name)")
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
    refetchInterval: 15000,
  });

  const { data: recipients } = useQuery({
    queryKey: ["sms-recipients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, email, phone, sms_opt_out, call_access_enabled")
        .eq("archived", false)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateRecipient = async (id: string, patch: Record<string, any>) => {
    const { error } = await supabase.from("clients").update(patch as any).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["sms-recipients"] });
  };

  const filteredRecipients = useMemo(() => {
    const q = recipSearch.trim().toLowerCase();
    return (recipients ?? []).filter((c: any) =>
      !q || `${c.full_name ?? ""} ${c.email ?? ""} ${c.phone ?? ""}`.toLowerCase().includes(q)
    );
  }, [recipients, recipSearch]);

  const { data: automations } = useQuery({
    queryKey: ["sms-automations"],
    queryFn: async () => (await supabase.from("sms_automations").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const autosaveValue = useMemo(() => f ? ({
    enabled: !!f.enabled,
    from_phone: f.from_phone ?? null,
    admin_notify_phone: f.admin_notify_phone ?? null,
    brand_name: f.brand_name ?? "",
    manual_default_template: f.manual_default_template ?? "",
    rate_limit_per_hour: Number(f.rate_limit_per_hour) || 3,
    reminder_steps: Array.isArray(f.reminder_steps) ? f.reminder_steps : [],
  }) : null, [f]);

  const saveFn = useCallback(async (v: any) => {
    if (!v) return;
    await update({ data: v });
    qc.invalidateQueries({ queryKey: ["sms-settings"] });
  }, [update, qc]);

  const autosave = useAutosave({
    key: "sms-settings",
    value: autosaveValue,
    enabled: !!autosaveValue,
    onSave: saveFn,
    delay: 900,
  });

  if (!f) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const setVal = (k: string, v: any) => setForm({ ...f, [k]: v });
  const steps: Step[] = Array.isArray(f.reminder_steps) ? f.reminder_steps : [];
  const setSteps = (s: Step[]) => setVal("reminder_steps", s);

  const doTest = async () => {
    if (!testTo) return toast.error("Enter a phone number");
    setBusy(true);
    try { await test({ data: { to: testTo } }); toast.success("Test SMS sent"); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };
  const doSweep = async () => {
    setBusy(true);
    try { const r: any = await sweep({}); toast.success(`Reminder sweep ran — processed ${r?.processed ?? 0}`); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader title="SMS Notifications" subtitle="Twilio-powered text alerts, personal messages, and custom automations." />
        <div className="flex items-center gap-2 flex-wrap">
          <SaveStatus state={autosave.state} savedAt={autosave.savedAt} />
          <Button size="sm" variant="outline" onClick={() => setPersonalOpen(true)}>
            <MessageSquare className="mr-1 h-4 w-4" />Create Personal SMS
          </Button>
          <Button size="sm" onClick={() => { setAutoEditing(null); setAutoOpen(true); }}>
            <Zap className="mr-1 h-4 w-4" />Create SMS Automation
          </Button>
        </div>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold">SMS sending</div>
            <div className="text-xs text-muted-foreground">Master switch. Turn off to pause all manual + automatic SMS.</div>
          </div>
          <Switch checked={!!f.enabled} onCheckedChange={(v) => setVal("enabled", v)} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>From phone (Twilio E.164)</Label>
            <Input value={f.from_phone ?? ""} placeholder="+15551234567" onChange={(e) => setVal("from_phone", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Admin notify phone (E.164)</Label>
            <Input
              value={f.admin_notify_phone ?? ""}
              placeholder="+15551234567"
              onChange={(e) => setVal("admin_notify_phone", e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Where system alerts text you — e.g. when a client is missing their 1RM/Training Max at program assignment.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Brand name in messages</Label>
            <Input value={f.brand_name ?? ""} onChange={(e) => setVal("brand_name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Hourly rate limit (per client)</Label>
            <Input type="number" min={1} max={20} value={f.rate_limit_per_hour ?? 3} onChange={(e) => setVal("rate_limit_per_hour", Number(e.target.value))} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Default manual SMS template</Label>
          <Textarea rows={3} value={f.manual_default_template ?? ""} onChange={(e) => setVal("manual_default_template", e.target.value)} />
          <div className="text-[11px] text-muted-foreground">Available tags: <code>{"{first_name}"}</code> <code>{"{full_name}"}</code> <code>{"{brand}"}</code></div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold">Automatic unread reminders</div>
            <div className="text-xs text-muted-foreground">Sends after admin message has been unread for this many minutes. Reminders stop once the client reads the message or after the last step.</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSteps([...steps, { delay_minutes: 60, enabled: true, template: `Hi {first_name}, this is ${f.brand_name}. You still have an unread message from your coach. Reply STOP to opt out.` }])}>
            <Plus className="mr-1 h-4 w-4" /> Add step
          </Button>
        </div>
        <div className="space-y-3">
          {steps.length === 0 && <div className="text-sm text-muted-foreground">No reminder steps configured.</div>}
          {steps.map((s, i) => (
            <div key={i} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-3">
                <Badge variant="outline">Step {i + 1}</Badge>
                <Label className="text-xs">Delay (min)</Label>
                <Input type="number" min={1} className="w-28 h-8" value={s.delay_minutes}
                  onChange={(e) => { const v = [...steps]; v[i] = { ...s, delay_minutes: Number(e.target.value) }; setSteps(v); }} />
                <div className="ml-auto flex items-center gap-2">
                  <Switch checked={s.enabled} onCheckedChange={(v) => { const arr = [...steps]; arr[i] = { ...s, enabled: v }; setSteps(arr); }} />
                  <Button size="icon" variant="ghost" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <Textarea rows={3} value={s.template} onChange={(e) => { const v = [...steps]; v[i] = { ...s, template: e.target.value }; setSteps(v); }} />
            </div>
          ))}
        </div>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" onClick={doSweep} disabled={busy}><RefreshCw className="mr-1 h-4 w-4" />Run reminder sweep now</Button>
      </div>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="font-bold flex items-center gap-2"><Zap className="h-4 w-4" />Custom SMS automations</div>
            <div className="text-xs text-muted-foreground">Build SMS automations for any trigger. Toggle active to start sending.</div>
          </div>
          <Button size="sm" onClick={() => { setAutoEditing(null); setAutoOpen(true); }}>
            <Plus className="mr-1 h-4 w-4" />New automation
          </Button>
        </div>
        <div className="space-y-2">
          {(automations ?? []).length === 0 && (
            <div className="text-sm text-muted-foreground">No custom automations yet. Click "New automation" to create one.</div>
          )}
          {(automations ?? []).map((a: any) => (
            <div key={a.id} className="flex items-start gap-3 rounded-lg border border-border p-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-semibold truncate">{a.name}</div>
                  <Badge variant="outline">{a.category}</Badge>
                  <Badge variant="outline">{a.trigger_type}</Badge>
                  {!a.active && <Badge variant="outline" className="border-amber-500/40 text-amber-600">Paused</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.body}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Audience: {a.audience_type} · Delay: {a.delay_minutes}m · Max/day: {a.max_per_client_per_day}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="icon" variant="ghost" onClick={() => { setAutoEditing(a as AutomationRow); setAutoOpen(true); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={async () => {
                  if (!confirm(`Delete automation "${a.name}"?`)) return;
                  try { await removeAuto({ data: { id: a.id } }); toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["sms-automations"] }); }
                  catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="font-bold">Send a test SMS</div>
        <div className="flex gap-2">
          <Input placeholder="+15551234567" value={testTo} onChange={(e) => setTestTo(e.target.value)} className="max-w-xs" />
          <Button onClick={doTest} disabled={busy}><Send className="mr-1 h-4 w-4" />Send test</Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="font-bold">Recent SMS activity</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr><th className="p-2">When</th><th className="p-2">Client</th><th className="p-2">Kind</th><th className="p-2">To</th><th className="p-2">Status</th><th className="p-2">Body / error</th></tr>
            </thead>
            <tbody>
              {(recent ?? []).map((r: any) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-2">{r.clients?.full_name ?? "—"}</td>
                  <td className="p-2">{r.kind}{r.reminder_step != null ? ` #${r.reminder_step + 1}` : ""}</td>
                  <td className="p-2 whitespace-nowrap">{r.to_phone || "—"}</td>
                  <td className="p-2">
                    <Badge variant={r.status === "sent" ? "default" : r.status === "failed" ? "destructive" : "outline"}>{r.status}</Badge>
                  </td>
                  <td className="p-2 max-w-md">{r.error ? <span className="text-destructive">{r.error}</span> : <span className="text-muted-foreground">{r.body}</span>}</td>
                </tr>
              ))}
              {(!recent || recent.length === 0) && (
                <tr><td className="p-3 text-muted-foreground" colSpan={6}>No SMS sent yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="font-bold">SMS recipients</div>
            <div className="text-xs text-muted-foreground">All active clients. Edit phone, toggle opt-out, or add a new contact.</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8 h-9 w-[220px]" placeholder="Search" value={recipSearch} onChange={(e) => setRecipSearch(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => setAddOpen(true)}><UserPlus className="mr-1 h-4 w-4" />Add contact</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">SMS opt-out</th>
                <th className="px-3 py-2 text-right">Profile</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecipients.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No clients match.</td></tr>}
              {filteredRecipients.map((c: any) => (
                <tr key={c.id} className="border-t border-border align-middle">
                  <td className="px-3 py-2 min-w-[200px]">
                    <Input defaultValue={c.full_name ?? ""} className="h-8 text-sm font-semibold"
                      onBlur={(e) => { if (e.target.value !== (c.full_name ?? "")) updateRecipient(c.id, { full_name: e.target.value }); }} />
                  </td>
                  <td className="px-3 py-2 min-w-[200px]">
                    <Input defaultValue={c.email ?? ""} className="h-8 text-sm"
                      onBlur={(e) => { if (e.target.value !== (c.email ?? "")) updateRecipient(c.id, { email: e.target.value }); }} />
                  </td>
                  <td className="px-3 py-2 min-w-[180px]">
                    <Input defaultValue={c.phone ?? ""} placeholder="+15551234567" className="h-8 text-sm"
                      onBlur={(e) => { if (e.target.value !== (c.phone ?? "")) updateRecipient(c.id, { phone: e.target.value || null }); }} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Switch checked={!!c.sms_opt_out} onCheckedChange={(v) => updateRecipient(c.id, { sms_opt_out: v })} />
                      {c.sms_opt_out
                        ? <Badge variant="outline" className="border-amber-500/40 text-amber-600">Opted out</Badge>
                        : c.phone ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">Will receive</Badge>
                          : <Badge variant="outline">No phone</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button asChild size="sm" variant="ghost"><Link to="/admin/clients/$id" params={{ id: c.id }}>Open</Link></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <AddSmsContact open={addOpen} onOpenChange={setAddOpen} onCreated={() => qc.invalidateQueries({ queryKey: ["sms-recipients"] })} />
      <SmsPersonalDialog open={personalOpen} onOpenChange={setPersonalOpen} />
      <SmsAutomationDialog open={autoOpen} onOpenChange={setAutoOpen} initial={autoEditing}
        onSaved={() => qc.invalidateQueries({ queryKey: ["sms-automations"] })} />
    </div>
  );
}

function AddSmsContact({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void; }) {
  const empty = { first_name: "", last_name: "", email: "", phone: "" };
  const [f, setF] = useState<any>(empty);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.first_name || !f.email) return toast.error("First name and email required");
    setBusy(true);
    const full_name = `${f.first_name} ${f.last_name}`.trim();
    const { error } = await supabase.from("clients").insert({
      first_name: f.first_name, last_name: f.last_name || null, full_name,
      email: f.email.toLowerCase().trim(), phone: f.phone || null, status: "Active",
    } as any);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Contact added"); onOpenChange(false); onCreated(); setF(empty);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add SMS contact</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>First name *</Label><Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></div>
            <div><Label>Last name</Label><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></div>
          </div>
          <div><Label>Email *</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div><Label>Phone</Label><Input value={f.phone} placeholder="+15551234567" onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}