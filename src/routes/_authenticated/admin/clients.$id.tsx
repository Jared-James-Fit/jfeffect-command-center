import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, lazy, Suspense, Fragment, type ComponentType } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink, Save, Trash2, Mail, Archive, KeyRound, Copy, CheckCircle2, AlertCircle, BellRing, Tag, Dumbbell, MessageSquare, Link2, MoreHorizontal, Apple, DollarSign, LayoutDashboard, IdCard, Target, Phone, Calendar } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SendBookingLinkDialog } from "@/components/appointments/send-booking-link-dialog";
import { SendPasswordResetDialog } from "@/components/account/send-password-reset-dialog";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { inviteClient, deleteClient, getSetupLink, getPasswordResetLink, sendPasswordReset, markSetupComplete, setNeedsAdminHelp, setClientPassword } from "@/lib/clients.functions";
import { sendAuthLinkBySms } from "@/lib/sms-links.functions";
import { deactivateClient, reactivateClient, DEACTIVATION_REASONS } from "@/lib/client-deactivation.functions";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { calcAge, formatHeight } from "@/lib/basic-info";
import { Switch } from "@/components/ui/switch";
import { COMMON_TIMEZONES } from "@/lib/pt-sessions";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { WORKSPACE_CONTAINER_CLASS, WORKSPACE_GRID_CLASS } from "@/components/workspace/workspace-container";
import { ClientDriveFolderPanel } from "@/components/client-drive-folder-panel";
import { TrainingScheduleCard } from "@/components/training-schedule-card";
import { PowerlifterBadge, POWERLIFTER_BADGE_LABELS } from "@/components/powerlifter-badge";
import { SocialHandlesEditor } from "@/components/social-handles-editor";
import { SocialIcons } from "@/components/social-icons";
import { ClientQuickLinksCard } from "@/components/client-quick-links-card";
import { AppActivityCard } from "@/components/app-activity-card";
import { ManualCheckInReviewComposer } from "@/components/manual-check-in-review-composer";
import { ClientCheckInConversations } from "@/components/client-check-in-conversations";
import { Send } from "lucide-react";
import { FolderOpen, Eye } from "lucide-react";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { Checkbox } from "@/components/ui/checkbox";
import { listForms as listNativeForms, type NfForm } from "@/lib/native-forms";
import { replaceClientNativeFormAssignments } from "@/lib/native-forms.functions";
import { ActionButton } from "@/components/action-button";
import { IntakeAnswersBigButton } from "@/components/clients/intake-answers-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { describeAccountAccess } from "@/lib/client-account-access";
import {
  WorkspaceIdentityHeader,
  WorkspaceSnapshotField,
} from "@/components/workspace";
import {
  IdentityCard,
  ContactCard,
  PersonalDetailsCard,
  AddressCard,
  EmergencyContactCard,
} from "@/components/admin/client-profile/personal-info-cards";
import { CoachNutritionOverrideCard } from "@/components/admin/coach-nutrition-override-card";
import { ClientWorkspaceTabs, type WorkspaceTab } from "@/components/clients/client-workspace-tabs";

// Heavy panels — code-split so visiting a client only loads the active tab's code.
const lazyDefault = <T,>(loader: () => Promise<{ [k: string]: T }>, name: string) =>
  lazy(async () => {
    const m = await loader();
    return { default: (m as any)[name] as ComponentType<any> };
  });
const ScheduleManagerShell = lazyDefault(() => import("@/components/schedule/ScheduleManagerShell"), "ScheduleManagerShell");
const TrainingPhasesPanel = lazyDefault(() => import("@/components/training-phases-panel"), "TrainingPhasesPanel");
const ClientMaxesPanel = lazyDefault(() => import("@/components/client-maxes-panel"), "ClientMaxesPanel");
const ImportantDatesPanel = lazyDefault(() => import("@/components/important-dates-panel"), "ImportantDatesPanel");
const ClientSessionsPanel = lazyDefault(() => import("@/components/sessions/client-sessions-panel"), "ClientSessionsPanel");
const NutritionTargetsPanel = lazyDefault(() => import("@/components/nutrition-targets-panel"), "NutritionTargetsPanel");
const CardioTargetsPanel = lazyDefault(() => import("@/components/cardio-targets-panel"), "CardioTargetsPanel");
const LiftVideosPanel = lazyDefault(() => import("@/components/lift-videos-panel"), "LiftVideosPanel");
const ProgressMetricsPanel = lazyDefault(() => import("@/components/progress-metrics-panel"), "ProgressMetricsPanel");
const ClientAnalyticsDashboard = lazyDefault(() => import("@/components/analytics/client-analytics-dashboard"), "ClientAnalyticsDashboard");
const BasicInfoForm = lazyDefault(() => import("@/components/basic-info-form"), "BasicInfoForm");
const ClientExerciseNotesCard = lazyDefault(() => import("@/components/client-exercise-notes-card"), "ClientExerciseNotesCard");
const ProfilePictureCapture = lazyDefault(() => import("@/components/profile-picture-capture"), "ProfilePictureCapture");
const AgreementStatusPanel = lazyDefault(() => import("@/components/agreement-status-panel"), "AgreementStatusPanel");
const ClientSalesTable = lazyDefault(() => import("@/components/admin/client-sales-table"), "ClientSalesTable");
const PriceCardPickerDialog = lazyDefault(() => import("@/components/price-card-picker-dialog"), "PriceCardPickerDialog");
const AgreementsPanel = lazyDefault(() => import("@/components/agreements-panel"), "AgreementsPanel");
const AssignedProgramsCard = lazyDefault(() => import("@/components/assigned-programs-card"), "AssignedProgramsCard");
const ClientWarmupCard = lazyDefault(() => import("@/components/client-warmup-card"), "ClientWarmupCard");
const ClientBillingPanel = lazyDefault(() => import("@/components/admin/client-billing-panel"), "ClientBillingPanel");
const GoalsSetupPanel = lazyDefault(() => import("@/components/clients/goals-setup-panel"), "GoalsSetupPanel");
const TrainingProgramHub = lazyDefault(() => import("@/components/clients/training-program-hub"), "TrainingProgramHub");

function TabFallback() {
  return <div className="md:col-span-3 p-6 text-sm text-muted-foreground">Loading…</div>;
}

function SectionNav({ activeTab, onChange, heading }: { activeTab: TabValue; onChange: (v: TabValue) => void; compact?: boolean; heading?: string }) {
  return (
    <ClientWorkspaceTabs
      activeTab={activeTab as WorkspaceTab}
      onChange={(next) => onChange(next as TabValue)}
      heading={heading}
    />
  );
}

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

const TAB_VALUES = ["summary", "info", "goals-setup", "coaching", "account", "training", "program-setup", "analytics", "nutrition", "metrics", "lift-videos", "documents", "sessions", "purchases", "billing", "agreements", "notes"] as const;
type TabValue = typeof TAB_VALUES[number];



