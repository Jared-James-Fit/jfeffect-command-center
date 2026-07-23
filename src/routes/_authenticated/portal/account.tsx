import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { usePortalUserId } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert, CreditCard, Settings, Trash2, CheckCircle2, AlertTriangle, Clock, Briefcase, Calendar } from "lucide-react";
import { isBasicInfoComplete, isIntakeLiftsComplete } from "@/lib/basic-info";
import { isNative } from "@/platform";
import { toast } from "sonner";
import { createCustomerPortalSession } from "@/lib/stripe-checkout.functions";
import { ProfilePictureCapture } from "@/components/profile-picture-capture";
import { SocialHandlesEditor } from "@/components/social-handles-editor";
import { SOCIAL_FIELDS } from "@/lib/social-handles";
import { BasicInfoForm } from "@/components/basic-info-form";
import { ChangePasswordCard } from "@/components/change-password-card";
import { TrainingScheduleCard } from "@/components/training-schedule-card";
import { useAutosave } from "@/hooks/use-autosave";
import { SavedIndicator } from "@/components/saved-indicator";
import { ClientLegalSafety } from "@/components/legal/client-legal-safety";
import { InstallAppCard } from "@/components/portal/install-app-card";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { PushNotificationCard } from "@/components/push/push-notification-card";

export const Route = createFileRoute("/_authenticated/portal/account")({
  component: AccountPage,
});

const PROFILE_FIELDS = ["first_name", "last_name", "preferred_name", "phone", "address", "city", "province", "postal_code", "country", "timezone", "date_of_birth", "height_cm", "preferred_height_unit", "emergency_contact_name", "emergency_contact_phone", ...SOCIAL_FIELDS] as const;

