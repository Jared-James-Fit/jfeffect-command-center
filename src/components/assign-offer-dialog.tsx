import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ActionButton } from "@/components/action-button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, CreditCard, FileText, Send } from "lucide-react";
import { toast } from "sonner";
import { snapshotOfferForPurchase } from "@/lib/offers";
import { useServerFn } from "@tanstack/react-start";
import { createAgreement } from "@/lib/agreements.functions";
import { createCheckoutSessionForAssignment } from "@/lib/stripe-checkout.functions";
import { createPaymentShareLink } from "@/lib/payment-share.functions";
import { sendPaymentLinkEmail } from "@/lib/payments.functions";
import { runJob } from "@/lib/progress-jobs";
import { autoCalculatePurchaseTermDates } from "@/lib/purchase-term-dates.functions";
import { FIRST50_CODE } from "@/lib/first50-policy";
import { findReusablePurchaseIntent } from "@/lib/purchase-idempotency";

/** What actually happens when the admin confirms. */
type AssignMode = "payment_request" | "paid_in_full" | "draft";

const MODE_COPY: Record<AssignMode, { button: string; title: string; blurb: string; icon: any }> = {
  payment_request: {
    button: "Send payment request",
    title: "Client will receive a Stripe payment request",
    blurb:
      "A Stripe Checkout session is created server-side and linked to this purchase. Nothing is charged until the client completes checkout — the webhook then marks it paid automatically.",
    icon: CreditCard,
  },
  paid_in_full: {
    button: "Create paid record",
    title: "Admin is marking this as already paid",
    blurb:
      "No Stripe checkout is created. A manual paid-in-full record is written, with no renewal unless you set product dates manually.",
    icon: CheckCircle2,
  },
  draft: {
    button: "Create draft record",
    title: "Draft only — no payment request will be sent",
    blurb:
      "Creates an unpaid draft record for planning. It is not marked paid and does not activate paid access.",
    icon: FileText,
  },
};

