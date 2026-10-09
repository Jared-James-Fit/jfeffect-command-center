import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updatePurchasePayment } from "@/lib/payments.functions";
import { RECORDABLE_PAYMENT_STATUSES } from "@/lib/permissions";
import { fmtCad } from "@/lib/business-tax";

export type PaymentToRecord = { id: string; client: string | null; offer: string | null; outstandingMinor: number };

/**
 * Record money in on a purchase: paid, partly paid, or still owed. Never a
 * refund, comp or cancellation (the server holds the finance login to the
 * same list).
 */
export function RecordPaymentDialog({
  sale, onOpenChange, onSaved,
}: {
  sale: PaymentToRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const updateFn = useServerFn(updatePurchasePayment);
  const [status, setStatus] = useState<string>("Paid");
  const [paidSoFar, setPaidSoFar] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sale) return;
    setStatus("Paid");
    setPaidSoFar("");
    setNote("");
  }, [sale?.id]);

  const partial = status === "Partially Paid";
  const amount = paidSoFar.trim() === "" ? undefined : Number(paidSoFar.replace(/[$,\s]/g, ""));
  const amountBad = amount !== undefined && (!Number.isFinite(amount) || amount < 0);
  const ready = !!sale && !amountBad && (!partial || amount !== undefined);

  const save = async () => {
    if (!sale || !ready) return;
    setBusy(true);
    try {
      await updateFn({ data: { id: sale.id, payment_status: status, amount_paid: amount, note: note.trim() || null } });
      toast.success(status === "Paid" ? `Marked paid: ${sale.client ?? "client"}` : `Saved: ${status}`);
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't record the payment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!sale} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            {sale ? `${sale.client ?? "Client"} · ${sale.offer ?? "Purchase"} · ${fmtCad(sale.outstandingMinor)} outstanding` : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECORDABLE_PAYMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paid-so-far">Total paid so far ($){partial ? "" : " (optional)"}</Label>
            <Input id="paid-so-far" inputMode="decimal" placeholder="e.g. 250" value={paidSoFar} onChange={(e) => setPaidSoFar(e.target.value)} />
            {amountBad && <p className="text-xs text-destructive">Enter an amount like 250 or 250.50.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-note">Note (optional)</Label>
            <Textarea id="pay-note" rows={2} placeholder="E-transfer received Oct 9" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!ready || busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
