import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Copy, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { voidLedgerRow } from "@/lib/billing.functions";
import {
  stripeCustomerUrl,
  stripePaymentIntentUrl,
  stripeChargeUrl,
  stripeInvoiceUrl,
  stripeCheckoutSessionUrl,
  stripeSubscriptionUrl,
  stripeProductUrl,
  stripePriceUrl,
} from "@/lib/stripe-links";
import type { AdminTransactionRow } from "@/lib/admin-transactions";

function statusTone(status: string | null | undefined) {
  const s = (status ?? "").toLowerCase();
  if (s === "paid") return "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
  if (s === "refunded" || s === "voided") return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  if (s === "failed") return "bg-red-500/15 text-red-500 border-red-500/30";
  if (s === "pending") return "bg-blue-500/15 text-blue-500 border-blue-500/30";
  return "bg-muted text-muted-foreground border-border";
}

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error("Copy failed"),
  );
}

function Row({ label, value, onCopy }: { label: string; value?: React.ReactNode; onCopy?: () => void }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 text-right font-mono text-xs">
        <span className="max-w-[260px] truncate">{value}</span>
        {onCopy && (
          <button type="button" onClick={onCopy} className="text-muted-foreground hover:text-foreground">
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function StripeButton({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="justify-start gap-2"
      onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
    >
      <ExternalLink className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

export function TransactionDetailDrawer({
  txn,
  open,
  onOpenChange,
}: {
  txn: AdminTransactionRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!txn) return null;
  const mode = txn.stripe_mode;

  const amountFmt = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: txn.currency || "USD",
  }).format(txn.amount ?? 0);

  const profileHref =
    txn.subject_kind === "client"
      ? `/admin/clients/${txn.subject_id}`
      : `/admin/members/${txn.subject_id}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={statusTone(txn.status)}>{txn.status}</Badge>
            <Badge variant="outline" className="capitalize">{txn.purchase_type ?? txn.source}</Badge>
            {mode === "test" && <Badge variant="outline" className="border-amber-500/30 text-amber-500">TEST</Badge>}
          </div>
          <SheetTitle className="text-xl">{amountFmt}</SheetTitle>
          <SheetDescription>{new Date(txn.occurred_at).toLocaleString()}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <section>
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Who</h3>
            <div className="rounded-lg border border-border bg-card p-3">
              <Link to={profileHref} onClick={() => onOpenChange(false)} className="font-medium hover:underline">
                {txn.subject_name ?? "Unknown"}
              </Link>
              <div className="text-xs text-muted-foreground">{txn.subject_email}</div>
              <div className="text-xs text-muted-foreground mt-1 capitalize">{txn.subject_kind}</div>
            </div>
          </section>

          <section>
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">What</h3>
            <div className="rounded-lg border border-border bg-card p-3">
              {txn.offer_id ? (
                <Link
                  to="/admin/products-history/$offerId"
                  params={{ offerId: txn.offer_id }}
                  onClick={() => onOpenChange(false)}
                  className="font-medium hover:underline"
                >
                  {txn.product_name}
                </Link>
              ) : (
                <span className="font-medium">{txn.product_name}</span>
              )}
              <div className="text-xs text-muted-foreground mt-1">
                {txn.txn_type} · {txn.method ?? "—"}
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Stripe references</h3>
            <div className="rounded-lg border border-border bg-card px-3">
              <Row label="Customer" value={txn.stripe_customer_id} onCopy={txn.stripe_customer_id ? () => copy(txn.stripe_customer_id!, "Customer ID") : undefined} />
              <Row label="Payment intent" value={txn.stripe_payment_intent_id} onCopy={txn.stripe_payment_intent_id ? () => copy(txn.stripe_payment_intent_id!, "Payment intent") : undefined} />
              <Row label="Charge" value={txn.stripe_charge_id} onCopy={txn.stripe_charge_id ? () => copy(txn.stripe_charge_id!, "Charge") : undefined} />
              <Row label="Invoice" value={txn.stripe_invoice_id} onCopy={txn.stripe_invoice_id ? () => copy(txn.stripe_invoice_id!, "Invoice") : undefined} />
              <Row label="Checkout session" value={txn.stripe_checkout_session_id} onCopy={txn.stripe_checkout_session_id ? () => copy(txn.stripe_checkout_session_id!, "Checkout session") : undefined} />
              <Row label="Subscription" value={txn.stripe_subscription_id} onCopy={txn.stripe_subscription_id ? () => copy(txn.stripe_subscription_id!, "Subscription") : undefined} />
              <Row label="Product" value={txn.stripe_product_id} onCopy={txn.stripe_product_id ? () => copy(txn.stripe_product_id!, "Product") : undefined} />
              <Row label="Price" value={txn.stripe_price_id} onCopy={txn.stripe_price_id ? () => copy(txn.stripe_price_id!, "Price") : undefined} />
              {!txn.stripe_customer_id &&
                !txn.stripe_payment_intent_id &&
                !txn.stripe_invoice_id &&
                !txn.stripe_checkout_session_id &&
                !txn.stripe_subscription_id && (
                  <div className="py-3 text-xs text-muted-foreground">No Stripe references recorded.</div>
                )}
            </div>
          </section>

          <section>
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Open in Stripe</h3>
            <div className="grid grid-cols-2 gap-2">
              <StripeButton href={stripeCustomerUrl(txn.stripe_customer_id, mode)} label="Customer" />
              <StripeButton href={stripePaymentIntentUrl(txn.stripe_payment_intent_id, mode)} label="Payment" />
              <StripeButton href={stripeChargeUrl(txn.stripe_charge_id, mode)} label="Charge" />
              <StripeButton href={stripeInvoiceUrl(txn.stripe_invoice_id, mode)} label="Invoice" />
              <StripeButton href={stripeCheckoutSessionUrl(txn.stripe_checkout_session_id, mode)} label="Checkout session" />
              <StripeButton href={stripeSubscriptionUrl(txn.stripe_subscription_id, mode)} label="Subscription" />
              <StripeButton href={stripeProductUrl(txn.stripe_product_id, mode)} label="Product" />
              <StripeButton href={stripePriceUrl(txn.stripe_price_id, mode)} label="Price" />
            </div>
            {txn.receipt_url && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2 w-full justify-start gap-2"
                onClick={() => window.open(txn.receipt_url!, "_blank", "noopener,noreferrer")}
              >
                <Receipt className="h-3.5 w-3.5" /> Open receipt
              </Button>
            )}
            {txn.invoice_pdf_url && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2 w-full justify-start gap-2"
                onClick={() => window.open(txn.invoice_pdf_url!, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="h-3.5 w-3.5" /> Invoice PDF
              </Button>
            )}
            {txn.hosted_invoice_url && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2 w-full justify-start gap-2"
                onClick={() => window.open(txn.hosted_invoice_url!, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="h-3.5 w-3.5" /> Hosted invoice
              </Button>
            )}
          </section>

          {txn.admin_notes && (
            <>
              <Separator />
              <section>
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Admin notes</h3>
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                  {txn.admin_notes}
                </div>
              </section>
            </>
          )}

          {/* Void action — only for client-source ledger rows that aren't already voided */}
          {txn.source === "client" && txn.status?.toLowerCase() !== "voided" && txn.status?.toLowerCase() !== "refunded" && (
            <>
              <Separator />
              <VoidTransactionSection
                ledgerId={txn.id}
                amount={new Intl.NumberFormat(undefined, { style: "currency", currency: txn.currency || "USD" }).format(txn.amount ?? 0)}
                date={new Date(txn.occurred_at).toLocaleDateString()}
                onVoided={() => onOpenChange(false)}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function VoidTransactionSection({ ledgerId, amount, date, onVoided }: { ledgerId: string; amount: string; date: string; onVoided: () => void }) {
  const fn = useServerFn(voidLedgerRow);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const VOID_REASONS = ["Duplicate entry", "Entered in error", "Test transaction", "Refunded outside system", "Other"];
  const m = useMutation({
    mutationFn: async () => {
      const finalReason = reason === "Other" ? customReason.trim() : reason;
      if (!finalReason) throw new Error("Please select or enter a reason");
      return fn({ data: { ledger_id: ledgerId, reason: finalReason } });
    },
    onSuccess: () => { toast.success("Transaction voided"); setOpen(false); onVoided(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <section>
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Admin actions</h3>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/5"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-3.5 w-3.5" /> Void transaction
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Void Transaction</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-md bg-muted/50 border border-border px-3 py-2 text-sm">
              <div className="text-muted-foreground text-xs">{date}</div>
              <div className="font-semibold">{amount}</div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Reason <span className="text-destructive">*</span></Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger><SelectValue placeholder="Select a reason\u2026" /></SelectTrigger>
                <SelectContent>{VOID_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
              {reason === "Other" && (
                <Input placeholder="Describe the reason\u2026" autoFocus value={customReason} onChange={e => setCustomReason(e.target.value)} />
              )}
            </div>
            <p className="text-xs text-muted-foreground">Marks the transaction as voided and inserts an offsetting reversal. The original record is preserved for audit.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => m.mutate()} disabled={!reason || (reason === "Other" && !customReason.trim()) || m.isPending}>
              {m.isPending ? "Voiding\u2026" : "Void Transaction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}