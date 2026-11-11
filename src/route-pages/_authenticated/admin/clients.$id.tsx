import { adminDeleteCopy, deletedToast } from "@/lib/recently-deleted";
import { Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, Suspense, Fragment, type ComponentType } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Save, Trash2, Mail, Archive, KeyRound, Copy, CheckCircle2, AlertCircle, BellRing, Tag, Dumbbell, MessageSquare, Link2, MoreHorizontal, Phone, Calendar, ChevronDown } from "lucide-react";
import { adminClientAgreementDetail } from "@/lib/coaching-agreement.functions";
import { ADMIN_AGREEMENT_QUERY_ROOT } from "@/components/coaching-agreement/admin-agreement-parts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ShareBookingSheet } from "@/components/booking/share-booking-sheet";
import { useBookingTypes } from "@/components/booking/use-booking-types";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { inviteClient, deleteClient, getSetupLink, getPasswordResetLink, sendPasswordReset, setNeedsAdminHelp, setClientPassword } from "@/lib/clients.functions";
import { sendAuthLinkBySms } from "@/lib/sms-links.functions";
import { deactivateClient, reactivateClient, DEACTIVATION_REASONS } from "@/lib/client-deactivation.functions";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { COMMON_TIMEZONES } from "@/lib/pt-sessions";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { WORKSPACE_CONTAINER_CLASS, WORKSPACE_GRID_CLASS } from "@/components/workspace/workspace-container";
import { ClientDriveFolderPanel } from "@/components/client-drive-folder-panel";
import { profileChanges, rebaseProfileForm } from "@/lib/client-profile-form";
import { clientAccountLabel, statusChoicesFor } from "@/lib/client-account-label";
import { SETUP_INVITE_DAYS } from "@/lib/setup-invite";
import { PowerlifterBadge, POWERLIFTER_BADGE_LABELS } from "@/components/powerlifter-badge";
import { SocialHandlesEditor } from "@/components/social-handles-editor";
import { SocialIcons } from "@/components/social-icons";
import { ClientQuickLinksCard } from "@/components/client-quick-links-card";
import { AppActivityCard } from "@/components/app-activity-card";
import { ClientCalendarSyncStatus } from "@/components/admin/client-calendar-sync-status";
import { ManualCheckInReviewComposer } from "@/components/manual-check-in-review-composer";
import { ClientCheckInConversations } from "@/components/client-check-in-conversations";
import { Send } from "lucide-react";
import { FolderOpen, Eye } from "lucide-react";
import { useEnterClientPov, clientWorkoutHref } from "@/components/clients/use-enter-client-pov";
import { Checkbox } from "@/components/ui/checkbox";
import { listForms as listNativeForms, type NfForm } from "@/lib/native-forms";
import { replaceClientNativeFormAssignments } from "@/lib/native-forms.functions";
import { ActionButton } from "@/components/action-button";
import { IntakeAnswersBigButton } from "@/components/clients/intake-answers-dialog";
import { describeAccountAccess } from "@/lib/client-account-access";
import { WorkspaceIdentityHeader } from "@/components/workspace";
import {
  IdentityCard,
  ContactCard,
  PersonalDetailsCard,
  AddressCard,
  EmergencyContactCard,
} from "@/components/admin/client-profile/personal-info-cards";
import { CoachNutritionOverrideCard } from "@/components/admin/coach-nutrition-override-card";
import { ClientWorkspaceTabs, type WorkspaceTab } from "@/components/clients/client-workspace-tabs";
import { LEGACY_WORKSPACE_TABS } from "@/components/clients/client-workspace-tab-model";
import { TAB_VALUES, type TabValue } from "@/components/clients/client-tab-values";
import { getRouteApi as __getRouteApi } from "@tanstack/react-router";
const Route = __getRouteApi("/_authenticated/admin/clients/$id");


// Heavy panels — code-split so visiting a client only loads the active tab's code.
const lazyDefault = <T,>(loader: () => Promise<{ [k: string]: T }>, name: string) =>
  lazyWithRetry(async () => {
    const m = await loader();
    return { default: (m as any)[name] as ComponentType<any> };
  });
