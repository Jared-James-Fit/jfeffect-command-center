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
import { ArrowLeft, ExternalLink, Save, Trash2, Mail, Archive, KeyRound, Copy, CheckCircle2, AlertCircle, BellRing, Tag, Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { inviteClient, deleteClient, getSetupLink, getPasswordResetLink, sendPasswordReset, markSetupComplete, setNeedsAdminHelp, setClientPassword } from "@/lib/clients.functions";
import { deactivateClient, reactivateClient, DEACTIVATION_REASONS } from "@/lib/client-deactivation.functions";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { TrainingPhasesPanel } from "@/components/training-phases-panel";
import { ImportantDatesPanel } from "@/components/important-dates-panel";
import { PtSessionsPanel } from "@/components/pt-sessions-panel";
import { NutritionTargetsPanel } from "@/components/nutrition-targets-panel";
import { CardioTargetsPanel } from "@/components/cardio-targets-panel";
import { LiftVideosPanel } from "@/components/lift-videos-panel";
import { ProgressMetricsPanel } from "@/components/progress-metrics-panel";
import { BasicInfoForm } from "@/components/basic-info-form";
import { calcAge, formatHeight } from "@/lib/basic-info";
import { Switch } from "@/components/ui/switch";
import { COMMON_TIMEZONES } from "@/lib/pt-sessions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProfilePictureCapture } from "@/components/profile-picture-capture";
import { MessageThread } from "@/components/message-thread";
import type { ConversationState } from "@/lib/messages";
import { AgreementStatusPanel } from "@/components/agreement-status-panel";
import { ClientDriveFolderPanel } from "@/components/client-drive-folder-panel";
import { PurchaseRecordsPanel } from "@/components/purchase-records-panel";
import { PriceCardPickerDialog } from "@/components/price-card-picker-dialog";
import { AgreementsPanel } from "@/components/agreements-panel";
import { TrainingScheduleCard } from "@/components/training-schedule-card";
import { AssignedProgramsCard } from "@/components/assigned-programs-card";
import { PowerlifterBadge, POWERLIFTER_BADGE_LABELS } from "@/components/powerlifter-badge";
import { SocialHandlesEditor } from "@/components/social-handles-editor";
import { SocialIcons } from "@/components/social-icons";
import { ClientQuickLinksCard } from "@/components/client-quick-links-card";
import { AppActivityCard } from "@/components/app-activity-card";
import { FolderOpen, Eye } from "lucide-react";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { Checkbox } from "@/components/ui/checkbox";
import { listForms as listNativeForms, type NfForm } from "@/lib/native-forms";
import { replaceClientNativeFormAssignments } from "@/lib/native-forms.functions";
import { ActionButton } from "@/components/action-button";

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

const TAB_VALUES = ["summary", "training", "nutrition", "cardio", "metrics", "messages", "lift-videos", "documents", "sessions", "purchases", "agreements", "notes", "info", "account"] as const;
type TabValue = typeof TAB_VALUES[number];

export const Route = createFileRoute("/_authenticated/admin/clients/$id")({
  validateSearch: (s) => z.object({ tab: z.enum(TAB_VALUES).optional() }).parse(s),
  component: ClientDetail,
});

const STATUSES = ["Active", "New Client", "Needs Attention", "Check-In Overdue", "Payment Overdue", "Injured / Modified Plan", "Paused", "Cancelling", "Deactivated", "Archived", "High Priority"];
const PAY_STATUSES = ["Not Sent", "Sent", "Paid", "Failed", "Overdue", "Cancelled", "Refunded"];
const ACCOUNT_FIELDS = ["first_name", "last_name", "preferred_name", "email", "phone", "date_of_birth", "height_cm", "preferred_height_unit", "address", "city", "province", "postal_code", "country", "timezone", "emergency_contact_name", "emergency_contact_phone"] as const;

function ClientDetail() {
  const { id } = Route.useParams();
  const { tab } = Route.useSearch();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { role } = useAuth();
  const impersonation = useClientImpersonation();
  const canPov = role === "admin" || role === "coach";
  const [form, setForm] = useState<any>(null);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [priceCardOpen, setPriceCardOpen] = useState(false);
  const inviteFn = useServerFn(inviteClient);
  const deleteFn = useServerFn(deleteClient);
  const getSetupLinkFn = useServerFn(getSetupLink);
  const sendResetFn = useServerFn(sendPasswordReset);
  const getResetLinkFn = useServerFn(getPasswordResetLink);
  const setPasswordFn = useServerFn(setClientPassword);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwValue, setPwValue] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const markCompleteFn = useServerFn(markSetupComplete);
  const needsHelpFn = useServerFn(setNeedsAdminHelp);
  const deactivateFn = useServerFn(deactivateClient);
  const reactivateFn = useServerFn(reactivateClient);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState<string>("Coaching ended");
  const [deactivateNote, setDeactivateNote] = useState<string>("");
  const [deactivateDisablePortal, setDeactivateDisablePortal] = useState<boolean>(true);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [reactivateRestorePortal, setReactivateRestorePortal] = useState(true);

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
    const t = toast.loading("Generating reset link…");
    try {
      const { url } = await getResetLinkFn({ data: { clientId: id, redirectTo: `${window.location.origin}/reset-password` } });
      await navigator.clipboard.writeText(url);
      toast.success("Reset link copied", { id: t });
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
      preferred_name: form.preferred_name ?? null,
      email: form.email ?? null,
      phone: form.phone ?? null,
      date_of_birth: form.date_of_birth || null,
      height_cm: form.height_cm ?? null,
      preferred_height_unit: form.preferred_height_unit ?? "imperial",
      emergency_contact_name: form.emergency_contact_name ?? null,
      emergency_contact_phone: form.emergency_contact_phone ?? null,
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
    ["Agreement", form.agreement_link],
    ["Calendar", form.calendar_link],
    ["Stripe", form.stripe_link],
  ] as const;

  return (
    <>
      <PageHeader
        backTo="/admin/clients"
        backLabel="Back to Clients"
        breadcrumbs={[{ label: "Clients", to: "/admin/clients" }, { label: form.full_name }]}
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
            <Link to="/admin/client-programs/$clientId" params={{ clientId: id }}>
              <Button variant="outline" size="sm"><Dumbbell className="mr-2 h-4 w-4" />Training Program</Button>
            </Link>
            {form.drive_folder_link && (
              <a href={form.drive_folder_link} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm"><FolderOpen className="mr-2 h-4 w-4" />Open Drive</Button>
              </a>
            )}
            {canPov && (
              <Button
                size="sm"
                className="bg-warning/15 text-warning border border-warning/40 hover:bg-warning/25"
                onClick={() => {
                  if (!form.user_id) {
                    toast.error("Client has no account yet — send a setup link first.");
                    return;
                  }
                  impersonation.start({ id, user_id: form.user_id, full_name: form.full_name });
                  navigate({ to: "/portal" });
                }}
              >
                <Eye className="mr-2 h-4 w-4" />Client POV
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setPriceCardOpen(true)}><Tag className="mr-2 h-4 w-4" />Assign Offer / View Price Card</Button>
            <ActionButton variant="outline" size="sm" onAction={sendSetup} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<Mail className="h-4 w-4" />}>Send setup link</ActionButton>
            {form.status === "Deactivated" ? (
              <Button variant="outline" size="sm" onClick={() => setReactivateOpen(true)}>
                <Eye className="mr-2 h-4 w-4" />Reactivate
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setDeactivateOpen(true)}>
                <Eye className="mr-2 h-4 w-4" />Deactivate
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={archive}><Archive className="mr-2 h-4 w-4" />{form.archived ? "Restore" : "Archive"}</Button>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteStep(1)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
            <Button size="sm" className="bg-gradient-primary uppercase font-bold" onClick={save}><Save className="mr-2 h-4 w-4" />Save</Button>
          </>
        }
      />
      <div className="p-6 md:p-8">
      {form.status === "Deactivated" && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <div className="font-semibold text-warning">Account Deactivated</div>
          <div className="text-muted-foreground">
            {form.deactivated_at ? `Deactivated ${new Date(form.deactivated_at).toLocaleDateString()}` : "Deactivated"}
            {form.deactivation_reason ? ` · ${form.deactivation_reason}` : ""}
            {form.portal_access_disabled ? " · Portal access disabled" : " · Portal access still enabled"}
          </div>
          {form.deactivation_note && (
            <div className="mt-1 text-xs text-muted-foreground italic">Note: {form.deactivation_note}</div>
          )}
        </div>
      )}
      <SetupStatusBanner
        form={form}
        onSendSetup={sendSetup}
        onCopySetup={copySetupLink}
        onSendReset={sendReset}
        onCopyReset={copyResetLink}
        onSetPassword={() => { setPwValue(""); setPwOpen(true); }}
        onGoToAccountTab={() => navigate({ to: ".", params: { id }, search: { tab: "account" }, replace: true })}
      />
      <Tabs
        value={tab ?? "summary"}
        onValueChange={(v) => navigate({ to: ".", params: { id }, search: { tab: v as TabValue }, replace: true })}
      >
        <TabsList className="mb-6 flex flex-wrap h-auto">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="training">Training</TabsTrigger>
          <TabsTrigger value="nutrition">Nutrition Targets</TabsTrigger>
          <TabsTrigger value="cardio">Cardio Targets</TabsTrigger>
         <TabsTrigger value="metrics">Progress Metrics</TabsTrigger>
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
        <AppActivityCard
          clientId={id}
          lastSignedInAt={form.last_signed_in_at}
          lastActiveAt={form.last_active_at}
          lastActiveRoute={form.last_active_route}
          complianceStatus={form.compliance_status}
          homeScreenStatus={form.home_screen_setup_status}
        />
        <TrainingScheduleCard client={form} />
        <ClientQuickLinksCard
          clientId={id}
          driveFolderLink={form.drive_folder_link}
          onChangeDriveFolderLink={(v) => set("drive_folder_link", v)}
        />
        <PowerlifterSection form={form} set={set} />
        <Card className="border-border bg-card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Basic Information</h3>
            <Link to="/admin/clients/$id" params={{ id }} search={{ tab: "info" }}>
              <Button variant="ghost" size="sm" className="h-7 text-xs">Edit</Button>
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
            {form.preferred_name && (<><dt className="text-muted-foreground">Preferred name</dt><dd className="font-medium">{form.preferred_name}</dd></>)}
            <dt className="text-muted-foreground">Date of birth</dt>
            <dd className="font-medium">{form.date_of_birth ? new Date(form.date_of_birth + "T00:00:00").toLocaleDateString() : "—"}</dd>
            <dt className="text-muted-foreground">Age</dt>
            <dd className="font-medium">{calcAge(form.date_of_birth) ?? "—"}</dd>
            <dt className="text-muted-foreground">Height</dt>
            <dd className="font-medium">{formatHeight(form.height_cm, (form.preferred_height_unit as any) ?? "imperial")}</dd>
            <dt className="text-muted-foreground">Time zone</dt>
            <dd className="font-medium">{form.timezone ?? "—"}</dd>
            <dt className="text-muted-foreground">Mailing address</dt>
            <dd className="font-medium truncate">
              {[form.address, form.city, form.province, form.postal_code, form.country].filter(Boolean).join(", ") || "—"}
            </dd>
            {(form.emergency_contact_name || form.emergency_contact_phone) && (
              <>
                <dt className="text-muted-foreground">Emergency contact</dt>
                <dd className="font-medium">
                  {form.emergency_contact_name ?? "—"}
                  {form.emergency_contact_phone ? ` · ${form.emergency_contact_phone}` : ""}
                </dd>
              </>
            )}
          </dl>
        </Card>
        <Card className="border-border bg-card p-6 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Social Media</h3>
            <SocialIcons client={form} size="xs" />
          </div>
          <p className="text-[11px] text-muted-foreground">Usernames/handles only — the app auto-links where possible.</p>
          <SocialHandlesEditor values={form} onChange={(k, v) => set(k, v)} />
        </Card>
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
        <div className="md:col-span-3">
          <ClientDriveFolderPanel clientId={id} />
        </div>
        </div>
        </TabsContent>

        <TabsContent value="training" className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-3"><TrainingScheduleCard client={form} /></div>
          <AssignedProgramsCard clientId={id} mode="admin" />
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

        <TabsContent value="metrics" className="grid gap-6 md:grid-cols-3">
          <ProgressMetricsPanel
            clientId={id}
            defaultUnit={(form?.preferred_weight_unit as "lb" | "kg") ?? "lb"}
            canEdit
            showExport
          />
        </TabsContent>

        <TabsContent value="messages" className="grid gap-6">
          <ClientMessagesTab clientId={id} />
        </TabsContent>

        <TabsContent value="lift-videos" className="grid gap-6 md:grid-cols-3">
          <LiftVideosPanel clientId={id} />
        </TabsContent>

        <TabsContent value="documents" className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-3">
            <ClientQuickLinksCard
              clientId={id}
              driveFolderLink={form.drive_folder_link}
              onChangeDriveFolderLink={(v) => set("drive_folder_link", v)}
            />
          </div>
          <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Check-Ins & Forms</h3>
                <p className="text-xs text-muted-foreground mt-1">Assign this client to forms from the unified form builder.</p>
              </div>
              <Link to="/admin/native-forms"><Button variant="outline" size="sm">Manage forms</Button></Link>
            </div>
            <ClientNativeFormsAssignment clientId={id} />
            <div className="grid gap-3 md:grid-cols-2">
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
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Basic Information</h3>
              <div className="flex gap-2">
                {form.info_update_requested ? (
                  <Button size="sm" variant="outline" onClick={clearUpdateRequest}>Clear update request</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={requestUpdate}><BellRing className="mr-2 h-4 w-4" />Request Profile Info Update</Button>
                )}
                <Button size="sm" className="bg-gradient-primary uppercase font-bold" onClick={saveAccountInfo}><Save className="mr-2 h-4 w-4" />Save</Button>
              </div>
            </div>
            <div className="md:col-span-2">
              <Label>Email</Label>
              <Input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
            </div>
            <BasicInfoForm
              values={form}
              onChange={(p) => setForm({ ...form, ...p })}
            />
            <div className="grid gap-2 rounded-md border border-border bg-secondary/30 p-3 text-xs md:grid-cols-2">
              <div><span className="text-muted-foreground">Last account info update:</span> {fmtDate(form.info_last_updated_at)}</div>
              <div><span className="text-muted-foreground">Updated by:</span> {form.info_last_updated_by ?? "—"}</div>
              <div className="md:col-span-2"><span className="text-muted-foreground">Fields updated:</span> {form.info_last_updated_fields?.length ? form.info_last_updated_fields.join(", ") : "—"}</div>
              <div><span className="text-muted-foreground">Profile picture updated:</span> {fmtDate(form.profile_picture_updated_at)}</div>
              <div><span className="text-muted-foreground">Time zone confirmed:</span> {fmtDate(form.timezone_confirmed_at)}</div>
              <div><span className="text-muted-foreground">Update requested:</span> {form.info_update_requested ? `Yes (${fmtDate(form.info_update_requested_at)})` : "No"}</div>
              <div><span className="text-muted-foreground">Basic info completed:</span> {fmtDate(form.basic_info_completed_at)}</div>
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

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-4 md:col-span-2">
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Email" value={form.email ?? "—"} />
                <Field label="Invite sent" value={fmtDate(form.invite_sent_at)} />
                <Field label="Last resent" value={fmtDate(form.invite_last_resent_at)} />
                <Field label="Account created" value={fmtDate(form.account_created_at)} />
                <Field label="Password reset sent" value={fmtDate(form.password_reset_sent_at)} />
                <Field label="Linked auth user" value={form.user_id ? "Yes" : "No"} />
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <ActionButton size="sm" variant="outline" onAction={sendSetup} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<Mail className="h-4 w-4" />}>{form.invite_sent_at ? "Resend setup email" : "Send setup email"}</ActionButton>
                <ActionButton size="sm" variant="outline" onAction={copySetupLink} loadingLabel="Copying…" successLabel="Copied" successToast={false} errorToast={false} icon={<Copy className="h-4 w-4" />}>Copy setup link</ActionButton>
                <ActionButton size="sm" variant="outline" onAction={sendReset} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<KeyRound className="h-4 w-4" />}>Send password reset</ActionButton>
                <ActionButton size="sm" variant="outline" onAction={copyResetLink} loadingLabel="Copying…" successLabel="Copied" successToast={false} errorToast={false} icon={<Copy className="h-4 w-4" />}>Copy reset link</ActionButton>
                <Button size="sm" variant="outline" onClick={() => { setPwValue(""); setPwOpen(true); }}>
                  <KeyRound className="mr-2 h-4 w-4" />Set password
                </Button>
                <ActionButton size="sm" variant="outline" onAction={markComplete} loadingLabel="Saving…" successLabel="Done" successToast={false} errorToast={false} icon={<CheckCircle2 className="h-4 w-4" />}>Mark setup complete</ActionButton>
                <Button size="sm" variant={form.needs_admin_help ? "default" : "outline"} onClick={toggleNeedsHelp}>
                  <AlertCircle className="mr-2 h-4 w-4" />{form.needs_admin_help ? "Clear admin help flag" : "Mark needs admin help"}
                </Button>
              </div>
            </div>

            <InviteExpiryPanel
              expiresAt={form.invite_expires_at}
              accountCreatedAt={form.account_created_at}
            />
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

      <AlertDialog open={pwOpen} onOpenChange={(o) => !pwSaving && setPwOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set password for {form.full_name}</AlertDialogTitle>
            <AlertDialogDescription>
              This sets the client's login password directly. Share it with them securely — they can change it later from their account settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="admin-set-pw">New password</Label>
            <Input
              id="admin-set-pw"
              type="text"
              autoComplete="new-password"
              value={pwValue}
              onChange={(e) => setPwValue(e.target.value)}
              placeholder="Pick any password"
            />
            <p className="text-xs text-muted-foreground">No minimum — keep it simple.</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pwSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pwSaving || pwValue.length < 1}
              onClick={async (e) => {
                e.preventDefault();
                setPwSaving(true);
                const t = toast.loading("Setting password…");
                try {
                  await setPasswordFn({ data: { clientId: id, password: pwValue } });
                  toast.success("Password updated", { id: t });
                  setPwOpen(false);
                  setPwValue("");
                  qc.invalidateQueries({ queryKey: ["client", id] });
                } catch (err: any) {
                  toast.error(err?.message ?? "Failed to set password", { id: t });
                } finally {
                  setPwSaving(false);
                }
              }}
            >
              {pwSaving ? "Saving…" : "Set password"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this client?</AlertDialogTitle>
            <AlertDialogDescription>
              Their account and history will be preserved, but they will no longer appear as an active client.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason (optional)</Label>
              <Select value={deactivateReason} onValueChange={setDeactivateReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEACTIVATION_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Internal note (admin only)</Label>
              <Textarea value={deactivateNote} onChange={(e) => setDeactivateNote(e.target.value)} rows={3} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Disable client portal access</div>
                <div className="text-xs text-muted-foreground">Recommended for ended coaching.</div>
              </div>
              <Switch checked={deactivateDisablePortal} onCheckedChange={setDeactivateDisablePortal} />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const t = toast.loading("Deactivating…");
                try {
                  await deactivateFn({ data: {
                    clientId: id,
                    reason: deactivateReason || undefined,
                    note: deactivateNote || undefined,
                    disablePortalAccess: deactivateDisablePortal,
                  }});
                  toast.success("Client deactivated", { id: t });
                  setDeactivateOpen(false);
                  qc.invalidateQueries({ queryKey: ["client", id] });
                  qc.invalidateQueries({ queryKey: ["clients"] });
                } catch (e: any) {
                  toast.error(e?.message ?? "Failed", { id: t });
                }
              }}
            >Deactivate Client</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reactivateOpen} onOpenChange={setReactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate this client?</AlertDialogTitle>
            <AlertDialogDescription>They will return to your Active Clients list.</AlertDialogDescription>
          </AlertDialogHeader>
          {form.portal_access_disabled && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="text-sm font-medium">Restore client portal access</div>
              <Switch checked={reactivateRestorePortal} onCheckedChange={setReactivateRestorePortal} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const t = toast.loading("Reactivating…");
                try {
                  await reactivateFn({ data: { clientId: id, restorePortalAccess: reactivateRestorePortal } });
                  toast.success("Client reactivated", { id: t });
                  setReactivateOpen(false);
                  qc.invalidateQueries({ queryKey: ["client", id] });
                  qc.invalidateQueries({ queryKey: ["clients"] });
                } catch (e: any) {
                  toast.error(e?.message ?? "Failed", { id: t });
                }
              }}
            >Reactivate</AlertDialogAction>
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

