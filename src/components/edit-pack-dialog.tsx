import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { updateSessionPack } from "@/lib/pt-pack.functions";

type Pack = {
  id: string;
  offer_name: string;
  currency?: string | null;
  sessions_purchased?: number | null;
  contract_value_cents?: number | null;
  amount_paid_cents?: number | null;
  package_expiry_date?: string | null;
  show_value_to_client?: boolean | null;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  pack: Pack | null;
  onSaved: () => void;
};

/**
 * Edit a session pack's value, amount paid, session count, and expiry.
 * Every change requires a reason and is written to the financial audit log.
 */
export function EditPackDialog({ open, onOpenChange, clientId, pack, onSaved }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [sessions, setSessions] = useState<number>(1);
  const [value, setValue] = useState<string>("");
  const [paid, setPaid] = useState<string>("");
  const [expiry, setExpiry] = useState("");
  const [showValue, setShowValue] = useState(true);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !pack) return;
    setName(pack.offer_name ?? "");
    setSessions(Number(pack.sessions_purchased ?? 1));
    setValue(((pack.contract_value_cents ?? 0) / 100).toString());
    setPaid(((pack.amount_paid_cents ?? 0) / 100).toString());
    setExpiry(pack.package_expiry_date ?? "");
    setShowValue(pack.show_value_to_client !== false);
    setReason("");
  }, [open, pack]);

  if (!pack) return null;
  const currency = pack.currency ?? "CAD";
  const valueMinor = Math.round((Number(value) || 0) * 100);
  const paidMinor = Math.round((Number(paid) || 0) * 100);
  const listedPer = sessions > 0 ? valueMinor / sessions / 100 : 0;
  const paidPer = sessions > 0 ? paidMinor / sessions / 100 : 0;
  const outstanding = Math.max(valueMinor - paidMinor, 0);

  const save = async () => {
    if (!name.trim()) return toast.error("Package name is required");
    if (paidMinor > valueMinor) return toast.error("Amount paid cannot exceed the package value");
    if (reason.trim().length < 2) return toast.error("Add a reason for the audit trail");
    setSaving(true);
    try {
      const res = await updateSessionPack({
        data: {
          purchaseId: pack.id,
          packageName: name.trim(),
          totalValueMinor: valueMinor,
          amountPaidMinor: paidMinor,
          sessionCount: sessions,
          expiryDate: expiry || null,
          showValueToClient: showValue,
          reason: reason.trim(),
        },
      });
      toast.success(
        res.paymentStatus === "Paid"
          ? "Pack updated — paid in full, credits active"
          : `Pack updated — ${currency} ${(res.outstandingMinor / 100).toFixed(2)} still due`,
      );
      qc.invalidateQueries({ queryKey: ["pt-balance", clientId] });
      qc.invalidateQueries({ queryKey: ["pt-pack-purchases", clientId] });
      qc.invalidateQueries({ queryKey: ["client-session-credits", clientId] });
      qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4 text-primary" /> Edit Session Pack</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Package name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Sessions</Label>
              <Input type="number" min={1} max={500} value={sessions} onChange={(e) => setSessions(Math.max(1, parseInt(e.target.value || "1", 10) || 1))} />
            </div>
            <div>
              <Label>Total value ({currency})</Label>
              <Input type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div>
              <Label>Amount paid ({currency})</Label>
              <Input type="number" min={0} step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
            {sessions} session{sessions === 1 ? "" : "s"} · ${listedPer.toFixed(2)}/session value · ${paidPer.toFixed(2)}/session paid value
            {outstanding > 0
              ? <> · <strong className="text-warning">{currency} {(outstanding / 100).toFixed(2)} due</strong></>
              : <> · <strong className="text-success">paid in full</strong></>}
          </div>

          <div>
            <Label>Expiry date (optional)</Label>
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
            <Label className="text-xs">Show price to client</Label>
            <Switch checked={showValue} onCheckedChange={setShowValue} />
          </div>

          <div>
            <Label>Reason (required)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client paid remaining balance in cash" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-gradient-primary font-bold uppercase">
            {saving ? "Saving…" : "Save Pack"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}