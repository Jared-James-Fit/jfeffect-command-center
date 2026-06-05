import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { X, Plus } from "lucide-react";
import {
  OFFER_TYPES, OFFER_STATUSES, PAYMENT_STRUCTURES, PAYMENT_FREQUENCIES,
  TERM_DURATION_UNITS, DEFAULT_PURCHASE_DISCLAIMER, type OfferLike, blankOffer,
} from "@/lib/offers";

function BulletList({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...(value ?? []), t]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder} />
        <Button type="button" size="sm" variant="outline" onClick={add}><Plus className="h-4 w-4" /></Button>
      </div>
      {value?.length > 0 && (
        <ul className="space-y-1">
          {value.map((item, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded border border-border bg-secondary/30 px-2 py-1 text-sm">
              <span>• {item}</span>
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OfferForm({ initial, onSubmit, submitting, submitLabel = "Save offer" }: {
  initial?: Partial<OfferLike>;
  onSubmit: (v: OfferLike) => void;
  submitting?: boolean;
  submitLabel?: string;
}) {
  const [form, setForm] = useState<OfferLike>({ ...blankOffer(), ...initial });
  useEffect(() => { if (initial) setForm({ ...blankOffer(), ...initial }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof OfferLike>(k: K, v: OfferLike[K]) => setForm((f) => ({ ...f, [k]: v }));
  const isInPerson = ["In-Person Personal Training", "In-Person Session Package", "Hybrid Coaching"].includes(form.offer_type ?? "");

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}
      className="space-y-6"
    >
      <Section title="Basic Information">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2"><Label>Offer name *</Label><Input required value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div>
            <Label>Offer type</Label>
            <Select value={form.offer_type ?? ""} onValueChange={(v) => set("offer_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{OFFER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status ?? "Active"} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{OFFER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2"><Label>Short description</Label><Input value={form.short_description ?? ""} onChange={(e) => set("short_description", e.target.value)} placeholder="One-line summary shown on cards" /></div>
          <div className="md:col-span-2"><Label>Full description</Label><Textarea rows={3} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} /></div>
          <div><Label>Currency</Label><Input value={form.currency ?? "USD"} onChange={(e) => set("currency", e.target.value)} /></div>
          <div><Label>Price (display)</Label><Input type="number" step="0.01" value={form.price ?? ""} onChange={(e) => set("price", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><Label>Full payable amount</Label><Input type="number" step="0.01" value={form.full_payable_amount ?? ""} onChange={(e) => set("full_payable_amount", e.target.value ? Number(e.target.value) : null)} /></div>
          <div>
            <Label>Payment structure</Label>
            <Select value={form.payment_structure ?? ""} onValueChange={(v) => set("payment_structure", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_STRUCTURES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2"><Label>Stripe payment link</Label><Input value={form.stripe_payment_link ?? ""} onChange={(e) => set("stripe_payment_link", e.target.value)} placeholder="https://buy.stripe.com/…" /></div>
          <div><Label>Stripe product ID</Label><Input value={form.stripe_product_id ?? ""} onChange={(e) => set("stripe_product_id", e.target.value)} /></div>
          <div><Label>Stripe price ID</Label><Input value={form.stripe_price_id ?? ""} onChange={(e) => set("stripe_price_id", e.target.value)} /></div>
          <div className="md:col-span-2"><Label>Internal admin notes</Label><Textarea rows={2} value={form.admin_notes ?? ""} onChange={(e) => set("admin_notes", e.target.value)} /></div>
        </div>
      </Section>

      <Section title="Product / Service Term">
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>Start date</Label><Input type="date" value={form.term_start_date ?? ""} onChange={(e) => set("term_start_date", e.target.value || null)} /></div>
          <div><Label>End date</Label><Input type="date" value={form.term_end_date ?? ""} onChange={(e) => set("term_end_date", e.target.value || null)} /></div>
          <div><Label>Term duration</Label><Input type="number" value={form.term_duration ?? ""} onChange={(e) => set("term_duration", e.target.value ? Number(e.target.value) : null)} /></div>
          <div>
            <Label>Term duration unit</Label>
            <Select value={form.term_duration_unit ?? ""} onValueChange={(v) => set("term_duration_unit", v)}>
              <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
              <SelectContent>{TERM_DURATION_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Access length</Label><Input value={form.access_length ?? ""} onChange={(e) => set("access_length", e.target.value)} placeholder="e.g. Lifetime access" /></div>
          <div><Label>Renewal date</Label><Input type="date" value={form.renewal_date ?? ""} onChange={(e) => set("renewal_date", e.target.value || null)} /></div>
          <div><Label>Expiration date</Label><Input type="date" value={form.expiration_date ?? ""} onChange={(e) => set("expiration_date", e.target.value || null)} /></div>
          <div><Label>Package expiry date</Label><Input type="date" value={form.package_expiry_date ?? ""} onChange={(e) => set("package_expiry_date", e.target.value || null)} /></div>
          <div><Label>Minimum commitment length</Label><Input value={form.minimum_commitment_length ?? ""} onChange={(e) => set("minimum_commitment_length", e.target.value)} /></div>
          <div className="flex items-end gap-3"><Switch checked={!!form.is_recurring} onCheckedChange={(v) => set("is_recurring", v)} /><Label>Recurring?</Label></div>
          <div className="md:col-span-2"><Label>Cancellation policy summary</Label><Textarea rows={2} value={form.cancellation_policy ?? ""} onChange={(e) => set("cancellation_policy", e.target.value)} /></div>
        </div>
      </Section>

      <Section title="Payment Details">
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>Amount due today</Label><Input type="number" step="0.01" value={form.amount_due_today ?? ""} onChange={(e) => set("amount_due_today", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><Label>Deposit amount</Label><Input type="number" step="0.01" value={form.deposit_amount ?? ""} onChange={(e) => set("deposit_amount", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><Label>Number of payments</Label><Input type="number" value={form.number_of_payments ?? ""} onChange={(e) => set("number_of_payments", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><Label>Payment amount</Label><Input type="number" step="0.01" value={form.payment_amount ?? ""} onChange={(e) => set("payment_amount", e.target.value ? Number(e.target.value) : null)} /></div>
          <div>
            <Label>Payment frequency</Label>
            <Select value={form.payment_frequency ?? ""} onValueChange={(v) => set("payment_frequency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Billing day (1–31)</Label><Input type="number" min={1} max={31} value={form.billing_day ?? ""} onChange={(e) => set("billing_day", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><Label>Payment start date</Label><Input type="date" value={form.payment_start_date ?? ""} onChange={(e) => set("payment_start_date", e.target.value || null)} /></div>
          <div><Label>Final payment date</Label><Input type="date" value={form.final_payment_date ?? ""} onChange={(e) => set("final_payment_date", e.target.value || null)} /></div>
          <div className="flex items-end gap-3"><Switch checked={!!form.taxes_included} onCheckedChange={(v) => set("taxes_included", v)} /><Label>Taxes included</Label></div>
          <div className="md:col-span-2"><Label>Payment processing note</Label><Input value={form.payment_processing_note ?? ""} onChange={(e) => set("payment_processing_note", e.target.value)} /></div>
          <div className="md:col-span-2"><Label>Late / failed payment policy</Label><Textarea rows={2} value={form.late_failed_policy ?? ""} onChange={(e) => set("late_failed_policy", e.target.value)} /></div>
          <div className="md:col-span-2"><Label>Refund policy summary</Label><Textarea rows={2} value={form.refund_policy ?? ""} onChange={(e) => set("refund_policy", e.target.value)} /></div>
        </div>
        <div className="rounded-md border border-border bg-secondary/20 p-3 mt-3 space-y-3">
          <div className="flex items-center gap-3">
            <Switch checked={!!form.is_fixed_term_commitment} onCheckedChange={(v) => set("is_fixed_term_commitment", v)} />
            <Label>Is this a fixed-term commitment?</Label>
          </div>
          {form.is_fixed_term_commitment && (
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label>Commitment term length</Label><Input value={form.commitment_term_length ?? ""} onChange={(e) => set("commitment_term_length", e.target.value)} placeholder="e.g. 12 months" /></div>
              <div><Label>Total payable amount</Label><Input type="number" step="0.01" value={form.full_payable_amount ?? ""} onChange={(e) => set("full_payable_amount", e.target.value ? Number(e.target.value) : null)} /></div>
              <div><Label>Commitment start date</Label><Input type="date" value={form.commitment_start_date ?? ""} onChange={(e) => set("commitment_start_date", e.target.value || null)} /></div>
              <div><Label>Commitment end date</Label><Input type="date" value={form.commitment_end_date ?? ""} onChange={(e) => set("commitment_end_date", e.target.value || null)} /></div>
              <div><Label>Installment amount</Label><Input type="number" step="0.01" value={form.installment_amount ?? ""} onChange={(e) => set("installment_amount", e.target.value ? Number(e.target.value) : null)} /></div>
              <div>
                <Label>Installment frequency</Label>
                <Select value={form.installment_frequency ?? ""} onValueChange={(v) => set("installment_frequency", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Installment due day</Label><Input type="number" min={1} max={31} value={form.installment_due_day ?? ""} onChange={(e) => set("installment_due_day", e.target.value ? Number(e.target.value) : null)} /></div>
              <p className="md:col-span-2 text-xs text-muted-foreground">Installments are payments toward the full payable amount.</p>
            </div>
          )}
        </div>
      </Section>

      {isInPerson && (
        <Section title="In-Person / Session Package">
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>Location</Label><Input value={form.location ?? ""} onChange={(e) => set("location", e.target.value)} /></div>
            <div><Label>Session length (minutes)</Label><Input type="number" value={form.session_length_minutes ?? ""} onChange={(e) => set("session_length_minutes", e.target.value ? Number(e.target.value) : null)} /></div>
            <div><Label>Sessions included</Label><Input type="number" value={form.sessions_included ?? ""} onChange={(e) => set("sessions_included", e.target.value ? Number(e.target.value) : null)} /></div>
            <div><Label>Cancellation window</Label><Input value={form.cancellation_window ?? ""} onChange={(e) => set("cancellation_window", e.target.value)} placeholder="e.g. 24 hours" /></div>
            <div className="md:col-span-2"><Label>No-show policy</Label><Textarea rows={2} value={form.no_show_policy ?? ""} onChange={(e) => set("no_show_policy", e.target.value)} /></div>
            <div className="md:col-span-2"><Label>Late arrival policy</Label><Textarea rows={2} value={form.late_arrival_policy ?? ""} onChange={(e) => set("late_arrival_policy", e.target.value)} /></div>
            <div className="md:col-span-2"><Label>Rescheduling policy</Label><Textarea rows={2} value={form.rescheduling_policy ?? ""} onChange={(e) => set("rescheduling_policy", e.target.value)} /></div>
            <div className="md:col-span-2"><Label>Transferability policy</Label><Textarea rows={2} value={form.transferability_policy ?? ""} onChange={(e) => set("transferability_policy", e.target.value)} /></div>
            <div className="md:col-span-2"><Label>Gym access / drop-in note</Label><Textarea rows={2} value={form.gym_access_note ?? ""} onChange={(e) => set("gym_access_note", e.target.value)} /></div>
          </div>
        </Section>
      )}

      <Section title="What's Included">
        <BulletList value={form.included_features ?? []} onChange={(v) => set("included_features", v)} placeholder="e.g. Custom training program" />
      </Section>

      <Section title="What's Not Included">
        <BulletList value={form.excluded_features ?? []} onChange={(v) => set("excluded_features", v)} placeholder="e.g. Medical advice" />
      </Section>

      <Section title="Agreement & Disclaimer">
        <div className="flex items-center gap-3 mb-3">
          <Switch checked={!!form.requires_agreement} onCheckedChange={(v) => set("requires_agreement", v)} />
          <Label>Requires signed Coaching Agreement</Label>
        </div>
        <div className="flex items-center gap-3 mb-3">
          <Switch
            checked={!!form.agreement_before_service}
            onCheckedChange={(v) => set("agreement_before_service", v)}
            disabled={!form.requires_agreement}
          />
          <Label className={!form.requires_agreement ? "text-muted-foreground" : ""}>
            Must be signed before service start (blocks start if missing)
          </Label>
        </div>
        <DefaultAgreementTemplatePicker
          value={form.default_agreement_template_id ?? null}
          onChange={(v) => set("default_agreement_template_id", v)}
        />
        <Label>Purchase disclaimer (shown to client)</Label>
        <Textarea rows={5} value={form.purchase_disclaimer ?? DEFAULT_PURCHASE_DISCLAIMER} onChange={(e) => set("purchase_disclaimer", e.target.value)} />
      </Section>

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting} className="bg-gradient-primary font-bold uppercase">{submitting ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border bg-card p-5">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{title}</h3>
      {children}
    </Card>
  );
}

function DefaultAgreementTemplatePicker({
  value,
  onChange,
}: { value: string | null; onChange: (v: string | null) => void }) {
  const { data: templates = [] } = useQuery({
    queryKey: ["agreement-templates-for-offer"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agreement_templates")
        .select("id, name, agreement_type, is_active, archived")
        .eq("archived", false)
        .order("name");
      return data ?? [];
    },
  });
  return (
    <div className="mb-3">
      <Label>Default agreement template (optional)</Label>
      <Select value={value ?? "__none__"} onValueChange={(v) => onChange(v === "__none__" ? null : v)}>
        <SelectTrigger><SelectValue placeholder="No default — admin picks per purchase" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">No default</SelectItem>
          {templates.map((t: any) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}{t.is_active ? "" : " (inactive)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1 text-xs text-muted-foreground">When set, a draft agreement is auto-created on each new purchase of this offer.</p>
    </div>
  );
}