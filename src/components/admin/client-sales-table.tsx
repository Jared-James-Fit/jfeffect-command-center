import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ShoppingBag, Plus, MoreHorizontal, ExternalLink, Pencil, Copy, Send, Download,
  CheckCircle2, AlertTriangle, RefreshCw, Share2, Archive, ArchiveRestore, Trash2, BellOff, Bell, CalendarClock,
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
import { resolvePaymentDisplay, type PaymentDisplay } from "@/lib/payment-display";
import { clientTaxRate } from "@/lib/client-billing-summary";
import {
  AccessBadge, SaleDates, SaleMoney, hasPaymentDestination, nextPaymentCell, nextText, resolveSaleStatus,
} from "@/components/admin/sale-row-parts";
import { paymentReminderStatus, paymentLinkExpiryText } from "@/lib/payment-reminder-status";
import { PaymentLinkExpiryDialog } from "@/components/admin/payment-link-expiry-dialog";

type SortKey = "recent" | "name" | "status" | "next";
type ArchiveFilter = "current" | "archived" | "all";

type Row = { raw: any; display: PaymentDisplay; status: { label: string; tone: string }; next: ReturnType<typeof nextPaymentCell> };

export function ClientSalesTable({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [sort, setSort] = useState<SortKey>("recent");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("current");
  const [picker, setPicker] = useState(false);
  const [editingDates, setEditingDates] = useState<any | null>(null);
  const [editingExpiry, setEditingExpiry] = useState<any | null>(null);
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

  // Sessions per package (shared with the Sessions panel) and the client's tax rate.
  const { data: sessionBalance = [] } = useQuery<any[]>({
    queryKey: ["pt-balance", clientId],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("session_balance", { _client_id: clientId });
      return (data ?? []) as any[];
    },
  });
  const sessionsBySale = useMemo(() => new Map(sessionBalance.map((b: any) => [b.purchase_id, b])), [sessionBalance]);
  const taxRate = useMemo(() => clientTaxRate((records ?? []) as any[]), [records]);

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
          <Table><TableHeader><TableRow><TableHead>Package</TableHead><TableHead>Dates</TableHead><TableHead>Next payment</TableHead><TableHead>Status</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>{rows.map(({ raw, display, status, next }) => (
              <TableRow key={raw.id} className={raw.archived_at ? "opacity-70" : undefined}>
                <TableCell className="max-w-[300px] space-y-1"><Link to="/admin/purchases/$id" params={{ id: raw.id }} className="font-medium hover:underline">{raw.offer_name ?? "Product"}</Link><SaleMoney display={display} rate={taxRate} sessions={sessionsBySale.get(raw.id)} /></TableCell>
                <TableCell className="text-sm"><SaleDates raw={raw} /></TableCell>
                <TableCell className="text-sm"><span className={next.tone}>{nextText(display, next, taxRate)}</span>{next.helper && <div className="text-[11px] text-muted-foreground">{next.helper}</div>}<ReminderLines raw={raw} /></TableCell>
                <TableCell><Badge variant="outline" className={status.tone}>{status.label}</Badge>{!raw.archived_at && <AccessBadge raw={raw} />}</TableCell>
                <TableCell><RowMenu raw={raw} clientName={clientLite?.full_name} onEditDates={() => setEditingDates(raw)} onSetExpiry={() => setEditingExpiry(raw)} onMarkPaid={() => markPaid(raw)} onMarkOverdue={() => markOverdue(raw)} onEmailLink={() => emailLink(raw.id)} onChanged={invalidate} /></TableCell>
              </TableRow>
            ))}</TableBody></Table>
        </div>

        <ul className="space-y-3 md:hidden">{rows.map(({ raw, display, status, next }) => (
          <li key={raw.id} className={`rounded-lg border border-border bg-secondary/20 p-3 space-y-2 ${raw.archived_at ? "opacity-70" : ""}`}>
            <div className="flex items-start justify-between gap-2"><Link to="/admin/purchases/$id" params={{ id: raw.id }} className="min-w-0"><div className="font-semibold">{raw.offer_name ?? "Product"}</div></Link><RowMenu raw={raw} clientName={clientLite?.full_name} onEditDates={() => setEditingDates(raw)} onSetExpiry={() => setEditingExpiry(raw)} onMarkPaid={() => markPaid(raw)} onMarkOverdue={() => markOverdue(raw)} onEmailLink={() => emailLink(raw.id)} onChanged={invalidate} /></div>
            <div className="flex flex-wrap items-center gap-1.5"><Badge variant="outline" className={status.tone}>{status.label}</Badge>{!raw.archived_at && <AccessBadge raw={raw} />}</div>
            <SaleMoney display={display} rate={taxRate} sessions={sessionsBySale.get(raw.id)} />
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs"><div><dt className="text-muted-foreground">Dates</dt><dd className="font-medium"><SaleDates raw={raw} /></dd></div><div><dt className="text-muted-foreground">Next payment</dt><dd className={next.tone}>{nextText(display, next, taxRate)}</dd></div></dl>
            {next.helper && <p className="text-[11px] text-muted-foreground">{next.helper}</p>}
            <ReminderLines raw={raw} />
          </li>
        ))}</ul>
      </>}

      <AddSaleDialog open={picker} onOpenChange={setPicker} clientId={clientId} clientName={clientLite?.full_name ?? null} />
      {editingDates && <TermDateEditor purchase={editingDates} clientId={clientId} onClose={() => setEditingDates(null)} />}
      {editingExpiry && <PaymentLinkExpiryDialog purchase={editingExpiry} clientId={clientId} onClose={() => setEditingExpiry(null)} />}
    </Card>
  );
}

