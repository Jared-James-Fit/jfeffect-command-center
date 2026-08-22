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
import { ArrowLeft, ExternalLink, CheckCircle2, AlertTriangle, FileSignature, Receipt, FileText, Download } from "lucide-react";
import { toast } from "sonner";
import { resolvePaymentDisplay, formatMoney } from "@/lib/payment-display";
import { useServerFn } from "@tanstack/react-start";
import { resolvePaymentShareLink } from "@/lib/payment-share.functions";
import { sanitizeShareUrl } from "@/lib/payment-share-link";

export const Route = createFileRoute("/_authenticated/portal/purchases/$id")({ component: ClientPurchase });

function ClientPurchase() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const resolveShareFn = useServerFn(resolvePaymentShareLink);

  const { data: r } = useQuery({
    queryKey: ["my-purchase", id],
    queryFn: async () => (await supabase.from("purchase_records").select("*, clients(full_name, email, agreement_signed, agreement_signed_date, agreement_version, agreement_link)").eq("id", id).single()).data,
  });

  const { data: latestLedger } = useQuery({
    queryKey: ["my-purchase-ledger", id],
    queryFn: async () =>
      (
        await supabase
          .from("payment_ledger")
          .select("method, receipt_url, hosted_invoice_url, invoice_pdf_url, transaction_date, voided")
          .eq("purchase_id", id)
          .eq("voided", false)
          .order("transaction_date", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
  });

  if (!r) return <div className="p-10 text-muted-foreground">Loading…</div>;

  const c = r.clients as any;
  const d = resolvePaymentDisplay({ ...r, latest_ledger: latestLedger ?? null });
  const accept = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("accept_my_purchase", { p_purchase_id: id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Acceptance recorded");
    qc.invalidateQueries({ queryKey: ["my-purchase", id] });
    qc.invalidateQueries({ queryKey: ["my-purchases"] });
  };

  const goToStripe = async () => {
    // Never open the stored (possibly expired) Checkout Session URL — resolve
    // the canonical current link server-side first.
    const t = toast.loading("Opening secure payment…");
    try {
      const res: any = await resolveShareFn({ data: { purchaseRecordId: id } });
      const url = sanitizeShareUrl(res?.url);
      if (!url) throw new Error("Your coach needs to send a fresh payment link.");
      toast.dismiss(t);
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open payment", { id: t });
    }
  };

  const accepted = r.terms_accepted;
  const paid = d.isPaidInFull || d.status === "paid" || d.status === "active_subscription";

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
                <div className="text-xs text-muted-foreground">
                  Paid on {d.paymentDate ? new Date(d.paymentDate).toLocaleString() : "—"}
                  {d.paymentMethodLabel ? ` · ${d.paymentMethodLabel}` : ""}
                </div>
              </div>
            </Card>
          )}

          <Card className="border-border bg-card p-6 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Payment</div>
                <div className="text-4xl font-black mt-1">{formatMoney(d.amountPaid, d.currency)}</div>
                <div className="text-xs text-muted-foreground mt-1">paid of {formatMoney(d.contractTotal, d.currency)}</div>
              </div>
              <Badge variant="outline" className={d.statusTone}>{d.statusLabel}</Badge>
            </div>

            {d.amountOutstanding > 0 && (
              <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <span className="text-muted-foreground">Outstanding balance:</span>{" "}
                <span className="font-semibold text-destructive">{formatMoney(d.amountOutstanding, d.currency)}</span>
              </div>
            )}

            {d.renewal.kind !== "none" && (
              <div className="text-sm">
                <span className="text-muted-foreground">{d.renewal.label}:</span>{" "}
                <span className={`font-semibold ${d.renewal.tone}`}>{d.renewal.valueText}</span>
              </div>
            )}

            {d.paymentMethodLabel && (
              <div className="text-xs text-muted-foreground">Method: {d.paymentMethodLabel}</div>
            )}

            {(d.receiptUrl || d.hostedInvoiceUrl || d.invoicePdfUrl) && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                {d.receiptUrl && (
                  <a href={d.receiptUrl} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline"><Receipt className="mr-1 h-3.5 w-3.5" /> Receipt</Button>
                  </a>
                )}
                {d.hostedInvoiceUrl && (
                  <a href={d.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline"><FileText className="mr-1 h-3.5 w-3.5" /> Invoice</Button>
                  </a>
                )}
                {d.invoicePdfUrl && (
                  <a href={d.invoicePdfUrl} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline"><Download className="mr-1 h-3.5 w-3.5" /> PDF</Button>
                  </a>
                )}
              </div>
            )}
          </Card>

          {d.productDescription ? (
            <Card className="border-border bg-card p-6 whitespace-pre-wrap text-sm">{d.productDescription}</Card>
          ) : null}

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