function AccountPage() {
  const portalUserId = usePortalUserId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(null);

  const { data: client } = useQuery({
    queryKey: ["my-client-account", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("user_id", portalUserId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!client) return;
    const [first, ...rest] = (client.full_name ?? "").split(" ");
    setForm({
      ...client,
      first_name: client.first_name ?? first ?? "",
      last_name: client.last_name ?? rest.join(" ") ?? "",
    });
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

  if (!user) return <div className="p-10 text-muted-foreground">Sign in to manage your account.</div>;
  if (!form) return <div className="p-10 text-muted-foreground">Loading…</div>;

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
    setForm({ ...form, profile_picture_url: path });
  };

  return (
    <>
      <PageHeader
        title="Account Settings"
        subtitle="Manage your contact info, profile picture, and password."
        actions={<SavedIndicator state={saveState} />}
      />
      <div className="grid gap-5 px-4 py-4 md:gap-6 md:p-8 md:grid-cols-3">
        {/* Sticky quick-jump navigation so clients can find any section
            fast on mobile without scrolling through the whole page. */}
        <div className="md:col-span-3 sticky top-14 z-20 -mx-4 md:-mx-8 md:top-20">
          <div className="border-y border-border bg-background/95 px-4 py-2 backdrop-blur md:px-8">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {[
                { id: "basic-information", label: "Basic Info" },
                { id: "profile-picture", label: "Photo" },
                { id: "training-schedule", label: "Schedule" },
                { id: "goals-setup", label: "Goals" },
                { id: "password", label: "Password" },
                { id: "notifications", label: "Notifications" },
                { id: "install-app", label: "Install App" },
                { id: "legal-safety", label: "Legal" },
                { id: "billing", label: "Billing" },
                { id: "delete-account", label: "Delete" },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(s.id);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Profile Status ── */}
        <div className="md:col-span-3">
          <ProfileStatusCard
            client={client}
            goalsStatus={goalsStatus}
            infoUpdateRequested={!!form?.info_update_requested}
          />
        </div>

        {form.info_update_requested && (
          <Card className="border-warning/40 bg-warning/10 p-4 md:col-span-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-warning" />
              <div>
                <div className="font-bold">Your coach asked you to review your account info</div>
                <div className="text-xs text-muted-foreground">Please double-check the fields below and hit Save to confirm.</div>
              </div>
            </div>
          </Card>
        )}

        <SectionErrorBoundary label="Basic Information" className="md:col-span-2">
          <Card id="basic-information" className="border-border bg-card p-6 md:col-span-2 space-y-4 scroll-mt-24">
            <div className="flex items-center justify-between">
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Basic Information</h3>
              <SavedIndicator state={saveState} />
            </div>
            <BasicInfoForm
              values={form}
              onChange={(p) => setForm({ ...form, ...p })}
              emailReadOnly={form.email ?? user.email ?? ""}
            />
            <p className="text-[11px] text-muted-foreground">
              Saves automatically. Last updated:{" "}
              {form.info_last_updated_at ? new Date(form.info_last_updated_at).toLocaleString() : "—"}{" "}
              {form.info_last_updated_by ? `by ${form.info_last_updated_by}` : ""}
            </p>
          </Card>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Profile Picture">
          <Card id="profile-picture" className="border-border bg-card p-6 space-y-3 scroll-mt-32">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Profile Picture</h3>
            <ProfilePictureCapture
              mode="client"
              userId={user.id}
              currentUrl={form.profile_picture_url}
              onUploaded={updatePicture}
            />
            <p className="text-[11px] text-muted-foreground">
              Use a clear, real-time headshot. Replacement only — you can't leave this blank.
              Last updated: {form.profile_picture_updated_at ? new Date(form.profile_picture_updated_at).toLocaleString() : "—"}
            </p>
          </Card>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Social Media" className="md:col-span-3">
          <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
            <div>
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Social Media (optional)</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Add just your username/handle — no full URLs needed. Leave any field blank to skip.
              </p>
            </div>
            <SocialHandlesEditor values={form} onChange={(k, v) => set(k, v)} />
          </Card>
        </SectionErrorBoundary>

        <div id="password" className="md:col-span-3 scroll-mt-32">
          <SectionErrorBoundary label="Change Password">
            <ChangePasswordCard />
          </SectionErrorBoundary>
        </div>

        <div id="training-schedule" className="md:col-span-3 scroll-mt-32">
          <SectionErrorBoundary label="Training Schedule">
            <TrainingScheduleCard client={client as any} editable />
          </SectionErrorBoundary>
        </div>

        {/* Goals & Training Setup — links to the dedicated goals-setup page */}
        <div id="goals-setup" className="md:col-span-3 scroll-mt-32">
          <Card className="border-border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Goals &amp; Training Setup</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your training goals, experience level, equipment, nutrition preferences, and coaching setup.
                </p>
              </div>
              {client && (
                <GoalsSetupStatusBadge clientId={(client as any).id} />
              )}
            </div>
            <Link to="/portal/goals-setup">
              <Button className="w-full sm:w-auto" size="lg">
                View &amp; Update Profile &amp; Goals
              </Button>
            </Link>
          </Card>
        </div>

        {/* ── Coaching Setup (read-only) ── */}
        {client && (client.assigned_coach_id || client.coaching_type || client.coaching_package || client.start_date || client.status) && (
          <div className="md:col-span-3">
            <CoachingSetupSection client={client as any} coach={assignedCoach ?? null} />
          </div>
        )}

        <div id="legal-safety" className="md:col-span-3 scroll-mt-32">
          <SectionErrorBoundary label="Legal & Safety">
            <ClientLegalSafety />
          </SectionErrorBoundary>
        </div>

        <div id="install-app" className="md:col-span-3 scroll-mt-32">
          <SectionErrorBoundary label="Install App">
            <InstallAppCard />
          </SectionErrorBoundary>
        </div>

        <div id="notifications" className="md:col-span-3 scroll-mt-32">
          <SectionErrorBoundary label="Push Notifications">
            <PushNotificationCard />
          </SectionErrorBoundary>
        </div>

        {/* ── Billing & Subscription — hidden on native (purchases not available in Android app) ── */}
        {!isNative() && (
          <div id="billing" className="md:col-span-3 scroll-mt-32">
            <SectionErrorBoundary label="Billing & Subscription">
              <BillingSection clientId={client?.id} />
            </SectionErrorBoundary>
          </div>
        )}

        {/* ── Delete Account — required by Google Play and Apple App Store policies ── */}
        <div id="delete-account" className="md:col-span-3 scroll-mt-32">
          <Card className="border-destructive/30 bg-card p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Delete Account</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Permanently delete your JF Effect account and all associated data. This action cannot be undone.
            </p>
            <Button variant="destructive" size="sm" asChild>
              <a href="/account-deletion">Delete my account</a>
            </Button>
          </Card>
        </div>
      </div>
    </>
  );

}

function ProfileStatusCard({
  client,
  goalsStatus,
  infoUpdateRequested,
}: {
  client: any;
  goalsStatus: { completed_at: string | null; main_goal: string | null } | null | undefined;
  infoUpdateRequested: boolean;
}) {
  if (!client) return null;

  const basicOk = isBasicInfoComplete(client);
  const goalsOk = !!(goalsStatus?.completed_at || goalsStatus?.main_goal);

  let status: "complete" | "missing" | "review";
  if (infoUpdateRequested) {
    status = "review";
  } else if (!basicOk || !goalsOk) {
    status = "missing";
  } else {
    status = "complete";
  }

  // Build a granular, plain-English list of every missing field so the
  // client sees exactly what to fix instead of a vague "Information Missing".
  const isFilled = (v: any) => v !== null && v !== undefined && String(v).trim() !== "";
  const isPositive = (v: any) => Number(v) > 0;

  type MissingItem = { key: string; label: string; section: "basic" | "lifts" | "goals" };
  const missing: MissingItem[] = [];

  if (!isFilled(client.first_name)) missing.push({ key: "first_name", label: "First name", section: "basic" });
  if (!isFilled(client.last_name)) missing.push({ key: "last_name", label: "Last name", section: "basic" });
  if (!isFilled(client.phone)) missing.push({ key: "phone", label: "Phone number", section: "basic" });
  if (!isFilled(client.date_of_birth)) missing.push({ key: "date_of_birth", label: "Date of birth", section: "basic" });
  if (!isFilled(client.height_cm)) missing.push({ key: "height_cm", label: "Height", section: "basic" });
  if (!isFilled(client.address)) missing.push({ key: "address", label: "Street address", section: "basic" });
  if (!isFilled(client.city)) missing.push({ key: "city", label: "City", section: "basic" });
  if (!isFilled(client.country)) missing.push({ key: "country", label: "Country", section: "basic" });
  if (!isFilled(client.timezone)) missing.push({ key: "timezone", label: "Timezone", section: "basic" });
  if (!isFilled(client.emergency_contact_name)) missing.push({ key: "ec_name", label: "Emergency contact name", section: "basic" });
  if (!isFilled(client.emergency_contact_phone)) missing.push({ key: "ec_phone", label: "Emergency contact phone", section: "basic" });

  if (!isIntakeLiftsComplete(client)) {
    if (client.intake_lifts_known === false) {
      if (!isPositive(client.intake_squat_5rm)) missing.push({ key: "sq5", label: "Squat × 5 max", section: "lifts" });
      if (!isPositive(client.intake_bench_5rm)) missing.push({ key: "bn5", label: "Bench × 5 max", section: "lifts" });
      if (!isPositive(client.intake_deadlift_5rm)) missing.push({ key: "dl5", label: "Deadlift × 5 max", section: "lifts" });
    } else {
      if (client.intake_lift_unit !== "kg" && client.intake_lift_unit !== "lb") {
        missing.push({ key: "unit", label: "Lift units (lb or kg)", section: "lifts" });
      }
      if (!isPositive(client.intake_squat_1rm)) missing.push({ key: "sq1", label: "Squat 1-rep max", section: "lifts" });
      if (!isPositive(client.intake_bench_1rm)) missing.push({ key: "bn1", label: "Bench 1-rep max", section: "lifts" });
      if (!isPositive(client.intake_deadlift_1rm)) missing.push({ key: "dl1", label: "Deadlift 1-rep max", section: "lifts" });
    }
  }

  if (!goalsOk) missing.push({ key: "goals", label: "Goals & Training setup", section: "goals" });

  const hasBasic = missing.some((m) => m.section === "basic" || m.section === "lifts");
  const hasGoals = missing.some((m) => m.section === "goals");

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Card className={[
      "p-5 space-y-4",
      status === "complete" ? "border-emerald-500/30 bg-emerald-500/5" :
      status === "review" ? "border-amber-500/40 bg-amber-500/10" :
      "border-amber-500/40 bg-amber-500/10",
    ].join(" ")}>
      <div className="flex items-start gap-3">
        {status === "complete" && <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-500 mt-0.5" />}
        {status === "review" && <Clock className="h-6 w-6 shrink-0 text-amber-500 mt-0.5" />}
        {status === "missing" && <AlertTriangle className="h-6 w-6 shrink-0 text-amber-500 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base">
            {status === "complete" && "Profile complete — you're all set."}
            {status === "review" && "Coach asked you to review your info"}
            {status === "missing" && (
              missing.length === 1
                ? "1 thing to finish on your profile"
                : `${missing.length} things to finish on your profile`
            )}
          </div>
          {status === "missing" && (
            <p className="text-xs text-muted-foreground mt-1">
              Tap any item below to jump straight to the field that needs to be filled in.
            </p>
          )}
          {status === "review" && (
            <p className="text-xs text-muted-foreground mt-1">
              Double-check your details below — autosave will confirm them for your coach.
            </p>
          )}
        </div>
        {status !== "complete" && (
          <Badge
            variant="outline"
            className="border-amber-500/40 text-amber-600 dark:text-amber-400 shrink-0"
          >
            Action needed
          </Badge>
        )}
      </div>

      {status === "missing" && missing.length > 0 && (
        <>
          <ul className="flex flex-wrap gap-1.5">
            {missing.map((m) => (
              <li key={m.key}>
                <button
                  type="button"
                  onClick={() => jumpTo(m.section === "goals" ? "" : "basic-information")}
                  className="rounded-full border border-amber-500/40 bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 transition"
                >
                  {m.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            {hasBasic && (
              <Button
                size="sm"
                onClick={() => jumpTo("basic-information")}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                Fix basic info
              </Button>
            )}
            {hasGoals && (
              <Link to="/portal/goals-setup">
                <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                  Complete Goals & Training
                </Button>
              </Link>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function CoachingSetupSection({ client, coach }: { client: any; coach: any }) {
  const rows: { label: string; value: string | null | undefined }[] = [
    { label: "Assigned coach", value: coach?.full_name ?? (client.assigned_coach_id ? "—" : null) },
    { label: "Coaching type", value: client.coaching_type },
    { label: "Current service", value: client.coaching_package },
    { label: "Start date", value: client.start_date ? new Date(client.start_date).toLocaleDateString() : null },
    { label: "Coaching status", value: client.status },
  ].filter((r) => r.value);

  if (rows.length === 0) return null;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Briefcase className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Coaching Setup</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map(({ label, value }) => (
          <div key={label}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="mt-0.5 text-sm font-medium">{value}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Coaching information is managed by your coach. Contact us if anything looks incorrect.
      </p>
    </Card>
  );
}

function BillingSection({ clientId }: { clientId?: string }) {
  const portalFn = useServerFn(createCustomerPortalSession);
  const [loading, setLoading] = useState(false);

  const { data: primaryPurchase } = useQuery({
    queryKey: ["billing-section-purchase", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_records")
        .select("offer_name, payment_status, payment_structure, payment_frequency, term_end_date, stripe_customer_id, is_recurring")
        .eq("client_id", clientId!)
        .not("payment_status", "in", "(\"Cancelled\",\"Expired\",\"Refunded\")")
        .order("purchased_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

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

  return (
    <Card className="border-border bg-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-primary" />
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Billing &amp; Subscription</h2>
      </div>
      {primaryPurchase ? (
        <>
          <div className="space-y-1 text-sm">
            <div className="font-semibold">{primaryPurchase.offer_name}</div>
            <div className="text-muted-foreground">
              {primaryPurchase.payment_frequency ?? primaryPurchase.payment_structure ?? ""}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] uppercase tracking-wider rounded-full border border-border px-2 py-0.5">{primaryPurchase.payment_status}</span>
              {primaryPurchase.is_recurring && primaryPurchase.term_end_date && (
                <span className="text-xs text-muted-foreground">Next billing: {fmtDate(primaryPurchase.term_end_date)}</span>
              )}
            </div>
          </div>
          {primaryPurchase.stripe_customer_id && (
            <Button size="sm" variant="outline" onClick={openPortal} disabled={loading} className="gap-2">
              <Settings className="h-4 w-4" />{loading ? "Opening..." : "Manage Billing"}
            </Button>
          )}
          <p className="text-xs text-muted-foreground/70">Manage Billing opens the Stripe portal where you can update your payment method, view invoices, and manage your subscription.</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No active billing found. Purchase a coaching plan to see billing details here.</p>
      )}
    </Card>
  );
}

/** Lightweight badge showing goals setup completion status — loads only when the Goals card is visible */
function GoalsSetupStatusBadge({ clientId }: { clientId: string }) {
  const { data } = useQuery({
    queryKey: ["client-goals-setup-status", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("client_goals_setup")
        .select("completed_at, main_goal")
        .eq("client_id", clientId)
        .maybeSingle();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  if (!data) return <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/30">Not started</Badge>;
  if (data.completed_at) return <Badge variant="outline" className="text-xs text-emerald-500 border-emerald-500/30">Complete</Badge>;
  if (data.main_goal) return <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/30">In progress</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">Not started</Badge>;
}
