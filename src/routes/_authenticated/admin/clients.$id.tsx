import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink, Save, Trash2, Mail, Archive, KeyRound, Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { inviteClient, deleteClient, getSetupLink, sendPasswordReset, markSetupComplete, setNeedsAdminHelp } from "@/lib/clients.functions";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { TrainingPhasesPanel } from "@/components/training-phases-panel";
import { PtSessionsPanel } from "@/components/pt-sessions-panel";
import { NutritionTargetsPanel } from "@/components/nutrition-targets-panel";
import { CardioTargetsPanel } from "@/components/cardio-targets-panel";
import { Switch } from "@/components/ui/switch";
import { COMMON_TIMEZONES } from "@/lib/pt-sessions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/clients/$id")({
  component: ClientDetail,
});

const STATUSES = ["Active", "New Client", "Needs Attention", "Check-In Overdue", "Payment Overdue", "Injured / Modified Plan", "Paused", "Cancelling", "Archived", "High Priority"];
const PAY_STATUSES = ["Not Sent", "Sent", "Paid", "Failed", "Overdue", "Cancelled", "Refunded"];

function ClientDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<any>(null);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const inviteFn = useServerFn(inviteClient);
  const deleteFn = useServerFn(deleteClient);
  const getSetupLinkFn = useServerFn(getSetupLink);
  const sendResetFn = useServerFn(sendPasswordReset);
  const markCompleteFn = useServerFn(markSetupComplete);
  const needsHelpFn = useServerFn(setNeedsAdminHelp);

  const { data } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => { if (data) setForm(data); }, [data]);

  if (!form) return <div className="p-10 text-muted-foreground">Loading…</div>;

  const save = async () => {
    const { id: _id, created_at, updated_at, ...patch } = form;
    const { error } = await supabase.from("clients").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["client", id] });
    qc.invalidateQueries({ queryKey: ["clients"] });
  };

  const archive = async () => {
    const { error } = await supabase.from("clients").update({ archived: !form.archived, status: !form.archived ? "Archived" : "Active" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(form.archived ? "Restored" : "Archived");
    navigate({ to: "/admin/clients" });
  };

  const sendSetup = async () => {
    if (!form.email) return toast.error("Add an email first");
    const t = toast.loading("Sending setup link…");
    try {
      const redirectTo = `${window.location.origin}/setup`;
      await inviteFn({ data: { clientId: id, redirectTo } });
      toast.success("Setup link sent", { id: t });
      qc.invalidateQueries({ queryKey: ["client", id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed", { id: t });
    }
  };

  const copySetupLink = async () => {
    if (!form.email) return toast.error("Add an email first");
    const t = toast.loading("Generating link…");
    try {
      const { url } = await getSetupLinkFn({ data: { clientId: id, redirectTo: `${window.location.origin}/setup` } });
      await navigator.clipboard.writeText(url);
      toast.success("Setup link copied", { id: t });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed", { id: t });
    }
  };

  const sendReset = async () => {
    if (!form.email) return toast.error("Add an email first");
    const t = toast.loading("Sending reset link…");
    try {
      await sendResetFn({ data: { clientId: id, redirectTo: `${window.location.origin}/reset-password` } });
      toast.success("Reset email sent", { id: t });
      qc.invalidateQueries({ queryKey: ["client", id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed", { id: t });
    }
  };

  const copyResetLink = async () => {
    if (!form.email) return toast.error("Add an email first");
    const t = toast.loading("Sending reset link…");
    try {
      await sendResetFn({ data: { clientId: id, redirectTo: `${window.location.origin}/reset-password` } });
      toast.success("Reset email sent to client", { id: t });
      qc.invalidateQueries({ queryKey: ["client", id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed", { id: t });
    }
  };

  const markComplete = async () => {
    await markCompleteFn({ data: { clientId: id } });
    toast.success("Marked as account created");
    qc.invalidateQueries({ queryKey: ["client", id] });
  };

  const toggleNeedsHelp = async () => {
    await needsHelpFn({ data: { clientId: id, value: !form.needs_admin_help } });
    toast.success(form.needs_admin_help ? "Cleared admin help flag" : "Flagged as needs help");
    qc.invalidateQueries({ queryKey: ["client", id] });
  };

  const confirmDelete = async () => {
    try {
      await deleteFn({ data: { clientId: id, deleteAuthUser: true } });
      toast.success("Client deleted");
      setDeleteStep(0);
      qc.invalidateQueries({ queryKey: ["clients"] });
      navigate({ to: "/admin/clients" });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    }
  };

  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

  const links = [
    ["Program Sheet", form.program_sheet_link],
    ["Drive Folder", form.drive_folder_link],
    ["Check-In Form", form.checkin_form_link],
    ["Agreement", form.agreement_link],
    ["Calendar", form.calendar_link],
    ["Stripe", form.stripe_link],
  ] as const;

  return (
    <>
      <PageHeader
        title={form.full_name}
        subtitle={form.coaching_type ?? "Coaching client"}
        actions={
          <>
            <Link to="/admin/clients"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />Back</Button></Link>
            <Button variant="outline" size="sm" onClick={sendSetup}><Mail className="mr-2 h-4 w-4" />Send setup link</Button>
            <Button variant="outline" size="sm" onClick={archive}><Archive className="mr-2 h-4 w-4" />{form.archived ? "Restore" : "Archive"}</Button>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteStep(1)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
            <Button size="sm" className="bg-gradient-primary uppercase font-bold" onClick={save}><Save className="mr-2 h-4 w-4" />Save</Button>
          </>
        }
      />
      <div className="p-6 md:p-8">
      <Tabs defaultValue="summary">
        <TabsList className="mb-6 flex flex-wrap h-auto">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="programs">Programs & Phases</TabsTrigger>
          <TabsTrigger value="nutrition">Nutrition</TabsTrigger>
          <TabsTrigger value="cardio">Cardio</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="account">Account & Access</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="grid gap-6 md:grid-cols-3">
        <Card className="border-border bg-card p-6 md:col-span-2 space-y-4">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Profile</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Full name</Label><Input value={form.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} /></div>
            <div><Label>Email</Label><Input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></div>
            <div><Label>Instagram</Label><Input value={form.instagram ?? ""} onChange={(e) => set("instagram", e.target.value)} /></div>
            <div><Label>Start date</Label><Input type="date" value={form.start_date ?? ""} onChange={(e) => set("start_date", e.target.value || null)} /></div>
            <div><Label>Renewal date</Label><Input type="date" value={form.renewal_date ?? ""} onChange={(e) => set("renewal_date", e.target.value || null)} /></div>
            <div><Label>Coaching package</Label><Input value={form.coaching_package ?? ""} onChange={(e) => set("coaching_package", e.target.value)} /></div>
            <div><Label>Program phase</Label><Input value={form.program_phase ?? ""} onChange={(e) => set("program_phase", e.target.value)} /></div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Payment status</Label>
              <Select value={form.payment_status ?? "Not Sent"} onValueChange={(v) => set("payment_status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PAY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <Card className="border-border bg-card p-6 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Linked Resources</h3>
          <div className="space-y-3">
            <div><Label>Program sheet</Label><Input value={form.program_sheet_link ?? ""} onChange={(e) => set("program_sheet_link", e.target.value)} placeholder="https://sheets.google.com/…" /></div>
            <div><Label>Drive folder</Label><Input value={form.drive_folder_link ?? ""} onChange={(e) => set("drive_folder_link", e.target.value)} /></div>
            <div><Label>Check-in form</Label><Input value={form.checkin_form_link ?? ""} onChange={(e) => set("checkin_form_link", e.target.value)} /></div>
            <div><Label>Agreement</Label><Input value={form.agreement_link ?? ""} onChange={(e) => set("agreement_link", e.target.value)} /></div>
            <div><Label>Calendar / booking link</Label><Input value={form.calendar_link ?? ""} onChange={(e) => set("calendar_link", e.target.value)} /></div>
            <div><Label>Stripe payment link</Label><Input value={form.stripe_link ?? ""} onChange={(e) => set("stripe_link", e.target.value)} /></div>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-2">
            {links.filter(([, v]) => v).map(([n, v]) => (
              <a key={n} href={v as string} target="_blank" rel="noreferrer">
                <Badge variant="outline" className="cursor-pointer hover:border-primary">{n} <ExternalLink className="ml-1 h-3 w-3" /></Badge>
              </a>
            ))}
          </div>
        </Card>

        <Card className="border-border bg-card p-6 md:col-span-2 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Coaching Notes</h3>
          <div><Label>Goals</Label><Textarea rows={2} value={form.goals ?? ""} onChange={(e) => set("goals", e.target.value)} /></div>
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>Injuries / limitations</Label><Textarea rows={3} value={form.injuries ?? ""} onChange={(e) => set("injuries", e.target.value)} /></div>
            <div><Label>Training notes</Label><Textarea rows={3} value={form.training_notes ?? ""} onChange={(e) => set("training_notes", e.target.value)} /></div>
            <div><Label>Nutrition notes</Label><Textarea rows={3} value={form.nutrition_notes ?? ""} onChange={(e) => set("nutrition_notes", e.target.value)} /></div>
            <div><Label>Lifestyle notes</Label><Textarea rows={3} value={form.lifestyle_notes ?? ""} onChange={(e) => set("lifestyle_notes", e.target.value)} /></div>
          </div>
        </Card>

        <Card className="border-primary/30 bg-primary/5 p-6 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-primary">Private Coach Notes</h3>
          <p className="text-xs text-muted-foreground">Only visible to admin.</p>
          <Textarea rows={10} value={form.coach_notes ?? ""} onChange={(e) => set("coach_notes", e.target.value)} placeholder="Internal notes the client never sees…" />
        </Card>
        </TabsContent>

        <TabsContent value="programs" className="grid gap-6 md:grid-cols-3">
          <TrainingPhasesPanel clientId={id} />
        </TabsContent>

        <TabsContent value="nutrition" className="grid gap-6 md:grid-cols-3">
          <NutritionTargetsPanel clientId={id} />
        </TabsContent>

        <TabsContent value="cardio" className="grid gap-6 md:grid-cols-3">
          <CardioTargetsPanel clientId={id} />
        </TabsContent>

        <TabsContent value="sessions" className="grid gap-6 md:grid-cols-3">
          <PtSessionsPanel clientId={id} client={form} />

        <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Time Zone & Sessions</h3>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label>Client time zone</Label>
              <Select value={form.timezone ?? "America/Winnipeg"} onValueChange={(v) => set("timezone", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{COMMON_TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Default session location</Label>
              <Input value={form.default_session_location ?? ""} onChange={(e) => set("default_session_location", e.target.value)} placeholder="Iron Image Gym" />
            </div>
            <div className="flex items-end justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
              <Label className="text-xs">Session package tracking</Label>
              <Switch checked={!!form.package_tracking_enabled} onCheckedChange={(v) => set("package_tracking_enabled", v)} />
            </div>
            <div />
            <div>
              <Label>Sessions purchased</Label>
              <Input type="number" value={form.sessions_purchased ?? 0} onChange={(e) => set("sessions_purchased", Number(e.target.value))} />
            </div>
            <div>
              <Label>Sessions used</Label>
              <Input type="number" value={form.sessions_used ?? 0} onChange={(e) => set("sessions_used", Number(e.target.value))} />
            </div>
            <div>
              <Label>Remaining</Label>
              <Input value={Math.max((form.sessions_purchased ?? 0) - (form.sessions_used ?? 0), 0)} readOnly className="bg-secondary/40" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Reminder emails are sent in the client's time zone. Defaults to America/Winnipeg if not set.</p>
        </Card>
        </TabsContent>

        <TabsContent value="account" className="grid gap-6 md:grid-cols-3">
        <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Account Access</h3>
            <AccountStatusBadge status={form.account_status} needsHelp={form.needs_admin_help} />
          </div>

          <div className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-4">
            <Field label="Email" value={form.email ?? "—"} />
            <Field label="Invite sent" value={fmtDate(form.invite_sent_at)} />
            <Field label="Last resent" value={fmtDate(form.invite_last_resent_at)} />
            <Field label="Account created" value={fmtDate(form.account_created_at)} />
            <Field label="Invite expires" value={fmtDate(form.invite_expires_at)} />
            <Field label="Password reset sent" value={fmtDate(form.password_reset_sent_at)} />
            <Field label="Linked auth user" value={form.user_id ? "Yes" : "No"} />
            <Field label="Needs admin help" value={form.needs_admin_help ? "Yes" : "No"} />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={sendSetup}><Mail className="mr-2 h-4 w-4" />{form.invite_sent_at ? "Resend setup email" : "Send setup email"}</Button>
            <Button size="sm" variant="outline" onClick={copySetupLink}><Copy className="mr-2 h-4 w-4" />Copy setup link</Button>
            <Button size="sm" variant="outline" onClick={sendReset}><KeyRound className="mr-2 h-4 w-4" />Send password reset</Button>
            <Button size="sm" variant="outline" onClick={copyResetLink}><Copy className="mr-2 h-4 w-4" />Copy reset link</Button>
            <Button size="sm" variant="outline" onClick={markComplete}><CheckCircle2 className="mr-2 h-4 w-4" />Mark setup complete</Button>
            <Button size="sm" variant={form.needs_admin_help ? "default" : "outline"} onClick={toggleNeedsHelp}>
              <AlertCircle className="mr-2 h-4 w-4" />{form.needs_admin_help ? "Clear admin help flag" : "Mark needs admin help"}
            </Button>
          </div>
        </Card>
        </TabsContent>
      </Tabs>
      </div>

      <AlertDialog open={deleteStep > 0} onOpenChange={(o) => !o && setDeleteStep(0)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteStep === 1 ? `Delete ${form.full_name}?` : "Are you absolutely sure?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteStep === 1
                ? "This will permanently remove the client record and their login. You'll be asked to confirm one more time."
                : "This action cannot be undone. The client's account, login, and all associated records will be permanently deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {deleteStep === 1 ? (
              <AlertDialogAction onClick={(e) => { e.preventDefault(); setDeleteStep(2); }}>Continue</AlertDialogAction>
            ) : (
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); confirmDelete(); }}>
                Yes, delete permanently
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}

function fmtDate(v?: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString();
}

function AccountStatusBadge({ status, needsHelp }: { status?: string; needsHelp?: boolean }) {
  const s = needsHelp ? "Needs Admin Help" : (status ?? "Invite Not Sent");
  const tone =
    s === "Account Created" || s === "Password Reset Completed" ? "border-success/40 text-success bg-success/10" :
    s === "Invite Sent" || s === "Password Reset Sent" ? "border-primary/40 text-primary bg-primary/10" :
    s === "Invite Expired" || s === "Needs Admin Help" ? "border-warning/40 text-warning bg-warning/10" :
    "border-border text-muted-foreground bg-secondary/40";
  return <Badge variant="outline" className={tone}>{s}</Badge>;
}