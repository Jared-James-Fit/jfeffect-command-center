import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { accessBadge } from "@/lib/service-access-status";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ShoppingBag, Plus, MoreHorizontal, ExternalLink, Pencil, Copy, Send, Download,
  CheckCircle2, AlertTriangle, RefreshCw, Share2, Archive, ArchiveRestore, Trash2,
} from "lucide-react";
import { createPaymentShareLink } from "@/lib/payment-share.functions";
import { createCheckoutSessionForAssignment } from "@/lib/stripe-checkout.functions";
import { reconcilePurchaseWithStripe } from "@/lib/stripe-sync.functions";
import { getShareablePaymentUrl } from "@/components/payments/copy-payment-link-button";
import { shareKindLabel } from "@/lib/payment-share-link";
import { share as nativeShare, canShare } from "@/platform/share";
import { toast } from "sonner";
import { AddSaleDialog } from "@/components/clients/add-sale-dialog";
import { TermDateEditor, downloadPurchasePdf } from "@/components/purchase-records-panel";
import { updatePurchasePayment, sendPaymentLinkEmail } from "@/lib/payments.functions";
import {
  archivePurchaseRecord,
  restorePurchaseRecord,
  removeUnpaidPurchaseRecord,
} from "@/lib/purchase-archive.functions";
import { resolvePaymentDisplay, formatMoney, type PaymentDisplay } from "@/lib/payment-display";

type SortKey = "recent" | "name" | "status" | "next";
type ArchiveFilter = "current" | "archived" | "all";

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

const TONE = {
  ok: "border-emerald-500/40 text-emerald-500 bg-emerald-500/10",
  info: "border-blue-500/40 text-blue-500 bg-blue-500/10",
  warn: "border-amber-500/40 text-amber-500 bg-amber-500/10",
  bad: "border-destructive/40 text-destructive bg-destructive/5",
  muted: "border-border text-muted-foreground",
};

function hasPaymentDestination(r: any) {
  return Boolean(r?.stripe_payment_link || r?.stripe_checkout_session_id || r?.stripe_subscription_id);
}

function resolveSaleStatus(r: any, d: PaymentDisplay): { label: string; tone: string } {
  if (r.archived_at) return { label: "Archived", tone: TONE.muted };
  if (d.status === "draft") return { label: "Draft", tone: TONE.muted };
  if (d.status === "pending_payment") {
    return hasPaymentDestination(r)
      ? { label: "Payment Link Ready", tone: TONE.warn }
      : { label: "Pending Payment", tone: TONE.warn };
  }
  if ((r.payment_status ?? "") === "Failed") return { label: "Failed", tone: TONE.bad };
  const kind = d.renewal.kind;
  if (kind === "cancelled") return { label: "Cancelled", tone: TONE.muted };
  if (kind === "cancels") return { label: "Cancelling", tone: TONE.warn };
  if (kind === "first_payment") return { label: "Trialing", tone: TONE.info };
  if (kind === "retry" || kind === "past_due") return { label: "Past Due", tone: TONE.bad };
  if (kind === "renew" || kind === "unavailable") return { label: "Active", tone: TONE.ok };
  if (kind === "free") return { label: "Free", tone: TONE.muted };
  const end = r.term_end_date ?? r.package_expiry_date ?? null;
  const expired = end ? new Date(`${String(end).slice(0, 10)}T23:59:59`) < new Date() : false;
  if (expired) return { label: "Expired", tone: TONE.muted };
  if (d.isPaidInFull) return { label: "Paid in Full", tone: TONE.ok };
  if (d.status === "partially_paid") return { label: "Partially Paid", tone: TONE.warn };
  if (d.status === "unpaid" || d.status === "past_due") return { label: "Past Due", tone: TONE.bad };
  if (d.status === "pending_setup") return { label: "Payment setup pending", tone: TONE.warn };
  return { label: "Unknown", tone: TONE.muted };
}

function AccessBadge({ raw }: { raw: any }) {
  const { state, label } = accessBadge(raw);
  const tone = state === "active" ? TONE.ok : state === "upcoming" ? TONE.info : TONE.muted;
  return <Badge variant="outline" className={`${tone} ml-1 whitespace-nowrap text-[10px]`}>{label}</Badge>;
}