export const Route = createFileRoute("/_authenticated/admin/clients/$id")({
  validateSearch: (s): { tab?: TabValue } => {
    const parsed = z.object({ tab: z.string().optional() }).parse(s);
    // Redirect deprecated tabs after the Client Profile / Nutrition consolidation.
    // "messages" now lives in the unified inbox, not the client workspace.
    const remap: Record<string, TabValue> = { profile: "info", cardio: "nutrition", messages: "summary" };
    const t = parsed.tab ? (remap[parsed.tab] ?? parsed.tab) : undefined;
    return { tab: t && (TAB_VALUES as readonly string[]).includes(t) ? (t as TabValue) : undefined };
  },
  component: ClientDetailRoute,
});

function ClientDetailRoute() {
  const { id } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <ClientProfileWorkspace
      clientId={id}
      initialTab={tab}
      onTabChange={(t) =>
        navigate({ to: ".", params: { id }, search: { tab: t }, replace: true })
      }
    />
  );
}

const STATUSES = ["Active", "New Client", "Needs Attention", "Check-In Overdue", "Payment Overdue", "Injured / Modified Plan", "Paused", "Cancelling", "Deactivated", "Archived", "High Priority"];
const PAY_STATUSES = ["Not Sent", "Sent", "Paid", "Failed", "Overdue", "Cancelled", "Refunded"];
const ACCOUNT_FIELDS = ["first_name", "last_name", "preferred_name", "email", "phone", "date_of_birth", "height_cm", "preferred_height_unit", "address", "city", "province", "postal_code", "country", "timezone", "emergency_contact_name", "emergency_contact_phone"] as const;