export function AssignOfferDialog({ offer, onClose, fixedClientId }: { offer: any | null; onClose: () => void; fixedClientId?: string }) {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState<string>(fixedClientId ?? "");
  const [adminNotes, setAdminNotes] = useState("");
  const [mode, setMode] = useState<AssignMode>("payment_request");
  const offerDefaultTemplateId: string | null = offer?.default_agreement_template_id ?? null;
  const [agreementTemplateId, setAgreementTemplateId] = useState<string | null>(offerDefaultTemplateId);
  const [createAgreementOnAssign, setCreateAgreementOnAssign] = useState<boolean>(!!offerDefaultTemplateId);
  const createAgreementFn = useServerFn(createAgreement);
  const createCheckoutFn = useServerFn(createCheckoutSessionForAssignment);
  const shareLinkFn = useServerFn(createPaymentShareLink);
  const [stripeUrl, setStripeUrl] = useState<string | null>(null);
  const autoCalcTermDatesFn = useServerFn(autoCalculatePurchaseTermDates);
  const sendLinkFn = useServerFn(sendPaymentLinkEmail);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [emailNote, setEmailNote] = useState<string | null>(null);
  const [discountCodeId, setDiscountCodeId] = useState<string | null>(null);
  const recordPaid = mode === "paid_in_full";

  const { data: templates = [] } = useQuery({
    queryKey: ["agreement-templates-active-for-assign"],
    queryFn: async () => (await supabase
      .from("agreement_templates")
      .select("id, name, is_active, archived")
      .eq("archived", false).eq("is_active", true)
      .order("name")).data ?? [],
    enabled: !!offer,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-assign-list"],
    enabled: !!offer && !fixedClientId,
    queryFn: async () => (await supabase.from("clients").select("id, full_name, email, agreement_status, agreement_signed").eq("archived", false).order("full_name")).data ?? [],
  });

  const { data: activeDiscounts = [] } = useQuery({
    queryKey: ["assign-offer-active-discounts", offer?.id],
    enabled: !!offer?.id,
    queryFn: async () => (await supabase
      .from("discount_codes")
      .select("id, public_code, eligible_product_ids, applies_to_all_products, status")
      .eq("status", "active")).data ?? [],
  });
  const first50 = (activeDiscounts as any[]).find(
    (discount) =>
      String(discount.public_code ?? "").toUpperCase() === FIRST50_CODE &&
      !discount.applies_to_all_products &&
      (discount.eligible_product_ids ?? []).includes(offer?.id),
  ) ?? null;

  const { data: selectedClient } = useQuery({
    queryKey: ["client-for-assign", clientId],
    enabled: !!clientId,
    queryFn: async () => (await supabase.from("clients").select("id, full_name, email, agreement_status, agreement_signed, agreement_signed_date, agreement_version, agreement_link, timezone").eq("id", clientId).single()).data,
  });

  const submit = async () => {
    if (!offer || !clientId || !selectedClient) return;

    runJob({
      title: MODE_COPY[mode].button,
      description: `${offer.name} → ${selectedClient.full_name}`,
      steps: ["Validate product", "Create assignment", "Create checkout session", "Save purchase record", "Send checkout link", "Finalize"],
    }, async (job) => {
      job.completeStep(0); // Validate product
      
      const { data: { user: u } } = await supabase.auth.getUser();
      const snap = snapshotOfferForPurchase(offer, { clientId, assignedBy: u?.id ?? null, timezone: selectedClient.timezone });
      const payload = {
        ...snap,
        admin_notes: adminNotes || null,
        agreement_signed_at_purchase: !!selectedClient.agreement_signed,
        agreement_signed_date: selectedClient.agreement_signed_date ?? null,
        agreement_version: selectedClient.agreement_version ?? null,
        agreement_link: selectedClient.agreement_link ?? null,
        payment_status:
          mode === "paid_in_full" ? "Paid" : mode === "draft" ? "Draft" : "Pending Payment",
        paid_at: recordPaid ? new Date().toISOString() : null,
        amount_paid: recordPaid ? snap.full_payable_amount ?? 0 : 0,
        last_payment_update_source: recordPaid ? "manual" : "admin_assignment",
        last_payment_update_at: new Date().toISOString(),
      };
      
      job.completeStep(1); // Create assignment

      // A payment REQUEST is not a SALE. Repeated "assign / generate link" runs
      // for the same client + offer must resolve to the SAME purchase intent —
      // otherwise every attempt leaves a permanent duplicate sale row (the
      // Marc Asugui duplicate-sales bug). Rows with real Stripe money attached
      // are never reused.
      const { data: existingRows } = await supabase
        .from("purchase_records")
        .select(
          "id, client_id, offer_id, payment_status, amount_paid, amount_paid_cents, stripe_subscription_id, stripe_payment_intent_id, stripe_checkout_session_id, created_at",
        )
        .eq("client_id", clientId)
        .eq("offer_id", offer.id);
      const reusable = findReusablePurchaseIntent((existingRows ?? []) as any[], {
        clientId,
        offerId: offer.id,
      });

      let purchase: { id: string } | null = null;
      if (reusable) {
        const { data: updated, error: updateError } = await supabase
          .from("purchase_records")
          .update(payload as any)
          .eq("id", reusable.id)
          .select("id")
          .single();
        if (updateError) throw updateError;
        purchase = updated as any;
      } else {
        const { data: inserted, error } = await supabase
          .from("purchase_records").insert(payload as any).select("id").single();
        if (error) throw error;
        purchase = inserted as any;
      }
      
      job.completeStep(3); // Save purchase record

      // Auto-calculate term dates from product term (start = today, end = today + term)
      // Best-effort — don't fail the whole assignment if this fails
      if (purchase?.id) {
        try {
          await autoCalcTermDatesFn({
            data: {
              purchaseId: purchase.id,
              termLength: offer?.term_length ?? null,
              termUnit: offer?.term_unit ?? null,
            },
          });
        } catch { /* non-fatal */ }
      }

      let generatedUrl: string | null = null;
      if (mode === "payment_request" && purchase?.id) {
        const res = await createCheckoutFn({
          data: { purchaseRecordId: purchase.id, discountCodeId, origin: window.location.origin },
        });
        generatedUrl = res.url;
        setStripeUrl(res.url);
        // Give the admin a SHORT, iMessage-safe JF Effect link — the raw
        // Stripe Checkout URL gets split by iMessage's link detector.
        let shareUrl = res.url as string;
        try {
          const minted: any = await shareLinkFn({
            data: { purchaseRecordId: purchase.id, origin: window.location.origin },
          });
          if (minted?.shareUrl) shareUrl = minted.shareUrl;
        } catch { /* fall back to the canonical Stripe URL */ }
        setCheckoutUrl(shareUrl);
        try { await navigator.clipboard.writeText(shareUrl); } catch {}
        job.completeStep(2); // Create checkout session
        // Prefer the existing email sender; fall back to copy/paste.
        try {
          const sent: any = await sendLinkFn({ data: { id: purchase.id } });
          setEmailNote(
            sent?.sent
              ? `Payment link emailed to ${selectedClient.email ?? "the client"}.`
              : "Payment link created. Copy and send this link to the client.",
          );
        } catch {
          setEmailNote("Payment link created. Copy and send this link to the client.");
        }
        job.completeStep(4); // Send checkout link
      } else {
        job.completeStep(2);
        job.completeStep(4);
      }

      if (createAgreementOnAssign && agreementTemplateId && purchase?.id) {
        await createAgreementFn({
          data: {
            client_id: clientId,
            template_id: agreementTemplateId,
            purchase_record_id: purchase.id,
            offer_name: offer.name,
            send_now: false,
          },
        });
        qc.invalidateQueries({ queryKey: ["client-agreements", clientId] });
      }

      qc.invalidateQueries({ queryKey: ["purchase-records"] });
      qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
      qc.invalidateQueries({ queryKey: ["admin-transactions"] });
      
      job.completeStep(5); // Finalize
      
      if (!generatedUrl) {
        onClose();
        setClientId(fixedClientId ?? "");
        setAdminNotes("");
        setMode("payment_request");
      }
    });
  };

  return (
    <Dialog open={!!offer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Assign offer to client</DialogTitle></DialogHeader>
        {offer && (
          <div className="space-y-4">
            {checkoutUrl && (
              <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm space-y-2">
                <div className="font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" /> Payment link ready
                </div>
                <div className="break-all rounded bg-background px-2 py-1 font-mono text-xs">{checkoutUrl}</div>
                <div className="flex gap-2">
                  <ActionButton size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(checkoutUrl); toast.success("Copied"); } catch {} }}>Copy link</ActionButton>
                  <ActionButton size="sm" variant="outline" onClick={() => window.open(stripeUrl ?? checkoutUrl, "_blank")}>Open</ActionButton>
                  <ActionButton size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(`Here's your secure payment link:\n${checkoutUrl}`); toast.success("Message copied"); } catch {} }}>Copy message</ActionButton>
                </div>
                <p className="text-xs text-muted-foreground">
                  {emailNote ?? "Payment link created. Copy and send this link to the client."} The webhook marks this exact purchase as paid when they complete checkout.
                </p>
              </div>
            )}
            <div className="rounded-md border border-border bg-secondary/30 p-3">
              <div className="font-bold">{offer.name}</div>
              <div className="text-xs text-muted-foreground">{offer.offer_type} · v{offer.version ?? 1} · {offer.currency ?? "USD"} {Number(offer.full_payable_amount ?? offer.price ?? 0).toLocaleString()}</div>
            </div>
            {mode === "payment_request" && first50 && (
              <div>
                <Label>Optional discount</Label>
                <Select value={discountCodeId ?? "none"} onValueChange={(value) => setDiscountCodeId(value === "none" ? null : value)}>
                  <SelectTrigger><SelectValue placeholder="No discount" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No discount</SelectItem>
                    <SelectItem value={first50.id}>{FIRST50_CODE} — CAD $50 off the first eligible monthly payment</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">The server verifies CAD $180/month, eligible product, Stripe synchronization, and no stacking before checkout.</p>
              </div>
            )}
            {!fixedClientId && (
              <div>
                <Label>Client</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue placeholder="Pick a client" /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name} {c.agreement_signed ? "✓" : "⚠︎"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {selectedClient && (
              <div className={`rounded-md border p-3 text-sm ${selectedClient.agreement_signed ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5"}`}>
                <div className="flex items-center gap-2 font-semibold">
                  {selectedClient.agreement_signed ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
                  Coaching Agreement: <Badge variant="outline">{selectedClient.agreement_status ?? "Not Sent"}</Badge>
                </div>
                {!selectedClient.agreement_signed && (
                  <p className="mt-1 text-xs text-destructive">
                    This client does not have a signed Coaching Agreement on file. You can still send the payment request, but access may require agreement completion first.
                  </p>
                )}
              </div>
            )}
            <div>
              <Label>Admin notes (optional)</Label>
              <Textarea rows={2} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>What should happen?</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as AssignMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="payment_request">Send payment request (Stripe checkout)</SelectItem>
                  <SelectItem value="paid_in_full">Mark as already paid in full (manual)</SelectItem>
                  <SelectItem value="draft">Draft / manual record only</SelectItem>
                </SelectContent>
              </Select>
              <div className="rounded-md border border-border bg-secondary/20 p-3 text-sm">
                <div className="flex items-center gap-2 font-semibold">
                  {(() => { const Icon = MODE_COPY[mode].icon; return <Icon className="h-4 w-4 text-primary" />; })()}
                  {MODE_COPY[mode].title}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{MODE_COPY[mode].blurb}</p>
              </div>
            </div>

            <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-2">
              <div className="flex items-center gap-3">
                <Switch checked={createAgreementOnAssign} onCheckedChange={setCreateAgreementOnAssign} />
                <Label>Auto-create draft agreement for this purchase</Label>
              </div>
              {createAgreementOnAssign && (
                <div>
                  <Label className="text-xs">Agreement template{offerDefaultTemplateId ? " (offer default pre-selected)" : ""}</Label>
                  <Select value={agreementTemplateId ?? ""} onValueChange={(v) => setAgreementTemplateId(v || null)}>
                    <SelectTrigger><SelectValue placeholder="Pick a template" /></SelectTrigger>
                    <SelectContent>
                      {templates.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">The draft is linked to this purchase. You'\''ll still send it manually from the client'\''s Agreements panel.</p>
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <ActionButton variant="ghost" onClick={onClose}>Cancel</ActionButton>
          <ActionButton disabled={!clientId} onClick={submit} className="bg-gradient-primary font-bold uppercase">
            {MODE_COPY[mode].button}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
