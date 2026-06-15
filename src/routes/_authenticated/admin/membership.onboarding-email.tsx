import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getMembershipOnboardingEmail,
  updateMembershipOnboardingEmail,
  sendMembershipOnboardingEmailPreview,
} from "@/lib/membership-onboarding-email.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Send, Save, Mail } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/membership/onboarding-email")({
  component: OnboardingEmailAdmin,
});

function OnboardingEmailAdmin() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getMembershipOnboardingEmail);
  const saveSettings = useServerFn(updateMembershipOnboardingEmail);
  const sendPreview = useServerFn(sendMembershipOnboardingEmailPreview);

  const { data, isLoading } = useQuery({
    queryKey: ["membership-onboarding-email-settings"],
    queryFn: () => fetchSettings(),
  });

  const [form, setForm] = useState<any>(null);
  useEffect(() => { if (data) setForm({ ...data }); }, [data]);

  const [saving, setSaving] = useState(false);
  const [previewTo, setPreviewTo] = useState("");
  const [sending, setSending] = useState(false);

  const onSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const { id: _id, updated_at: _u, ...patch } = form;
      await saveSettings({ data: patch });
      qc.invalidateQueries({ queryKey: ["membership-onboarding-email-settings"] });
      toast.success("Onboarding email saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally { setSaving(false); }
  };

  const onSendPreview = async () => {
    if (!previewTo) return toast.error("Enter a recipient email for the preview send");
    setSending(true);
    try {
      const r: any = await sendPreview({ data: { recipientEmail: previewTo } });
      if (r?.sent) toast.success(`Preview queued to ${previewTo}`);
      else toast.error(`Not sent: ${r?.reason ?? "unknown"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send preview");
    } finally { setSending(false); }
  };

  if (isLoading || !form) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-4 p-4 pb-32 md:p-6">
      <PageHeader
        title="Membership Onboarding Email"
        subtitle="Sent automatically when a new member completes JF Membership checkout (subscription_purchased)."
      />
      <Link to="/admin/membership" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
        <ArrowLeft className="h-3 w-3" /> Back to Membership
      </Link>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold">Send onboarding email</div>
            <div className="text-xs text-muted-foreground">
              When off, no membership welcome email is sent. SMS automations are unaffected.
            </div>
          </div>
          <Switch
            checked={!!form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Content</div>
        <Field label="Product name" v={form.product_name}
          onChange={(v) => setForm({ ...form, product_name: v })} />
        <Field label="Subject (use {first_name} to insert the member's first name)" v={form.subject}
          onChange={(v) => setForm({ ...form, subject: v })} />
        <Field label="Preheader (inbox preview text)" v={form.preheader}
          onChange={(v) => setForm({ ...form, preheader: v })} />
        <TextField label="Welcome message" v={form.welcome_message}
          onChange={(v) => setForm({ ...form, welcome_message: v })} />
        <TextField label="Next step" v={form.next_step}
          onChange={(v) => setForm({ ...form, next_step: v })} />
        <TextField label="How to cancel" v={form.cancel_instructions}
          onChange={(v) => setForm({ ...form, cancel_instructions: v })} />
      </Card>

      <Card className="space-y-4 p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Billing display</div>
        <Field label="Monthly price (display only — actual billing comes from Stripe)" v={form.monthly_price_display}
          onChange={(v) => setForm({ ...form, monthly_price_display: v })} />
        <Field label="Trial timezone (IANA, e.g. America/Winnipeg)" v={form.trial_timezone}
          onChange={(v) => setForm({ ...form, trial_timezone: v })} />
        <Field label="Support email" v={form.support_email}
          onChange={(v) => setForm({ ...form, support_email: v })} />
      </Card>

      <div className="sticky bottom-24 z-10 flex flex-wrap justify-end gap-2 md:bottom-0 md:relative">
        <Button onClick={onSave} disabled={saving} className="h-11 font-bold">
          <Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2 text-sm font-bold"><Mail className="h-4 w-4" /> Send a preview</div>
        <div className="text-xs text-muted-foreground">
          Sends the current rendered email to any address you choose. Bypasses dedupe;
          honours the suppression list. Trial date is a fake 3-day-from-now value.
        </div>
        <div className="flex flex-wrap gap-2">
          <Input type="email" placeholder="you@example.com"
            value={previewTo} onChange={(e) => setPreviewTo(e.target.value)}
            className="max-w-xs" />
          <Button variant="outline" onClick={onSendPreview} disabled={sending} className="h-10">
            <Send className="mr-2 h-4 w-4" />{sending ? "Sending…" : "Send preview"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, v, onChange }: { label: string; v: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <Input value={v ?? ""} onChange={(e) => onChange(e.target.value)} className="h-10" />
    </div>
  );
}
function TextField({ label, v, onChange }: { label: string; v: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <Textarea value={v ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} />
    </div>
  );
}