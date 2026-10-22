import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ShoppingBag, Plus, MoreHorizontal, ExternalLink, Pencil, Copy, Send, Download, RefreshCw, Share2,
  Archive, ArchiveRestore, Trash2, BellOff, Bell, CalendarClock, Banknote, Undo2, PlusCircle,
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
import { sendPaymentLinkEmail } from "@/lib/payments.functions";
import { getClientBillingOverview } from "@/lib/billing.functions";
import {
  archivePurchaseRecord,
  restorePurchaseRecord,
  removeUnpaidPurchaseRecord,
} from "@/lib/purchase-archive.functions";
import { resolvePaymentDisplay } from "@/lib/payment-display";
import { clientTaxRate } from "@/lib/client-billing-summary";
import { saleMoney, salePayments, type PaymentRow, type SaleMoney } from "@/lib/sale-money";
import { AccessBadge, hasPaymentDestination, nextPaymentCell, saleStatus } from "@/components/admin/sale-row-parts";
import { SaleCard } from "@/components/admin/sale-card";
import { AddSessionsDialog, RecordPaymentDialog, RefundDialog, VoidPaymentDialog } from "@/components/admin/sale-payment-dialogs";
import { paymentReminderStatus, paymentLinkExpiryText } from "@/lib/payment-reminder-status";
import { PaymentLinkExpiryDialog } from "@/components/admin/payment-link-expiry-dialog";

type ArchiveFilter = "current" | "archived" | "all";

type Row = { raw: any; money: SaleMoney; status: { label: string; tone: string }; payments: PaymentRow[] };

/** Which money dialog is open, and for which sale. */
type Open =
  | { kind: "pay" | "refund" | "sessions"; row: Row }
  | { kind: "void"; row: Row; payment: PaymentRow }
  | null;

/**
 * A client's sales, one card each: price, paid and what's left in the dollars
 * the client pays, the sessions on it, its payments, and every action on it in
 * one menu. Newest first.
 */
