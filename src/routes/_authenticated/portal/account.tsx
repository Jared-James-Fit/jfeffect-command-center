import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert, CreditCard, Settings } from "lucide-react";
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

  if (!user) return <div className="p-10 text-muted-foreground">Sign in to manage your account.</div>;
  if (!form) return <div className="p-10 text-muted-foreground">Loading…</div>;

  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

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
      <div className="grid gap-6 p-6 md:p-8 md:grid-cols-3">
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

        <Card className="border-border bg-card p-6 md:col-span-2 space-y-4">
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

        <Card className="border-border bg-card p-6 space-y-3">
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

        <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
          <div>
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Social Media (optional)</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Add just your username/handle — no full URLs needed. Leave any field blank to skip.
            </p>
          </div>
          <SocialHandlesEditor values={form} onChange={(k, v) => set(k, v)} />
        </Card>

        <div className="md:col-span-3">
          <ChangePasswordCard />
        </div>

        <div className="md:col-span-3">
          <TrainingScheduleCard client={client as any} editable />
        </div>

        <div className="md:col-span-3">
          <ClientLegalSafety />
        </div>

        {/* ── Billing & Subscription ─────────────────────────────────────── */}
        <BillingSection clientId={client?.id} />
      </div>
    </>
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