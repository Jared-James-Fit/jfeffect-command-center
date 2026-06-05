import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, EyeOff, Save, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { ProfilePictureCapture } from "@/components/profile-picture-capture";
import { COMMON_TIMEZONES } from "@/lib/pt-sessions";
import { SocialHandlesEditor } from "@/components/social-handles-editor";
import { SOCIAL_FIELDS } from "@/lib/social-handles";
import { BasicInfoForm } from "@/components/basic-info-form";
import { calcAge, formatHeight } from "@/lib/basic-info";

export const Route = createFileRoute("/_authenticated/portal/account")({
  component: AccountPage,
});

const COUNTRIES = ["Canada", "United States", "United Kingdom", "Australia", "New Zealand", "Other"];
const PROFILE_FIELDS = ["first_name", "last_name", "preferred_name", "phone", "address", "city", "province", "postal_code", "country", "timezone", "date_of_birth", "height_cm", "preferred_height_unit", "emergency_contact_name", "emergency_contact_phone", ...SOCIAL_FIELDS] as const;

function AccountPage() {
  const portalUserId = usePortalUserId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(null);
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "", showCurrent: false, showNext: false });
  const [pwdBusy, setPwdBusy] = useState(false);

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

  const save = async () => {
    const updatedFields = PROFILE_FIELDS.filter((f) => form[f] !== client?.[f]);
    const patch: any = {
      first_name: form.first_name?.trim() || null,
      last_name: form.last_name?.trim() || null,
      full_name: [form.first_name, form.last_name].filter(Boolean).join(" ").trim() || form.full_name,
      preferred_name: form.preferred_name?.trim() || null,
      phone: form.phone || null,
      date_of_birth: form.date_of_birth || null,
      height_cm: form.height_cm ?? null,
      preferred_height_unit: form.preferred_height_unit ?? "imperial",
      emergency_contact_name: form.emergency_contact_name || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
      address: form.address || null,
      city: form.city || null,
      province: form.province || null,
      postal_code: form.postal_code || null,
      country: form.country || null,
      timezone: form.timezone || "America/Winnipeg",
      instagram: form.instagram || null,
      tiktok: form.tiktok || null,
      youtube: form.youtube || null,
      facebook: form.facebook || null,
      twitter_x: form.twitter_x || null,
      linkedin: form.linkedin || null,
      website: form.website || null,
      other_social_label: form.other_social_label || null,
      other_social_handle: form.other_social_handle || null,
      info_last_updated_at: new Date().toISOString(),
      info_last_updated_by: "client",
      info_last_updated_fields: updatedFields,
      info_update_requested: false,
      timezone_confirmed_at: form.timezone !== client?.timezone ? new Date().toISOString() : client?.timezone_confirmed_at,
    };
    const { error } = await supabase.from("clients").update(patch).eq("id", form.id);
    if (error) return toast.error(error.message);
    toast.success("Account information updated");
    qc.invalidateQueries({ queryKey: ["my-client-account"] });
    qc.invalidateQueries({ queryKey: ["my-client"] });
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

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd.next.length < 8) return toast.error("Password must be at least 8 characters");
    if (pwd.next !== pwd.confirm) return toast.error("Passwords don't match");
    setPwdBusy(true);
    // Verify current password by reauthenticating
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: user.email!, password: pwd.current });
    if (signInErr) {
      setPwdBusy(false);
      return toast.error("Current password is incorrect");
    }
    const { error } = await supabase.auth.updateUser({ password: pwd.next });
    setPwdBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    setPwd({ current: "", next: "", confirm: "", showCurrent: false, showNext: false });
  };

  return (
    <>
      <PageHeader
        title="Account Settings"
        subtitle="Manage your contact info, profile picture, and password."
        actions={<Button size="sm" className="bg-gradient-primary uppercase font-bold" onClick={save}><Save className="mr-2 h-4 w-4" />Save changes</Button>}
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
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Contact Information</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>First name</Label><Input value={form.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} /></div>
            <div><Label>Last name</Label><Input value={form.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} /></div>
            <div className="md:col-span-2">
              <Label>Email</Label>
              <Input value={form.email ?? user.email ?? ""} disabled className="bg-secondary/40" />
              <p className="mt-1 text-[11px] text-muted-foreground">To update your email, contact Coach Jared.</p>
            </div>
            <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></div>
            <div>
              <Label>Time zone</Label>
              <Select value={form.timezone ?? "America/Winnipeg"} onValueChange={(v) => set("timezone", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{COMMON_TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
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
          </div>
          <p className="text-[11px] text-muted-foreground">Last updated: {form.info_last_updated_at ? new Date(form.info_last_updated_at).toLocaleString() : "—"} {form.info_last_updated_by ? `by ${form.info_last_updated_by}` : ""}</p>
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

        <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Change Password</h3>
          <form onSubmit={changePassword} className="grid gap-3 md:grid-cols-3">
            <div>
              <Label>Current password</Label>
              <div className="relative">
                <Input type={pwd.showCurrent ? "text" : "password"} value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} required />
                <button type="button" onClick={() => setPwd({ ...pwd, showCurrent: !pwd.showCurrent })} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {pwd.showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <Label>New password</Label>
              <div className="relative">
                <Input type={pwd.showNext ? "text" : "password"} value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} required minLength={8} />
                <button type="button" onClick={() => setPwd({ ...pwd, showNext: !pwd.showNext })} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {pwd.showNext ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <Label>Confirm new password</Label>
              <Input type={pwd.showNext ? "text" : "password"} value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} required minLength={8} />
            </div>
            <div className="md:col-span-3">
              <p className="mb-2 text-[11px] text-muted-foreground">Minimum 8 characters. Use a mix of letters and numbers.</p>
              <Button type="submit" disabled={pwdBusy} className="bg-gradient-primary uppercase font-bold">{pwdBusy ? "Updating…" : "Update password"}</Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}