/** Reminder progress and any explicit link expiry, under the sale's next-payment text. */
function ReminderLines({ raw }: { raw: any }) {
  const reminder = paymentReminderStatus(raw);
  const expiry = paymentLinkExpiryText(raw);
  if (!reminder && !expiry) return null;
  return <div className="space-y-0.5">
    {reminder && <div className={`text-[11px] ${reminder.tone === "warn" ? "text-amber-500" : "text-muted-foreground"}`}>{reminder.text}</div>}
    {expiry && <div className="text-[11px] text-muted-foreground">{expiry}</div>}
  </div>;
}

function RowMenu({ raw, clientName, onEditDates, onSetExpiry, onMarkPaid, onMarkOverdue, onEmailLink, onChanged }: {
  raw: any; clientName?: string | null; onEditDates: () => void; onSetExpiry: () => void; onMarkPaid: () => void; onMarkOverdue: () => void; onEmailLink: () => void; onChanged: () => void;
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

  const toggleReminders = async () => {
    const pause = !raw.payment_reminders_paused;
    const { error } = await (supabase as any).from("purchase_records").update({ payment_reminders_paused: pause }).eq("id", raw.id);
    if (error) return void toast.error(error.message ?? "Could not update reminders");
    toast.success(pause ? "Payment reminders paused" : "Payment reminders back on");
    onChanged();
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
    if (!window.confirm("Delete this unpaid payment setup permanently? Any open Stripe checkout will be closed first. Paid or transaction-backed sales cannot be deleted.")) return;
    try { await removeFn({ data: { id: raw.id } }); toast.success("Payment setup deleted"); onChanged(); }
    catch (e: any) { toast.error(e?.message ?? "Could not remove sale"); }
  };

  const protectedFinancialStatus = ["paid", "active subscription", "refunded", "partially paid"].includes(
    String(raw.payment_status ?? "").trim().toLowerCase(),
  );
  // An unpaid Checkout Session is a payment setup, not financial history by
  // itself. The server re-checks Stripe and expires an open session before
  // permanent removal. Paid/payment-intent/subscription/ledger-backed rows stay protected.
  const removable =
    !protectedFinancialStatus &&
    !raw.stripe_payment_intent_id &&
    !raw.stripe_subscription_id &&
    Number(raw.amount_paid ?? 0) <= 0 &&
    Number(raw.amount_paid_cents ?? 0) <= 0;

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
        {linkReady && <DropdownMenuItem onSelect={() => void toggleReminders()}>{raw.payment_reminders_paused ? <Bell className="mr-2 h-3.5 w-3.5" /> : <BellOff className="mr-2 h-3.5 w-3.5" />}{raw.payment_reminders_paused ? "Resume payment reminders" : "Pause payment reminders"}</DropdownMenuItem>}
        {linkReady && <DropdownMenuItem onSelect={onSetExpiry}><CalendarClock className="mr-2 h-3.5 w-3.5" />{raw.payment_link_expires_at ? "Change link expiry" : "Set link expiry"}</DropdownMenuItem>}
      </>}
      {(raw.stripe_subscription_id || raw.stripe_checkout_session_id) && <DropdownMenuItem onSelect={() => void syncWithStripe()}><RefreshCw className="mr-2 h-3.5 w-3.5" />Sync with Stripe</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => void downloadPurchasePdf(raw, clientName)}><Download className="mr-2 h-3.5 w-3.5" />Download PDF</DropdownMenuItem>
      <DropdownMenuSeparator />
      {raw.archived_at ? <DropdownMenuItem onSelect={() => void restore()}><ArchiveRestore className="mr-2 h-3.5 w-3.5" />Restore sale</DropdownMenuItem> : <DropdownMenuItem onSelect={() => void archive()}><Archive className="mr-2 h-3.5 w-3.5" />Archive sale</DropdownMenuItem>}
      {removable && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void remove()}><Trash2 className="mr-2 h-3.5 w-3.5" />Delete unpaid setup</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
