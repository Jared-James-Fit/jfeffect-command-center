import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { PAYMENT_RECORD_STATUSES, PURCHASE_RECORD_STATUSES } from "@/lib/offers";

export const Route = createFileRoute("/_authenticated/admin/purchases/$id")({ component: PurchaseDetail });

function PurchaseDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(null);
  const { data } = useQuery({
    queryKey: ["purchase-record", id],
    queryFn: async () => (await supabase.from("purchase_records").select("*, clients(id, full_name, email)").eq("id", id).single()).data,
  });
  useEffect(() => { if (data) setForm(data); }, [data]);
  if (!form) return <div className="p-10 text-muted-foreground">Loading…</div>;

  const save = async () => {
    const { id: _i, created_at, updated_at, clients, ...patch } = form;
    if (patch.payment_status === "Paid" && !patch.paid_at) patch.paid_at = new Date().toISOString();
    const { error } = await supabase.from("purchase_records").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["purchase-record", id] });
    qc.invalidateQueries({ queryKey: ["purchase-records"] });
  };

  const del = async () => {
    if (!confirm("Delete this purchase record? This cannot be undone.")) return;
    const { error } = await supabase.from("purchase_records").delete().eq("id", id);
    if (error) return toast.error(error.message);
    window.location.href = "/admin/purchases";
  };

  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

  return (
    <>
      <PageHeader
        title={form.offer_name}
        subtitle={`Purchase by ${form.clients?.full_name ?? "—"} · ${new Date(form.purchased_at).toLocaleString()}`}
        actions={
          <>
            <Link to="/admin/purchases"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />Back</Button></Link>
            <Button variant="outline" size="sm" className="text-destructive" onClick={del}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
            <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={save}>Save</Button>
          </>
        }
      />
      <div className="p-6 md:p-8 grid gap-6 md:grid-cols-3">
        <Card className="border-border bg-card p-5 md:col-span-2 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Snapshot</h3>
          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <Field label="Offer type" v={form.offer_type} />
            <Field label="Offer version" v={`v${form.offer_version ?? 1}`} />
            <Field label="Amount" v={`${form.currency ?? "USD"} ${Number(form.full_payable_amount ?? 0).toLocaleString()}`} />
            <Field label="Payment structure" v={form.payment_structure} />
            <Field label="Payment frequency" v={form.payment_frequency} />
            <Field label="Term" v={form.term_duration_text} />
            <Field label="Start" v={form.term_start_date} />
            <Field label="End" v={form.term_end_date} />
            <Field label="Location" v={form.location} />
          </div>
          {form.included_features?.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mt-3 mb-1">Included</div>
              <ul className="text-sm space-y-0.5">{form.included_features.map((f: string, i: number) => <li key={i}>• {f}</li>)}</ul>
            </div>
          )}
          {form.excluded_features?.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mt-3 mb-1">Not included</div>
              <ul className="text-sm space-y-0.5">{form.excluded_features.map((f: string, i: number) => <li key={i}>• {f}</li>)}</ul>
            </div>
          )}
        </Card>
        <div className="space-y-6">
          <Card className="border-border bg-card p-5 space-y-3">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Payment</h3>
            <div>
              <Label>Payment status</Label>
              <Select value={form.payment_status} onValueChange={(v) => set("payment_status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_RECORD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Record status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PURCHASE_RECORD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Amount paid</Label><Input type="number" step="0.01" value={form.amount_paid ?? 0} onChange={(e) => set("amount_paid", Number(e.target.value))} /></div>
            {form.stripe_payment_link && (
              <a href={form.stripe_payment_link} target="_blank" rel="noreferrer"><Button variant="outline" size="sm" className="w-full">Stripe link <ExternalLink className="ml-2 h-3 w-3" /></Button></a>
            )}
          </Card>
          {form.package_tracking_enabled && (
            <Card className="border-border bg-card p-5 space-y-3">
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Sessions</h3>
              {[
                ["sessions_purchased", "Purchased"],
                ["sessions_booked", "Booked"],
                ["sessions_completed", "Completed"],
                ["sessions_used", "Used"],
                ["sessions_missed", "Missed"],
                ["sessions_cancelled", "Cancelled"],
              ].map(([k, label]) => (
                <div key={k}><Label>{label}</Label><Input type="number" value={form[k as string] ?? 0} onChange={(e) => set(k as string, Number(e.target.value))} /></div>
              ))}
              <div className="text-xs text-muted-foreground">
                Remaining: <span className="font-bold text-foreground">{Math.max(0, (form.sessions_purchased ?? 0) - (form.sessions_used ?? 0))}</span>
              </div>
            </Card>
          )}
          <Card className="border-border bg-card p-5 space-y-2">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Agreement & acceptance</h3>
            <div className="text-sm flex items-center gap-2">Agreement: <Badge variant="outline" className={form.agreement_signed_at_purchase ? "border-primary/40 text-primary" : "border-destructive/40 text-destructive"}>{form.agreement_signed_at_purchase ? "Signed" : "Not signed"}</Badge></div>
            {form.agreement_version && <div className="text-xs text-muted-foreground">Version {form.agreement_version}</div>}
            {form.agreement_link && <a className="text-xs text-primary underline" href={form.agreement_link} target="_blank" rel="noreferrer">View agreement</a>}
            <div className="text-sm flex items-center gap-2 mt-2">Terms accepted: <Badge variant="outline" className={form.terms_accepted ? "border-primary/40 text-primary" : "text-muted-foreground"}>{form.terms_accepted ? "Yes" : "No"}</Badge></div>
            {form.terms_accepted_at && <div className="text-xs text-muted-foreground">on {new Date(form.terms_accepted_at).toLocaleString()}</div>}
          </Card>
          <Card className="border-border bg-card p-5 space-y-2">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Admin notes</h3>
            <Textarea rows={4} value={form.admin_notes ?? ""} onChange={(e) => set("admin_notes", e.target.value)} />
          </Card>
        </div>
      </div>
    </>
  );
}

function Field({ label, v }: { label: string; v: any }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div>{v || "—"}</div>
    </div>
  );
}