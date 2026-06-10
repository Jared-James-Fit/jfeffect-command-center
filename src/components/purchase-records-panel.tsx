import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { ShoppingBag, Plus, CheckCircle2, Copy, ExternalLink, Send, AlertTriangle, Ban, Trash2, CreditCard } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AssignOfferDialog } from "@/components/assign-offer-dialog";
import { PurchaseAgreementInlineBadge } from "@/components/purchase-agreement-status";
import { useServerFn } from "@tanstack/react-start";
import {
  updatePurchasePayment,
  sendPaymentLinkEmail,
  cancelPurchaseRequest,
  deletePurchaseRecord,
} from "@/lib/payments.functions";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SendPaymentRequestDialog } from "@/components/send-payment-request-dialog";

function statusTone(s?: string | null) {
  switch (s) {
    case "Paid":
    case "Active Subscription":
      return "border-green-500/40 text-green-500 bg-green-500/10";
    case "Overdue":
    case "Failed":
    case "Manual Payment Needed":
      return "border-destructive/40 text-destructive bg-destructive/5";
    case "Refunded":
    case "Cancelled":
    case "Expired":
      return "border-border text-muted-foreground";
    default:
      return "border-warning/40 text-warning bg-warning/5";
  }
}

function isPending(s?: string | null) {
  return s !== "Paid" && s !== "Active Subscription" && s !== "Cancelled" && s !== "Refunded";
}

function requestLabel(s?: string | null) {
  if (s === "Paid") return "Paid";
  if (s === "Active Subscription") return "Active subscription";
  if (s === "Cancelled") return "Cancelled request";
  if (s === "Refunded") return "Refunded";
  if (s === "Overdue" || s === "Failed" || s === "Manual Payment Needed") return `Payment ${s.toLowerCase()}`;
  return "Pending payment setup request";
}

