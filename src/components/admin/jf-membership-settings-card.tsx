import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { adminGetJfSettings, adminUpdateJfSettings } from "@/lib/jf-billing.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

export function JfMembershipSettingsCard() {
  const get = useServerFn(adminGetJfSettings);
  const update = useServerFn(adminUpdateJfSettings);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["jf-admin-settings"], queryFn: () => get() });
  const [form, setForm] = useState<any>({});

  useEffect(() => { if (data?.settings) setForm(data.settings); }, [data]);

  const save = useMutation({
    mutationFn: () => update({ data: {
      monthly_price_id: form.monthly_price_id || null,
      monthly_price_display: form.monthly_price_display,
      hold_price_id: form.hold_price_id || null,
      hold_price_display: form.hold_price_display,
      trial_days: Number(form.trial_days ?? 3),
      upgrade_coaching_url: form.upgrade_coaching_url || null,
      support_email: form.support_email || null,
      refund_policy: form.refund_policy,
    }}),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["jf-admin-settings"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!data?.settings) return null;

  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5 p-6 space-y-3 md:col-span-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-emerald-400" />
        <h3 className="text-xs uppercase tracking-widest text-emerald-300">JF Membership</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Configure Stripe price IDs (test or live), trial length, and the refund/cancellation policy shown on signup.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Monthly price ID (Stripe)</Label>
          <Input placeholder="price_…" value={form.monthly_price_id ?? ""} onChange={(e) => setForm({ ...form, monthly_price_id: e.target.value })} />
        </div>
        <div>
          <Label>Display</Label>
          <Input value={form.monthly_price_display ?? ""} onChange={(e) => setForm({ ...form, monthly_price_display: e.target.value })} />
        </div>
        <div>
          <Label>Hold Plan price ID (Stripe)</Label>
          <Input placeholder="price_…" value={form.hold_price_id ?? ""} onChange={(e) => setForm({ ...form, hold_price_id: e.target.value })} />
        </div>
        <div>
          <Label>Display</Label>
          <Input value={form.hold_price_display ?? ""} onChange={(e) => setForm({ ...form, hold_price_display: e.target.value })} />
        </div>
        <div>
          <Label>Trial days</Label>
          <Input type="number" min={0} max={60} value={form.trial_days ?? 3} onChange={(e) => setForm({ ...form, trial_days: e.target.value })} />
        </div>
        <div>
          <Label>Support email</Label>
          <Input type="email" value={form.support_email ?? ""} onChange={(e) => setForm({ ...form, support_email: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <Label>Upgrade to Coaching URL</Label>
          <Input placeholder="https://…" value={form.upgrade_coaching_url ?? ""} onChange={(e) => setForm({ ...form, upgrade_coaching_url: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <Label>Refund / cancellation policy</Label>
          <Textarea rows={4} value={form.refund_policy ?? ""} onChange={(e) => setForm({ ...form, refund_policy: e.target.value })} />
        </div>
      </div>
      <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save settings"}</Button>
      <p className="text-[11px] text-muted-foreground">
        Public signup link: <code>/join</code>. Webhook endpoint is the same Stripe webhook you already configured.
      </p>
    </Card>
  );
}