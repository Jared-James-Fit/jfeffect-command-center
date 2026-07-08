import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@tanstack/react-router";
import {
  ShoppingBag, Plus, CheckCircle2, Copy, ExternalLink, Send, AlertTriangle,
  Ban, Trash2, CreditCard, Calendar, Clock, Pencil, Download, History, AlertCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AssignOfferDialog } from "@/components/assign-offer-dialog";
import { PurchaseAgreementInlineBadge } from "@/components/purchase-agreement-status";
import { useServerFn } from "@tanstack/react-start";
import {
  updatePurchasePayment, sendPaymentLinkEmail, cancelPurchaseRequest, deletePurchaseRecord,
} from "@/lib/payments.functions";
import { updatePurchaseTermDates, getPurchaseStripeFailures } from "@/lib/purchase-term-dates.functions";
import { toast } from "sonner";
import { SendPaymentRequestDialog } from "@/components/send-payment-request-dialog";
import { differenceInDays, format, parseISO } from "date-fns";
import { resolvePaymentDisplay, formatMoney } from "@/lib/payment-display";

// ── Helpers ──────────────────────────────────────────────────────────────────

function isPending(s?: string | null) {
  return s !== "Paid" && s !== "Active Subscription" && s !== "Cancelled" && s !== "Refunded";
}

function expiryStatus(endDate?: string | null): { label: string; tone: string; daysLeft: number } | null {
  if (!endDate) return null;
  try {
    const end = parseISO(endDate);
    const daysLeft = differenceInDays(end, new Date());
    if (daysLeft < 0) return { label: `Expired ${Math.abs(daysLeft)}d ago`, tone: "border-destructive/40 text-destructive bg-destructive/5", daysLeft };
    if (daysLeft <= 14) return { label: `Expires in ${daysLeft}d`, tone: "border-amber-500/40 text-amber-600 bg-amber-500/5", daysLeft };
    if (daysLeft <= 30) return { label: `${daysLeft}d remaining`, tone: "border-warning/40 text-warning bg-warning/5", daysLeft };
    return { label: `${daysLeft}d remaining`, tone: "border-green-500/40 text-green-600 bg-green-500/5", daysLeft };
  } catch { return null; }
}

async function downloadPurchasePdf(r: any, clientName?: string | null) {
  try {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    let y = 20;
    doc.setFontSize(18); doc.setFont("helvetica", "bold");
    doc.text("JF Effect — Purchase Record", pageW / 2, y, { align: "center" });
    y += 10;
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(100);
    doc.text(`Generated ${new Date().toLocaleDateString("en-CA")}`, pageW / 2, y, { align: "center" });
    y += 12;
    doc.setDrawColor(220); doc.line(14, y, pageW - 14, y); y += 8;
    doc.setTextColor(0);
    const rows: [string, string][] = [
      ["Client", clientName ?? "—"],
      ["Product", `${r.offer_name ?? "—"} v${r.offer_version ?? "1"}`],
      ["Product type", r.offer_type ?? "—"],
      ["Purchase date", r.purchased_at ? new Date(r.purchased_at).toLocaleDateString("en-CA") : "—"],
      ["Payment status", r.payment_status ?? "—"],
      ["Amount", `${r.currency ?? "CAD"} ${Number(r.full_payable_amount ?? 0).toLocaleString()}`],
      ["", ""],
      ["Service start date", r.term_start_date ?? "Not set"],
      ["Service end date", r.term_end_date ?? "Not set"],
      ["Term", r.term_duration_text ?? (r.term_length_snapshot ? `${r.term_length_snapshot} ${r.term_unit_snapshot ?? ""}` : "—")],
      ["", ""],
      ["Service status", r.service_status ?? "—"],
    ];
    for (const [label, value] of rows) {
      if (!label && !value) { y += 4; continue; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text(label, 14, y);
      doc.setFont("helvetica", "normal"); doc.text(value, 80, y); y += 7;
    }
    const history = r.term_date_history ?? [];
    if (history.length > 0) {
      y += 4; doc.setDrawColor(220); doc.line(14, y, pageW - 14, y); y += 8;
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text("Date Change History", 14, y); y += 7;
      for (const h of history.slice(-10)) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8);
        const line = `${h.changed_at ? new Date(h.changed_at).toLocaleDateString("en-CA") : "?"} — Start: ${h.start_date ?? "—"} → End: ${h.end_date ?? "—"}${h.reason ? ` (${h.reason})` : ""}`;
        doc.text(line, 14, y); y += 6;
      }
    }
    if (r.admin_notes) {
      y += 4; doc.setDrawColor(220); doc.line(14, y, pageW - 14, y); y += 8;
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text("Admin Notes", 14, y); y += 7;
      doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      const lines = doc.splitTextToSize(r.admin_notes, pageW - 28);
      doc.text(lines, 14, y);
    }
    doc.setTextColor(150); doc.setFontSize(8);
    doc.text("JF Effect · jfeffect.com", pageW / 2, doc.internal.pageSize.getHeight() - 10, { align: "center" });
    const filename = `purchase-${r.offer_name?.replace(/[^a-z0-9]/gi, "-").toLowerCase() ?? "record"}-${r.id.slice(0, 8)}.pdf`;
    doc.save(filename);
    toast.success("PDF downloaded");
  } catch (e: any) {
    toast.error("Could not generate PDF: " + (e?.message ?? "Unknown error"));
  }
}

