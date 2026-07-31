import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ShoppingBag, Plus, MoreHorizontal, ExternalLink, Pencil, Copy, Send, Download,
  CheckCircle2, AlertTriangle, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { AssignOfferDialog } from "@/components/assign-offer-dialog";
import { TermDateEditor, downloadPurchasePdf } from "@/components/purchase-records-panel";
import { updatePurchasePayment, sendPaymentLinkEmail } from "@/lib/payments.functions";
import { resolvePaymentDisplay, formatMoney, type PaymentDisplay } from "@/lib/payment-display";

/**
 * Client profile → Sales.
 *
 * Trainerize-style table of everything sold to this client. Purely a
 * presentation reorganisation of `purchase_records` (the existing source of
 * truth) — no Stripe calls, no writes beyond the pre-existing quick actions
 * that already lived on the old purchase cards.
 *
 * Columns: Product · Type · Date added · Start · End · Next payment · Status
 */

type SortKey = "recent" | "name" | "status" | "next";

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

/** Clean, never-misleading status label derived from stored billing state. */
function resolveSaleStatus(r: any, d: PaymentDisplay): { label: string; tone: string } {
  // Payment-request lifecycle wins over renewal inference: a purchase that is
  // only awaiting checkout must never read as "Active".
  if (d.status === "draft") return { label: "Draft", tone: TONE.muted };
  if (d.status === "pending_payment") {
    return r.stripe_payment_link
      ? { label: "Payment Link Sent", tone: TONE.warn }
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

  // Non-recurring from here on.
  const end = r.term_end_date ?? r.package_expiry_date ?? null;
  const expired = end ? new Date(`${String(end).slice(0, 10)}T23:59:59`) < new Date() : false;
  if (expired) return { label: "Expired", tone: TONE.muted };
  if (d.isPaidInFull) return { label: "Paid in Full", tone: TONE.ok };
  if (d.status === "partially_paid") return { label: "Partially Paid", tone: TONE.warn };
  if (d.status === "unpaid" || d.status === "past_due") return { label: "Past Due", tone: TONE.bad };
  if (d.status === "pending_setup") return { label: "Payment setup pending", tone: TONE.warn };
  return { label: "Unknown", tone: TONE.muted };
}

/** Next Payment cell text — mirrors resolveRenewal, never fabricated. */
function nextPaymentCell(d: PaymentDisplay, raw?: any) {
  if (d.status === "draft") {
    return { text: "Not started", tone: "text-muted-foreground", helper: "Draft record — no payment requested." as string | null };
  }
  if (d.status === "pending_payment") {
    return {
      text: "Awaiting payment",
      tone: "text-amber-500",
      helper: raw?.stripe_payment_link ? "Payment link created — waiting on Stripe confirmation." : "Payment request created.",
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
  const [picker, setPicker] = useState(false);
  const [chosenOffer, setChosenOffer] = useState<any | null>(null);
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
      const { data, error } = await supabase
        .from("purchase_records")
        .select("*")
        .eq("client_id", clientId)
        .order("purchased_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    // Targeted freshness only: refetch on focus, and poll slowly *only* while
    // a payment request is still awaiting Stripe confirmation. No global polling.
    refetchOnWindowFocus: true,
    refetchInterval: (q) => {
      const rows = (q.state.data as any[]) ?? [];
      const waiting = rows.some((r) =>
        ["Pending Payment", "Payment Link Sent", "Pending"].includes(String(r.payment_status ?? "")),
      );
      return waiting ? 45_000 : false;
    },
  });

  const { data: offers = [] } = useQuery({
    queryKey: ["offers-pickable"],
    enabled: picker,
    queryFn: async () => (await supabase.from("offers").select("*").eq("archived", false).order("name")).data ?? [],
  });

  const rows: Row[] = useMemo(() => {
    const built = (records ?? []).map((raw: any) => {
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
  }, [records, sort]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
  const markPaid = async (r: any) => {
    try {
      await updateFn({ data: { id: r.id, payment_status: "Paid", amount_paid: Number(r.full_payable_amount ?? 0) } });
      toast.success("Marked paid"); invalidate();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const markOverdue = async (r: any) => {
    try { await updateFn({ data: { id: r.id, payment_status: "Overdue" } }); toast.success("Marked overdue"); invalidate(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const emailLink = async (id: string) => {
    try {
      const res: any = await sendFn({ data: { id } });
      if (res?.sent) toast.success("Payment setup request emailed"); else toast.message(res?.reason ?? "Email skipped");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const addSale = (
    <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => setPicker(true)}>
      <Plus className="mr-1.5 h-3.5 w-3.5" />Add sale
    </Button>
  );

  return (
    <Card className="border-border bg-card p-4 md:col-span-3 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <ShoppingBag className="h-4 w-4" />Sales
        </h3>
        <div className="flex items-center gap-2">
          {rows.length > 1 && (
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Newest first</SelectItem>
                <SelectItem value="name">Product name</SelectItem>
                <SelectItem value="status">Status</SelectItem>
                <SelectItem value="next">Next payment</SelectItem>
              </SelectContent>
            </Select>
          )}
          {addSale}
        </div>
      </div>

      {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading sales…</p>}

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center space-y-3">
          <p className="text-sm text-destructive">Sales could not be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-8 text-center space-y-3">
          <p className="text-sm font-medium">No products sold yet.</p>
          <p className="text-xs text-muted-foreground">
            Add a sale or send a payment setup request to connect a product to this client.
          </p>
          <div className="flex justify-center">{addSale}</div>
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <>
          {/* ── Desktop: clean table ── */}
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Date added</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Next payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ raw, display, status, next }) => (
                  <TableRow key={raw.id}>
                    <TableCell className="max-w-[220px]">
                      <Link to="/admin/purchases/$id" params={{ id: raw.id }} className="font-medium hover:underline">
                        {raw.offer_name ?? "Product"}
                      </Link>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatMoney(display.contractTotal, display.currency)}
                        {display.amountOutstanding > 0 && ` · ${formatMoney(display.amountOutstanding, display.currency)} outstanding`}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{raw.offer_type ?? "—"}</TableCell>
                    <TableCell className="text-sm">{fmtDate(raw.purchased_at) ?? "—"}</TableCell>
                    <TableCell className="text-sm">{fmtDate(raw.term_start_date) ?? <span className="text-muted-foreground italic">Not set</span>}</TableCell>
                    <TableCell className="text-sm">{fmtDate(raw.term_end_date) ?? <span className="text-muted-foreground italic">Not set</span>}</TableCell>
                    <TableCell className="text-sm">
                      <span className={next.tone}>{next.text}</span>
                      {next.helper && <div className="text-[11px] text-muted-foreground">{next.helper}</div>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className={status.tone}>{status.label}</Badge></TableCell>
                    <TableCell>
                      <RowMenu
                        raw={raw}
                        clientName={clientLite?.full_name}
                        onEditDates={() => setEditingDates(raw)}
                        onMarkPaid={() => markPaid(raw)}
                        onMarkOverdue={() => markOverdue(raw)}
                        onEmailLink={() => emailLink(raw.id)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* ── Mobile: stacked cards, no horizontal scroll ── */}
          <ul className="space-y-3 md:hidden">
            {rows.map(({ raw, display, status, next }) => (
              <li key={raw.id} className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <Link to="/admin/purchases/$id" params={{ id: raw.id }} className="min-w-0">
                    <div className="truncate font-semibold">{raw.offer_name ?? "Product"}</div>
                    <div className="text-xs text-muted-foreground">{raw.offer_type ?? "—"}</div>
                  </Link>
                  <RowMenu
                    raw={raw}
                    clientName={clientLite?.full_name}
                    onEditDates={() => setEditingDates(raw)}
                    onMarkPaid={() => markPaid(raw)}
                    onMarkOverdue={() => markOverdue(raw)}
                    onEmailLink={() => emailLink(raw.id)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className={status.tone}>{status.label}</Badge>
                  <span className="text-sm font-mono">{formatMoney(display.contractTotal, display.currency)}</span>
                  {display.amountOutstanding > 0 && (
                    <Badge variant="outline" className={TONE.warn}>
                      {formatMoney(display.amountOutstanding, display.currency)} outstanding
                    </Badge>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <Field label="Date added" value={fmtDate(raw.purchased_at) ?? "—"} />
                  <Field label="Start" value={fmtDate(raw.term_start_date) ?? "Not set"} />
                  <Field label="End" value={fmtDate(raw.term_end_date) ?? "Not set"} />
                  <div>
                    <dt className="text-muted-foreground">Next payment</dt>
                    <dd className={next.tone}>{next.text}</dd>
                  </div>
                </dl>
                {next.helper && <p className="text-[11px] text-muted-foreground">{next.helper}</p>}
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Pick a product</DialogTitle></DialogHeader>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {offers.map((o: any) => (
              <button
                key={o.id}
                type="button"
                onClick={() => { setChosenOffer(o); setPicker(false); }}
                className="w-full rounded-md border border-border bg-secondary/20 p-3 text-left hover:bg-secondary/40"
              >
                <div className="font-semibold">{o.name}</div>
                <div className="text-xs text-muted-foreground">
                  {o.offer_type} · {o.currency ?? "USD"} {Number(o.full_payable_amount ?? o.price ?? 0).toLocaleString()}
                </div>
              </button>
            ))}
            {offers.length === 0 && <p className="text-sm text-muted-foreground">No active products. Create one in Products.</p>}
          </div>
        </DialogContent>
      </Dialog>

      <AssignOfferDialog offer={chosenOffer} fixedClientId={clientId} onClose={() => setChosenOffer(null)} />
      {editingDates && (
        <TermDateEditor purchase={editingDates} clientId={clientId} onClose={() => setEditingDates(null)} />
      )}
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function RowMenu({
  raw, clientName, onEditDates, onMarkPaid, onMarkOverdue, onEmailLink,
}: {
  raw: any;
  clientName?: string | null;
  onEditDates: () => void;
  onMarkPaid: () => void;
  onMarkOverdue: () => void;
  onEmailLink: () => void;
}) {
  const paid = raw.payment_status === "Paid" || raw.payment_status === "Active Subscription";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Sale actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link to="/admin/purchases/$id" params={{ id: raw.id }}>
            <ExternalLink className="mr-2 h-3.5 w-3.5" />View sale details
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onEditDates()}>
          <Pencil className="mr-2 h-3.5 w-3.5" />{raw.term_start_date || raw.term_end_date ? "Edit dates" : "Set dates"}
        </DropdownMenuItem>
        {!paid && (
          <DropdownMenuItem onSelect={() => onMarkPaid()}>
            <CheckCircle2 className="mr-2 h-3.5 w-3.5" />Mark paid
          </DropdownMenuItem>
        )}
        {!paid && raw.payment_status !== "Overdue" && (
          <DropdownMenuItem onSelect={() => onMarkOverdue()}>
            <AlertTriangle className="mr-2 h-3.5 w-3.5" />Mark overdue
          </DropdownMenuItem>
        )}
        {raw.stripe_payment_link && (
          <>
            <DropdownMenuItem
              onSelect={() => { navigator.clipboard.writeText(raw.stripe_payment_link); toast.success("Payment link copied"); }}
            >
              <Copy className="mr-2 h-3.5 w-3.5" />Copy payment link
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onEmailLink()}>
              <Send className="mr-2 h-3.5 w-3.5" />Email payment setup request
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onSelect={() => { void downloadPurchasePdf(raw, clientName); }}>
          <Download className="mr-2 h-3.5 w-3.5" />Download PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}