function nextPaymentCell(d: PaymentDisplay, raw?: any) {
  if (d.status === "draft") return { text: "Not started", tone: "text-muted-foreground", helper: "Draft record — no payment requested." as string | null };
  if (d.status === "pending_payment") {
    const ready = hasPaymentDestination(raw);
    return {
      text: "Awaiting payment",
      tone: "text-amber-500",
      helper: ready
        ? "Payment link ready — waiting on Stripe confirmation."
        : "Payment link not created. Use Create payment link to retry this sale.",
    };
  }
  const r = d.renewal;
  if (r.kind === "none") return { text: "No renewal", tone: "text-muted-foreground", helper: null as string | null };
  if (r.kind === "free") return { text: "No payment", tone: "text-muted-foreground", helper: null };
  if (r.kind === "cancelled") return { text: r.date ? `Ended ${fmtDate(r.date)}` : "Cancelled", tone: "text-muted-foreground", helper: null };
  if (r.kind === "cancels") return { text: `Cancels on ${r.valueText}`, tone: "text-amber-500", helper: null };
  if (r.kind === "first_payment") return { text: `First payment ${r.valueText}`, tone: "text-foreground", helper: r.helper };
  if (r.kind === "retry") return { text: `Retry ${r.valueText}`, tone: "text-destructive", helper: null };
  if (r.kind === "past_due") return { text: "Past due", tone: "text-destructive", helper: "No retry date synced." };
  if (r.kind === "unavailable") return { text: "Next payment unavailable", tone: "text-amber-500", helper: r.helper };
  return { text: r.valueText, tone: "text-foreground", helper: null };
}

type Row = { raw: any; display: PaymentDisplay; status: { label: string; tone: string }; next: ReturnType<typeof nextPaymentCell> };

