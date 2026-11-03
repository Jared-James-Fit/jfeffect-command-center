import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useClientImpersonation, usePortalUserId } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { useServiceTier, useEntitlement } from "@/lib/service-tier";
import { PageHeader } from "@/components/app-shell";
import { PageBodySkeleton } from "@/components/route-pending";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileSignature,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Scale,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Target,
  Trash2,
  User,
  Watch,
} from "lucide-react";
import { isBasicInfoComplete } from "@/lib/basic-info";
import { isNative } from "@/platform";
import { healthStoreProvider } from "@/platform/health";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createCustomerPortalSession } from "@/lib/stripe-checkout.functions";
import { ProfilePictureCapture } from "@/components/profile-picture-capture";
import { SocialHandlesEditor } from "@/components/social-handles-editor";
import { SOCIAL_FIELDS, SOCIAL_PLATFORMS } from "@/lib/social-handles";
import { BasicInfoForm } from "@/components/basic-info-form";
import { ChangePasswordCard } from "@/components/change-password-card";
import { TrainingScheduleCard } from "@/components/training-schedule-card";
import { WEEK_DAYS, SHORT_DAY, type WeekDay } from "@/lib/training-schedule";
import { useAutosave } from "@/hooks/use-autosave";
import { SavedIndicator } from "@/components/saved-indicator";
import { ClientLegalSafety } from "@/components/legal/client-legal-safety";
import { AgreementAccountCard } from "@/components/coaching-agreement/agreement-account-card";
import { useCoachingAgreement } from "@/components/coaching-agreement/agreement-context";
import { MemberAgreementCard, membershipAgreementStatus, useMembershipAgreement } from "@/components/member/member-agreement";
import { InstallAppDialog } from "@/components/portal/install-app-dialog";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { WearablesCard, connectableProviders, useWearableOverview } from "@/components/portal/wearables-card";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { PushNotificationCard } from "@/components/push/push-notification-card";
import { WeightUnitCard } from "@/components/portal/weight-unit-card";
import { UserAvatar } from "@/components/user-avatar";

export const Route = createFileRoute("/_authenticated/portal/account")({
  component: AccountPage,
});

const PROFILE_FIELDS = ["first_name", "last_name", "preferred_name", "phone", "address", "city", "province", "postal_code", "country", "timezone", "date_of_birth", "sex", "height_cm", "preferred_height_unit", "emergency_contact_name", "emergency_contact_phone", ...SOCIAL_FIELDS] as const;

/**
 * The page's sections, each a row that opens in place. A link that names one
 * (`/portal/account#legal`, the old section anchors) opens it.
 */
type SectionId =
  | "units"
  | "notifications"
  | "coaching-agreement"
  | "basic-information"
  | "profile-picture"
  | "social-media"
  | "devices"
  | "password"
  | "legal"
  | "billing"
  | "delete-account";

const SECTION_ALIASES: Record<string, SectionId> = {
  units: "units",
  "training-schedule": "units",
  schedule: "units",
  notifications: "notifications",
  "coaching-agreement": "coaching-agreement",
  agreement: "coaching-agreement",
  "basic-information": "basic-information",
  basic: "basic-information",
  "profile-picture": "profile-picture",
  photo: "profile-picture",
  "social-media": "social-media",
  social: "social-media",
  devices: "devices",
  password: "password",
  legal: "legal",
  "legal-safety": "legal",
  privacy: "legal",
  billing: "billing",
  "delete-account": "delete-account",
};