const ClientSessionsPanel = lazyDefault(() => import("@/components/sessions/client-sessions-panel"), "ClientSessionsPanel");
const NutritionRequestPanel = lazyDefault(() => import("@/components/nutrition/NutritionRequestPanel"), "NutritionRequestPanel");
const NutritionTargetsPanel = lazyDefault(() => import("@/components/nutrition-targets-panel"), "NutritionTargetsPanel");
const CardioTargetsPanel = lazyDefault(() => import("@/components/cardio-targets-panel"), "CardioTargetsPanel");
const ProgressMetricsPanel = lazyDefault(() => import("@/components/progress-metrics-panel"), "ProgressMetricsPanel");
const ClientAnalyticsDashboard = lazyDefault(() => import("@/components/analytics/client-analytics-dashboard"), "ClientAnalyticsDashboard");
const BasicInfoForm = lazyDefault(() => import("@/components/basic-info-form"), "BasicInfoForm");
const ClientFileNotes = lazyDefault(() => import("@/components/clients/client-file-notes"), "ClientFileNotes");
const ProfilePictureCapture = lazyDefault(() => import("@/components/profile-picture-capture"), "ProfilePictureCapture");
const AgreementStatusPanel = lazyDefault(() => import("@/components/agreement-status-panel"), "AgreementStatusPanel");
const ClientAgreementPanel = lazyDefault(() => import("@/components/coaching-agreement/client-agreement-panel"), "ClientAgreementPanel");
const ClientSalesTable = lazyDefault(() => import("@/components/admin/client-sales-table"), "ClientSalesTable");
const PriceCardPickerDialog = lazyDefault(() => import("@/components/price-card-picker-dialog"), "PriceCardPickerDialog");
const AgreementsPanel = lazyDefault(() => import("@/components/agreements-panel"), "AgreementsPanel");
const ClientBillingPanel = lazyDefault(() => import("@/components/admin/client-billing-panel"), "ClientBillingPanel");
const GoalsSetupPanel = lazyDefault(() => import("@/components/clients/goals-setup-panel"), "GoalsSetupPanel");
const ClientTrainingTab = lazyDefault(() => import("@/components/clients/client-training-tab"), "ClientTrainingTab");

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






