import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
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
import { ArrowLeft, ExternalLink, Save, Trash2, Mail, Archive, KeyRound, Copy, CheckCircle2, AlertCircle, BellRing, Tag } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { inviteClient, deleteClient, getSetupLink, sendPasswordReset, markSetupComplete, setNeedsAdminHelp } from "@/lib/clients.functions";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { TrainingPhasesPanel } from "@/components/training-phases-panel";
import { ImportantDatesPanel } from "@/components/important-dates-panel";
import { PtSessionsPanel } from "@/components/pt-sessions-panel";
import { NutritionTargetsPanel } from "@/components/nutrition-targets-panel";
import { CardioTargetsPanel } from "@/components/cardio-targets-panel";
import { LiftVideosPanel } from "@/components/lift-videos-panel";
import { Switch } from "@/components/ui/switch";
import { COMMON_TIMEZONES } from "@/lib/pt-sessions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProfilePictureCapture } from "@/components/profile-picture-capture";
import { MessageThread } from "@/components/message-thread";
import type { ConversationState } from "@/lib/messages";
import { AgreementStatusPanel } from "@/components/agreement-status-panel";
import { PurchaseRecordsPanel } from "@/components/purchase-records-panel";
import { PriceCardPickerDialog } from "@/components/price-card-picker-dialog";
import { AgreementsPanel } from "@/components/agreements-panel";
import { TrainingScheduleCard } from "@/components/training-schedule-card";
import { listCheckInLinks } from "@/lib/check-ins";
import { PowerlifterBadge, POWERLIFTER_BADGE_LABELS } from "@/components/powerlifter-badge";
import { SocialHandlesEditor } from "@/components/social-handles-editor";
import { SocialIcons } from "@/components/social-icons";

function AssignedCoachSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data: coaches = [] } = useQuery({
    queryKey: ["coaches-select"],
    queryFn: async () => {
      const { data } = await supabase.from("coaches").select("id, full_name, status").eq("archived", false).order("full_name");
      return data ?? [];
    },
  });
  return (
    <Select value={value ?? "none"} onValueChange={(v) => onChange(v === "none" ? null : v)}>
      <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">— Unassigned —</SelectItem>
        {coaches.map((c) => (
          <SelectItem key={c.id} value={c.id}>{c.full_name}{c.status !== "Active" ? ` (${c.status})` : ""}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const TAB_VALUES = ["summary", "training", "nutrition", "cardio", "messages", "lift-videos", "documents", "sessions", "purchases", "agreements", "notes", "info", "account"] as const;
type TabValue = typeof TAB_VALUES[number];

export const Route = createFileRoute("/_authenticated/admin/clients/$id")({
  validateSearch: (s) => z.object({ tab: z.enum(TAB_VALUES).optional() }).parse(s),
  component: ClientDetail,
});

const STATUSES = ["Active", "New Client", "Needs Attention", "Check-In Overdue", "Payment Overdue", "Injured / Modified Plan", "Paused", "Cancelling", "Archived", "High Priority"];
const PAY_STATUSES = ["Not Sent", "Sent", "Paid", "Failed", "Overdue", "Cancelled", "Refunded"];
const COUNTRIES = ["Canada", "United States", "United Kingdom", "Australia", "New Zealand", "Other"];
const ACCOUNT_FIELDS = ["first_name", "last_name", "email", "phone", "address", "city", "province", "postal_code", "country", "timezone"] as const;

function ClientDetail() {
  const { id } = Route.useParams();
  const { tab } = Route.useSearch();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<any>(null);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [priceCardOpen, setPriceCardOpen] = useState(false);
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

  const saveAccountInfo = async () => {
    if (!data) return;
    const updatedFields = ACCOUNT_FIELDS.filter((f) => form[f] !== (data as any)[f]);
    const patch: any = {
      first_name: form.first_name ?? null,
      last_name: form.last_name ?? null,
      full_name: [form.first_name, form.last_name].filter(Boolean).join(" ").trim() || form.full_name,
      email: form.email ?? null,
      phone: form.phone ?? null,
      address: form.address ?? null,
      city: form.city ?? null,
      province: form.province ?? null,
      postal_code: form.postal_code ?? null,
      country: form.country ?? null,
      timezone: form.timezone ?? "America/Winnipeg",
      info_last_updated_at: new Date().toISOString(),
      info_last_updated_by: "admin",
      info_last_updated_fields: updatedFields,
    };
    const { error } = await supabase.from("clients").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Account info saved");
    qc.invalidateQueries({ queryKey: ["client", id] });
    qc.invalidateQueries({ queryKey: ["clients"] });
  };

  const requestUpdate = async () => {
    const { error } = await supabase
      .from("clients")
      .update({ info_update_requested: true, info_update_requested_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Client will see a reminder on their dashboard");
    qc.invalidateQueries({ queryKey: ["client", id] });
  };

  const clearUpdateRequest = async () => {
    const { error } = await supabase.from("clients").update({ info_update_requested: false }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["client", id] });
  };

  const adminUpdatePicture = async (path: string) => {
    const { error } = await supabase
      .from("clients")
      .update({
        profile_picture_url: path,
        profile_picture_updated_at: new Date().toISOString(),
        profile_picture_updated_by: "admin",
        profile_picture_source: "admin_override",
        profile_picture_needs_update: false,
        profile_picture_needs_update_at: null,
        profile_picture_needs_update_reason: null,
      })
      .eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["client", id] });
    setForm({
      ...form,
      profile_picture_url: path,
      profile_picture_needs_update: false,
      profile_picture_needs_update_at: null,
      profile_picture_needs_update_reason: null,
    });
  };

  const requestPictureUpdate = async () => {
    const reason = window.prompt(
      "Reason for requesting a new profile picture (optional, shown to the client):",
      "Please take a new clear headshot.",
    );
    if (reason === null) return;
    const { error } = await supabase
      .from("clients")
      .update({
        profile_picture_needs_update: true,
        profile_picture_needs_update_at: new Date().toISOString(),
        profile_picture_needs_update_reason: reason || "Please take a new clear headshot.",
      })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Client will be asked to update their profile picture on next login.");
    qc.invalidateQueries({ queryKey: ["client", id] });
    setForm({
      ...form,
      profile_picture_needs_update: true,
      profile_picture_needs_update_at: new Date().toISOString(),
      profile_picture_needs_update_reason: reason || "Please take a new clear headshot.",
    });
  };

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
        title={
          <>
            <span>{form.full_name}</span>
            {form.is_powerlifter && (
              <PowerlifterBadge label={form.powerlifter_badge_label} size="sm" />
            )}
            <SocialIcons client={form} size="sm" />
          </>
        }
        subtitle={form.coaching_type ?? "Coaching client"}
        actions={
          <>
            <Link to="/admin/clients"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />Back</Button></Link>
            <Button variant="outline" size="sm" onClick={() => setPriceCardOpen(true)}><Tag className="mr-2 h-4 w-4" />Assign Offer / View Price Card</Button>
            <Button variant="outline" size="sm" onClick={sendSetup}><Mail className="mr-2 h-4 w-4" />Send setup link</Button>
            <Button variant="outline" size="sm" onClick={archive}><Archive className="mr-2 h-4 w-4" />{form.archived ? "Restore" : "Archive"}</Button>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteStep(1)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
            <Button size="sm" className="bg-gradient-primary uppercase font-bold" onClick={save}><Save className="mr-2 h-4 w-4" />Save</Button>
          </>
        }
      />
      <div className="p-6 md:p-8">
      <Tabs
        value={tab ?? "summary"}
        onValueChange={(v) => navigate({ to: ".", params: { id }, search: { tab: v as TabValue }, replace: true })}
      >
        <TabsList className="mb-6 flex flex-wrap h-auto">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="training">Training</TabsTrigger>
          <TabsTrigger value="nutrition">Nutrition Targets</TabsTrigger>
          <TabsTrigger value="cardio">Cardio Targets</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="lift-videos">Lift Videos</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
          <TabsTrigger value="agreements">Agreements</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="info">Account Info</TabsTrigger>
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
            <div className="col-span-2">
              <Label>Assigned coach</Label>
              <AssignedCoachSelect
                value={form.assigned_coach_id ?? null}
                onChange={(v) => set("assigned_coach_id", v)}
              />
            </div>
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

        <div className="space-y-6">
        <TrainingScheduleCard client={form} />
        <PowerlifterSection form={form} set={set} />
        <Card className="border-border bg-card p-6 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Quick Jump</h3>
          <p className="text-xs text-muted-foreground">Open a management area for this client.</p>
          <div className="grid gap-2">
            <Link to="/admin/clients/$id" params={{ id }} search={{ tab: "training" }}><Button variant="outline" size="sm" className="w-full justify-start">Manage Training</Button></Link>
            <Link to="/admin/clients/$id" params={{ id }} search={{ tab: "nutrition" }}><Button variant="outline" size="sm" className="w-full justify-start">Manage Nutrition Targets</Button></Link>
            <Link to="/admin/clients/$id" params={{ id }} search={{ tab: "cardio" }}><Button variant="outline" size="sm" className="w-full justify-start">Manage Cardio Targets</Button></Link>
            <Link to="/admin/clients/$id" params={{ id }} search={{ tab: "documents" }}><Button variant="outline" size="sm" className="w-full justify-start">Manage Documents</Button></Link>
            <Link to="/admin/clients/$id" params={{ id }} search={{ tab: "sessions" }}><Button variant="outline" size="sm" className="w-full justify-start">Book PT Session</Button></Link>
            <Link to="/admin/clients/$id" params={{ id }} search={{ tab: "account" }}><Button variant="outline" size="sm" className="w-full justify-start">Account & Access</Button></Link>
          </div>
        </Card>
        </div>
        </TabsContent>

        <TabsContent value="training" className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-3"><TrainingScheduleCard client={form} /></div>
          <TrainingPhasesPanel clientId={id} />
          <ImportantDatesPanel clientId={id} />
        </TabsContent>

        <TabsContent value="nutrition" className="grid gap-6 md:grid-cols-3">
          <NutritionTargetsPanel clientId={id} />
        </TabsContent>

        <TabsContent value="cardio" className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-3"><TrainingScheduleCard client={form} /></div>
          <CardioTargetsPanel clientId={id} />
        </TabsContent>

        <TabsContent value="messages" className="grid gap-6">
          <ClientMessagesTab clientId={id} />
        </TabsContent>

        <TabsContent value="lift-videos" className="grid gap-6 md:grid-cols-3">
          <LiftVideosPanel clientId={id} />
        </TabsContent>

        <TabsContent value="documents" className="grid gap-6 md:grid-cols-3">
          <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Weekly Check-In</h3>
                <p className="text-xs text-muted-foreground mt-1">Assign a reusable check-in link from your library, or paste a custom one below.</p>
              </div>
              <Badge variant="outline" className={form.checkin_form_link ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-warning/40 bg-warning/10 text-warning"}>
                Weekly check-in link: {form.checkin_form_link ? "Added" : "Missing"}
              </Badge>
            </div>
            <AssignCheckInLibrary
              value={form.assigned_check_in_link_id ?? null}
              onChange={(v: string | null) => set("assigned_check_in_link_id", v)}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label>Weekly Check-In Link</Label>
                <Input
                  value={form.checkin_form_link ?? ""}
                  onChange={(e) => { set("checkin_form_link", e.target.value); set("checkin_link_updated_at", new Date().toISOString()); }}
                  placeholder="https://forms.google.com/…"
                />
                {form.checkin_link_updated_at && (
                  <div className="mt-1 text-[11px] text-muted-foreground">Last updated: {new Date(form.checkin_link_updated_at).toLocaleString()}</div>
                )}
              </div>
              <div>
                <Label>Check-in due day</Label>
                <Input value={form.checkin_due_day ?? ""} onChange={(e) => set("checkin_due_day", e.target.value)} placeholder="e.g. Every Sunday" />
              </div>
              <div className="flex items-end gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={form.checkin_allow_video !== false} onCheckedChange={(v) => set("checkin_allow_video", v)} />
                  Allow check-in video
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={form.checkin_allow_photos !== false} onCheckedChange={(v) => set("checkin_allow_photos", v)} />
                  Allow progress photos
                </label>
              </div>
              <div className="md:col-span-2">
                <Label>Check-in instructions (visible to client)</Label>
                <Textarea rows={3} value={form.checkin_instructions ?? ""} onChange={(e) => set("checkin_instructions", e.target.value)} placeholder="What you want the client to know before submitting." />
              </div>
              <div className="md:col-span-2">
                <Label>Check-in notes for client</Label>
                <Textarea rows={2} value={form.checkin_notes_client ?? ""} onChange={(e) => set("checkin_notes_client", e.target.value)} placeholder="Short note shown on their check-in page." />
              </div>
              <div className="md:col-span-2">
                <Label>Private admin notes</Label>
                <Textarea rows={2} value={form.checkin_notes_admin ?? ""} onChange={(e) => set("checkin_notes_admin", e.target.value)} placeholder="Internal only — never shown to the client." />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Use the Save button at the top of the page to apply changes.</p>
          </Card>

          <Card className="border-border bg-card p-6 md:col-span-3 space-y-3">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Linked Resources & Uploads</h3>
            <p className="text-xs text-muted-foreground">Attach Google Sheets, Drive folders, PDFs, and external links. Save to apply.</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label>Program sheet (Google Sheets)</Label><Input value={form.program_sheet_link ?? ""} onChange={(e) => set("program_sheet_link", e.target.value)} placeholder="https://sheets.google.com/…" /></div>
              <div><Label>Drive folder</Label><Input value={form.drive_folder_link ?? ""} onChange={(e) => set("drive_folder_link", e.target.value)} placeholder="https://drive.google.com/…" /></div>
              <div><Label>Check-in form</Label><Input value={form.checkin_form_link ?? ""} onChange={(e) => set("checkin_form_link", e.target.value)} /></div>
              <div><Label>Agreement / contract</Label><Input value={form.agreement_link ?? ""} onChange={(e) => set("agreement_link", e.target.value)} /></div>
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

        <TabsContent value="purchases" className="grid gap-6 md:grid-cols-3">
          <AgreementStatusPanel client={form} />
          <PurchaseRecordsPanel clientId={id} />
        </TabsContent>

        <TabsContent value="agreements" className="grid gap-6 md:grid-cols-3">
          <AgreementStatusPanel client={form} />
          <AgreementsPanel clientId={id} clientName={form?.full_name} />
        </TabsContent>

        <TabsContent value="notes" className="grid gap-6 md:grid-cols-3">
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
            <Textarea rows={12} value={form.coach_notes ?? ""} onChange={(e) => set("coach_notes", e.target.value)} placeholder="Internal notes the client never sees…" />
          </Card>
        </TabsContent>

        <TabsContent value="info" className="grid gap-6 md:grid-cols-3">
          <Card className="border-border bg-card p-6 md:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Account Information</h3>
              <div className="flex gap-2">
                {form.info_update_requested ? (
                  <Button size="sm" variant="outline" onClick={clearUpdateRequest}>Clear update request</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={requestUpdate}><BellRing className="mr-2 h-4 w-4" />Request Account Info Update</Button>
                )}
                <Button size="sm" className="bg-gradient-primary uppercase font-bold" onClick={saveAccountInfo}><Save className="mr-2 h-4 w-4" />Save</Button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label>First name</Label><Input value={form.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} /></div>
              <div><Label>Last name</Label><Input value={form.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} /></div>
              <div><Label>Email</Label><Input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} /></div>
              <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></div>
              <div className="md:col-span-2"><Label>Mailing address</Label><Input value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} /></div>
              <div><Label>City</Label><Input value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} /></div>
              <div><Label>Province / State</Label><Input value={form.province ?? ""} onChange={(e) => set("province", e.target.value)} /></div>
              <div><Label>Postal / ZIP code</Label><Input value={form.postal_code ?? ""} onChange={(e) => set("postal_code", e.target.value)} /></div>
              <div>
                <Label>Country</Label>
                <Select value={form.country ?? ""} onValueChange={(v) => set("country", v)}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Time zone</Label>
                <Select value={form.timezone ?? "America/Winnipeg"} onValueChange={(v) => set("timezone", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COMMON_TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2 rounded-md border border-border bg-secondary/30 p-3 text-xs md:grid-cols-2">
              <div><span className="text-muted-foreground">Last account info update:</span> {fmtDate(form.info_last_updated_at)}</div>
              <div><span className="text-muted-foreground">Updated by:</span> {form.info_last_updated_by ?? "—"}</div>
              <div className="md:col-span-2"><span className="text-muted-foreground">Fields updated:</span> {form.info_last_updated_fields?.length ? form.info_last_updated_fields.join(", ") : "—"}</div>
              <div><span className="text-muted-foreground">Profile picture updated:</span> {fmtDate(form.profile_picture_updated_at)}</div>
              <div><span className="text-muted-foreground">Time zone confirmed:</span> {fmtDate(form.timezone_confirmed_at)}</div>
              <div><span className="text-muted-foreground">Update requested:</span> {form.info_update_requested ? `Yes (${fmtDate(form.info_update_requested_at)})` : "No"}</div>
            </div>
          </Card>

          <Card className="border-border bg-card p-6 space-y-3">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Profile Picture</h3>
            <ProfilePictureCapture
              userId={form.user_id ?? id}
              currentUrl={form.profile_picture_url}
              onUploaded={adminUpdatePicture}
              allowFileUpload
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={requestPictureUpdate}>
                {form.profile_picture_needs_update ? "Update reminder active" : "Request client to update"}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Status:{" "}
                {form.profile_picture_needs_update
                  ? "Needs Update"
                  : form.profile_picture_url
                  ? "Complete"
                  : "Required"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Admin can capture or upload on behalf of the client. Source:{" "}
              {form.profile_picture_source ?? "—"} · Updated by: {form.profile_picture_updated_by ?? "—"}
            </p>
            {form.profile_picture_needs_update && form.profile_picture_needs_update_reason && (
              <p className="text-[11px] text-warning">
                Reason shown to client: {form.profile_picture_needs_update_reason}
              </p>
            )}
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
      <PriceCardPickerDialog open={priceCardOpen} onClose={() => setPriceCardOpen(false)} fixedClientId={id} />
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

function ClientMessagesTab({ clientId }: { clientId: string }) {
  const { data: state } = useQuery({
    queryKey: ["conversation-state", clientId],
    queryFn: async () => {
      const { data } = await (supabase.from("conversation_state") as any).select("*").eq("client_id", clientId).maybeSingle();
      return (data ?? null) as ConversationState | null;
    },
  });
  return <MessageThread clientId={clientId} role="admin" conversationState={state ?? null} />;
}

function AssignCheckInLibrary({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data: links = [] } = useQuery({
    queryKey: ["check-in-links-active"],
    queryFn: () => listCheckInLinks({ includeArchived: false }),
  });
  return (
    <div className="grid gap-2 md:grid-cols-[1fr_auto] items-end">
      <div>
        <Label>Assigned check-in link (from library)</Label>
        <Select value={value ?? "none"} onValueChange={(v) => onChange(v === "none" ? null : v)}>
          <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— None (use custom link below) —</SelectItem>
            {links.filter((l) => l.active).map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.title} {l.due_day ? `· ${l.due_day}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Link to="/admin/check-ins"><Button variant="outline" size="sm">Manage library</Button></Link>
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

function PowerlifterSection({ form, set }: { form: any; set: (k: string, v: any) => void }) {
  const url = (form.openpowerlifting_url ?? "").trim();
  const isOn = !!form.is_powerlifter;
  const show = isOn || !!url;
  const openLink = () => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };
  const removeLink = () => set("openpowerlifting_url", null);
  return (
    <Card className="border-border bg-card p-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">OpenPowerlifting</h3>
        {isOn && <PowerlifterBadge label={form.powerlifter_badge_label} size="xs" />}
      </div>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">Powerlifter</span>
        <Switch checked={isOn} onCheckedChange={(v) => set("is_powerlifter", v)} />
      </label>

      {isOn && (
        <div>
          <Label className="text-[11px]">Badge style</Label>
          <Select
            value={form.powerlifter_badge_label ?? "Powerlifter"}
            onValueChange={(v) => set("powerlifter_badge_label", v)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {POWERLIFTER_BADGE_LABELS.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {show ? (
        <div className="space-y-2">
          <Label className="text-[11px]">OpenPowerlifting Link (optional)</Label>
          <Input
            value={form.openpowerlifting_url ?? ""}
            onChange={(e) => set("openpowerlifting_url", e.target.value || null)}
            placeholder="https://www.openpowerlifting.org/u/…"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" size="sm" variant="outline" disabled={!url} onClick={openLink}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open Link
            </Button>
            {url && (
              <Button type="button" size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={removeLink}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No OpenPowerlifting link added.</p>
      )}

      {(isOn || url) && (
        <label className="flex items-center justify-between gap-3 text-sm pt-2 border-t border-border/60">
          <span>Visible to client</span>
          <Switch
            checked={!!form.powerlifting_visible_to_client}
            onCheckedChange={(v) => set("powerlifting_visible_to_client", v)}
          />
        </label>
      )}
      <p className="text-[11px] text-muted-foreground">Use Save at the top to apply changes.</p>
    </Card>
  );
}