// ── Term Date Editor ─────────────────────────────────────────────────────────

function TermDateEditor({ purchase, clientId, onClose }: { purchase: any; clientId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updatePurchaseTermDates);
  const [startDate, setStartDate] = useState(purchase.term_start_date ?? "");
  const [endDate, setEndDate] = useState(purchase.term_end_date ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const history: any[] = purchase.term_date_history ?? [];

  const autoFillEndDate = () => {
    if (!startDate || !purchase.term_length_snapshot || !purchase.term_unit_snapshot) return;
    try {
      const start = parseISO(startDate);
      const len = purchase.term_length_snapshot as number;
      const unit = purchase.term_unit_snapshot as string;
      const end = new Date(start);
      if (unit === "days") end.setDate(end.getDate() + len);
      else if (unit === "weeks") end.setDate(end.getDate() + len * 7);
      else if (unit === "months") end.setMonth(end.getMonth() + len);
      else if (unit === "years") end.setFullYear(end.getFullYear() + len);
      setEndDate(end.toISOString().split("T")[0]);
    } catch {}
  };

  const save = async () => {
    if (!startDate || !endDate) return toast.error("Both start and end dates are required");
    if (startDate > endDate) return toast.error("Start date must be before end date");
    setBusy(true);
    try {
      await updateFn({ data: { purchaseId: purchase.id, startDate, endDate, reason: reason.trim() || undefined } });
      toast.success("Service dates updated");
      qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update dates");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" /> Edit Service Dates
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-secondary/30 px-3 py-2 text-sm">
            <div className="font-semibold">{purchase.offer_name}</div>
            {purchase.term_length_snapshot && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Product term: {purchase.term_length_snapshot} {purchase.term_unit_snapshot}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="term-start" className="text-sm font-semibold">
              Service Start Date <span className="text-destructive">*</span>
            </Label>
            <Input id="term-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} onBlur={autoFillEndDate} />
            <p className="text-xs text-muted-foreground">When does the client's service begin? Defaults to purchase date.</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="term-end" className="text-sm font-semibold">
                Service End Date / Next Renewal <span className="text-destructive">*</span>
              </Label>
              {purchase.term_length_snapshot && startDate && (
                <button type="button" onClick={autoFillEndDate} className="text-xs text-primary underline underline-offset-2">
                  Auto-fill ({purchase.term_length_snapshot} {purchase.term_unit_snapshot})
                </button>
              )}
            </div>
            <Input id="term-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} />
            <p className="text-xs text-muted-foreground">When does the service expire or next renewal is due?</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="term-reason" className="text-sm font-semibold">
              Reason <span className="text-muted-foreground font-normal">(optional — saved to history)</span>
            </Label>
            <Input id="term-reason" placeholder="e.g. Client requested extension, correcting start date…" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {history.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <History className="h-3.5 w-3.5" />
                {showHistory ? "Hide" : "Show"} change history ({history.length})
              </button>
              {showHistory && (
                <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto rounded-lg border border-border bg-secondary/20 p-2">
                  {[...history].reverse().map((h, i) => (
                    <div key={i} className="text-xs border-b border-border/50 pb-1.5 last:border-0 last:pb-0">
                      <div className="font-medium">{h.start_date ?? "—"} → {h.end_date ?? "—"}</div>
                      <div className="text-muted-foreground">
                        {h.changed_at ? format(new Date(h.changed_at), "MMM d, yyyy 'at' h:mm a") : "Unknown date"}
                        {h.reason ? ` · ${h.reason}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !startDate || !endDate}>
            {busy ? "Saving…" : "Save dates"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Failed Payments ──────────────────────────────────────────────────────────

function FailedPaymentsSection({ purchaseId }: { purchaseId: string }) {
  const getFn = useServerFn(getPurchaseStripeFailures);
  const { data } = useQuery({
    queryKey: ["purchase-stripe-failures", purchaseId],
    queryFn: () => getFn({ data: { purchaseId } }),
    staleTime: 60_000,
  });
  const failures = data?.failures ?? [];
  if (failures.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive uppercase tracking-widest">
        <AlertCircle className="h-3.5 w-3.5" /> Failed payments
      </div>
      {failures.map((f: any) => (
        <div key={f.id} className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs">
          <div className="font-medium text-destructive">
            {f.currency?.toUpperCase()} {(f.amount / 100).toFixed(2)} — {f.failure_message ?? "Payment failed"}
          </div>
          <div className="text-muted-foreground">
            {new Date(f.created * 1000).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export function PurchaseRecordsPanel({ clientId }: { clientId: string }) {
  const [picker, setPicker] = useState(false);
  const [chosenOffer, setChosenOffer] = useState<any | null>(null);
  const [payDlg, setPayDlg] = useState<{ open: boolean; purchaseId: string; hasLink?: boolean }>({ open: false, purchaseId: "" });
  const [editingDates, setEditingDates] = useState<any | null>(null);
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
      const { data } = await supabase.from("offers").select("id, requires_agreement, agreement_before_service").in("id", offerIds as string[]);
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

  const copyLink = (url?: string | null) => { if (!url) return toast.error("No payment link"); navigator.clipboard.writeText(url); toast.success("Copied"); };
  const markPaid = async (r: any) => { try { await updateFn({ data: { id: r.id, payment_status: "Paid", amount_paid: Number(r.full_payable_amount ?? 0) } }); toast.success("Marked paid"); qc.invalidateQueries({ queryKey: ["client-purchases", clientId] }); } catch (e: any) { toast.error(e?.message ?? "Failed"); } };
  const markStatus = async (r: any, payment_status: string) => { try { await updateFn({ data: { id: r.id, payment_status } }); toast.success(`Marked ${payment_status}`); qc.invalidateQueries({ queryKey: ["client-purchases", clientId] }); } catch (e: any) { toast.error(e?.message ?? "Failed"); } };
  const emailLink = async (id: string) => { try { const r: any = await sendFn({ data: { id } }); if (r?.sent) toast.success("Payment setup request emailed to client"); else toast.message(r?.reason ?? "Email skipped"); } catch (e: any) { toast.error(e?.message ?? "Failed"); } };
  const cancelReq = async (id: string) => { try { await cancelFn({ data: { id } }); toast.success("Payment request cancelled"); qc.invalidateQueries({ queryKey: ["client-purchases", clientId] }); } catch (e: any) { toast.error(e?.message ?? "Failed"); } };
  const deleteReq = async (id: string) => { try { await deleteFn({ data: { id } }); toast.success("Payment request deleted"); qc.invalidateQueries({ queryKey: ["client-purchases", clientId] }); } catch (e: any) { toast.error(e?.message ?? "Failed"); } };

  return (
    <Card className="border-border bg-card p-6 md:col-span-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <ShoppingBag className="h-4 w-4" />Purchases & Payment Setup Requests
        </h3>
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => setPicker(true)}>
          <Plus className="mr-1.5 h-3 w-3" />Send payment setup request
        </Button>
      </div>

      {records.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No purchases or pending payment requests yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {records.map((r: any) => {
            const expiry = expiryStatus(r.term_end_date ?? r.package_expiry_date);
            const hasTermDates = !!(r.term_start_date || r.term_end_date);
            return (
              <li key={r.id} className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link to="/admin/purchases/$id" params={{ id: r.id }} className="min-w-0 hover:underline">
                    <div className="font-semibold">{r.offer_name} <span className="text-xs text-muted-foreground font-normal">v{r.offer_version}</span></div>
                    <div className="text-xs text-muted-foreground">{r.offer_type} · {new Date(r.purchased_at).toLocaleDateString()}</div>
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-mono">{r.currency} {Number(r.full_payable_amount ?? 0).toLocaleString()}</span>
                    <Badge variant="outline" className={statusTone(r.payment_status)}>{requestLabel(r.payment_status)}</Badge>
                    {r.service_status && r.service_status !== "Not Started" && <Badge variant="outline">{r.service_status}</Badge>}
                    {expiry && (
                      <Badge variant="outline" className={expiry.tone}>
                        <Clock className="mr-1 h-3 w-3" />{expiry.label}
                      </Badge>
                    )}
                    <PurchaseAgreementInlineBadge
                      purchaseId={r.id} clientId={clientId}
                      requiresAgreement={!!offerFlags[r.offer_id]?.requires_agreement}
                      agreementBeforeService={!!offerFlags[r.offer_id]?.agreement_before_service}
                      termStartDate={r.term_start_date}
                    />
                  </div>
                </div>

                {/* Term dates row */}
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-background/60 px-3 py-2">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 flex-1 min-w-0 text-xs">
                    <span>
                      <span className="text-muted-foreground">Start: </span>
                      <span className={r.term_start_date ? "font-medium" : "text-muted-foreground italic"}>
                        {r.term_start_date ? new Date(r.term_start_date).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : "Not set"}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">End / Renewal: </span>
                      <span className={r.term_end_date ? "font-medium" : "text-muted-foreground italic"}>
                        {r.term_end_date ? new Date(r.term_end_date).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : "Not set"}
                      </span>
                    </span>
                    {r.term_duration_text && <span className="text-muted-foreground">{r.term_duration_text}</span>}
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs shrink-0" onClick={() => setEditingDates(r)}>
                    <Pencil className="mr-1 h-3 w-3" />{hasTermDates ? "Edit" : "Set dates"}
                  </Button>
                </div>

                {/* Sessions */}
                {r.package_tracking_enabled && (
                  <div className="text-xs text-muted-foreground">
                    Sessions: <span className="font-semibold text-foreground">{Math.max(0, (r.sessions_purchased ?? 0) - (r.sessions_used ?? 0))}</span> remaining of {r.sessions_purchased ?? 0}
                  </div>
                )}

                {/* Failed payments */}
                <FailedPaymentsSection purchaseId={r.id} />

                {/* Actions */}
                <div className="flex flex-wrap gap-1">
                  {r.payment_status !== "Paid" && r.payment_status !== "Active Subscription" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markPaid(r)}>
                      <CheckCircle2 className="mr-1 h-3 w-3" />Mark paid
                    </Button>
                  )}
                  {r.payment_status !== "Overdue" && r.payment_status !== "Paid" && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => markStatus(r, "Overdue")}>
                      <AlertTriangle className="mr-1 h-3 w-3" />Overdue
                    </Button>
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
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => downloadPurchasePdf(r, clientLite?.full_name)}>
                    <Download className="mr-1 h-3 w-3" />PDF
                  </Button>
                  {isPending(r.payment_status) && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-warning hover:text-warning"><Ban className="mr-1 h-3 w-3" />Cancel request</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Cancel this payment request?</AlertDialogTitle>
                          <AlertDialogDescription>This marks the purchase as Cancelled and deactivates the Stripe payment link.</AlertDialogDescription>
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
                          <AlertDialogDescription>This permanently removes the purchase record and deactivates the Stripe link.</AlertDialogDescription>
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
            );
          })}
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
      <SendPaymentRequestDialog
        open={payDlg.open}
        onOpenChange={(o) => setPayDlg((p) => ({ ...p, open: o }))}
        purchaseId={payDlg.purchaseId}
        clientName={clientLite?.full_name}
        hasPhone={!!clientLite?.phone}
        hasLink={payDlg.hasLink}
      />
      {editingDates && (
        <TermDateEditor purchase={editingDates} clientId={clientId} onClose={() => setEditingDates(null)} />
      )}
    </Card>
  );
}