export function ClientSalesTable({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("current");
  const [picker, setPicker] = useState(false);
  const [editingDates, setEditingDates] = useState<any | null>(null);
  const [editingExpiry, setEditingExpiry] = useState<any | null>(null);
  const [dialog, setDialog] = useState<Open>(null);
  const sendFn = useServerFn(sendPaymentLinkEmail);
  const overviewFn = useServerFn(getClientBillingOverview);

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

  // Payments per sale: the same billing read as the balance card above.
  const { data: billing } = useQuery({
    queryKey: ["client-billing", clientId],
    queryFn: () => overviewFn({ data: { client_id: clientId } }),
  });

  // Sessions per package (shared with the Sessions panel).
  const { data: sessionBalance = [] } = useQuery<any[]>({
    queryKey: ["pt-balance", clientId],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("session_balance", { _client_id: clientId });
      return (data ?? []) as any[];
    },
  });
  const sessionsBySale = useMemo(() => new Map(sessionBalance.map((b: any) => [b.purchase_id, b])), [sessionBalance]);

  const rows: Row[] = useMemo(() => {
    const all = (records ?? []) as any[];
    const rate = clientTaxRate(all);
    const ledger = ((billing as any)?.ledger ?? []) as any[];
    const visible = all.filter((raw) => {
      if (archiveFilter === "all") return true;
      return archiveFilter === "archived" ? Boolean(raw.archived_at) : !raw.archived_at;
    });
    return visible.map((raw) => {
      const own = ledger.filter((l) => l.purchase_id === raw.id);
      const money = saleMoney(raw, own, rate);
      return { raw, money, status: saleStatus(raw, money), payments: salePayments(own) };
    });
  }, [records, billing, archiveFilter]);

  const invalidate = () => {
    for (const key of [["client-purchases", clientId], ["client-billing", clientId], ["pt-balance", clientId]]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };
  const emailLink = async (id: string) => {
    try { const res: any = await sendFn({ data: { id } }); if (res?.sent) toast.success("Payment setup request emailed"); else toast.message(res?.reason ?? "Email skipped"); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const addSale = <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => setPicker(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Add sale</Button>;
  const close = (o: boolean) => { if (!o) setDialog(null); };

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

      {!isLoading && !isError && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => {
            const { raw, money, status, payments } = row;
            return (
              <SaleCard
                key={raw.id}
                raw={raw}
                money={money}
                status={status}
                badges={!raw.archived_at && <AccessBadge raw={raw} />}
                sessions={sessionsBySale.get(raw.id)}
                payments={payments}
                notes={<SaleNotes raw={raw} waiting={money.state === "waiting"} />}
                onRecordPayment={() => setDialog({ kind: "pay", row })}
                onVoidPayment={(payment) => setDialog({ kind: "void", row, payment })}
                menu={
                  <RowMenu
                    raw={raw}
                    money={money}
                    clientName={clientLite?.full_name}
                    onRecordPayment={() => setDialog({ kind: "pay", row })}
                    onRefund={() => setDialog({ kind: "refund", row })}
                    onAddSessions={() => setDialog({ kind: "sessions", row })}
                    onEditDates={() => setEditingDates(raw)}
                    onSetExpiry={() => setEditingExpiry(raw)}
                    onEmailLink={() => emailLink(raw.id)}
                    onChanged={invalidate}
                  />
                }
              />
            );
          })}
        </div>
      )}

      {dialog && dialog.kind === "pay" && <RecordPaymentDialog sale={dialog.row.raw} money={dialog.row.money} open onOpenChange={close} onDone={invalidate} />}
      {dialog && dialog.kind === "refund" && <RefundDialog sale={dialog.row.raw} money={dialog.row.money} open onOpenChange={close} onDone={invalidate} />}
      {dialog && dialog.kind === "sessions" && <AddSessionsDialog sale={dialog.row.raw} open onOpenChange={close} onDone={invalidate} />}
      {dialog && dialog.kind === "void" && <VoidPaymentDialog payment={dialog.payment} currency={dialog.row.money.currency} open onOpenChange={close} onDone={invalidate} />}

      <AddSaleDialog open={picker} onOpenChange={setPicker} clientId={clientId} clientName={clientLite?.full_name ?? null} />
      {editingDates && <TermDateEditor purchase={editingDates} clientId={clientId} onClose={() => setEditingDates(null)} />}
      {editingExpiry && <PaymentLinkExpiryDialog purchase={editingExpiry} clientId={clientId} onClose={() => setEditingExpiry(null)} />}
    </Card>
  );
}

/** Payment link state and reminders, while nothing has been paid. */
function SaleNotes({ raw, waiting }: { raw: any; waiting: boolean }) {
  const display = resolvePaymentDisplay(raw);
  const next = nextPaymentCell(display, raw);
  const reminder = paymentReminderStatus(raw);
  const expiry = paymentLinkExpiryText(raw);
  const helper = waiting ? next.helper : null;
  if (!helper && !reminder && !expiry) return null;
  return <div className="space-y-0.5 text-xs">
    {helper && <p className="text-warning">{helper}</p>}
    {reminder && <p className={reminder.tone === "warn" ? "text-amber-500" : "text-muted-foreground"}>{reminder.text}</p>}
    {expiry && <p className="text-muted-foreground">{expiry}</p>}
  </div>;
}

