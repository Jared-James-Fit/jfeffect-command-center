import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, ExternalLink, CheckCircle2, AlertTriangle, FileSignature } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/portal/purchases/$id")({ component: ClientPurchase });

function ClientPurchase() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: r } = useQuery({
    queryKey: ["my-purchase", id],
    queryFn: async () => (await supabase.from("purchase_records").select("*, clients(full_name, email, agreement_signed, agreement_signed_date, agreement_version, agreement_link)").eq("id", id).single()).data,
  });

  if (!r) return <div className="p-10 text-muted-foreground">Loading…</div>;

  const c = r.clients as any;
  const accept = async () => {
    setBusy(true);
    const { error } = await supabase.from("purchase_records").update({
      terms_accepted: true,
      terms_accepted_at: new Date().toISOString(),
      terms_accepted_client_name: c?.full_name ?? null,
      terms_accepted_client_email: c?.email ?? user?.email ?? null,
    }).eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Acceptance recorded");
    qc.invalidateQueries({ queryKey: ["my-purchase", id] });
    qc.invalidateQueries({ queryKey: ["my-purchases"] });
  };

  const goToStripe = () => {
    if (r.stripe_payment_link) window.open(r.stripe_payment_link, "_blank");
  };

  const accepted = r.terms_accepted;
  const paid = r.payment_status === "Paid";

  return (
    <>
      <PageHeader
        backTo="/portal/purchases"
        backLabel="Back to Purchases"
        title={r.offer_name}
        subtitle={r.offer_type ?? "Purchase summary"}
        actions={<Link to="/portal/purchases"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />Back</Button></Link>}
      />
      <div className="p-6 md:p-8 grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-4">
          {paid && accepted && (
            <Card className="border-primary/40 bg-primary/5 p-5 flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-primary" />
              <div>
                <div className="font-bold">Purchase confirmed</div>
                <div className="text-xs text-muted-foreground">Paid on {r.paid_at ? new Date(r.paid_at).toLocaleString() : "—"}</div>
              </div>
            </Card>
          )}

          <Card className="border-border bg-card p-6 space-y-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Amount</div>
            <div className="text-4xl font-black">{r.currency ?? "USD"} {Number(r.full_payable_amount ?? 0).toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">{r.payment_structure} {r.payment_frequency ? `· ${r.payment_frequency}` : ""}</div>
            {r.amount_due_today != null && r.amount_due_today !== r.full_payable_amount && (
              <div className="text-sm">Due today: <span className="font-bold">{r.currency} {Number(r.amount_due_today).toLocaleString()}</span></div>
            )}
          </Card>

          {r.short_description && <Card className="border-border bg-card p-6"><p>{r.short_description}</p></Card>}
          {r.full_description && <Card className="border-border bg-card p-6 whitespace-pre-wrap text-sm">{r.full_description}</Card>}

          <Card className="border-border bg-card p-6 grid gap-4 sm:grid-cols-2">
            <Field label="Service start" v={r.term_start_date} />
            <Field label="Service end" v={r.term_end_date} />
            <Field label="Term" v={r.term_duration_text} />
            <Field label="Location" v={r.location} />
          </Card>

          {(r.included_features?.length ?? 0) > 0 && (
            <Card className="border-border bg-card p-6">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">What's included</div>
              <ul className="space-y-1 text-sm">{r.included_features!.map((f: string, i: number) => <li key={i}>✓ {f}</li>)}</ul>
            </Card>
          )}
          {(r.excluded_features?.length ?? 0) > 0 && (
            <Card className="border-border bg-card p-6">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Not included</div>
              <ul className="space-y-1 text-sm text-muted-foreground">{r.excluded_features!.map((f: string, i: number) => <li key={i}>• {f}</li>)}</ul>
            </Card>
          )}
          {(r.refund_policy || r.cancellation_policy || r.in_person_policy) && (
            <Card className="border-border bg-card p-6 space-y-3 text-sm">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Policies</div>
              {r.cancellation_policy && <div><div className="font-semibold">Cancellation</div><p className="text-muted-foreground whitespace-pre-wrap">{r.cancellation_policy}</p></div>}
              {r.refund_policy && <div><div className="font-semibold">Refunds</div><p className="text-muted-foreground whitespace-pre-wrap">{r.refund_policy}</p></div>}
              {r.in_person_policy && <div><div className="font-semibold">In-person</div><p className="text-muted-foreground whitespace-pre-wrap">{r.in_person_policy}</p></div>}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className={`p-5 ${c?.agreement_signed ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5"}`}>
            <div className="flex items-center gap-2 mb-2"><FileSignature className="h-4 w-4" /><span className="text-xs uppercase tracking-widest">Coaching Agreement</span></div>
            {c?.agreement_signed ? (
              <>
                <Badge className="bg-gradient-primary">Signed</Badge>
                <p className="text-xs text-muted-foreground mt-2">This purchase is covered by your signed JF Effect / Jared James Fit Coaching Agreement + Liability Waiver.</p>
                {c.agreement_link && <a href={c.agreement_link} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="w-full mt-2">View agreement <ExternalLink className="ml-2 h-3 w-3" /></Button></a>}
              </>
            ) : (
              <>
                <Badge variant="outline" className="border-destructive/40 text-destructive">Not signed</Badge>
                <p className="text-xs text-destructive mt-2">You must complete the JF Effect / Jared James Fit Coaching Agreement + Liability Waiver before services begin.</p>
              </>
            )}
          </Card>

          {!accepted ? (
            <Card className="border-border bg-card p-5 space-y-3">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Confirm to continue</div>
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">{r.purchase_disclaimer}</p>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox checked={agree} onCheckedChange={(v) => setAgree(!!v)} className="mt-1" />
                <span>I understand what is included, what is not included, the payment terms, the service term, and that this purchase is covered by my signed Coaching Agreement.</span>
              </label>
              <Button disabled={!agree || busy} onClick={accept} className="w-full bg-gradient-primary font-bold uppercase">{busy ? "Recording…" : "Accept terms"}</Button>
            </Card>
          ) : (
            <Card className="border-primary/40 bg-primary/5 p-5 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <div className="font-semibold text-sm">Terms accepted</div>
                <div className="text-xs text-muted-foreground">{r.terms_accepted_at ? new Date(r.terms_accepted_at).toLocaleString() : ""}</div>
              </div>
            </Card>
          )}

          {r.stripe_payment_link && (
            <Card className="border-border bg-card p-5 space-y-3">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Payment</div>
              <Badge
                variant="outline"
                className={
                  paid || r.payment_status === "Active Subscription"
                    ? "border-green-500/40 text-green-500 bg-green-500/10"
                    : r.payment_status === "Cancelled"
                      ? "border-border text-muted-foreground"
                      : "border-warning/40 text-warning bg-warning/5"
                }
              >
                {paid ? "Paid · Active" : r.payment_status === "Active Subscription" ? "Active subscription" : r.payment_status === "Cancelled" ? "Cancelled" : "Payment setup needed"}
              </Badge>
              <Button onClick={goToStripe} disabled={!accepted} className="w-full bg-gradient-primary font-bold uppercase">
                {paid ? "Manage payment" : "Pay now"} <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
              {!accepted && <p className="text-xs text-muted-foreground">Accept the terms above to enable payment.</p>}
            </Card>
          )}

          {!r.stripe_payment_link && !paid && (
            <Card className="border-border bg-card p-5 text-sm text-muted-foreground flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5" /> Your coach will send the payment link separately.
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, v }: { label: string; v: any }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm">{v || "—"}</div>
    </div>
  );
}