export function ClientProfileWorkspace({
  clientId,
  initialTab,
  embedded = false,
  onClose,
  onTabChange,
}: {
  clientId: string;
  initialTab?: TabValue;
  embedded?: boolean;
  onClose?: () => void;
  onTabChange?: (tab: TabValue) => void;
}) {
  const id = clientId;
  const [tabState, setTabState] = useState<TabValue | undefined>(initialTab);
  const tab = tabState;
  const setTab = (t: TabValue) => {
    setTabState(t);
    onTabChange?.(t);
  };
  // Messaging is owned by the unified inbox — the workspace links out to the
  // client's thread instead of duplicating the whole thread inside a tab.
  const openMessages = () => {
    navigate({ to: "/admin/communication", search: { tab: "messages", client: clientId } as any });
  };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { role } = useAuth();
  const impersonation = useClientImpersonation();
  const canPov = role === "admin" || role === "coach";
  const [form, setForm] = useState<any>(null);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [priceCardOpen, setPriceCardOpen] = useState(false);
  const [bookingLinkOpen, setBookingLinkOpen] = useState(false);
  const [checkInResponseOpen, setCheckInResponseOpen] = useState(false);
  const inviteFn = useServerFn(inviteClient);
  const deleteFn = useServerFn(deleteClient);
  const getSetupLinkFn = useServerFn(getSetupLink);
  const sendResetFn = useServerFn(sendPasswordReset);
  const getResetLinkFn = useServerFn(getPasswordResetLink);
  const sendLinkSmsFn = useServerFn(sendAuthLinkBySms);
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
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  // Seed local form state from server data on initial load only. Subsequent
  // background refetches must not overwrite in-flight edits made by the admin.
  useEffect(() => {
    if (data && form === null) setForm(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Compare current form state to the last server snapshot to know when to
  // show the sticky Save bar. Must run before any early return to keep hook
  // order stable across renders.
  const isDirty = useMemo(() => {
    if (!data || !form) return false;
    try {
      return JSON.stringify(form) !== JSON.stringify(data);
    } catch {
      return false;
    }
  }, [form, data]);

  if (!form) {
    return (
      <div className="space-y-4 p-6" aria-busy="true" aria-label="Loading client profile">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { id: _id, created_at, updated_at, ...patch } = form;
      const { error } = await supabase.from("clients").update(patch).eq("id", id);
      if (error) return toast.error(error.message);
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["client", id] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    const { error } = await supabase.from("clients").update({ archived: !form.archived, status: !form.archived ? "Archived" : "Active" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(form.archived ? "Restored" : "Archived");
    if (embedded) onClose?.(); else navigate({ to: "/admin/clients" });
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

  const smsLink = (kind: "setup" | "magic" | "reset") => async () => {
    if (!form.phone) return toast.error("Add a phone number first");
    if (!form.email) return toast.error("Add an email first (used to mint the link)");
    const redirectTo = kind === "reset"
      ? `${window.location.origin}/reset-password`
      : `${window.location.origin}/setup`;
    const t = toast.loading("Sending SMS…");
    try {
      await sendLinkSmsFn({ data: { clientId: id, redirectTo, kind } });
      toast.success("SMS sent", { id: t });
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
      if (embedded) onClose?.(); else navigate({ to: "/admin/clients" });
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
      {!embedded && <PageHeader
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
            <Button
              variant="outline"
              size="sm"
              onClick={openMessages}
            >
              <MessageSquare className="mr-2 h-4 w-4" />Message
            </Button>
            <Link to="/admin/client-programs/$clientId" params={{ clientId: id }}>
              <Button variant="outline" size="sm"><Dumbbell className="mr-2 h-4 w-4" />Training Program</Button>
            </Link>
            <Link to="/admin/client-programs/$clientId/history" params={{ clientId: id }}>
              <Button variant="outline" size="sm"><Calendar className="mr-2 h-4 w-4" />Program History</Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTab("nutrition")}
            >
              <Apple className="mr-2 h-4 w-4" />Nutrition
            </Button>
            {canPov && (
              <Button
                size="sm"
                className="bg-warning/15 text-warning border border-warning/40 hover:bg-warning/25"
                onClick={() => {
                  if (!form.user_id) {
                    toast.error("Client has no account yet — send a setup link first.");
                    return;
                  }
                  impersonation.start(
                    { id, user_id: form.user_id, full_name: form.full_name },
                    typeof window !== "undefined" ? window.location.pathname + window.location.search : `/admin/clients/${id}`,
                  );
                  navigate({ to: "/portal" });
                }}
              >
                <Eye className="mr-2 h-4 w-4" />Client POV
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm"><MoreHorizontal className="mr-2 h-4 w-4" />More Actions</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Setup & Access</DropdownMenuLabel>
                <DropdownMenuItem onSelect={sendSetup}><Mail className="mr-2 h-4 w-4" />Send setup email</DropdownMenuItem>
                <DropdownMenuItem onSelect={copySetupLink}><Copy className="mr-2 h-4 w-4" />Copy setup link</DropdownMenuItem>
                <DropdownMenuItem onSelect={sendReset}><KeyRound className="mr-2 h-4 w-4" />Send password reset</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Scheduling & Offers</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setBookingLinkOpen(true)}><Link2 className="mr-2 h-4 w-4" />Send booking link</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPriceCardOpen(true)}><Tag className="mr-2 h-4 w-4" />Assign offer / price card</DropdownMenuItem>
                {form.drive_folder_link && (
                  <DropdownMenuItem onSelect={() => window.open(form.drive_folder_link, "_blank", "noreferrer")}>
                    <FolderOpen className="mr-2 h-4 w-4" />Open Drive folder
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Lifecycle</DropdownMenuLabel>
                {form.status === "Deactivated" ? (
                  <DropdownMenuItem onSelect={() => setReactivateOpen(true)}><Eye className="mr-2 h-4 w-4" />Reactivate</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => setDeactivateOpen(true)}><Eye className="mr-2 h-4 w-4" />Deactivate</DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={archive}><Archive className="mr-2 h-4 w-4" />{form.archived ? "Restore" : "Archive"}</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteStep(1)}>
                  <Trash2 className="mr-2 h-4 w-4" />Delete client
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" className="bg-gradient-primary uppercase font-bold" onClick={save}><Save className="mr-2 h-4 w-4" />Save</Button>
          </>
        }
      />}
      {embedded && (
        <EmbeddedIdentityHeader
          form={form}
          canPov={canPov}
          onClose={onClose}
          onMessage={openMessages}
          onPov={() => {
            if (!form.user_id) {
              toast.error("Client has no account yet — send a setup link first.");
              return;
            }
            impersonation.start(
              { id, user_id: form.user_id, full_name: form.full_name },
              typeof window !== "undefined" ? window.location.pathname + window.location.search : `/admin/clients/${id}`,
            );
            navigate({ to: "/portal" });
          }}
          onSave={save}
          isDirty={isDirty}
          saving={saving}
          moreMenu={(
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm"><MoreHorizontal className="mr-2 h-4 w-4" />More</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Setup & Access</DropdownMenuLabel>
                <DropdownMenuItem onSelect={sendSetup}><Mail className="mr-2 h-4 w-4" />Send setup email</DropdownMenuItem>
                <DropdownMenuItem onSelect={copySetupLink}><Copy className="mr-2 h-4 w-4" />Copy setup link</DropdownMenuItem>
                <DropdownMenuItem onSelect={sendReset}><KeyRound className="mr-2 h-4 w-4" />Send password reset</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Scheduling & Offers</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setBookingLinkOpen(true)}><Link2 className="mr-2 h-4 w-4" />Send booking link</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPriceCardOpen(true)}><Tag className="mr-2 h-4 w-4" />Assign offer / price card</DropdownMenuItem>
                {form.drive_folder_link && (
                  <DropdownMenuItem onSelect={() => window.open(form.drive_folder_link, "_blank", "noreferrer")}>
                    <FolderOpen className="mr-2 h-4 w-4" />Open Drive folder
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Lifecycle</DropdownMenuLabel>
                {form.status === "Deactivated" ? (
                  <DropdownMenuItem onSelect={() => setReactivateOpen(true)}><Eye className="mr-2 h-4 w-4" />Reactivate</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => setDeactivateOpen(true)}><Eye className="mr-2 h-4 w-4" />Deactivate</DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={archive}><Archive className="mr-2 h-4 w-4" />{form.archived ? "Restore" : "Archive"}</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteStep(1)}>
                  <Trash2 className="mr-2 h-4 w-4" />Delete client
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        />
      )}
      <div className={cn(WORKSPACE_CONTAINER_CLASS, embedded && "px-3 py-3 md:px-6 md:py-4")}>
      {/*
        The profile-shell "Actions" grid was removed — Message, POV and More
        live in the client header, Assign Program lives in the Training tab.
      */}
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
      {/*
        The workspace nav MUST stay directly under the client header.
        Previously this Tabs root was `flex flex-col` with the nav at `order-1`
        while only the Summary panel carried `order-2` — every other tab
        (Training, Nutrition, Sales…) defaulted to order-0 and rendered ABOVE
        the nav, pushing the tab bar to the bottom of the page. Plain document
        order keeps the nav first for every tab.
      */}
      <Tabs value={tab ?? "summary"} onValueChange={(v) => setTab(v as TabValue)}>
        <SectionNav
          activeTab={(tab ?? "summary") as TabValue}
          onChange={(v) => setTab(v)}
          compact={embedded}
          heading={embedded ? "Workspace" : undefined}
        />

        <TabsContent value="summary" className={WORKSPACE_GRID_CLASS}>
          {/* Setup/access alerts live at the top of Summary, never above the nav. */}
          <div className="md:col-span-3 empty:hidden">
            <SetupStatusBanner
              form={form}
              onSendSetup={sendSetup}
              onCopySetup={copySetupLink}
              onSendReset={sendReset}
              onCopyReset={copyResetLink}
              onSetPassword={() => { setPwValue(""); setPwOpen(true); }}
              onGoToAccountTab={() => setTab("account")}
            />
          </div>
          <ClientOverviewSnapshot
            form={form}
            clientId={id}
            canPov={canPov}
            embedded={embedded}
            onMessage={openMessages}
            onPov={() => {
              if (!form.user_id) {
                toast.error("Client has no account yet — send a setup link first.");
                return;
              }
              impersonation.start(
                { id, user_id: form.user_id, full_name: form.full_name },
                typeof window !== "undefined" ? window.location.pathname + window.location.search : `/admin/clients/${id}`,
              );
              navigate({ to: "/portal" });
            }}
            onSendSetup={sendSetup}
            onRequestUpdate={requestUpdate}
            onGoToTab={(t: TabValue) => setTab(t)}
          />
        </TabsContent>

        <TabsContent value="coaching" className={WORKSPACE_GRID_CLASS}>
          <Card className="border-border bg-card p-6 md:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Coaching Setup</h3>
              <Button size="sm" className="min-h-[44px] bg-gradient-primary uppercase font-bold" onClick={save}>
                <Save className="mr-2 h-4 w-4" />Save
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Assigned coach</Label>
                <AssignedCoachSelect
                  value={form.assigned_coach_id ?? null}
                  onChange={(v) => set("assigned_coach_id", v)}
                />
              </div>
              <div>
                <Label>Client status</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payment status</Label>
                <Select value={form.payment_status ?? "Not Sent"} onValueChange={(v) => set("payment_status", v)}>
                  <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Coaching package</Label>
                <Input className="min-h-[44px]" value={form.coaching_package ?? ""} onChange={(e) => set("coaching_package", e.target.value)} />
              </div>
              <div>
                <Label>Program phase</Label>
                <Input className="min-h-[44px]" value={form.program_phase ?? ""} onChange={(e) => set("program_phase", e.target.value)} />
              </div>
              <div>
                <Label>Start date</Label>
                <Input className="min-h-[44px]" type="date" value={form.start_date ?? ""} onChange={(e) => set("start_date", e.target.value || null)} />
              </div>
              <div>
                <Label>Renewal date</Label>
                <Input className="min-h-[44px]" type="date" value={form.renewal_date ?? ""} onChange={(e) => set("renewal_date", e.target.value || null)} />
              </div>
              <div className="sm:col-span-2">
                <Label>Instagram</Label>
                <Input className="min-h-[44px]" value={form.instagram ?? ""} onChange={(e) => set("instagram", e.target.value)} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Detailed billing controls live under Business. Detailed messaging & call access live under Communication and Personal Info.</p>
          </Card>

          <div className="space-y-6">
            <TrainingScheduleCard client={form} />
            <CoachNutritionOverrideCard userId={form.user_id ?? null} />
            <Link to="/admin/clients/$id/schedule" params={{ id }} className="block">
              <Button className="min-h-[52px] w-full bg-gradient-primary text-base font-bold uppercase">
                <Calendar className="mr-2 h-5 w-5" /> Manage Schedule
              </Button>
            </Link>
            <Link to="/admin/clients/$id/progress" params={{ id }} className="block">
              <Button variant="outline" className="min-h-[52px] w-full text-base font-semibold">
                <Calendar className="mr-2 h-5 w-5" /> Open Progress (Photos, Videos, Weight)
              </Button>
            </Link>
            <ClientQuickLinksCard
              clientId={id}
              driveFolderLink={form.drive_folder_link}
              onChangeDriveFolderLink={(v) => set("drive_folder_link", v)}
            />
            <Card className="border-border bg-card p-6 space-y-3">
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Billing & Access</h3>
              {(() => {
                const src = (form as any).billing_source as string | null;
                const locked = !!(form as any).billing_source_locked;
                const isLegacy = src === "trainerize_legacy";
                const label =
                  src === "trainerize_legacy" ? "Legacy — JF Effect Trainerize"
                  : src === "jfeffect_stripe" ? "JF Effect Stripe"
                  : src === "manual_external" ? "External / Manual"
                  : src === "complimentary" ? "Complimentary"
                  : "Not connected";
                const tone =
                  src === "trainerize_legacy" ? "bg-amber-500/10 text-amber-700 border-amber-500/30"
                  : src === "jfeffect_stripe" ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
                  : src === "manual_external" ? "bg-sky-500/10 text-sky-700 border-sky-500/30"
                  : src === "complimentary" ? "bg-purple-500/10 text-purple-700 border-purple-500/30"
                  : "bg-muted text-muted-foreground";
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${tone}`}>{label}</span>
                      {locked && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Locked</span>}
                    </div>
                    {isLegacy ? (
                      <p className="text-[11px] text-muted-foreground">
                        Billing remains in the legacy Trainerize Stripe account. This app will not create, modify, or duplicate any charge for this client.
                      </p>
                    ) : src === "none" || !src ? (
                      <p className="text-[11px] text-muted-foreground">
                        No billing source classified. Mark this client to keep webhooks and checkout safe.
                      </p>
                    ) : null}
                    <Link to="/admin/billing-sources">
                      <Button variant="outline" className="min-h-[44px] w-full justify-start">Open Billing & Legacy Migration</Button>
                    </Link>
                  </>
                );
              })()}
            </Card>
          </div>

          <div className="md:col-span-3">
            <ClientDriveFolderPanel clientId={id} />
          </div>
        </TabsContent>

        <TabsContent value="goals-setup" className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <IntakeAnswersBigButton
              clientId={id}
              clientName={form.full_name ?? null}
              subtitle="See every intake & in-app questionnaire this client filled out"
            />
            <Button
              variant="outline"
              className="min-h-[64px] w-full justify-start text-base"
              onClick={form.info_update_requested ? clearUpdateRequest : requestUpdate}
            >
              <BellRing className="mr-3 h-5 w-5" />
              {form.info_update_requested ? "Clear client update request" : "Request Client Update"}
            </Button>
            <Link to="/admin/clients/$id" params={{ id }} search={{ tab: "notes" }} className="block">
              <Button variant="outline" className="min-h-[64px] w-full justify-start text-base">
                <MessageSquare className="mr-3 h-5 w-5" /> Edit Coaching Notes
              </Button>
            </Link>
          </div>
          <StartingMaxesCard form={form} />
          <Suspense fallback={<TabFallback />}>
            <GoalsSetupPanel clientId={id} />
          </Suspense>
          <PowerlifterSection form={form} set={set} />
          <div className="flex justify-end">
            <Button size="sm" className="min-h-[44px] bg-gradient-primary uppercase font-bold" onClick={save}>
              <Save className="mr-2 h-4 w-4" />Save changes
            </Button>
          </div>
        </TabsContent>

        {/*
          Calendar-first Training tab: the schedule the coach acts on every day
          comes first, the program hub sits under it, and lower-frequency setup
          panels moved to the "Program setup" tab so nothing was removed.
        */}
        <TabsContent value="training" className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
          <Suspense fallback={<TabFallback />}>
            <ScheduleManagerShell clientId={id} mode="coach" />
            <TrainingProgramHub clientId={id} clientName={form?.full_name ?? null} />
          </Suspense>
        </TabsContent>

        <TabsContent value="program-setup" className={WORKSPACE_GRID_CLASS}>
          <Suspense fallback={<TabFallback />}>
            <div className="md:col-span-3"><TrainingScheduleCard client={form} /></div>
            <AssignedProgramsCard clientId={id} mode="admin" />
            <TrainingPhasesPanel clientId={id} />
            <ImportantDatesPanel clientId={id} />
            <ClientExerciseNotesCard clientId={id} />
            <ClientMaxesPanel clientId={id} />
            <ClientWarmupCard clientId={id} />
          </Suspense>
        </TabsContent>

        <TabsContent value="nutrition" className={WORKSPACE_GRID_CLASS}>
          <Suspense fallback={<TabFallback />}>
            <NutritionTargetsPanel clientId={id} />
            <CardioTargetsPanel clientId={id} />
          </Suspense>
        </TabsContent>

        <TabsContent value="metrics" className={WORKSPACE_GRID_CLASS}>
          <Suspense fallback={<TabFallback />}>
            <ProgressMetricsPanel
              clientId={id}
              defaultUnit={(form?.preferred_weight_unit as "lb" | "kg") ?? "lb"}
              canEdit
              showExport
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="analytics">
          <Suspense fallback={<TabFallback />}>
            <ClientAnalyticsDashboard
              clientId={id}
              preferredUnit={(form?.preferred_weight_unit as "lb" | "kg") ?? "lb"}
              canOpenLog
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="lift-videos" className={WORKSPACE_GRID_CLASS}>
          <Suspense fallback={<TabFallback />}>
            <LiftVideosPanel clientId={id} />
          </Suspense>
        </TabsContent>

        <TabsContent value="documents" className={WORKSPACE_GRID_CLASS}>
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
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="bg-gradient-primary font-bold"
                  onClick={() => setCheckInResponseOpen(true)}
                >
                  <Send className="mr-1 h-4 w-4" /> Send Check-In Response
                </Button>
                <Link to="/admin/native-forms"><Button variant="outline" size="sm">Manage forms</Button></Link>
              </div>
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

          <ClientCheckInConversations clientId={id} onCompose={() => setCheckInResponseOpen(true)} />

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

        {/*
          ONE canonical Sessions surface. The old split (PT sessions panel +
          separate "Session credits" panel + a raw counter form) let three
          sources disagree; the ledger is now the single source of truth and
          the user-facing word is always "Sessions", never "credits".
        */}
        <TabsContent value="sessions" className={WORKSPACE_GRID_CLASS}>
          <Suspense fallback={<TabFallback />}>
            <div id="session-transactions" className="contents">
              <ClientSessionsPanel clientId={id} client={form} onChangeField={set} />
            </div>
          </Suspense>
        </TabsContent>


        <TabsContent value="purchases" className={WORKSPACE_GRID_CLASS}>
          <Suspense fallback={<TabFallback />}>
            <ClientSalesTable clientId={id} />
          </Suspense>
        </TabsContent>

        <TabsContent value="billing" className={WORKSPACE_GRID_CLASS}>
          <Suspense fallback={<TabFallback />}>
            <ClientBillingPanel clientId={id} />
          </Suspense>
        </TabsContent>

        <TabsContent value="agreements" className={WORKSPACE_GRID_CLASS}>
          <Suspense fallback={<TabFallback />}>
            <AgreementStatusPanel client={form} />
            <AgreementsPanel clientId={id} clientName={form?.full_name} />
          </Suspense>
        </TabsContent>

        <TabsContent value="notes" className={WORKSPACE_GRID_CLASS}>
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

        <TabsContent value="info" className={WORKSPACE_GRID_CLASS}>
          <div className="md:col-span-2 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card/60 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Personal Information</h2>
                <p className="text-xs text-muted-foreground">Edit each section independently — each card saves on its own.</p>
              </div>
              {form.info_update_requested ? (
                <Button size="sm" variant="outline" className="min-h-[44px]" onClick={clearUpdateRequest}>
                  Clear update request
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="min-h-[44px]" onClick={requestUpdate}>
                  <BellRing className="mr-2 h-4 w-4" />Request Profile Info Update
                </Button>
              )}
            </div>
            {(() => {
              const savePersonal = async (patch: Record<string, any>) => {
                const updatedFields = Object.keys(patch).filter((k) => k !== "full_name");
                const fullPatch = {
                  ...patch,
                  info_last_updated_at: new Date().toISOString(),
                  info_last_updated_by: "admin",
                  info_last_updated_fields: updatedFields,
                };
                const { error } = await supabase.from("clients").update(fullPatch).eq("id", id);
                if (error) throw new Error(error.message);
                toast.success("Saved");
                setForm({ ...form, ...fullPatch });
                qc.invalidateQueries({ queryKey: ["client", id] });
                qc.invalidateQueries({ queryKey: ["clients"] });
              };
              return (
                <>
                  <IdentityCard form={form} onSave={savePersonal} />
                  <ContactCard form={form} onSave={savePersonal} />
                  <PersonalDetailsCard form={form} onSave={savePersonal} />
                  <AddressCard form={form} onSave={savePersonal} />
                  <EmergencyContactCard form={form} onSave={savePersonal} />
                </>
              );
            })()}
            <div className="grid gap-2 rounded-md border border-border bg-secondary/30 p-3 text-xs md:grid-cols-2">
              <div><span className="text-muted-foreground">Last account info update:</span> {fmtDate(form.info_last_updated_at)}</div>
              <div><span className="text-muted-foreground">Updated by:</span> {form.info_last_updated_by ?? "—"}</div>
              <div className="md:col-span-2"><span className="text-muted-foreground">Fields updated:</span> {form.info_last_updated_fields?.length ? form.info_last_updated_fields.join(", ") : "—"}</div>
              <div><span className="text-muted-foreground">Profile picture updated:</span> {fmtDate(form.profile_picture_updated_at)}</div>
              <div><span className="text-muted-foreground">Time zone confirmed:</span> {fmtDate(form.timezone_confirmed_at)}</div>
              <div><span className="text-muted-foreground">Update requested:</span> {form.info_update_requested ? `Yes (${fmtDate(form.info_update_requested_at)})` : "No"}</div>
              <div><span className="text-muted-foreground">Basic info completed:</span> {fmtDate(form.basic_info_completed_at)}</div>
            </div>
          </div>

          <Card className="border-border bg-card p-6 space-y-3">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Profile Picture</h3>
            <Suspense fallback={<TabFallback />}>
              <ProfilePictureCapture
                userId={form.user_id ?? id}
                currentUrl={form.profile_picture_url}
                onUploaded={adminUpdatePicture}
                allowFileUpload
              />
            </Suspense>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="min-h-[44px]" onClick={requestPictureUpdate}>
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

          <Card className="border-border bg-card p-6 md:col-span-3 space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Communication Preferences</h3>
            <p className="text-xs text-muted-foreground">In-app call and SMS access for this client. Save is applied immediately.</p>
            <div className="grid gap-3 md:grid-cols-2">
              <CommsToggleRow
                title="In-app call access"
                description="Shows a Call button in chat for admins & the assigned coach."
                checked={!!form.call_access_enabled}
                onChange={async (v: boolean) => {
                  set("call_access_enabled", v);
                  const { error } = await supabase.from("clients").update({ call_access_enabled: v }).eq("id", id);
                  if (error) { toast.error(error.message); set("call_access_enabled", !v); }
                  else { toast.success(v ? "Call access enabled" : "Call access disabled"); qc.invalidateQueries({ queryKey: ["client", id] }); qc.invalidateQueries({ queryKey: ["clients-min"] }); }
                }}
              />
              <CommsToggleRow
                title="SMS opt-out"
                description="When on, this client will not receive any SMS (manual or unread reminders)."
                checked={!!form.sms_opt_out}
                onChange={async (v: boolean) => {
                  set("sms_opt_out", v);
                  const { error } = await supabase.from("clients").update({ sms_opt_out: v }).eq("id", id);
                  if (error) { toast.error(error.message); set("sms_opt_out", !v); }
                  else { toast.success(v ? "SMS opted out" : "SMS enabled"); qc.invalidateQueries({ queryKey: ["client", id] }); }
                }}
              />
              <CommsToggleRow
                title="Client → Coach: call button"
                description="Shows a Call button in the client's chat so they can reach their assigned coach for urgent matters."
                checked={!!form.coach_call_access_enabled}
                onChange={async (v: boolean) => {
                  set("coach_call_access_enabled", v);
                  const { error } = await supabase.from("clients").update({ coach_call_access_enabled: v } as any).eq("id", id);
                  if (error) { toast.error(error.message); set("coach_call_access_enabled", !v); }
                  else { toast.success(v ? "Client can call their coach" : "Client can no longer call their coach"); qc.invalidateQueries({ queryKey: ["client", id] }); }
                }}
              />
              <CommsToggleRow
                title="Client → Coach: SMS button"
                description="Shows a Text button in the client's chat so they can SMS their assigned coach for urgent matters. Off by default."
                checked={!!form.coach_sms_access_enabled}
                onChange={async (v: boolean) => {
                  set("coach_sms_access_enabled", v);
                  const { error } = await supabase.from("clients").update({ coach_sms_access_enabled: v } as any).eq("id", id);
                  if (error) { toast.error(error.message); set("coach_sms_access_enabled", !v); }
                  else { toast.success(v ? "Client can SMS their coach" : "Client can no longer SMS their coach"); qc.invalidateQueries({ queryKey: ["client", id] }); }
                }}
              />
            </div>
          </Card>

          <Card className="border-border bg-card p-6 md:col-span-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Social Media</h3>
              <SocialIcons client={form} size="xs" />
            </div>
            <p className="text-[11px] text-muted-foreground">Usernames/handles only — the app auto-links where possible.</p>
            <SocialHandlesEditor values={form} onChange={(k, v) => set(k, v)} />
            <div className="flex justify-end pt-2">
              <Button size="sm" className="min-h-[44px] bg-gradient-primary uppercase font-bold" onClick={save}>
                <Save className="mr-2 h-4 w-4" />Save
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="account" className={WORKSPACE_GRID_CLASS}>
        <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Login & Access</h3>
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

              <div className="space-y-5 pt-2">
                {/* Setup link */}
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Setup link</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <ActionButton className="min-h-[48px] justify-start" variant="outline" onAction={sendSetup} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<Mail className="h-4 w-4" />}>{form.invite_sent_at ? "Resend setup email" : "Send setup email"}</ActionButton>
                    <ActionButton className="min-h-[48px] justify-start" variant="outline" onAction={copySetupLink} loadingLabel="Copying…" successLabel="Copied" successToast={false} errorToast={false} icon={<Copy className="h-4 w-4" />}>Copy setup link</ActionButton>
                    <ActionButton className="min-h-[48px] justify-start" variant="outline" onAction={smsLink("setup")} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<MessageSquare className="h-4 w-4" />}>SMS setup link</ActionButton>
                  </div>
                </div>

                {/* Password reset */}
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Password reset</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <ActionButton className="min-h-[48px] justify-start" variant="outline" onAction={sendReset} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<KeyRound className="h-4 w-4" />}>Send password reset</ActionButton>
                    <ActionButton className="min-h-[48px] justify-start" variant="outline" onAction={copyResetLink} loadingLabel="Copying…" successLabel="Copied" successToast={false} errorToast={false} icon={<Copy className="h-4 w-4" />}>Copy reset link</ActionButton>
                    <ActionButton className="min-h-[48px] justify-start" variant="outline" onAction={smsLink("reset")} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<MessageSquare className="h-4 w-4" />}>SMS reset link</ActionButton>
                    <SendPasswordResetDialog
                      targetUserId={form.user_id ?? null}
                      email={form.email ?? null}
                      phone={form.phone ?? null}
                      triggerLabel="Secure password reset"
                    />
                  </div>
                </div>

                {/* Sign-in & access */}
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Sign-in & access</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <ActionButton className="min-h-[48px] justify-start" variant="outline" onAction={smsLink("magic")} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<MessageSquare className="h-4 w-4" />}>SMS sign-in link</ActionButton>
                    <Button className="min-h-[48px] justify-start" variant="outline" onClick={() => { setPwValue(""); setPwOpen(true); }}>
                      <KeyRound className="mr-2 h-4 w-4" />Set password
                    </Button>
                    <ActionButton className="min-h-[48px] justify-start" variant="outline" onAction={markComplete} loadingLabel="Saving…" successLabel="Done" successToast={false} errorToast={false} icon={<CheckCircle2 className="h-4 w-4" />}>Mark setup complete</ActionButton>
                    <Button className="min-h-[48px] justify-start" variant={form.needs_admin_help ? "default" : "outline"} onClick={toggleNeedsHelp}>
                      <AlertCircle className="mr-2 h-4 w-4" />{form.needs_admin_help ? "Clear admin help flag" : "Mark needs admin help"}
                    </Button>
                    {canPov && (
                      <Button
                        className="min-h-[48px] justify-start bg-warning/15 text-warning border border-warning/40 hover:bg-warning/25"
                        onClick={() => {
                          if (!form.user_id) {
                            toast.error("Client has no account yet — send a setup link first.");
                            return;
                          }
                          impersonation.start(
                            { id, user_id: form.user_id, full_name: form.full_name },
                            typeof window !== "undefined" ? window.location.pathname + window.location.search : `/admin/clients/${id}`,
                          );
                          navigate({ to: "/portal" });
                        }}
                      >
                        <Eye className="mr-2 h-4 w-4" />Open Client POV
                      </Button>
                    )}
                  </div>
                </div>
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

      {/* Sticky Save bar — visible while scrolling whenever unsaved changes exist.
          Sits above the mobile bottom nav with safe-area padding. */}
      {isDirty && (
        <div
          className="fixed inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.4)]"
          style={{ bottom: 0, paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-8">
            <div className="min-w-0 text-sm">
              <div className="font-semibold">Unsaved changes</div>
              <div className="hidden text-xs text-muted-foreground sm:block truncate">Your edits aren't saved yet.</div>
            </div>
            <Button
              onClick={save}
              disabled={saving}
              className="min-h-[48px] bg-gradient-primary uppercase font-bold"
            >
              <Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

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
              <ActionButton
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                loadingLabel="Deleting…"
                successLabel="Deleted"
                successToast={false}
                errorToast
                onAction={async () => { await confirmDelete(); }}
              >
                Yes, delete permanently
              </ActionButton>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {priceCardOpen ? (
        <Suspense fallback={null}>
          <PriceCardPickerDialog open={priceCardOpen} onClose={() => setPriceCardOpen(false)} fixedClientId={id} />
        </Suspense>
      ) : null}
      <SendBookingLinkDialog
        open={bookingLinkOpen}
        onOpenChange={setBookingLinkOpen}
        defaultPhone={form.phone}
        defaultEmail={form.email}
      />

      <ManualCheckInReviewComposer
        open={checkInResponseOpen}
        onOpenChange={setCheckInResponseOpen}
        defaultClientId={id}
      />

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
            <ActionButton
              loadingLabel="Deactivating…"
              successLabel="Deactivated"
              successToast="Client deactivated"
              onAction={async () => {
                await deactivateFn({ data: {
                  clientId: id,
                  reason: deactivateReason || undefined,
                  note: deactivateNote || undefined,
                  disablePortalAccess: deactivateDisablePortal,
                }});
                setDeactivateOpen(false);
                qc.invalidateQueries({ queryKey: ["client", id] });
                qc.invalidateQueries({ queryKey: ["clients"] });
              }}
            >Deactivate Client</ActionButton>
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
            <ActionButton
              loadingLabel="Reactivating…"
              successLabel="Reactivated"
              successToast="Client reactivated"
              onAction={async () => {
                await reactivateFn({ data: { clientId: id, restorePortalAccess: reactivateRestorePortal } });
                setReactivateOpen(false);
                qc.invalidateQueries({ queryKey: ["client", id] });
                qc.invalidateQueries({ queryKey: ["clients"] });
              }}
            >Reactivate</ActionButton>
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
          <ActionButton type="button" size="sm" onAction={saveAssignments} disabled={saving || !dirty} loadingLabel="Saving…" successLabel="Saved">
            Save assignments
          </ActionButton>
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
  onSendSetup: () => unknown | Promise<unknown>;
  onCopySetup: () => unknown | Promise<unknown>;
  onSendReset: () => unknown | Promise<unknown>;
  onCopyReset: () => unknown | Promise<unknown>;
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

  // A live account needs no banner — the same detail lives in the Summary
  // panel and on the Account tab. Only surface this strip when there is
  // something the coach still has to do.
  if (stage === "live" && !form.needs_admin_help) return null;


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

/**
 * Coaching client sticky header — thin adapter over the shared
 * WorkspaceIdentityHeader so Coaching and Membership stay pixel-identical.
 */
function EmbeddedIdentityHeader({
  form,
  canPov,
  onClose,
  onMessage,
  onPov,
  onSave,
  isDirty,
  saving,
  moreMenu,
}: {
  form: any;
  canPov: boolean;
  onClose?: () => void;
  onMessage: () => void;
  onPov: () => void;
  onSave: () => unknown | Promise<unknown>;
  isDirty: boolean;
  saving: boolean;
  moreMenu: React.ReactNode;
}) {
  const lastActive = form.last_active_at ?? form.last_signed_in_at ?? null;
  const lastActiveLabel = lastActive ? new Date(lastActive).toLocaleDateString() : null;
  return (
    <WorkspaceIdentityHeader
      identity={{
        avatarUrl: form.profile_picture_url,
        name: form.full_name ?? "Unnamed client",
        titleAfter: form.is_powerlifter ? (
          <PowerlifterBadge label={form.powerlifter_badge_label} size="xs" />
        ) : null,
        badges: form.status ? [{ label: form.status }] : [],
        meta: [
          form.coaching_package,
          form.program_phase ? `· ${form.program_phase}` : null,
          form.assigned_coach_name ? (
            <span className="hidden sm:inline">· Coach {form.assigned_coach_name}</span>
          ) : null,
          lastActiveLabel ? (
            <span className="hidden md:inline">· Active {lastActiveLabel}</span>
          ) : null,
        ].filter(Boolean) as React.ReactNode[],
      }}
      onClose={onClose}
      onMessage={onMessage}
      onSave={onSave}
      isDirty={isDirty}
      saving={saving}
      primaryAction={
        canPov ? (
          <Button
            size="sm"
            onClick={onPov}
            className="hidden sm:inline-flex bg-warning/15 text-warning border border-warning/40 hover:bg-warning/25"
          >
            <Eye className="mr-2 h-4 w-4" />POV
          </Button>
        ) : null
      }
      moreMenu={moreMenu}
    />
  );
}

function CommsToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void | Promise<void> }) {
  return (
    <label className="flex min-h-[64px] items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 px-4 py-3 text-sm">
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function ClientOverviewSnapshot({
  form, clientId, canPov, embedded = false, onMessage, onPov, onSendSetup, onRequestUpdate, onGoToTab,
}: {
  form: any;
  clientId: string;
  canPov: boolean;
  embedded?: boolean;
  onMessage: () => void;
  onPov: () => void;
  onSendSetup: () => unknown | Promise<unknown>;
  onRequestUpdate: () => unknown | Promise<unknown>;
  onGoToTab: (t: TabValue) => void;
}) {
  // A live sale can legitimately satisfy "package" / "start date" — the
  // completion card used to flag them as missing even when the client had
  // an active purchase. Read-only lookup, no writes.
  const { data: salesLite = [] } = useQuery({
    queryKey: ["client-purchases-lite", clientId],
    queryFn: async () =>
      (await supabase
        .from("purchase_records")
        .select("offer_name, offer_type, term_start_date, payment_status, purchased_at")
        .eq("client_id", clientId)).data ?? [],
  });
  const liveSale = (salesLite as any[]).find(
    (s) => !["Cancelled", "Refunded", "Voided"].includes(String(s.payment_status ?? "")),
  );
  const saleStart = liveSale?.term_start_date ?? null;

  // Profile completion: count critical fields populated
  const critical: { key: string; label: string; jumpTo: TabValue; populated: boolean }[] = [
    { key: "first_name", label: "Name", jumpTo: "info", populated: !!form.first_name || !!form.full_name },
    { key: "email", label: "Email", jumpTo: "info", populated: !!form.email },
    { key: "phone", label: "Phone", jumpTo: "info", populated: !!form.phone },
    { key: "profile_picture_url", label: "Profile picture", jumpTo: "info", populated: !!form.profile_picture_url },
    { key: "date_of_birth", label: "Date of birth", jumpTo: "info", populated: !!form.date_of_birth },
    { key: "timezone", label: "Time zone", jumpTo: "info", populated: !!form.timezone },
    { key: "assigned_coach_id", label: "Assigned coach", jumpTo: "coaching", populated: !!form.assigned_coach_id },
    {
      key: "coaching_package",
      label: "Coaching package",
      jumpTo: form.coaching_package ? "coaching" : "purchases",
      populated: !!form.coaching_package || !!liveSale,
    },
    {
      key: "start_date",
      label: "Start date",
      jumpTo: form.start_date ? "coaching" : "purchases",
      populated: !!form.start_date || !!saleStart,
    },
    { key: "user_id", label: "Login account", jumpTo: "account", populated: !!form.user_id },
  ];
  const populated = critical.filter((c) => c.populated).length;
  const pct = Math.round((populated / critical.length) * 100);
  const missing = critical.filter((c) => !c.populated);

  const initials = (form.full_name ?? "?").split(" ").map((s: string) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  return (
    <div className="md:col-span-3 space-y-6">
      {/* Header card: identity + key facts (hidden when embedded — sticky header covers this) */}
      {!embedded && (
      <Card className="border-border bg-card p-5 md:p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-start">
          <div className="flex items-center gap-4">
            <UserAvatar
              src={form.profile_picture_url}
              name={form.full_name}
              size={80}
              ring
              className="rounded-2xl"
            />
            <div className="min-w-0">
              <div className="text-xl font-bold leading-tight truncate">{form.full_name ?? "Unnamed client"}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {form.status && <Badge variant="outline" className="text-[11px]">{form.status}</Badge>}
                {form.coaching_package && <Badge variant="outline" className="text-[11px]">{form.coaching_package}</Badge>}
                {form.is_powerlifter && <PowerlifterBadge label={form.powerlifter_badge_label} size="xs" />}
              </div>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-1 gap-3 text-sm sm:grid-cols-2 md:grid-cols-3">
            <SnapshotField label="Email" value={form.email} fallbackAction={form.email ? null : { label: "Add email", onClick: () => onGoToTab("info") }} />
            <SnapshotField label="Phone" value={form.phone} fallbackAction={form.phone ? null : { label: "Add phone", onClick: () => onGoToTab("info") }} />
            <SnapshotField label="Assigned coach" value={form.assigned_coach_name ?? (form.assigned_coach_id ? "Assigned" : null)} fallbackAction={form.assigned_coach_id ? null : { label: "Assign coach", onClick: () => onGoToTab("coaching") }} />
            <SnapshotField
              label="Coaching package"
              value={form.coaching_package ?? (liveSale ? `${liveSale.offer_name} (from sale)` : null)}
              fallbackAction={form.coaching_package || liveSale ? null : { label: "Add package", onClick: () => onGoToTab("coaching") }}
            />
            <SnapshotField label="Program phase" value={form.program_phase} fallbackAction={form.program_phase ? null : { label: "Add phase", onClick: () => onGoToTab("coaching") }} />
            <SnapshotField label="Login" value={form.user_id ? "Account active" : null} fallbackAction={form.user_id ? null : { label: "Send setup link", onClick: () => onSendSetup() }} />
          </div>
        </div>
      </Card>
      )}

      {/* Quick actions — 48–52px buttons (hidden when embedded — Action Center covers this) */}
      {!embedded && (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {canPov && (
          <Button onClick={onPov} className="min-h-[52px] justify-start bg-warning/15 text-warning border border-warning/40 hover:bg-warning/25 text-base">
            <Eye className="mr-3 h-5 w-5" /> Open Client POV
          </Button>
        )}
        <Button onClick={onMessage} variant="outline" className="min-h-[52px] justify-start text-base">
          <MessageSquare className="mr-3 h-5 w-5" /> Message Client
        </Button>
        <Link to="/admin/clients/$id/schedule" params={{ id: clientId }} className="block">
          <Button variant="outline" className="min-h-[52px] w-full justify-start text-base">
            <Calendar className="mr-3 h-5 w-5" /> Manage Schedule
          </Button>
        </Link>
        <Button variant="outline" className="min-h-[52px] justify-start text-base" onClick={() => onGoToTab("goals-setup")}>
          <Target className="mr-3 h-5 w-5" /> View Intake & Goals
        </Button>
        <Button variant="outline" className="min-h-[52px] justify-start text-base" onClick={() => onRequestUpdate()}>
          <BellRing className="mr-3 h-5 w-5" /> {form.info_update_requested ? "Update requested" : "Request Client Update"}
        </Button>
        <Link to="/admin/client-programs/$clientId" params={{ clientId }} className="block">
          <Button variant="outline" className="min-h-[52px] w-full justify-start text-base">
            <Dumbbell className="mr-3 h-5 w-5" /> Assign Program
          </Button>
        </Link>
      </div>
      )}

      <div className={WORKSPACE_GRID_CLASS}>
        <div className="space-y-6 md:col-span-2">
          <AppActivityCard
            clientId={clientId}
            lastSignedInAt={form.last_signed_in_at}
            lastActiveAt={form.last_active_at}
            lastActiveRoute={form.last_active_route}
            complianceStatus={form.compliance_status}
            homeScreenStatus={form.home_screen_setup_status}
          />
          <Card className="border-border bg-card p-6 space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Training Schedule</h3>
            <TrainingScheduleCard client={form} />
          </Card>
        </div>
        <div className="space-y-6">
          {/* Profile completion */}
          <Card className="border-border bg-card p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Profile Completion</h3>
              <span className={["text-xl font-bold", pct === 100 ? "text-success" : pct >= 70 ? "text-primary" : "text-warning"].join(" ")}>{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div className={["h-full transition-all", pct === 100 ? "bg-success" : pct >= 70 ? "bg-primary" : "bg-warning"].join(" ")} style={{ width: `${pct}%` }} />
            </div>
            {missing.length > 0 ? (
              <div className="space-y-1.5 pt-1">
                <div className="text-xs font-semibold text-muted-foreground">Missing information</div>
                <div className="grid gap-1.5">
                  {missing.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => m.key === "user_id" ? onSendSetup() : onGoToTab(m.jumpTo)}
                      className="flex min-h-[44px] items-center justify-between gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm hover:border-primary/40 hover:bg-secondary/60"
                    >
                      <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-warning" />{m.label}</span>
                      <span className="text-xs font-semibold text-primary">{m.key === "user_id" ? "Send setup" : "Add"} →</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-success">All critical fields complete.</p>
            )}
          </Card>

          {/* Account & Access — consolidated from the removed top-level
              "Account Setup" card. Quiet when healthy; never repeats the
              "Last signed in" value shown in App Activity. */}
          {(() => {
            const access = describeAccountAccess(form);
            return (
              <Card
                className={[
                  "border-border bg-card p-6 space-y-3",
                  access.needsAttention ? "border-warning/40 bg-warning/5" : "",
                ].join(" ")}
                data-testid="account-access-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    Account &amp; Access
                  </h3>
                  <Badge
                    variant="outline"
                    className={access.needsAttention ? "border-warning/40 text-warning bg-warning/10 text-[11px]" : "text-[11px]"}
                  >
                    {access.statusLabel}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
                  <dt className="text-muted-foreground">Account created</dt>
                  <dd className="font-medium">{fmtDate(access.accountCreatedAt)}</dd>
                  <dt className="text-muted-foreground">Invite status</dt>
                  <dd className="font-medium">{access.inviteStatusLabel}</dd>
                </dl>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-[40px] w-full justify-between text-primary"
                  onClick={() => onGoToTab("account")}
                >
                  Manage access <span aria-hidden>→</span>
                </Button>
              </Card>
            );
          })()}

          {/* Personal snapshot, read-only */}
          <Card className="border-border bg-card p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Personal Snapshot</h3>
              <Button variant="ghost" size="sm" className="min-h-[40px] text-primary" onClick={() => onGoToTab("info")}>
                Edit →
              </Button>
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

        </div>
      </div>
    </div>
  );
}

// Snapshot field — thin re-export of the shared workspace primitive so the
// coaching snapshot and the membership snapshot render identical rows.
const SnapshotField = WorkspaceSnapshotField;

function StartingMaxesCard({ form, onEdit }: { form: any; onEdit?: () => void }) {
  const unit = form.intake_lift_unit === "kg" ? "kg" : "lb";
  const known = form.intake_lifts_known !== false;
  const oneRms = {
    squat: form.intake_squat_1rm,
    bench: form.intake_bench_1rm,
    deadlift: form.intake_deadlift_1rm,
  };
  const fiveRms = {
    squat: form.intake_squat_5rm,
    bench: form.intake_bench_5rm,
    deadlift: form.intake_deadlift_5rm,
  };
  const hasAny =
    Number(oneRms.squat) > 0 || Number(oneRms.bench) > 0 || Number(oneRms.deadlift) > 0 ||
    Number(fiveRms.squat) > 0 || Number(fiveRms.bench) > 0 || Number(fiveRms.deadlift) > 0;
  const fmt = (v: any) => (Number(v) > 0 ? `${Number(v)} ${unit}` : "—");
  const rows = known
    ? [
        { label: "Squat 1RM", value: fmt(oneRms.squat) },
        { label: "Bench 1RM", value: fmt(oneRms.bench) },
        { label: "Deadlift 1RM", value: fmt(oneRms.deadlift) },
      ]
    : [
        { label: "Squat × 5", value: fmt(fiveRms.squat) },
        { label: "Bench × 5", value: fmt(fiveRms.bench) },
        { label: "Deadlift × 5", value: fmt(fiveRms.deadlift) },
      ];
  return (
    <Card className="border-border bg-card p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Starting Maxes {known ? "(1RM)" : "(5RM)"}
        </h3>
        {onEdit && (
          <Button variant="ghost" size="sm" className="min-h-[40px] text-primary" onClick={onEdit}>
            Edit →
          </Button>
        )}
      </div>
      {hasAny ? (
        <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
          {rows.map((r) => (
            <Fragment key={r.label}>
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="font-medium">{r.value}</dd>
            </Fragment>
          ))}
          {form.intake_training_experience && (
            <>
              <dt className="text-muted-foreground">Experience</dt>
              <dd className="font-medium">{form.intake_training_experience}</dd>
            </>
          )}
          {form.intake_followed_program != null && (
            <>
              <dt className="text-muted-foreground">Followed program</dt>
              <dd className="font-medium">{form.intake_followed_program ? "Yes" : "No"}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">
          Client hasn't entered their starting squat, bench, or deadlift yet.
        </p>
      )}
    </Card>
  );
}