export function ClientSalesTable({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [sort, setSort] = useState<SortKey>("recent");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("current");
  const [picker, setPicker] = useState(false);
  const [editingDates, setEditingDates] = useState<any | null>(null);
  const updateFn = useServerFn(updatePurchasePayment);
  const sendFn = useServerFn(sendPaymentLinkEmail);

  const { data: clientLite } = useQuery({
    queryKey: ["client-lite", clientId],
    queryFn: async () => (await supabase.from("clients").select("full_name, phone").eq("id", clientId).maybeSingle()).data,
  });

  const { data: records, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["client-purchases", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_records").select("*").eq("client_id", clientId).order("purchased_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchOnWindowFocus: true,
    refetchInterval: (q) => {
      const rows = (q.state.data as any[]) ?? [];
      const waiting = rows.some((r) => !r.archived_at && ["Pending Payment", "Payment Link Sent", "Pending"].includes(String(r.payment_status ?? "")));
      return waiting ? 45_000 : false;
    },
  });

  const rows: Row[] = useMemo(() => {
    const visible = (records ?? []).filter((raw: any) => {
      if (archiveFilter === "all") return true;
      return archiveFilter === "archived" ? Boolean(raw.archived_at) : !raw.archived_at;
    });
    const built = visible.map((raw: any) => {
      const display = resolvePaymentDisplay(raw);
      return { raw, display, status: resolveSaleStatus(raw, display), next: nextPaymentCell(display, raw) };
    });
    const byDate = (v: string | null | undefined) => (v ? new Date(v).getTime() : Number.POSITIVE_INFINITY);
    return [...built].sort((a, b) => {
      if (sort === "name") return String(a.raw.offer_name ?? "").localeCompare(String(b.raw.offer_name ?? ""));
      if (sort === "status") return a.status.label.localeCompare(b.status.label);
      if (sort === "next") return byDate(a.display.renewal.date) - byDate(b.display.renewal.date);
      return byDate(b.raw.purchased_at) - byDate(a.raw.purchased_at);
    });
  }, [records, sort, archiveFilter]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
  const markPaid = async (r: any) => {
    try { await updateFn({ data: { id: r.id, payment_status: "Paid", amount_paid: Number(r.full_payable_amount ?? 0) } }); toast.success("Marked paid"); invalidate(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const markOverdue = async (r: any) => {
    try { await updateFn({ data: { id: r.id, payment_status: "Overdue" } }); toast.success("Marked overdue"); invalidate(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const emailLink = async (id: string) => {
    try { const res: any = await sendFn({ data: { id } }); if (res?.sent) toast.success("Payment setup request emailed"); else toast.message(res?.reason ?? "Email skipped"); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const addSale = <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => setPicker(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Add sale</Button>;

  return (
    <Card className="border-border bg-card p-4 md:col-span-3 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><ShoppingBag className="h-4 w-4" />Sales</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={archiveFilter} onValueChange={(v) => setArchiveFilter(v as ArchiveFilter)}>
            <SelectTrigger className="h-9 w-[125px] text-xs" aria-label="Sale archive filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="current">Current</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          {(records?.length ?? 0) > 1 && (
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-9 w-[145px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Newest first</SelectItem><SelectItem value="name">Product name</SelectItem><SelectItem value="status">Status</SelectItem><SelectItem value="next">Next payment</SelectItem>
              </SelectContent>
            </Select>
          )}
          {(records?.length ?? 0) > 0 && addSale}
        </div>
      </div>

      {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading sales…</p>}
      {isError && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center space-y-3"><p className="text-sm text-destructive">Sales could not be loaded.</p><Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button></div>}

      {!isLoading && !isError && rows.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-8 text-center space-y-3">
          <p className="text-sm font-medium">{archiveFilter === "archived" ? "No archived sales." : "No products sold yet."}</p>
          {archiveFilter === "current" && <><p className="text-xs text-muted-foreground">Add a sale or send a payment request to connect a product to this client.</p><div className="flex justify-center">{addSale}</div></>}
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && <>
        <div className="hidden overflow-x-auto md:block">
          <Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Type</TableHead><TableHead>Date added</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead><TableHead>Next payment</TableHead><TableHead>Status</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>{rows.map(({ raw, display, status, next }) => (
              <TableRow key={raw.id} className={raw.archived_at ? "opacity-70" : undefined}>
                <TableCell className="max-w-[220px]"><Link to="/admin/purchases/$id" params={{ id: raw.id }} className="font-medium hover:underline">{raw.offer_name ?? "Product"}</Link><InstallmentSummary display={display} /></TableCell>
                <TableCell className="text-sm text-muted-foreground">{raw.offer_type ?? "—"}</TableCell><TableCell className="text-sm">{fmtDate(raw.purchased_at) ?? "—"}</TableCell>
                <TableCell className="text-sm">{fmtDate(raw.term_start_date) ?? <span className="text-muted-foreground italic">Not set</span>}</TableCell><TableCell className="text-sm">{fmtDate(raw.term_end_date) ?? <span className="text-muted-foreground italic">Not set</span>}</TableCell>
                <TableCell className="text-sm"><span className={next.tone}>{next.text}</span>{next.helper && <div className="text-[11px] text-muted-foreground">{next.helper}</div>}</TableCell>
                <TableCell><Badge variant="outline" className={status.tone}>{status.label}</Badge>{!raw.archived_at && <AccessBadge raw={raw} />}</TableCell>
                <TableCell><RowMenu raw={raw} clientName={clientLite?.full_name} onEditDates={() => setEditingDates(raw)} onMarkPaid={() => markPaid(raw)} onMarkOverdue={() => markOverdue(raw)} onEmailLink={() => emailLink(raw.id)} onChanged={invalidate} /></TableCell>
              </TableRow>
            ))}</TableBody></Table>
        </div>

        <ul className="space-y-3 md:hidden">{rows.map(({ raw, display, status, next }) => (
          <li key={raw.id} className={`rounded-lg border border-border bg-secondary/20 p-3 space-y-2 ${raw.archived_at ? "opacity-70" : ""}`}>
            <div className="flex items-start justify-between gap-2"><Link to="/admin/purchases/$id" params={{ id: raw.id }} className="min-w-0"><div className="truncate font-semibold">{raw.offer_name ?? "Product"}</div><div className="text-xs text-muted-foreground">{raw.offer_type ?? "—"}</div></Link><RowMenu raw={raw} clientName={clientLite?.full_name} onEditDates={() => setEditingDates(raw)} onMarkPaid={() => markPaid(raw)} onMarkOverdue={() => markOverdue(raw)} onEmailLink={() => emailLink(raw.id)} onChanged={invalidate} /></div>
            <div className="flex flex-wrap items-center gap-1.5"><Badge variant="outline" className={status.tone}>{status.label}</Badge>{!raw.archived_at && <AccessBadge raw={raw} />}<span className="text-sm font-mono">{formatMoney(display.contractTotal, display.currency)}</span>{display.amountOutstanding > 0 && <Badge variant="outline" className={TONE.warn}>{formatMoney(display.amountOutstanding, display.currency)} remaining</Badge>}</div>
            <InstallmentSummary display={display} />
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs"><Field label="Date added" value={fmtDate(raw.purchased_at) ?? "—"} /><Field label="Start" value={fmtDate(raw.term_start_date) ?? "Not set"} /><Field label="End" value={fmtDate(raw.term_end_date) ?? "Not set"} /><div><dt className="text-muted-foreground">Next payment</dt><dd className={next.tone}>{next.text}</dd></div></dl>
            {next.helper && <p className="text-[11px] text-muted-foreground">{next.helper}</p>}
          </li>
        ))}</ul>
      </>}

      <AddSaleDialog open={picker} onOpenChange={setPicker} clientId={clientId} clientName={clientLite?.full_name ?? null} />
      {editingDates && <TermDateEditor purchase={editingDates} clientId={clientId} onClose={() => setEditingDates(null)} />}
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>;
}

function RowMenu({ raw, clientName, onEditDates, onMarkPaid, onMarkOverdue, onEmailLink, onChanged }: {
  raw: any; clientName?: string | null; onEditDates: () => void; onMarkPaid: () => void; onMarkOverdue: () => void; onEmailLink: () => void; onChanged: () => void;
}) {
  const paid = raw.payment_status === "Paid" || raw.payment_status === "Active Subscription";
  const linkReady = hasPaymentDestination(raw);
  const shareFn = useServerFn(createPaymentShareLink);
  const checkoutFn = useServerFn(createCheckoutSessionForAssignment);
  const reconcileFn = useServerFn(reconcilePurchaseWithStripe);
  const archiveFn = useServerFn(archivePurchaseRecord);
  const restoreFn = useServerFn(restorePurchaseRecord);
  const removeFn = useServerFn(removeUnpaidPurchaseRecord);
  const qc = useQueryClient();

  const syncWithStripe = async () => {
    const t = toast.loading("Reading this sale from Stripe…");
    try { const res: any = await reconcileFn({ data: { purchaseId: raw.id } }); if (!res?.ok) return void toast.error(res?.error ?? "Could not reconcile", { id: t }); qc.invalidateQueries({ queryKey: ["client-purchases"] }); toast.success(`Synced — ${res.status}`, { id: t, description: res.ledgerAdded ? `${res.ledgerAdded} missing payment(s) recorded.` : "Already up to date." }); }
    catch (e: any) { toast.error(e?.message ?? "Could not reconcile", { id: t }); }
  };

  const copyLink = async (mode: "copy" | "share") => {
    const t = toast.loading(linkReady ? "Getting payment link…" : "Creating payment link…");
    try {
      const { url, kind } = await getShareablePaymentUrl(shareFn as any, checkoutFn as any, raw.id);
      onChanged();
      if (mode === "share" && canShare({ url })) { const res = await nativeShare({ url, title: "Payment link" }); if (res === "shared") return void toast.success("Payment link shared", { id: t }); }
      await navigator.clipboard.writeText(url);
      toast.success("Payment link copied", { id: t, description: shareKindLabel(kind as any) });
    } catch (e: any) { toast.error(e?.message ?? "Could not get a payment link", { id: t }); }
  };

  const archive = async () => {
    try { await archiveFn({ data: { id: raw.id } }); toast.success("Sale archived"); onChanged(); }
    catch (e: any) { toast.error(e?.message ?? "Could not archive sale"); }
  };
  const restore = async () => {
    try { await restoreFn({ data: { id: raw.id } }); toast.success("Sale restored"); onChanged(); }
    catch (e: any) { toast.error(e?.message ?? "Could not restore sale"); }
  };
  const remove = async () => {
    if (!window.confirm("Remove this unpaid sale permanently? This is only allowed when there is no payment or Stripe transaction history.")) return;
    try { await removeFn({ data: { id: raw.id } }); toast.success("Unpaid sale removed"); onChanged(); }
    catch (e: any) { toast.error(e?.message ?? "Could not remove sale"); }
  };

  const removable = !paid && !raw.stripe_payment_intent_id && !raw.stripe_subscription_id && !raw.stripe_checkout_session_id && Number(raw.amount_paid ?? 0) <= 0 && Number(raw.amount_paid_cents ?? 0) <= 0;

  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Sale actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-60">
      <DropdownMenuItem asChild><Link to="/admin/purchases/$id" params={{ id: raw.id }}><ExternalLink className="mr-2 h-3.5 w-3.5" />View sale details</Link></DropdownMenuItem>
      {!raw.archived_at && <DropdownMenuItem onSelect={onEditDates}><Pencil className="mr-2 h-3.5 w-3.5" />{raw.term_start_date || raw.term_end_date ? "Edit dates" : "Set dates"}</DropdownMenuItem>}
      {!raw.archived_at && !paid && <DropdownMenuItem onSelect={onMarkPaid}><CheckCircle2 className="mr-2 h-3.5 w-3.5" />Mark paid</DropdownMenuItem>}
      {!raw.archived_at && !paid && raw.payment_status !== "Overdue" && <DropdownMenuItem onSelect={onMarkOverdue}><AlertTriangle className="mr-2 h-3.5 w-3.5" />Mark overdue</DropdownMenuItem>}
      {!raw.archived_at && !paid && <>
        <DropdownMenuItem onSelect={() => void copyLink("copy")}><Copy className="mr-2 h-3.5 w-3.5" />{linkReady ? "Copy payment link" : "Create payment link"}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyLink("share")}><Share2 className="mr-2 h-3.5 w-3.5" />{linkReady ? "Share payment link" : "Create & share payment link"}</DropdownMenuItem>
        {raw.stripe_payment_link && <DropdownMenuItem onSelect={onEmailLink}><Send className="mr-2 h-3.5 w-3.5" />Email payment setup request</DropdownMenuItem>}
      </>}
      {(raw.stripe_subscription_id || raw.stripe_checkout_session_id) && <DropdownMenuItem onSelect={() => void syncWithStripe()}><RefreshCw className="mr-2 h-3.5 w-3.5" />Sync with Stripe</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => void downloadPurchasePdf(raw, clientName)}><Download className="mr-2 h-3.5 w-3.5" />Download PDF</DropdownMenuItem>
      <DropdownMenuSeparator />
      {raw.archived_at ? <DropdownMenuItem onSelect={() => void restore()}><ArchiveRestore className="mr-2 h-3.5 w-3.5" />Restore sale</DropdownMenuItem> : <DropdownMenuItem onSelect={() => void archive()}><Archive className="mr-2 h-3.5 w-3.5" />Archive sale</DropdownMenuItem>}
      {removable && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void remove()}><Trash2 className="mr-2 h-3.5 w-3.5" />Remove unpaid sale</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function InstallmentSummary({ display }: { display: PaymentDisplay }) {
  const plan = display.installmentPlan;
  if (!plan) return <div className="text-xs text-muted-foreground tabular-nums">{formatMoney(display.contractTotal, display.currency)}{display.amountOutstanding > 0 && ` · ${formatMoney(display.amountOutstanding, display.currency)} remaining`}</div>;
  return <div className="text-xs text-muted-foreground tabular-nums"><div>{formatMoney(plan.contractTotal, display.currency)} total · {formatMoney(plan.amountPaid, display.currency)} paid · {formatMoney(plan.amountRemaining, display.currency)} remaining</div><div>{plan.numberOfPayments} × {formatMoney(plan.installmentAmount, display.currency)} · {plan.paymentsMade} / {plan.numberOfPayments} paid</div></div>;
}