function InviteExpiryPanel({ expiresAt, accountCreatedAt }: { expiresAt: string | null; accountCreatedAt: string | null }) {
  if (accountCreatedAt) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
        <div className="text-[10px] uppercase tracking-widest text-emerald-400">Invite Status</div>
        <div className="mt-1 text-sm font-semibold text-emerald-300">Account created</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{fmtDate(accountCreatedAt)}</div>
      </div>
    );
  }
  if (!expiresAt) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Invite Expiry</div>
        <div className="mt-1 text-sm font-semibold">No invite sent yet</div>
        <div className="mt-0.5 text-xs text-muted-foreground">Send a setup link to start the 48-hour window.</div>
      </div>
    );
  }
  const ms = new Date(expiresAt).getTime() - Date.now();
  const expired = ms <= 0;
  const hours = Math.floor(Math.abs(ms) / 3_600_000);
  const mins = Math.floor((Math.abs(ms) % 3_600_000) / 60_000);
  const display = hours >= 1 ? `${hours}h ${mins}m` : `${mins}m`;
  const tone = expired
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : ms < 6 * 3_600_000
      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
      : "border-primary/30 bg-primary/10 text-primary";
  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <div className="text-[10px] uppercase tracking-widest opacity-80">Invite Expiry</div>
      <div className="mt-1 text-lg font-bold">{expired ? "Expired" : `${display} left`}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {expired ? "Expired on " : "Expires "} {fmtDate(expiresAt)}
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">Invites are valid for 48 hours.</div>
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

