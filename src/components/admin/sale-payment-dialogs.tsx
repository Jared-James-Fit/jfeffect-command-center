/**
 * The money actions on one sale, each a plain dialog opened from the sale's
 * menu or its "Record a payment" button: record money that came in another
 * way (tax split out for you), refund, void a payment, add sessions.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField } from "@/components/ui/date-field";
import { todayLocalISO } from "@/lib/today";
import { formatMoney } from "@/lib/payment-display";
import { grantSessionsManually, recordPayment, recordRefund, voidLedgerRow } from "@/lib/billing.functions";
import type { PaymentRow, SaleMoney } from "@/lib/sale-money";

/** Ways money comes in by hand (Stripe payments arrive on their own). */
const METHODS = [
  { value: "etransfer", label: "E-transfer" },
  { value: "cash", label: "Cash" },
  { value: "credit_card", label: "Card" },
  { value: "debit", label: "Debit" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
] as const;
type Method = (typeof METHODS)[number]["value"];

/** Alberta's GST, when no payment shows the client's rate yet. */
const DEFAULT_RATE = 0.05;

const toCents = (text: string) => {
  const v = Number(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
};

type SaleRef = { id: string; offer_name?: string | null; currency?: string | null; stripe_subscription_id?: string | null };

function MethodPicker({ value, onChange }: { value: Method; onChange: (m: Method) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {METHODS.map((m) => (
        <Button key={m.value} type="button" variant={value === m.value ? "default" : "outline"} className="h-11" onClick={() => onChange(m.value)}>
          {m.label}
        </Button>
      ))}
    </div>
  );
}

export function RecordPaymentDialog({ sale, money, open, onOpenChange, onDone }: {
  sale: SaleRef; money: SaleMoney; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void;
}) {
  const fn = useServerFn(recordPayment);
  const currency = sale.currency ?? money.currency ?? "CAD";
  const suggested = money.next?.cents ?? (money.leftCents > 0 ? money.leftCents : money.kind === "subscription" ? money.priceCents : 0);
  const [amount, setAmount] = useState("");
  const [hasTax, setHasTax] = useState(true);
  const [method, setMethod] = useState<Method>("etransfer");
  const [date, setDate] = useState(todayLocalISO());
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount(suggested > 0 ? (suggested / 100).toFixed(2) : "");
    setHasTax(money.rate != null);
    setMethod("etransfer");
    setDate(todayLocalISO());
    setNote("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const rate = money.rate ?? DEFAULT_RATE;
  const cents = toCents(amount);
  const tax = hasTax ? Math.round((cents * rate) / (1 + rate)) : 0;
  const pct = `${Math.round(rate * 1000) / 10}%`;
  const viaStripe = !!sale.stripe_subscription_id || money.kind === "subscription";

  const m = useMutation({
    mutationFn: () => fn({ data: {
      purchase_id: sale.id, method, amount_minor: cents, tax_minor: tax, currency,
      transaction_date: date, external_reference: note.trim() || undefined,
    } }),
    onSuccess: () => { toast.success(`${formatMoney(cents / 100, currency)} recorded`); onOpenChange(false); onDone(); },
    onError: (e: any) => toast.error(e?.message ?? "Could not record the payment"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>{sale.offer_name ?? "Sale"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {viaStripe && (
            <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
              Card payments through Stripe show up here by themselves. Only record money paid another way, like an e-transfer or cash.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount received</Label>
            <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="h-12 text-lg tabular-nums" />
            <label className="flex items-center gap-2 pt-1 text-sm">
              <Checkbox checked={hasTax} onCheckedChange={(v) => setHasTax(!!v)} />
              Includes {pct} GST
            </label>
            {cents > 0 && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {hasTax ? `${formatMoney((cents - tax) / 100, currency)} + ${formatMoney(tax / 100, currency)} tax` : "No tax in this payment"}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>How they paid</Label>
            <MethodPicker value={method} onChange={setMethod} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-date">Date received</Label>
            <DateField id="pay-date" value={date} onChange={setDate} max={todayLocalISO()} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-note">Reference (optional)</Label>
            <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="E-transfer confirmation #" className="h-11" />
          </div>
        </div>
        <DialogFooter>
          <Button className="h-11 w-full sm:w-auto" onClick={() => m.mutate()} disabled={cents <= 0 || !date || m.isPending}>
            {m.isPending ? "Saving…" : cents > 0 ? `Record ${formatMoney(cents / 100, currency)}` : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RefundDialog({ sale, money, open, onOpenChange, onDone }: {
  sale: SaleRef; money: SaleMoney; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void;
}) {
  const fn = useServerFn(recordRefund);
  const currency = sale.currency ?? money.currency ?? "CAD";
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("etransfer");
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) { setAmount(""); setMethod("etransfer"); setReason(""); } }, [open]);
  const cents = toCents(amount);
  const tooMuch = cents > money.paidCents;

  const m = useMutation({
    mutationFn: () => fn({ data: { purchase_id: sale.id, amount_minor: cents, method, reason: reason.trim(), partial: cents < money.paidCents } }),
    onSuccess: () => { toast.success("Refund recorded"); onOpenChange(false); onDone(); },
    onError: (e: any) => toast.error(e?.message ?? "Could not record the refund"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record a refund</DialogTitle>
          <DialogDescription>
            Money you sent back for {sale.offer_name ?? "this sale"}. {formatMoney(money.paidCents / 100, currency)} has been paid on it.
            A card refund made in Stripe shows up by itself.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="refund-amount">Amount refunded</Label>
            <Input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="h-12 text-lg tabular-nums" />
            {tooMuch && <p className="text-xs text-destructive">That's more than was paid.</p>}
          </div>
          <div className="space-y-1.5">
            <Label>How you sent it</Label>
            <MethodPicker value={method} onChange={setMethod} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">Why</Label>
            <Textarea id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="destructive" className="h-11 w-full sm:w-auto" onClick={() => m.mutate()} disabled={cents <= 0 || tooMuch || reason.trim().length < 3 || m.isPending}>
            {m.isPending ? "Saving…" : "Record refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const VOID_REASONS = ["Recorded twice", "Entered by mistake", "Payment bounced", "Test"];

export function VoidPaymentDialog({ payment, currency, open, onOpenChange, onDone }: {
  payment: PaymentRow | null; currency: string; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void;
}) {
  const fn = useServerFn(voidLedgerRow);
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  const m = useMutation({
    mutationFn: () => fn({ data: { ledger_id: payment!.id, reason: reason.trim() } }),
    onSuccess: () => { toast.success("Payment voided"); onOpenChange(false); onDone(); },
    onError: (e: any) => toast.error(e?.message ?? "Could not void the payment"),
  });
  if (!payment) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Void this payment?</DialogTitle>
          <DialogDescription>
            {formatMoney(payment.cents / 100, currency)}{payment.date ? ` on ${payment.date}` : ""} stops counting as paid. It stays in the history, crossed out.
            This doesn't send money back: use Refund for that.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Why</Label>
          <div className="grid grid-cols-2 gap-2">
            {VOID_REASONS.map((r) => (
              <Button key={r} type="button" variant={reason === r ? "default" : "outline"} className="h-11" onClick={() => setReason(r)}>{r}</Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep it</Button>
          <Button variant="destructive" onClick={() => m.mutate()} disabled={!reason || m.isPending}>{m.isPending ? "Voiding…" : "Void payment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddSessionsDialog({ sale, open, onOpenChange, onDone }: {
  sale: SaleRef; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void;
}) {
  const fn = useServerFn(grantSessionsManually);
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { if (open) { setCount(""); setNote(""); } }, [open]);
  const n = Math.floor(Number(count));
  const m = useMutation({
    mutationFn: () => fn({ data: { purchase_id: sale.id, count: n, note: note.trim() || "Added by hand" } }),
    onSuccess: () => { toast.success(`${n} session${n === 1 ? "" : "s"} added`); onOpenChange(false); onDone(); },
    onError: (e: any) => toast.error(e?.message ?? "Could not add sessions"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add free sessions</DialogTitle>
          <DialogDescription>Extra sessions on {sale.offer_name ?? "this package"} at no charge, like a make-up session. This doesn't change what they pay. To sell another package, use Renew.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="add-count">How many</Label><Input id="add-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} className="h-11" /></div>
          <div className="space-y-1.5"><Label htmlFor="add-note">Why (optional)</Label><Input id="add-note" value={note} onChange={(e) => setNote(e.target.value)} className="h-11" /></div>
        </div>
        <DialogFooter>
          <Button className="h-11 w-full sm:w-auto" onClick={() => m.mutate()} disabled={!(n > 0) || m.isPending}>{m.isPending ? "Adding…" : "Add free sessions"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