function RowMenu({ raw, money, clientName, onRecordPayment, onRefund, onAddSessions, onEditDates, onSetExpiry, onEmailLink, onChanged }: {
  raw: any; money: SaleMoney; clientName?: string | null;
  onRecordPayment: () => void; onRefund: () => void; onAddSessions: () => void;
  onEditDates: () => void; onSetExpiry: () => void; onEmailLink: () => void; onChanged: () => void;
}) {
  const unpaid = !["Paid", "Active Subscription"].includes(String(raw.payment_status ?? "")) && money.state !== "ended" && money.kind !== "free";
  const linkReady = hasPaymentDestination(raw);
  const shareFn = useServerFn(createPaymentShareLink);
  const checkoutFn = useServerFn(createCheckoutSessionForAssignment);
  const reconcileFn = useServerFn(reconcilePurchaseWithStripe);
  const archiveFn = useServerFn(archivePurchaseRecord);
  const restoreFn = useServerFn(restorePurchaseRecord);
  const removeFn = useServerFn(removeUnpaidPurchaseRecord);
  const qc = useQueryClient();
  const live = !raw.archived_at;

  const syncWithStripe = async () => {
    const t = toast.loading("Reading this sale from Stripe…");
    try { const res: any = await reconcileFn({ data: { purchaseId: raw.id } }); if (!res?.ok) return void toast.error(res?.error ?? "Could not reconcile", { id: t }); qc.invalidateQueries({ queryKey: ["client-purchases"] }); onChanged(); toast.success(`Synced — ${res.status}`, { id: t, description: res.ledgerAdded ? `${res.ledgerAdded} missing payment(s) recorded.` : "Already up to date." }); }
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
    <DropdownMenuContent align="end" className="w-64">
      {live && money.kind !== "free" && money.state !== "ended" && <DropdownMenuItem onSelect={onRecordPayment}><Banknote className="mr-2 h-3.5 w-3.5" />Record a payment</DropdownMenuItem>}
      {live && money.paidCents > 0 && <DropdownMenuItem onSelect={onRefund}><Undo2 className="mr-2 h-3.5 w-3.5" />Record a refund</DropdownMenuItem>}
      {live && Number(raw.sessions_purchased ?? 0) > 0 && <DropdownMenuItem onSelect={onAddSessions}><PlusCircle className="mr-2 h-3.5 w-3.5" />Add sessions</DropdownMenuItem>}
      {live && <DropdownMenuItem onSelect={onEditDates}><Pencil className="mr-2 h-3.5 w-3.5" />{raw.term_start_date || raw.term_end_date ? "Edit dates" : "Set dates"}</DropdownMenuItem>}
      {live && unpaid && <>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void copyLink("copy")}><Copy className="mr-2 h-3.5 w-3.5" />{linkReady ? "Copy payment link" : "Create payment link"}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyLink("share")}><Share2 className="mr-2 h-3.5 w-3.5" />{linkReady ? "Share payment link" : "Create & share payment link"}</DropdownMenuItem>
        {raw.stripe_payment_link && <DropdownMenuItem onSelect={onEmailLink}><Send className="mr-2 h-3.5 w-3.5" />Email payment setup request</DropdownMenuItem>}
        {linkReady && <DropdownMenuItem onSelect={() => void toggleReminders()}>{raw.payment_reminders_paused ? <Bell className="mr-2 h-3.5 w-3.5" /> : <BellOff className="mr-2 h-3.5 w-3.5" />}{raw.payment_reminders_paused ? "Resume payment reminders" : "Pause payment reminders"}</DropdownMenuItem>}
        {linkReady && <DropdownMenuItem onSelect={onSetExpiry}><CalendarClock className="mr-2 h-3.5 w-3.5" />{raw.payment_link_expires_at ? "Change link expiry" : "Set link expiry"}</DropdownMenuItem>}
      </>}
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild><Link to="/admin/purchases/$id" params={{ id: raw.id }}><ExternalLink className="mr-2 h-3.5 w-3.5" />Sale details & notes</Link></DropdownMenuItem>
      {(raw.stripe_subscription_id || raw.stripe_checkout_session_id) && <DropdownMenuItem onSelect={() => void syncWithStripe()}><RefreshCw className="mr-2 h-3.5 w-3.5" />Sync with Stripe</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => void downloadPurchasePdf(raw, clientName)}><Download className="mr-2 h-3.5 w-3.5" />Download PDF</DropdownMenuItem>
      <DropdownMenuSeparator />
      {raw.archived_at ? <DropdownMenuItem onSelect={() => void restore()}><ArchiveRestore className="mr-2 h-3.5 w-3.5" />Restore sale</DropdownMenuItem> : <DropdownMenuItem onSelect={() => void archive()}><Archive className="mr-2 h-3.5 w-3.5" />Archive sale</DropdownMenuItem>}
      {removable && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void remove()}><Trash2 className="mr-2 h-3.5 w-3.5" />Delete unpaid setup</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