function ClientNativeFormsAssignment({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const saveClientAssignmentsFn = useServerFn(replaceClientNativeFormAssignments);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: forms = [] } = useQuery({ queryKey: ["nf-forms"], queryFn: () => listNativeForms({ includeArchived: false }) });
  const { data: assignmentRows = [] } = useQuery({
    queryKey: ["client-nf-assignments", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nf_assignments")
        .select("form_id")
        .eq("client_id", clientId);
      if (error) throw error;
      return (data ?? []).map((row: any) => row.form_id as string);
    },
    enabled: !!clientId,
  });

  useEffect(() => {
    if (dirty || saving) return;
    setSelectedIds(new Set(assignmentRows));
  }, [assignmentRows, dirty, saving]);

  const visibleFormIds = forms.filter((form: NfForm) => form.visibility !== "all_active_clients").map((form: NfForm) => form.id);
  const allVisibleSelected = visibleFormIds.length > 0 && visibleFormIds.every((id) => selectedIds.has(id));

  function setFormSelected(formId: string, checked: boolean) {
    if (saving) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(formId);
      else next.delete(formId);
      return next;
    });
    setDirty(true);
  }

  async function saveAssignments() {
    setSaving(true);
    try {
      const result = await saveClientAssignmentsFn({ data: { clientId, formIds: Array.from(selectedIds) } });
      if (!result.ok) return toast.error("Assignment save failed", { description: result.error ?? "Assignments could not be saved" });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["client-nf-assignments", clientId] });
      await qc.invalidateQueries({ queryKey: ["nf-assignments"] });
      toast.success(`Saved ${result.count} form assignment${result.count === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error("Assignment save failed", { description: e?.message ?? "Assignments could not be saved" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-secondary/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {selectedIds.size} selected{dirty ? " · unsaved" : ""}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedIds(new Set(visibleFormIds));
              setDirty(true);
            }}
            disabled={saving || visibleFormIds.length === 0 || allVisibleSelected}
          >
            Select all
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setSelectedIds(new Set()); setDirty(true); }} disabled={saving}>Clear all</Button>
          <Button type="button" size="sm" onClick={saveAssignments} disabled={saving || !dirty}>{saving ? "Saving…" : "Save assignments"}</Button>
        </div>
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {forms.length === 0 ? (
          <div className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground">No forms yet.</div>
        ) : forms.map((form: NfForm) => {
          const broadcast = form.visibility === "all_active_clients";
          const checked = broadcast || selectedIds.has(form.id);
          return (
            <button
              key={form.id}
              type="button"
              onClick={() => !broadcast && setFormSelected(form.id, !checked)}
              disabled={saving || broadcast}
              className="flex min-h-[44px] w-full items-center gap-3 rounded p-2 text-left hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Checkbox checked={checked} className="pointer-events-none" />
              <span className="min-w-0 flex-1 text-sm font-semibold">{form.title}</span>
              <Badge variant="outline" className="text-[10px]">{broadcast ? "All active" : form.kind === "external" ? "External" : "Native"}</Badge>
            </button>
          );
        })}
      </div>
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

function SetupStatusBanner({
  form,
  onSendSetup,
  onCopySetup,
  onSendReset,
  onCopyReset,
  onSetPassword,
  onGoToAccountTab,
}: {
  form: any;
  onSendSetup: () => void;
  onCopySetup: () => void;
  onSendReset: () => void;
  onCopyReset: () => void;
  onSetPassword: () => void;
  onGoToAccountTab: () => void;
}) {
  const hasUser = !!form.user_id;
  const hasAccount = !!form.account_created_at;
  const lastSignIn: string | null = form.last_signed_in_at ?? null;
  const inviteSent: string | null = form.invite_sent_at ?? null;
  const expiresAt: string | null = form.invite_expires_at ?? null;
  const inviteExpired = !hasAccount && !!expiresAt && new Date(expiresAt).getTime() <= Date.now();

  type Stage = "no_account" | "invite_pending" | "invite_expired" | "account_no_signin" | "live";
  let stage: Stage;
  if (lastSignIn) stage = "live";
  else if (hasAccount || hasUser) stage = "account_no_signin";
  else if (inviteSent && inviteExpired) stage = "invite_expired";
  else if (inviteSent) stage = "invite_pending";
  else stage = "no_account";

  const cfg = {
    no_account: {
      tone: "border-warning/40 bg-warning/10 text-warning",
      label: "Account not set up",
      pill: "Needs setup",
      detail: "No setup link has been sent. Send or copy a setup link to start the 48-hour window.",
    },
    invite_pending: {
      tone: "border-primary/40 bg-primary/10 text-primary",
      label: "Setup link sent — waiting for client",
      pill: "Pending",
      detail: expiresAt
        ? `Invite valid until ${new Date(expiresAt).toLocaleString()}. They must finish before it expires.`
        : "Waiting for client to complete setup.",
    },
    invite_expired: {
      tone: "border-destructive/40 bg-destructive/10 text-destructive",
      label: "Setup link expired",
      pill: "Expired",
      detail: "The 48-hour window has passed. Send or copy a fresh setup link.",
    },
    account_no_signin: {
      tone: "border-amber-500/40 bg-amber-500/10 text-amber-400",
      label: "Account created — never signed in",
      pill: "Not signed in yet",
      detail: "Login exists but the client hasn't signed in yet. Send a reset link or set their password manually.",
    },
    live: {
      tone: "border-success/40 bg-success/10 text-success",
      label: "Account is live",
      pill: "Live",
      detail: `Last signed in ${new Date(lastSignIn!).toLocaleString()}.`,
    },
  }[stage];

  return (
    <div className={`mb-4 rounded-lg border p-4 ${cfg.tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest opacity-80">Account Setup</span>
            <Badge variant="outline" className="border-current text-current bg-background/30">{cfg.pill}</Badge>
            {form.needs_admin_help && (
              <Badge variant="outline" className="border-warning/40 text-warning bg-warning/10">Needs admin help</Badge>
            )}
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">{cfg.label}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{cfg.detail}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>Invite sent: {fmtDate(inviteSent)}</span>
            <span>Account created: {fmtDate(form.account_created_at)}</span>
            <span>Last sign-in: {fmtDate(lastSignIn)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(stage === "no_account" || stage === "invite_pending" || stage === "invite_expired") && (
            <>
              <ActionButton size="sm" variant="outline" onAction={onSendSetup} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<Mail className="h-4 w-4" />}>
                {stage === "no_account" ? "Send setup link" : "Resend setup link"}
              </ActionButton>
              <ActionButton size="sm" variant="outline" onAction={onCopySetup} loadingLabel="Copying…" successLabel="Copied" successToast={false} errorToast={false} icon={<Copy className="h-4 w-4" />}>
                Copy setup link
              </ActionButton>
            </>
          )}
          {stage === "account_no_signin" && (
            <>
              <ActionButton size="sm" variant="outline" onAction={onSendReset} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<KeyRound className="h-4 w-4" />}>
                Send reset link
              </ActionButton>
              <ActionButton size="sm" variant="outline" onAction={onCopyReset} loadingLabel="Copying…" successLabel="Copied" successToast={false} errorToast={false} icon={<Copy className="h-4 w-4" />}>
                Copy reset link
              </ActionButton>
              <Button size="sm" variant="outline" onClick={onSetPassword}>
                <KeyRound className="mr-2 h-4 w-4" />Set password
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={onGoToAccountTab}>Manage</Button>
        </div>
      </div>
    </div>
  );
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