export function PurchaseRecordsPanel({ clientId }: { clientId: string }) {
  const [picker, setPicker] = useState(false);
  const [chosenOffer, setChosenOffer] = useState<any | null>(null);
  const [payDlg, setPayDlg] = useState<{ open: boolean; purchaseId: string; hasLink?: boolean }>({ open: false, purchaseId: "" });
  const qc = useQueryClient();

  const { data: clientLite } = useQuery({
    queryKey: ["client-lite", clientId],
    queryFn: async () => (await supabase.from("clients").select("full_name, phone").eq("id", clientId).maybeSingle()).data,
  });
  const updateFn = useServerFn(updatePurchasePayment);
  const sendFn = useServerFn(sendPaymentLinkEmail);
  const cancelFn = useServerFn(cancelPurchaseRequest);
  const deleteFn = useServerFn(deletePurchaseRecord);

  const { data: records = [] } = useQuery({
    queryKey: ["client-purchases", clientId],
    queryFn: async () => (await supabase
      .from("purchase_records")
      .select("*")
      .eq("client_id", clientId)
      .order("purchased_at", { ascending: false })).data ?? [],
  });

  const offerIds = Array.from(new Set(records.map((r: any) => r.offer_id).filter(Boolean)));
  const { data: offerFlags = {} } = useQuery({
    queryKey: ["offer-agreement-flags", offerIds.sort().join(",")],
    enabled: offerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("offers")
        .select("id, requires_agreement, agreement_before_service")
        .in("id", offerIds as string[]);
      const map: Record<string, { requires_agreement: boolean; agreement_before_service: boolean }> = {};
      for (const o of (data ?? []) as any[]) map[o.id] = o;
      return map;
    },
  });

  const { data: offers = [] } = useQuery({
    queryKey: ["offers-pickable"],
    enabled: picker,
    queryFn: async () => (await supabase.from("offers").select("*").eq("archived", false).order("name")).data ?? [],
  });

  const copyLink = (url?: string | null) => {
    if (!url) return toast.error("No payment link");
    navigator.clipboard.writeText(url);
    toast.success("Copied");
  };
  const markPaid = async (r: any) => {
    try {
      await updateFn({ data: { id: r.id, payment_status: "Paid", amount_paid: Number(r.full_payable_amount ?? 0) } });
      toast.success("Marked paid");
      qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const markStatus = async (r: any, payment_status: string) => {
    try {
      await updateFn({ data: { id: r.id, payment_status } });
      toast.success(`Marked ${payment_status}`);
      qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const emailLink = async (id: string) => {
    try {
      const r: any = await sendFn({ data: { id } });
      if (r?.sent) toast.success("Payment setup request emailed to client");
      else toast.message(r?.reason ?? "Email skipped");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const cancelReq = async (id: string) => {
    try {
      await cancelFn({ data: { id } });
      toast.success("Payment request cancelled");
      qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const deleteReq = async (id: string) => {
    try {
      await deleteFn({ data: { id } });
      toast.success("Payment request deleted");
      qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  return (
    <Card className="border-border bg-card p-6 md:col-span-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><ShoppingBag className="h-4 w-4" />Purchases & Payment Setup Requests</h3>
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => setPicker(true)}><Plus className="mr-1.5 h-3 w-3" />Send payment setup request</Button>
      </div>
      {records.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No purchases or pending payment requests yet.</div>
      ) : (
        <ul className="space-y-2">
          {records.map((r: any) => (
            <li key={r.id} className="rounded-md border border-border bg-secondary/20 p-3 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link to="/admin/purchases/$id" params={{ id: r.id }} className="min-w-0 hover:underline">
                  <div className="font-semibold">{r.offer_name} <span className="text-xs text-muted-foreground font-normal">v{r.offer_version}</span></div>
                  <div className="text-xs text-muted-foreground">{r.offer_type} · {new Date(r.purchased_at).toLocaleDateString()}</div>
                </Link>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-mono">{r.currency} {Number(r.full_payable_amount ?? 0).toLocaleString()}</span>
                  <Badge variant="outline" className={statusTone(r.payment_status)}>{requestLabel(r.payment_status)}</Badge>
                  {r.service_status && r.service_status !== "Not Started" && <Badge variant="outline">{r.service_status}</Badge>}
                  <PurchaseAgreementInlineBadge
                    purchaseId={r.id}
                    clientId={clientId}
                    requiresAgreement={!!offerFlags[r.offer_id]?.requires_agreement}
                    agreementBeforeService={!!offerFlags[r.offer_id]?.agreement_before_service}
                    termStartDate={r.term_start_date}
                  />
                </div>
              </div>
              {r.package_tracking_enabled && (
                <div className="text-xs text-muted-foreground">
                  Sessions: <span className="font-semibold text-foreground">{Math.max(0, (r.sessions_purchased ?? 0) - (r.sessions_used ?? 0))}</span> remaining of {r.sessions_purchased ?? 0}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {r.payment_status !== "Paid" && r.payment_status !== "Active Subscription" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markPaid(r)}><CheckCircle2 className="mr-1 h-3 w-3" />Mark paid</Button>
                )}
                {r.payment_status !== "Overdue" && r.payment_status !== "Paid" && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => markStatus(r, "Overdue")}><AlertTriangle className="mr-1 h-3 w-3" />Overdue</Button>
                )}
                {r.stripe_payment_link && (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => copyLink(r.stripe_payment_link)}><Copy className="mr-1 h-3 w-3" />Copy</Button>
                    <a href={r.stripe_payment_link} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" className="h-7 text-xs"><ExternalLink className="mr-1 h-3 w-3" />Open</Button></a>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => emailLink(r.id)}><Send className="mr-1 h-3 w-3" />Email request</Button>
                  </>
                )}
                {r.stripe_payment_link && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPayDlg({ open: true, purchaseId: r.id, hasLink: true })}>
                    <CreditCard className="mr-1 h-3 w-3" />SMS / Post in chat
                  </Button>
                )}
                {r.stripe_receipt_url && (
                  <a href={r.stripe_receipt_url} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" className="h-7 text-xs">Receipt</Button></a>
                )}
                {isPending(r.payment_status) && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-warning hover:text-warning"><Ban className="mr-1 h-3 w-3" />Cancel request</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel this payment request?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This marks the purchase as Cancelled and deactivates the Stripe payment link so the client can no longer pay it. They will see it as Cancelled in their portal.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction onClick={() => cancelReq(r.id)}>Cancel request</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                {r.payment_status !== "Paid" && r.payment_status !== "Active Subscription" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive"><Trash2 className="mr-1 h-3 w-3" />Delete</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this payment request?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the purchase record and deactivates the Stripe link. Use Cancel instead if you want to keep a record of it.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteReq(r.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Pick an offer</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {offers.map((o: any) => (
              <button key={o.id} type="button" onClick={() => { setChosenOffer(o); setPicker(false); }} className="w-full text-left rounded-md border border-border bg-secondary/20 p-3 hover:bg-secondary/40">
                <div className="font-semibold">{o.name}</div>
                <div className="text-xs text-muted-foreground">{o.offer_type} · {o.currency ?? "USD"} {Number(o.full_payable_amount ?? o.price ?? 0).toLocaleString()}</div>
              </button>
            ))}
            {offers.length === 0 && <p className="text-sm text-muted-foreground">No active offers. Create one in Offers / Products.</p>}
          </div>
        </DialogContent>
      </Dialog>

      <AssignOfferDialog offer={chosenOffer} fixedClientId={clientId} onClose={() => setChosenOffer(null)} />
    </Card>
  );
}