export function ClientDetailRoute() {
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
  // Client view (and today's workout in it) through the one shared way in:
  // never for a view-only login, and a full page load so the portal starts as them.
  const pov = useEnterClientPov();
  const canPov = pov.canPov;
  const [form, setForm] = useState<any>(null);
  // The server row the form's untouched fields came from (client-profile-form.ts).
  const baseRef = useRef<any>(null);
  const [base, setBase] = useState<any>(null);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [priceCardOpen, setPriceCardOpen] = useState(false);
  const [bookingLinkOpen, setBookingLinkOpen] = useState(false);
  const { data: bookingTypes = [] } = useBookingTypes(bookingLinkOpen);
  const [quickBookOpen, setQuickBookOpen] = useState(false);
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

  // Every server refetch (a setup link sent, a login linked, a card that saved
  // itself) moves the fields the coach hasn't touched; the coach's own edits stay.
  useEffect(() => {
    if (!data) return;
    const prev = baseRef.current;
    baseRef.current = data;
    setBase(data);
    setForm((f: any) => (f === null ? data : rebaseProfileForm(f, prev, data as any)));
  }, [data]);

  // The sticky Save bar shows only for fields the coach actually changed.
  // Must run before any early return to keep hook order stable across renders.
  const changes = useMemo(() => profileChanges(form, base), [form, base]);
  const isDirty = Object.keys(changes).length > 0;

  // A section that saved itself: the form and its server copy both take the
  // saved values, so it never reads as "Unsaved changes".
  const markSaved = (patch: Record<string, any>) => {
    const next = { ...(baseRef.current ?? {}), ...patch };
    baseRef.current = next;
    setBase(next);
    setForm((f: any) => ({ ...(f ?? {}), ...patch }));
  };

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
      // Only what the coach changed: never the whole (possibly stale) row, the
      // columns the database computes, the schedule or sex (client-profile-form.ts).
      const patch = profileChanges(form, baseRef.current);
      if (!Object.keys(patch).length) {
        toast.success("Saved");
        return;
      }
      const { error } = await supabase.from("clients").update(patch as any).eq("id", id);
      if (error) return toast.error(error.message);
      markSaved(patch);
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

  // Each handler throws after its toast, so the button shows it failed instead of
  // "Sent" / "Copied" / "Texted" (the buttons don't toast errors themselves).
  const sendSetup = async () => {
    if (!form.email) {
      toast.error("No email on file. Copy or text the setup link: they add their email when they open it.");
      throw new Error("No email on file");
    }
    const t = toast.loading("Sending setup link…");
    try {
      const redirectTo = `${window.location.origin}/setup`;
      await inviteFn({ data: { clientId: id, redirectTo } });
      toast.success("Setup link sent", { id: t });
      qc.invalidateQueries({ queryKey: ["client", id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed", { id: t });
      throw e;
    }
  };

  const copySetupLink = async () => {
    const t = toast.loading("Generating link…");
    try {
      const { url, asksForEmail } = await getSetupLinkFn({ data: { clientId: id, redirectTo: `${window.location.origin}/setup` } });
      await navigator.clipboard.writeText(url);
      toast.success(asksForEmail ? "Setup link copied. They'll add their email when they open it." : "Setup link copied", { id: t });
      qc.invalidateQueries({ queryKey: ["client", id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed", { id: t });
      throw e;
    }
  };

  const sendReset = async () => {
    if (!form.email) {
      toast.error("Add an email first");
      throw new Error("No email on file");
    }
    const t = toast.loading("Sending reset link…");
    try {
      await sendResetFn({ data: { clientId: id, redirectTo: `${window.location.origin}/reset-password` } });
      toast.success("Reset email sent", { id: t });
      qc.invalidateQueries({ queryKey: ["client", id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed", { id: t });
      throw e;
    }
  };

  const copyResetLink = async () => {
    if (!form.email) {
      toast.error("Add an email first");
      throw new Error("No email on file");
    }
    const t = toast.loading("Generating reset link…");
    try {
      const { url } = await getResetLinkFn({ data: { clientId: id, redirectTo: `${window.location.origin}/reset-password` } });
      await navigator.clipboard.writeText(url);
      toast.success("Reset link copied", { id: t });
      qc.invalidateQueries({ queryKey: ["client", id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed", { id: t });
      throw e;
    }
  };

  const smsLink = (kind: "setup" | "magic" | "reset") => async () => {
    if (!form.phone) {
      toast.error("Add a phone number first");
      throw new Error("No phone on file");
    }
    // A setup link works without an email (they add it when they open it); a reset needs one.
    if (kind !== "setup" && !form.email) {
      toast.error("Add an email first");
      throw new Error("No email on file");
    }
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
      throw e;
    }
  };

  const toggleNeedsHelp = async () => {
    await needsHelpFn({ data: { clientId: id, value: !form.needs_admin_help } });
    toast.success(form.needs_admin_help ? "Cleared admin help flag" : "Flagged as needs help");
    qc.invalidateQueries({ queryKey: ["client", id] });
  };

  const confirmDelete = async () => {
    try {
      const res = await deleteFn({ data: { clientId: id } });
      toast.success(deletedToast(form.full_name, res?.purgeAfter ?? null), { duration: 8000 });
      setDeleteStep(0);
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["recently-deleted"] });
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
    markSaved({
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
    markSaved({
      profile_picture_needs_update: true,
      profile_picture_needs_update_at: new Date().toISOString(),
      profile_picture_needs_update_reason: reason || "Please take a new clear headshot.",
    });
  };

  // An empty preview helps nobody: client view needs their login.
  const needsLogin = () => {
    if (form.user_id) return false;
    toast.error("Client has no account yet — send a setup link first.");
    return true;
  };
  const enterPov = () => {
    if (!needsLogin()) void pov.enter(id, { fallbackName: form.full_name });
  };
  // Mid-session: today's workout as they see it, to log sets or move it.
  const openTodaysWorkout = () => {
    if (!needsLogin()) void pov.enter(id, { to: clientWorkoutHref(), fallbackName: form.full_name });
  };

  // One ⋯ for both headers (the page and the overlay opened from Clients).
  const moreMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="More actions" className="max-sm:h-10 max-sm:w-10 max-sm:px-0">
          <MoreHorizontal className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">More</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Training</DropdownMenuLabel>
        {canPov && (
          <DropdownMenuItem disabled={pov.busy} onSelect={openTodaysWorkout}>
            <Dumbbell className="mr-2 h-4 w-4" />Today's workout
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => navigate({ to: "/admin/client-programs/$clientId", params: { clientId: id } })}>
          <Dumbbell className="mr-2 h-4 w-4" />Training program
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/admin/client-programs/$clientId/history", params: { clientId: id } })}>
          <Calendar className="mr-2 h-4 w-4" />Program history
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Scheduling & Offers</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setQuickBookOpen(true)}><Calendar className="mr-2 h-4 w-4" />Book 1:1</DropdownMenuItem>
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
  );

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
        subtitle={accountSubtitle(form)}
        actions={
          <>
            {/* Back lives in the page header; Nutrition and Training are the tabs
                below; Save appears in the sticky bar as soon as something changes.
                The header keeps only what you reach for from anywhere on the page. */}
            <Button
              variant="outline"
              size="sm"
              onClick={openMessages}
              aria-label="Message"
            >
              <MessageSquare className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Message</span>
            </Button>
            {canPov && (
              <Button
                variant="outline"
                size="sm"
                aria-label="View as client"
                disabled={pov.busy}
                onClick={enterPov}
              >
                <Eye className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">View as client</span>
              </Button>
            )}
            {moreMenu}
          </>
        }
      />}
      {embedded && (
        <EmbeddedIdentityHeader
          form={form}
          canPov={canPov}
          povBusy={pov.busy}
          onClose={onClose}
          onMessage={openMessages}
          onPov={enterPov}
          onSave={save}
          isDirty={isDirty}
          saving={saving}
          moreMenu={moreMenu}
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
          <ClientOverviewSnapshot
            form={form}
            clientId={id}
            onSendSetup={sendSetup}
            onGoToTab={(t: TabValue) => setTab(t)}
          />
        </TabsContent>

        <TabsContent value="coaching" className={WORKSPACE_GRID_CLASS}>
          <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground">Coaching Setup</h3>
                <p className="mt-1 text-xs text-muted-foreground">Core coaching details only. Training, nutrition, billing, and documents stay in their dedicated sections.</p>
              </div>
              <Button size="sm" className="min-h-[44px] bg-primary font-semibold" onClick={save}>
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
                {/* Only what the data can't tell: a lead becomes a client on their first
                    sign-in by itself, and Deactivate / Archive are their own actions. */}
                <Select value={form.status ?? ""} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Client" /></SelectTrigger>
                  <SelectContent>
                    {statusChoicesFor(form.status).map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">{clientAccountLabel(form).hint}</p>
              </div>
              {/* What a client owes comes from their sales (Billing); the only
                  thing set here is that they don't pay at all, the same switch
                  as the Clients list's ⋯ "No payment needed". */}
              <div>
                <Label>Payment</Label>
                <label htmlFor="payment-exempt" className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3">
                  <span className="text-sm">No payment needed</span>
                  <Switch
                    id="payment-exempt"
                    checked={form.payment_status === "Complimentary"}
                    onCheckedChange={(v) => set("payment_status", v ? "Complimentary" : "Not Sent")}
                  />
                </label>
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
              {/* Instagram is edited once, with the other handles: Client details → Social media. */}
            </div>
          </Card>

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
            <Button size="sm" className="min-h-[44px] bg-primary font-semibold" onClick={save}>
              <Save className="mr-2 h-4 w-4" />Save changes
            </Button>
          </div>
        </TabsContent>

        {/*
          Training: only what builds, assigns and adjusts their training:
          the program (roadmap, alerts, Add), the schedule, athlete setup
          (training days, maxes, warm-up) and their workout notes.
        */}
        <TabsContent value="training" className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
          <Suspense fallback={<TabFallback />}>
            <ClientTrainingTab clientId={id} client={(data ?? form) as any} />
          </Suspense>
        </TabsContent>

        <TabsContent value="nutrition" className={WORKSPACE_GRID_CLASS}>
          <Suspense fallback={<TabFallback />}>
            <NutritionRequestPanel clientId={id} />
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
            <div className="md:col-span-3">
              <ClientAnalyticsDashboard
                clientId={id}
                preferredUnit={(form?.preferred_weight_unit as "lb" | "kg") ?? "lb"}
                canOpenLog
                hideBodyweight
              />
            </div>
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
                <h3 className="text-base font-semibold">Check-ins &amp; forms</h3>
                <p className="text-xs text-muted-foreground mt-1">Assign this client to forms from the unified form builder.</p>
              </div>
              {/* A check-in response is written from Check-in conversations, just below. */}
              <Button asChild variant="outline" size="sm"><Link to="/admin/native-forms">Manage forms</Link></Button>
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

          {/* The in-app Coaching Agreement first; SignNow and the hand-set record fold away under it. */}
          <div className="md:col-span-3">
            <Suspense fallback={<TabFallback />}>
              <ClientAgreementPanel clientId={id} clientName={form?.full_name} />
            </Suspense>
          </div>
          <OlderAgreements clientId={id} client={form} />
          {/* The Drive folder is edited in Quick links above; these older links keep their fields here, folded. */}
          <FoldedSection
            title="Linked resources"
            hint={(() => {
              const n = links.filter(([name, v]) => name !== "Drive Folder" && v).length;
              return n ? `${n} saved · program sheet, agreement, booking and Stripe links` : "Program sheet, agreement, booking and Stripe links";
            })()}
          >
            <Card className="border-border bg-card p-6 space-y-3">
              <p className="text-xs text-muted-foreground">Use the Save button at the top of the page to apply changes.</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div><Label>Program sheet (Google Sheets)</Label><Input value={form.program_sheet_link ?? ""} onChange={(e) => set("program_sheet_link", e.target.value)} placeholder="https://sheets.google.com/…" /></div>
                <div><Label>Agreement / contract</Label><Input value={form.agreement_link ?? ""} onChange={(e) => set("agreement_link", e.target.value)} /></div>
                <div><Label>Calendar / booking link</Label><Input value={form.calendar_link ?? ""} onChange={(e) => set("calendar_link", e.target.value)} /></div>
                <div><Label>Stripe payment link</Label><Input value={form.stripe_link ?? ""} onChange={(e) => set("stripe_link", e.target.value)} /></div>
              </div>
              {links.some(([name, v]) => name !== "Drive Folder" && v) && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {links.filter(([name, v]) => name !== "Drive Folder" && v).map(([n, v]) => (
                    <a key={n} href={v as string} target="_blank" rel="noreferrer">
                      <Badge variant="outline" className="cursor-pointer hover:border-foreground/40">{n} <ExternalLink className="ml-1 h-3 w-3" /></Badge>
                    </a>
                  ))}
                </div>
              )}
            </Card>
          </FoldedSection>
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
            <ClientBillingPanel clientId={id} />
            <ClientSalesTable clientId={id} />
          </Suspense>
        </TabsContent>

        <TabsContent value="notes" className={WORKSPACE_GRID_CLASS}>
          <Suspense fallback={<TabFallback />}>
            <ClientFileNotes clientId={id} className="md:col-span-3" />
          </Suspense>
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
          <Card className="border-border bg-card p-6 space-y-3">
            <h3 className="text-sm font-semibold">Private coach notes</h3>
            <p className="text-xs text-muted-foreground">Only visible to admin.</p>
            <Textarea rows={12} value={form.coach_notes ?? ""} onChange={(e) => set("coach_notes", e.target.value)} placeholder="Internal notes the client never sees…" />
          </Card>
        </TabsContent>

        <TabsContent value="info" className={WORKSPACE_GRID_CLASS}>
          <div className="md:col-span-2 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card/60 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground">Personal Information</h2>
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
                markSaved(fullPatch);
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
            <h3 className="text-sm font-semibold text-muted-foreground">Communication Preferences</h3>
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
                  else { markSaved({ call_access_enabled: v }); toast.success(v ? "Call access enabled" : "Call access disabled"); qc.invalidateQueries({ queryKey: ["client", id] }); qc.invalidateQueries({ queryKey: ["clients-min"] }); }
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
                  else { markSaved({ sms_opt_out: v }); toast.success(v ? "SMS opted out" : "SMS enabled"); qc.invalidateQueries({ queryKey: ["client", id] }); }
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
                  else { markSaved({ coach_call_access_enabled: v }); toast.success(v ? "Client can call their coach" : "Client can no longer call their coach"); qc.invalidateQueries({ queryKey: ["client", id] }); }
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
                  else { markSaved({ coach_sms_access_enabled: v }); toast.success(v ? "Client can SMS their coach" : "Client can no longer SMS their coach"); qc.invalidateQueries({ queryKey: ["client", id] }); }
                }}
              />
            </div>
          </Card>

          <Card className="border-border bg-card p-6 md:col-span-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Social Media</h3>
              <SocialIcons client={form} size="xs" />
            </div>
            <p className="text-[11px] text-muted-foreground">Usernames/handles only — the app auto-links where possible.</p>
            <SocialHandlesEditor values={form} onChange={(k, v) => set(k, v)} />
            <div className="flex justify-end pt-2">
              <Button size="sm" className="min-h-[44px] bg-primary font-semibold" onClick={save}>
                <Save className="mr-2 h-4 w-4" />Save
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="account" className={WORKSPACE_GRID_CLASS}>
        <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Login & Access</h3>
            <Badge variant="outline">{describeAccountAccess(form).statusLabel}</Badge>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <div className="space-y-3 md:col-span-2">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <Field label="Account" value={form.user_id || form.last_signed_in_at ? "Created" : "Not created"} />
                <Field label="Can log in" value={form.portal_access_disabled ? "No — portal disabled" : form.user_id ? "Yes" : "Not yet"} />
                <Field label="Last sign-in" value={fmtDate(form.last_signed_in_at)} />
                <Field label="Service access" value={form.status === "Deactivated" ? "Deactivated" : "Active"} />
              </div>
              {(() => {
                const access = describeAccountAccess(form);
                // Only a client who has actually signed in gets "reset password";
                // everyone else gets the setup flow (works for invited accounts too).
                const recovery = access.stage === "live";
                const lastSetup = form.invite_last_resent_at || form.invite_sent_at;
                const noEmail = !form.email;
                const noPhone = !form.phone;
                const steps = [
                  { label: "Client record created", done: true, at: form.created_at },
                  { label: "Setup link sent", done: !!lastSetup, at: lastSetup },
                  { label: "Signed in to the app", done: !!form.last_signed_in_at, at: form.last_signed_in_at },
                ];
                return (
                  <div className="space-y-4 border-t border-border pt-4">
                    <div>
                      <p className="text-sm font-semibold">
                        {recovery ? "Client is set up" : access.stage === "no_account" ? "Get them into the app" : "Waiting on the client to finish setup"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {recovery
                          ? "Locked out? Send a password reset by email or text."
                          : `Text them their setup link: one tap opens their account and they pick a password. It works for ${SETUP_INVITE_DAYS} days until they've signed in, and sending it again never breaks the last one.`}
                      </p>
                    </div>

                    <ol className="space-y-1.5" aria-label="Setup progress">
                      {steps.map((st) => (
                        <li key={st.label} className="flex items-center gap-2 text-xs">
                          {st.done
                            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                            : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/40" />}
                          <span className={st.done ? "font-medium" : "text-muted-foreground"}>{st.label}</span>
                          {st.at && <span className="ml-auto text-muted-foreground">{fmtDate(st.at)}</span>}
                        </li>
                      ))}
                    </ol>

                    {recovery ? (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <ActionButton className="min-h-[48px]" disabled={noEmail} onAction={sendReset} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<Mail className="h-4 w-4" />}>
                          Email reset link
                        </ActionButton>
                        <ActionButton className="min-h-[48px]" variant="outline" disabled={noPhone || noEmail} onAction={smsLink("reset")} loadingLabel="Texting…" successLabel="Texted" successToast={false} errorToast={false} icon={<MessageSquare className="h-4 w-4" />}>
                          Text reset link
                        </ActionButton>
                        <ActionButton className="min-h-[48px]" variant="outline" disabled={noEmail} onAction={copyResetLink} loadingLabel="Copying…" successLabel="Copied" successToast={false} errorToast={false} icon={<Copy className="h-4 w-4" />}>
                          Copy reset link
                        </ActionButton>
                      </div>
                    ) : (
                      // Text first: it's read within minutes and never lands in Junk.
                      <div className="grid gap-2 sm:grid-cols-3">
                        <ActionButton className="min-h-[48px]" variant={noPhone ? "outline" : "default"} disabled={noPhone} onAction={smsLink("setup")} loadingLabel="Texting…" successLabel="Texted" successToast={false} errorToast={false} icon={<MessageSquare className="h-4 w-4" />}>
                          {lastSetup ? "Text it again" : "Text setup link"}
                        </ActionButton>
                        <ActionButton className="min-h-[48px]" variant={noPhone ? "default" : "outline"} onAction={copySetupLink} loadingLabel="Copying…" successLabel="Copied" successToast={false} errorToast={false} icon={<Copy className="h-4 w-4" />}>
                          Copy setup link
                        </ActionButton>
                        <ActionButton className="min-h-[48px]" variant="outline" disabled={noEmail} onAction={sendSetup} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<Mail className="h-4 w-4" />}>
                          {lastSetup ? "Email it again" : "Email setup link"}
                        </ActionButton>
                      </div>
                    )}

                    <div className="grid gap-1.5 rounded-md bg-secondary/30 p-3 text-xs sm:grid-cols-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className={noEmail ? "text-muted-foreground" : "truncate"}>{form.email || "No email yet"}</span>
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className={noPhone ? "text-muted-foreground" : "truncate"}>{form.phone || "No phone yet: copy the link or email it"}</span>
                      </div>
                      {!recovery && (
                        <p className="text-muted-foreground sm:col-span-2">
                          {noEmail
                            ? "No email needed: they add theirs when they open the link and confirm it with a code."
                            : "Emailing a Hotmail or Outlook address? Text it too, those inboxes often send it to Junk."}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="space-y-3 rounded-md border border-border bg-secondary/20 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Advanced</div>
              <Button className="min-h-[44px] w-full justify-start" variant="outline" onClick={() => { setPwValue(""); setPwOpen(true); }}><KeyRound className="mr-2 h-4 w-4" />Set password manually</Button>
              <Button className="min-h-[44px] w-full justify-start" variant={form.needs_admin_help ? "default" : "outline"} onClick={toggleNeedsHelp}><AlertCircle className="mr-2 h-4 w-4" />{form.needs_admin_help ? "Clear help flag" : "Flag access issue"}</Button>
              <p className="text-[11px] text-muted-foreground">Account authentication is separate from coaching, billing, and feature access.</p>
            </div>
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
              className="min-h-[48px] bg-primary font-semibold"
            >
              <Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={deleteStep > 0} onOpenChange={(o) => !o && setDeleteStep(0)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* one step: nothing is deleted on the spot, it waits 30 days in Recently deleted */}
            <AlertDialogTitle>{adminDeleteCopy(form.full_name).title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {adminDeleteCopy(form.full_name).lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <ActionButton
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              loadingLabel="Moving…"
              successLabel="Moved"
              successToast={false}
              errorToast
              onAction={async () => { await confirmDelete(); }}
            >
              {adminDeleteCopy(form.full_name).action}
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {priceCardOpen ? (
        <Suspense fallback={null}>
          <PriceCardPickerDialog open={priceCardOpen} onClose={() => setPriceCardOpen(false)} fixedClientId={id} />
        </Suspense>
      ) : null}
      <PtSessionDialog
        open={quickBookOpen}
        onOpenChange={setQuickBookOpen}
        clientId={id}
        clients={[{ id, full_name: form.full_name, timezone: form.timezone, default_session_location: form.default_session_location, package_tracking_enabled: form.package_tracking_enabled, sessions_purchased: form.sessions_purchased, sessions_used: form.sessions_used }]}
      />
      <ShareBookingSheet
        target={null}
        choices={bookingTypes
          .filter((t) => t.is_active && t.online_enabled && t.slug && (t.hours ?? []).length)
          .map((t) => ({ name: t.name, slug: t.slug! }))}
        open={bookingLinkOpen}
        onOpenChange={setBookingLinkOpen}
        client={{ id, full_name: form.full_name ?? null, email: form.email ?? null, phone: form.phone ?? null }}
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

/** "Client · Online Coaching", "Lead", "Member": the account's label, then how they're coached. */
function accountSubtitle(form: any): string {
  const account = clientAccountLabel(form);
  const type = account.kind === "member" ? null : (form.coaching_type ?? "").trim() || null;
  return [account.label, type].filter(Boolean).join(" · ");
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
  povBusy,
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
  povBusy?: boolean;
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
        badges: [(() => {
          const account = clientAccountLabel(form);
          return { label: account.label, tone: account.tone === "warn" ? "warn" : "default" };
        })()],
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
        // View as client at every width: on a phone the eye alone, beside Message.
        canPov ? (
          <>
            <Button variant="outline" size="sm" onClick={onPov} disabled={povBusy} className="hidden sm:inline-flex">
              <Eye className="mr-2 h-4 w-4" />View as client
            </Button>
            <Button variant="ghost" size="icon" onClick={onPov} disabled={povBusy} className="h-10 w-10 sm:hidden" aria-label="View as client">
              <Eye className="h-5 w-5" />
            </Button>
          </>
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
  form, clientId, onSendSetup, onGoToTab,
}: {
  form: any;
  clientId: string;
  onSendSetup: () => unknown | Promise<unknown>;
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
  const missing = critical.filter((c) => !c.populated && c.key !== "user_id");
  // Login problems (no account yet, invite expired, never signed in, portal
  // off) sit in the same list as the missing fields: one short "Missing" card,
  // shown only when something is. The details live on Login & access.
  const access = describeAccountAccess(form);
  const loginIssue = !form.user_id || access.needsAttention;

  return (
    <div className="md:col-span-3 space-y-6">
      {/* The coach's notes on this client first (Quick Notes saved to them land here). */}
      <Suspense fallback={<div className="h-24 rounded-2xl bg-muted" />}>
        <ClientFileNotes clientId={clientId} limit={3} />
      </Suspense>
      <ClientCalendarSyncStatus clientId={clientId} />
      {/*
        No identity card or quick-action grid here: the page header already
        shows who this is and holds Message, View as client and ⋯ (program,
        booking, lifecycle); Training, Goals & intake and the update request
        are tabs. Personal details are on Client details.
      */}
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
        </div>
        {(missing.length > 0 || loginIssue) && (
          <div className="space-y-6">
            <Card className="border-border bg-card p-5 space-y-3" data-testid="client-missing-card">
              <h3 className="text-base font-semibold">Missing</h3>
              <ul className="divide-y divide-border">
                {loginIssue && (
                  <li className="space-y-2 py-2.5 first:pt-0" data-testid="account-access-card">
                    <div className="flex items-center gap-2 text-sm">
                      <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
                      <span className="min-w-0">Login: {access.statusLabel}</span>
                    </div>
                    <p className="pl-6 text-xs text-muted-foreground">
                      Invite status: {access.inviteStatusLabel}
                      {access.accountCreatedAt ? ` · Account created ${fmtDate(access.accountCreatedAt)}` : ""}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pl-6">
                      {access.stage !== "live" && form.email && (
                        <ActionButton variant="outline" size="sm" className="min-h-10" onAction={onSendSetup} loadingLabel="Sending…" successLabel="Sent" successToast={false} errorToast={false} icon={<Mail className="h-4 w-4" />}>
                          {form.invite_sent_at || form.invite_last_resent_at ? "Resend setup email" : "Email setup link"}
                        </ActionButton>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-10 text-muted-foreground hover:text-foreground"
                        onClick={() => onGoToTab("account")}
                      >
                        {access.stage === "live" ? "Manage access" : "Text, copy or reset link"} <span aria-hidden>›</span>
                      </Button>
                    </div>
                  </li>
                )}
                {missing.map((m) => (
                  <li key={m.key}>
                    <button
                      type="button"
                      onClick={() => onGoToTab(m.jumpTo)}
                      className="flex min-h-[44px] w-full items-center justify-between gap-2 py-2 text-left text-sm hover:text-foreground"
                    >
                      <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0 text-warning" />{m.label}</span>
                      <span className="text-xs font-semibold text-muted-foreground">Add ›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A section that stays one row until it's opened. Its content only mounts when
 * open, so a folded panel costs nothing (no queries, no lazy chunk).
 */
function FoldedSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="group md:col-span-3"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      {open && <div className="mt-3 grid gap-4">{children}</div>}
    </details>
  );
}

/**
 * The agreement records from before in-app signing: the hand-set record
 * (signed toggle, date, version, links) and SignNow. Folded under the in-app
 * panel, and only there when this client has something in either: a SignNow
 * agreement, or a hand-set record the in-app signature didn't write (in-app
 * signing stamps the same columns, so a client who signed in the app has
 * nothing older to show). SignNow stays fully usable from its own page.
 */
function OlderAgreements({ clientId, client }: { clientId: string; client: any }) {
  const detailFn = useServerFn(adminClientAgreementDetail);
  const { data: detail, isSuccess: detailReady } = useQuery({
    queryKey: [ADMIN_AGREEMENT_QUERY_ROOT, "detail", clientId],
    queryFn: () => detailFn({ data: { clientId } }),
    staleTime: 15_000,
  });
  const { data: signNowCount = 0 } = useQuery({
    queryKey: ["client-agreements-count", clientId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("agreements")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });
  const signedInApp = ((detail as any)?.signatures?.length ?? 0) > 0;
  const status = String(client?.agreement_status ?? "Not Sent");
  const handSet =
    !!client?.agreement_link ||
    !!client?.agreement_signature_platform_link ||
    (detailReady && !signedInApp && (!!client?.agreement_signed || !!client?.agreement_signed_date || !!client?.agreement_version || status !== "Not Sent"));
  if (signNowCount === 0 && !handSet) return null;
  const parts = [handSet && "hand-set record", signNowCount > 0 && `${signNowCount} SignNow`].filter(Boolean).join(" · ");
  return (
    <FoldedSection title="Older agreements" hint={`From before in-app signing: ${parts}`}>
      <Suspense fallback={<TabFallback />}>
        <AgreementStatusPanel client={client} />
        <AgreementsPanel clientId={clientId} clientName={client?.full_name} />
      </Suspense>
    </FoldedSection>
  );
}

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
        <h3 className="text-sm font-semibold text-muted-foreground">
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