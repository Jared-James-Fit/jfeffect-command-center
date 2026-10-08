import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { businessToday } from "@/lib/billing-schedule";
import { businessDateOf, endOfBusinessDayIso } from "@/lib/payment-reminder-status";

/**
 * Payment links never expire on their own: they stay usable until the sale is
 * paid. Set a date here only when the offer genuinely has a deadline; after
 * that day the link stops working and the reminders stop.
 */
export function PaymentLinkExpiryDialog({
  purchase,
  clientId,
  onClose,
}: {
  purchase: { id: string; offer_name?: string | null; payment_link_expires_at?: string | null };
  clientId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState(businessDateOf(purchase.payment_link_expires_at));
  const [busy, setBusy] = useState(false);

  const save = async (value: string | null) => {
    setBusy(true);
    const { error } = await (supabase as any)
      .from("purchase_records")
      .update({ payment_link_expires_at: value })
      .eq("id", purchase.id);
    setBusy(false);
    if (error) return void toast.error(error.message ?? "Could not save");
    toast.success(value ? "Payment link will expire on that date" : "Payment link never expires");
    qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Payment link expiry</DialogTitle>
          <DialogDescription>
            {purchase.offer_name ?? "This sale"}: the link stays active until it is paid. Only set a date if the offer has a real deadline.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="link-expiry">Expires at the end of</Label>
          <Input id="link-expiry" type="date" min={businessToday()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void save(null)}>Never expires</Button>
          <Button disabled={busy || !date} onClick={() => void save(endOfBusinessDayIso(date))}>Save date</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
