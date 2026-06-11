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
import { Sparkles, AlertTriangle, CheckCircle2, Circle } from "lucide-react";

export function JfMembershipSettingsCard() {
  const get = useServerFn(adminGetJfSettings);
  const update = useServerFn(adminUpdateJfSettings);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["jf-admin-settings"], queryFn: () => get() });
  const [form, setForm] = useState<any>({});

  useEffect(() => { if (data?.settings) setForm(data.settings); }, [data]);

  const monthlyOk = typeof form.monthly_price_id === "string" && form.monthly_price_id.startsWith("price_");
  const holdOk = typeof form.hold_price_id === "string" && form.hold_price_id.startsWith("price_");
  const monthlyInvalid = !!form.monthly_price_id && !monthlyOk;
  const holdInvalid = !!form.hold_price_id && !holdOk;
  const trialDaysNum = Number(form.trial_days ?? 3);
  const trialOk = Number.isFinite(trialDaysNum) && trialDaysNum >= 0 && trialDaysNum <= 60;
  const canSave = !monthlyInvalid && !holdInvalid && trialOk;
  const fullyConfigured = monthlyOk && holdOk && trialOk;

  const save = useMutation({
    mutationFn: () => {
      if (form.monthly_price_id && !monthlyOk) throw new Error("Monthly price ID must start with price_");
      if (form.hold_price_id && !holdOk) throw new Error("Hold Plan price ID must start with price_");
      if (!trialOk) throw new Error("Trial days must be a number between 0 and 60");
      return update({ data: {
      monthly_price_id: form.monthly_price_id || null,
      monthly_price_display: form.monthly_price_display,
      hold_price_id: form.hold_price_id || null,
      hold_price_display: form.hold_price_display,
      trial_days: trialDaysNum,
      upgrade_coaching_url: form.upgrade_coaching_url || null,
      support_email: form.support_email || null,
      refund_policy: form.refund_policy,
    }});
    },
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

      {!fullyConfigured && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <div className="font-bold">JF Membership pricing is not configured.</div>
            <div className="opacity-90">Add Stripe price IDs before sending the public signup link (/join). Until then, public checkout will be blocked with a clean error message.</div>
          </div>
        </div>
      )}

      <div className="rounded-md border border-border bg-background/50 p-3 text-xs">
        <div className="mb-2 font-bold uppercase tracking-widest text-muted-foreground">Setup checklist</div>
        <ul className="space-y-1.5">
          <ChecklistItem done={false}>
            In Stripe, create product <strong>JF Membership</strong> with a recurring monthly price of <strong>$29 USD</strong>. Copy the price ID (starts with <code>price_</code>).
          </ChecklistItem>
          <ChecklistItem done={false}>
            In Stripe, create product <strong>JF Membership Hold Plan</strong> with a recurring monthly price of <strong>$9 USD</strong>. Copy that price ID.
          </ChecklistItem>
          <ChecklistItem done={monthlyOk}>
            Paste the $29 monthly price ID into <strong>Monthly price ID</strong> below.
          </ChecklistItem>
          <ChecklistItem done={holdOk}>
            Paste the $9 Hold Plan price ID into <strong>Hold Plan price ID</strong> below.
          </ChecklistItem>
          <ChecklistItem done={trialDaysNum === 3}>
            Confirm <strong>Trial days = 3</strong> (default).
          </ChecklistItem>
          <ChecklistItem done={fullyConfigured}>
            Save settings, then test the public link <code>/join</code>.
          </ChecklistItem>
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Use Stripe test-mode price IDs while validating; switch to live IDs only when you're ready to take real payments. Stripe secret keys are never exposed in the app.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Monthly price ID (Stripe)</Label>
          <Input
            placeholder="price_…"
            value={form.monthly_price_id ?? ""}
            onChange={(e) => setForm({ ...form, monthly_price_id: e.target.value.trim() })}
            className={monthlyInvalid ? "border-destructive" : undefined}
          />
          {monthlyInvalid && <p className="mt-1 text-[11px] text-destructive">Must start with <code>price_</code></p>}
        </div>
        <div>
          <Label>Display</Label>
          <Input value={form.monthly_price_display ?? ""} onChange={(e) => setForm({ ...form, monthly_price_display: e.target.value })} />
        </div>
        <div>
          <Label>Hold Plan price ID (Stripe)</Label>
          <Input
            placeholder="price_…"
            value={form.hold_price_id ?? ""}
            onChange={(e) => setForm({ ...form, hold_price_id: e.target.value.trim() })}
            className={holdInvalid ? "border-destructive" : undefined}
          />
          {holdInvalid && <p className="mt-1 text-[11px] text-destructive">Must start with <code>price_</code></p>}
        </div>
        <div>
          <Label>Display</Label>
          <Input value={form.hold_price_display ?? ""} onChange={(e) => setForm({ ...form, hold_price_display: e.target.value })} />
        </div>
        <div>
          <Label>Trial days (default 3)</Label>
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
      <Button onClick={() => save.mutate()} disabled={save.isPending || !canSave}>{save.isPending ? "Saving…" : "Save settings"}</Button>
      <p className="text-[11px] text-muted-foreground">
        Public signup link: <code>/join</code>. Webhook endpoint is the same Stripe webhook you already configured.
      </p>
    </Card>
  );
}

function ChecklistItem({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {done
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
      <span className={done ? "text-muted-foreground line-through" : ""}>{children}</span>
    </li>
  );
}