function accountSectionFromHash(hash: string | null | undefined): SectionId | null {
  const key = String(hash ?? "").replace(/^#/, "").trim().toLowerCase();
  return SECTION_ALIASES[key] ?? null;
}

function AccountPage() {
  const portalUserId = usePortalUserId();
  const { isImpersonating } = useClientImpersonation();
  const { user } = useAuth();
  const { tier, loading: tierLoading } = useServiceTier();
  const goalsOn = useEntitlement("goals_setup");
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(null);
  const [open, setOpen] = useState<string[]>([]);

  const { data: client } = useQuery({
    queryKey: ["my-client-account", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("user_id", portalUserId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Fill the form once per account: a refetch (after a save, or coming back
  // to the app) must never overwrite what's being typed.
  const hydratedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!client || hydratedIdRef.current === client.id) return;
    hydratedIdRef.current = client.id;
    const [first, ...rest] = (client.full_name ?? "").split(" ");
    setForm({
      ...client,
      first_name: client.first_name ?? first ?? "",
      last_name: client.last_name ?? rest.join(" ") ?? "",
    });
    // the coach asked them to review their details: open them
    if (client.info_update_requested) setOpen((cur) => (cur.includes("basic-information") ? cur : [...cur, "basic-information"]));
  }, [client]);

  const set = (k: string, v: any) => setForm({ ...(form ?? {}), [k]: v });

  const { data: goalsStatus } = useQuery({
    queryKey: ["client-goals-setup-status", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("client_goals_setup")
        .select("completed_at, main_goal")
        .eq("client_id", client!.id)
        .maybeSingle();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const { data: assignedCoach } = useQuery({
    queryKey: ["coach", client?.assigned_coach_id],
    enabled: !!client?.assigned_coach_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("coaches")
        .select("id, full_name")
        .eq("id", client!.assigned_coach_id!)
        .maybeSingle();
      return data;
    },
    staleTime: 10 * 60_000,
  });

  // What the rows say about themselves (their summaries), from reads the sections share.
  const agreement = useCoachingAgreement();
  const { data: memberAgreement } = useMembershipAgreement();
  const wearablesQ = useWearableOverview();
  const wearables = wearablesQ.data;
  const { data: primaryPurchase } = useActivePurchase(client?.id);

  const buildPatch = (current: any) => {
    const updatedFields = PROFILE_FIELDS.filter((f) => current[f] !== client?.[f]);
    const patch: any = {
      first_name: current.first_name?.trim() || null,
      last_name: current.last_name?.trim() || null,
      full_name: [current.first_name, current.last_name].filter(Boolean).join(" ").trim() || current.full_name,
      preferred_name: current.preferred_name?.trim() || null,
      phone: current.phone || null,
      date_of_birth: current.date_of_birth || null,
      height_cm: current.height_cm ?? null,
      preferred_height_unit: current.preferred_height_unit ?? "imperial",
      emergency_contact_name: current.emergency_contact_name || null,
      emergency_contact_phone: current.emergency_contact_phone || null,
      address: current.address || null,
      city: current.city || null,
      province: current.province || null,
      postal_code: current.postal_code || null,
      country: current.country || null,
      timezone: current.timezone || "America/Winnipeg",
      instagram: current.instagram || null,
      tiktok: current.tiktok || null,
      youtube: current.youtube || null,
      facebook: current.facebook || null,
      twitter_x: current.twitter_x || null,
      linkedin: current.linkedin || null,
      website: current.website || null,
      other_social_label: current.other_social_label || null,
      other_social_handle: current.other_social_handle || null,
      info_last_updated_at: new Date().toISOString(),
      info_last_updated_by: "client",
      info_last_updated_fields: updatedFields,
      info_update_requested: false,
      timezone_confirmed_at:
        current.timezone !== client?.timezone ? new Date().toISOString() : client?.timezone_confirmed_at,
    };
    // Only write sex when it has an answer, so autosave never erases one.
    if (current.sex) patch.sex = current.sex;
    return patch;
  };

  // Autosave the entire form (debounced) — no Save button needed.
  const autosaveValue = useMemo(() => {
    if (!form) return null;
    const pick: any = {};
    for (const f of PROFILE_FIELDS) pick[f] = form[f] ?? null;
    return pick;
  }, [form]);

  const { state: saveState } = useAutosave({
    key: form?.id ? `client-account-${form.id}` : null,
    value: autosaveValue,
    enabled: !!form && !!form.id,
    onSave: async () => {
      if (!form?.id) return;
      const patch = buildPatch(form);
      const { error } = await supabase.from("clients").update(patch).eq("id", form.id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["my-client-account"] });
      qc.invalidateQueries({ queryKey: ["my-client"] });
    },
  });

  /** Open a section (leaving any other open one as it is) and bring it into view. */
  const openSection = useCallback((id: SectionId) => {
    setOpen((cur) => (cur.includes(id) ? cur : [...cur, id]));
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }, []);

  // A link to a section (`#legal` from a legal notice, or an old anchor) opens it.
  const hash = useRouterState({ select: (s) => s.location.hash });
  const ready = !!form && !tierLoading;
  useEffect(() => {
    if (!ready) return;
    const id = accountSectionFromHash(hash);
    if (id) openSection(id);
  }, [hash, ready, openSection]);

  if (!user) return <div className="p-10 text-muted-foreground">Sign in to manage your account.</div>;
  if (!form || tierLoading) {
    // members and coaching clients see different sections: wait for the tier, never guess
    return (
      <>
        <PageHeader title="Account Settings" />
        <PageBodySkeleton />
      </>
    );
  }

  // Manual save button (rare — used if you change everything and want immediate confirmation).
  const flushNow = async () => {
    if (!form?.id) return;
    try {
      const patch = buildPatch(form);
      const { error } = await supabase.from("clients").update(patch).eq("id", form.id);
      if (error) throw error;
      toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["my-client-account"] });
    qc.invalidateQueries({ queryKey: ["my-client"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    }
  };

  const updatePicture = async (path: string) => {
    const { error } = await supabase
      .from("clients")
      .update({
        profile_picture_url: path,
        profile_picture_updated_at: new Date().toISOString(),
        profile_picture_updated_by: "client",
        profile_picture_source: "camera",
        profile_picture_needs_update: false,
        profile_picture_needs_update_at: null,
        profile_picture_needs_update_reason: null,
      })
      .eq("id", form.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["my-client-account"] });
    qc.invalidateQueries({ queryKey: ["my-client-picture-gate"] });
    qc.invalidateQueries({ queryKey: ["my-client"] });
    setForm({ ...form, profile_picture_url: path, profile_picture_updated_at: new Date().toISOString(), profile_picture_needs_update: false });
  };

  // ── Row summaries ──
  const missing = profileMissing(client, goalsStatus, goalsOn);
  const basicMissing = missing.filter((m) => m.section === "basic-information").length;
  const unitsOk = !!client?.weight_unit_confirmed_at;
  const scheduleOk = !!client?.training_schedule_completed;
  const days = committedShortDays(client);
  const unitsSummary: Summary = !unitsOk
    ? { text: "Pick lb or kg", warn: true }
    : !scheduleOk || days.length === 0
      ? { text: "Set your training days", warn: true }
      : { text: `${client?.preferred_weight_unit === "kg" ? "kg" : "lb"} · ${days.length} day${days.length === 1 ? "" : "s"} a week` };
  const photoOk = !!form.profile_picture_url && !form.profile_picture_needs_update;
  const photoSummary: Summary = !form.profile_picture_url
    ? { text: "Add a photo", warn: true }
    : !photoOk
      ? { text: "Needs a new photo", warn: true }
      : form.profile_picture_updated_at
        ? { text: `Updated ${format(new Date(form.profile_picture_updated_at), "MMM d")}` }
        : null;
  // only the handles they've filled in
  const socialValues = SOCIAL_PLATFORMS.map((p) => String(form[p.field] ?? "").trim()).filter(Boolean);

  const coachingRows = tier === "coaching" ? coachingSetupRows(client, assignedCoach ?? null) : [];
  const coachState = agreement.state?.applicable ? agreement.state.state?.state ?? null : null;
  const memberStatus = !isImpersonating ? membershipAgreementStatus(memberAgreement) : null;
  const agreementSummary: Summary =
    coachState === "signed"
      ? { text: "Signed" }
      : coachState === "needs_signature"
        ? { text: "Action required", warn: true }
        : coachState === "exempt"
          ? { text: "On file" }
          : memberStatus
            ? { text: memberStatus.label, warn: memberStatus.needsYou }
            : coachingRows.length
              ? { text: String(client?.coaching_package ?? client?.coaching_type ?? "") }
              : null;
  const hasAgreement = !!coachState || !!memberStatus;
  const coachingTitle =
    coachingRows.length && hasAgreement
      ? "Coaching & agreement"
      : coachingRows.length
        ? "Coaching"
        : tier === "self_serve"
          ? "Membership agreement"
          : "Coaching agreement";

  // Devices: only where something can actually connect (or already has).
  const wearablesActive = (wearables?.connections ?? []).filter((c) => c.status !== "disconnected");
  const canConnectHere = !!wearables && wearables.isOwner && connectableProviders(wearables).length > 0;
  // in the phone app the row stays even when the read fails (the section says so, never a silent gap)
  const showDevices =
    wearablesActive.length > 0 || canConnectHere || (!!healthStoreProvider() && (wearablesQ.isError || !!wearables?.isOwner));
  const devicesSummary: Summary = wearablesActive.length
    ? { text: wearablesActive.map((c) => providerLabel(c.provider)).join(", ") }
    : { text: "Not connected" };

  const native = isNative();
  const displayName =
    [form.first_name, form.last_name].filter(Boolean).join(" ").trim() || form.full_name || "Your account";
  const email = form.email ?? (portalUserId === user.id ? user.email : "") ?? "";

  return (
    <>
      <PageHeader title="Account Settings" actions={<SavedIndicator state={saveState} />} actionsInline />
      <div className="w-full max-w-2xl space-y-4 px-4 pb-[max(6rem,env(safe-area-inset-bottom))] pt-4 md:px-5 xl:px-6">
        {/* Who this is: photo (a tap opens the photo section), name, email. */}
        <div className="flex items-center gap-3 px-1">
          <button
            type="button"
            onClick={() => openSection("profile-picture")}
            aria-label="Change your profile photo"
            className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserAvatar src={form.profile_picture_url} name={displayName} size={56} expandable={false} />
          </button>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold leading-tight">{displayName}</div>
            {email && <div className="truncate text-sm text-muted-foreground">{email}</div>}
          </div>
        </div>

        {/* ── Only while something's missing, or the coach asked for a review ── */}
        <ProfileStatusCard missing={missing} onOpen={openSection} />

        {form.info_update_requested && (
          <Card className="border-warning/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <ShieldAlert className="h-5 w-5 shrink-0 text-warning" />
                <div className="min-w-0">
                  <div className="text-base font-semibold">Your coach asked you to review your account info</div>
                  <div className="text-xs text-muted-foreground">Fix anything that's out of date below, then confirm.</div>
                </div>
              </div>
              <Button className="h-10 shrink-0" onClick={() => void flushNow()}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />Everything's correct
              </Button>
            </div>
          </Card>
        )}

        <Accordion type="multiple" value={open} onValueChange={setOpen} className="space-y-4">
          {/* Training: what people change most */}
          <SettingsGroup>
            <SettingsSection id="units" icon={Scale} title="Units & training days" summary={unitsSummary}>
              <div className="space-y-5">
                <SectionErrorBoundary label="Weight units">
                  <WeightUnitCard
                    key={`${form.id}:${client?.preferred_weight_unit}:${client?.weight_unit_confirmed_at ?? ""}`}
                    clientId={form.id}
                    value={client?.preferred_weight_unit}
                    confirmed={!!client?.weight_unit_confirmed_at}
                  />
                </SectionErrorBoundary>
                <SectionErrorBoundary label="Training Schedule">
                  <TrainingDaysBlock client={client as any} />
                </SectionErrorBoundary>
              </div>
            </SettingsSection>

            <SettingsSection id="notifications" icon={Bell} title="Notifications & sounds">
              <SectionErrorBoundary label="Push Notifications">
                <PushNotificationCard bare />
              </SectionErrorBoundary>
            </SettingsSection>

            {/* Goals & Setup is the coach's onboarding: its own page, a coaching client's only. */}
            {goalsOn && client && (
              <SettingsLink
                to="/portal/goals-setup"
                icon={Target}
                title="Goals & setup"
                summary={goalsSummary(goalsStatus)}
              />
            )}

            {/* Coaching Agreement: status, sign if needed, and the signed copy to view any time.
                Read-only for a coach in "View as client". */}
            {(coachingRows.length > 0 || hasAgreement) && (
              <SettingsSection id="coaching-agreement" icon={FileSignature} title={coachingTitle} summary={agreementSummary}>
                <div className="space-y-5">
                  {coachingRows.length > 0 && <CoachingSetupRows rows={coachingRows} />}
                  <SectionErrorBoundary label="Coaching Agreement">
                    <AgreementAccountCard bare />
                    {/* a JF member's agreement (the coaching one never applies to them) */}
                    {!isImpersonating && <MemberAgreementCard />}
                  </SectionErrorBoundary>
                </div>
              </SettingsSection>
            )}
          </SettingsGroup>

          {/* Profile */}
          <SettingsGroup>
            <SettingsSection
              id="basic-information"
              icon={User}
              title="Personal details"
              summary={basicMissing ? { text: `${basicMissing} to finish`, warn: true } : null}
            >
              <SectionErrorBoundary label="Basic Information">
                <BasicInfoForm
                  values={form}
                  onChange={(p) => setForm({ ...form, ...p })}
                  emailReadOnly={email}
                />
                <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span>
                    Saves automatically
                    {form.info_last_updated_at ? ` · Updated ${format(new Date(form.info_last_updated_at), "MMM d")}` : ""}
                    {form.info_last_updated_by && form.info_last_updated_by !== "client" ? ` by ${form.info_last_updated_by}` : ""}
                  </span>
                  <SavedIndicator state={saveState} />
                </p>
              </SectionErrorBoundary>
            </SettingsSection>

            <SettingsSection id="profile-picture" icon={ImageIcon} title="Profile photo" summary={photoSummary}>
              <SectionErrorBoundary label="Profile Picture">
                <ProfilePictureCapture
                  mode="client"
                  userId={portalUserId ?? user.id}
                  currentUrl={form.profile_picture_url}
                  onUploaded={updatePicture}
                />
                <p className="text-center text-[11px] text-muted-foreground">Use a clear, current headshot.</p>
              </SectionErrorBoundary>
            </SettingsSection>

            <SettingsSection
              id="social-media"
              icon={Link2}
              title="Social links"
              summary={socialValues.length ? { text: socialValues.join(" · ") } : null}
            >
              <SectionErrorBoundary label="Social Media">
                <p className="mb-3 text-[11px] text-muted-foreground">Just your username, no full links. All optional.</p>
                <SocialHandlesEditor values={form} onChange={(k, v) => set(k, v)} />
              </SectionErrorBoundary>
            </SettingsSection>

            {showDevices && (
              <SettingsSection id="devices" icon={Watch} title="Devices & recovery" summary={devicesSummary}>
                <SectionErrorBoundary label="Devices">
                  <WearablesCard bare />
                </SectionErrorBoundary>
              </SettingsSection>
            )}
          </SettingsGroup>

          {/* Account */}
          <SettingsGroup>
            {!native && <InstallAppRow />}

            <SettingsSection id="password" icon={KeyRound} title="Password">
              <SectionErrorBoundary label="Change Password">
                <ChangePasswordCard bare />
              </SectionErrorBoundary>
            </SettingsSection>

            {/* Legal status/consents come from the signed-in session, so in coach
                "View as client" they'd be the coach's, not the client's. */}
            {!isImpersonating && (
              <SettingsSection id="legal" icon={ShieldCheck} title="Privacy & legal">
                <SectionErrorBoundary label="Legal & Safety">
                  <ClientLegalSafety bare />
                </SectionErrorBoundary>
              </SettingsSection>
            )}

            {/* ── Billing & Subscription — hidden on native (purchases not available in Android app) ── */}
            {!native && (
              <SettingsSection
                id="billing"
                icon={CreditCard}
                title="Billing"
                summary={primaryPurchase?.offer_name ? { text: String(primaryPurchase.offer_name) } : null}
              >
                <SectionErrorBoundary label="Billing & Subscription">
                  <BillingSection purchase={primaryPurchase ?? null} />
                </SectionErrorBoundary>
              </SettingsSection>
            )}

            {/* ── Delete Account — required by Google Play and Apple App Store policies ── */}
            <SettingsSection id="delete-account" icon={Trash2} title="Delete account" destructive>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Permanently delete your JF Effect account and all associated data. This action cannot be undone.
                </p>
                <Button variant="destructive" asChild className="h-10">
                  <a href="/account-deletion">Delete my account</a>
                </Button>
              </div>
            </SettingsSection>
          </SettingsGroup>
        </Accordion>
      </div>
    </>
  );

}

type Summary = { text: string; warn?: boolean } | null;

/** One group of rows, like an iOS Settings group: a card with hairlines between rows. */
function SettingsGroup({ children }: { children: ReactNode }) {
  return <Card className="overflow-hidden p-0 [&>*+*]:border-t [&>*+*]:border-border">{children}</Card>;
}

const rowClass =
  "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 active:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function RowLabel({ icon: Icon, title, summary, destructive }: { icon: ComponentType<{ className?: string }>; title: string; summary?: Summary; destructive?: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <Icon className={cn("h-5 w-5 shrink-0", destructive ? "text-destructive" : "text-muted-foreground")} aria-hidden />
      <span className={cn("shrink-0 text-[15px] font-medium", destructive && "text-destructive")}>{title}</span>
      {summary?.text ? (
        <span className={cn("ml-auto min-w-0 truncate text-right text-[13px]", summary.warn ? "font-medium text-warning" : "text-muted-foreground")}>
          {summary.text}
        </span>
      ) : null}
    </span>
  );
}

/** A row that opens its section in place (collapsed until tapped). */
function SettingsSection({
  id,
  icon,
  title,
  summary,
  destructive,
  children,
}: {
  id: SectionId;
  icon: ComponentType<{ className?: string }>;
  title: string;
  summary?: Summary;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={id} id={id} className="scroll-mt-28 border-b-0">
      <AccordionTrigger className={cn(rowClass, "font-normal hover:no-underline")}>
        <RowLabel icon={icon} title={title} summary={summary} destructive={destructive} />
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-5 pt-1">{children}</AccordionContent>
    </AccordionItem>
  );
}

/** A row that goes to its own page. */
function SettingsLink({ to, icon, title, summary }: { to: string; icon: ComponentType<{ className?: string }>; title: string; summary?: Summary }) {
  return (
    <Link to={to as any} className={rowClass}>
      <RowLabel icon={icon} title={title} summary={summary} />
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** Install the app: a row that opens the install steps (on the web only; the phone app is installed). */
function InstallAppRow() {
  const [open, setOpen] = useState(false);
  const info = usePwaInstall();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={rowClass}>
        <RowLabel icon={Smartphone} title="Install the app" summary={info.isStandalone ? { text: "Installed" } : null} />
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <InstallAppDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** The training days inside "Units & training days": the days, then Change opens the same editor (and the same save). */
function TrainingDaysBlock({ client }: { client: any }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  if (!client) return null;
  const isSet = committedShortDays(client).length > 0 && !!client.training_schedule_completed;
  return (
    <div className="space-y-2">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <div className="text-sm font-medium">Training days</div>
        {!editing && (
          <Button size="sm" variant={isSet ? "outline" : "default"} className="h-9" onClick={() => setEditing(true)}>
            {isSet ? "Change" : "Set your days"}
          </Button>
        )}
      </div>
      <TrainingScheduleCard
        key={editing ? "edit" : "view"}
        client={client}
        editable
        embedded
        defaultEditing={editing}
        onDone={() => {
          setEditing(false);
          qc.invalidateQueries({ queryKey: ["my-client-account"] });
        }}
      />
    </div>
  );
}

function committedShortDays(client: any): string[] {
  return ((client?.committed_training_days ?? []) as string[])
    .filter((d): d is WeekDay => (WEEK_DAYS as readonly string[]).includes(d))
    .slice()
    .sort((a, b) => WEEK_DAYS.indexOf(a) - WEEK_DAYS.indexOf(b))
    .map((d) => SHORT_DAY[d]);
}

function providerLabel(id: string): string {
  const names: Record<string, string> = { oura: "Oura", apple_health: "Apple Health", health_connect: "Health Connect" };
  return names[id] ?? id;
}

type MissingItem = { key: string; label: string; section: SectionId | "goals" };

/**
 * Every missing field in plain English, so the client sees exactly what to fix
 * instead of a vague "Information Missing". Goals & Setup only for a coaching
 * client (it's the coach's onboarding).
 */
function profileMissing(
  client: any,
  goalsStatus: { completed_at: string | null; main_goal: string | null } | null | undefined,
  goalsOn: boolean,
): MissingItem[] {
  if (!client) return [];
  const goalsOk = !!(goalsStatus?.completed_at || goalsStatus?.main_goal);
  const unitsOk = !!client.weight_unit_confirmed_at;
  const photoOk = !!client.profile_picture_url && !client.profile_picture_needs_update;
  const scheduleOk = !!client.training_schedule_completed;
  const isFilled = (v: any) => v !== null && v !== undefined && String(v).trim() !== "";
  const missing: MissingItem[] = [];
  const basic = "basic-information" as const;

  if (!isFilled(client.first_name)) missing.push({ key: "first_name", label: "First name", section: basic });
  if (!isFilled(client.last_name)) missing.push({ key: "last_name", label: "Last name", section: basic });
  if (!isFilled(client.phone)) missing.push({ key: "phone", label: "Phone number", section: basic });
  if (!isFilled(client.date_of_birth)) missing.push({ key: "date_of_birth", label: "Date of birth", section: basic });
  if (!isFilled(client.height_cm)) missing.push({ key: "height_cm", label: "Height", section: basic });
  if (!isFilled(client.address)) missing.push({ key: "address", label: "Street address", section: basic });
  if (!isFilled(client.city)) missing.push({ key: "city", label: "City", section: basic });
  if (!isFilled(client.country)) missing.push({ key: "country", label: "Country", section: basic });
  if (!isFilled(client.timezone)) missing.push({ key: "timezone", label: "Timezone", section: basic });
  if (!isFilled(client.emergency_contact_name)) missing.push({ key: "ec_name", label: "Emergency contact name", section: basic });
  if (!isFilled(client.emergency_contact_phone)) missing.push({ key: "ec_phone", label: "Emergency contact phone", section: basic });
  // anything else isBasicInfoComplete checks still reads as "basic info"
  if (!isBasicInfoComplete(client) && !missing.some((m) => m.section === basic)) {
    missing.push({ key: "basic", label: "Basic info", section: basic });
  }

  if (!photoOk) missing.push({ key: "photo", label: "Profile photo", section: "profile-picture" });
  if (!unitsOk) missing.push({ key: "units", label: "Weight units (lb or kg)", section: "units" });
  if (!scheduleOk) missing.push({ key: "schedule", label: "Training schedule", section: "units" });
  if (goalsOn && !goalsOk) missing.push({ key: "goals", label: "Goals & Training setup", section: "goals" });
  return missing;
}

/**
 * What's still missing from the profile, each item a tap that opens its
 * section. Nothing once it's complete (no standing "all set" banner), and never
 * the coach's review request: that has its own card with "Everything's correct".
 */
function ProfileStatusCard({ missing, onOpen }: { missing: MissingItem[]; onOpen: (id: SectionId) => void }) {
  if (missing.length === 0) return null;

  const chipClass = "inline-flex min-h-9 items-center rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground transition hover:bg-muted";

  return (
    <Card className="space-y-3 border-warning/40 p-4">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1 text-base font-semibold">
          {missing.length === 1 ? "1 thing to finish on your profile" : `${missing.length} things to finish on your profile`}
        </div>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {missing.map((m) => (
          <li key={m.key}>
            {m.section === "goals" ? (
              <Link to="/portal/goals-setup" className={chipClass}>{m.label}</Link>
            ) : (
              <button type="button" onClick={() => onOpen(m.section as SectionId)} className={chipClass}>
                {m.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function goalsSummary(data: { completed_at: string | null; main_goal: string | null } | null | undefined): Summary {
  if (data?.completed_at) return { text: "Complete" };
  if (data?.main_goal) return { text: "In progress", warn: true };
  return { text: "Not started", warn: true };
}

function coachingSetupRows(client: any, coach: any): { label: string; value: string }[] {
  if (!client) return [];
  return [
    { label: "Assigned coach", value: coach?.full_name ?? (client.assigned_coach_id ? "—" : null) },
    { label: "Coaching type", value: client.coaching_type },
    { label: "Current service", value: client.coaching_package },
    { label: "Start date", value: client.start_date ? new Date(client.start_date).toLocaleDateString() : null },
    { label: "Coaching status", value: client.status },
  ].filter((r): r is { label: string; value: string } => !!r.value);
}

/** Coaching setup (read-only: the coach manages it). */
function CoachingSetupRows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {rows.map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Your coach manages these. Contact us if anything looks wrong.</p>
    </div>
  );
}

type ActivePurchase = {
  offer_name: string | null;
  payment_status: string | null;
  payment_structure: string | null;
  payment_frequency: string | null;
  term_end_date: string | null;
  stripe_customer_id: string | null;
  is_recurring: boolean | null;
};

/** The client's current purchase (the Billing row's name and its section). */
function useActivePurchase(clientId?: string) {
  return useQuery({
    queryKey: ["billing-section-purchase", clientId],
    enabled: !!clientId && !isNative(),
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_records")
        .select("offer_name, payment_status, payment_structure, payment_frequency, term_end_date, stripe_customer_id, is_recurring")
        .eq("client_id", clientId!)
        .not("payment_status", "in", "(\"Cancelled\",\"Expired\",\"Refunded\")")
        .order("purchased_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as ActivePurchase | null;
    },
  });
}

function BillingSection({ purchase }: { purchase: ActivePurchase | null }) {
  const portalFn = useServerFn(createCustomerPortalSession);
  const [loading, setLoading] = useState(false);

  const openPortal = async () => {
    setLoading(true);
    try {
      const { url } = await portalFn({ data: { origin: window.location.origin } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open billing portal");
    } finally {
      setLoading(false);
    }
  };

  const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString() : "—";

  if (!purchase) {
    return <p className="text-sm text-muted-foreground">No active billing found.</p>;
  }
  const plan = purchase.payment_frequency ?? purchase.payment_structure ?? "";
  return (
    <div className="space-y-3">
      <div className="space-y-0.5 text-sm">
        <div className="font-semibold">{purchase.offer_name}</div>
        <div className="text-muted-foreground">
          {[plan, purchase.payment_status].filter(Boolean).join(" · ")}
        </div>
        {purchase.is_recurring && purchase.term_end_date && (
          <div className="text-xs text-muted-foreground">Next billing: {fmtDate(purchase.term_end_date)}</div>
        )}
      </div>
      {purchase.stripe_customer_id && (
        <>
          <Button variant="outline" onClick={openPortal} disabled={loading} className="h-10 gap-2">
            <Settings className="h-4 w-4" />{loading ? "Opening..." : "Manage Billing"}
          </Button>
          <p className="text-xs text-muted-foreground">Update your card, see invoices or change your subscription.</p>
        </>
      )}
    </div>
  );
}
