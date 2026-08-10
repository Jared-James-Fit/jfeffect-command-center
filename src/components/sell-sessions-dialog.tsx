import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { sellSessionPack } from "@/lib/pt-pack.functions";
import { Ticket } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
};

/**
 * Sell a Personal Training session pack to a client.
 * Creates a purchase record; session credits are granted automatically when
 * the pack is paid in full (manual or via Stripe webhook reconciliation).
 */
export function SellSessionsDialog({ open, onOpenChange, clientId }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"package" | "custom">("package");
  const [packageId, setPackageId] = useState<string>("");
  const [name, setName] = useState("");
  const [sessions, setSessions] = useState<number>(6);
  const [price, setPrice] = useState<string>("");
  const [amountPaid, setAmountPaid] = useState<string>("");
  const [paymentMode, setPaymentMode] = useState<"paid" | "partial" | "pending">("paid");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [expiry, setExpiry] = useState<string>("");
  const [note, setNote] = useState("");
  const [showValue, setShowValue] = useState(true);
  const [saving, setSaving] = useState(false);

  const { data: packages = [] } = useQuery<any[]>({
    queryKey: ["session-credit-packages", "active"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("session_credit_packages")
        .select("id, name, session_count, unit_price_minor, total_price_minor, currency")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!open) return;
    setMode("package");
    setPackageId("");
    setName("");
    setSessions(6);
    setPrice("");
    setAmountPaid("");
    setPaymentMode("paid");
    setPaymentMethod("");
    setCurrency("CAD");
    setExpiry("");
    setNote("");
    setShowValue(true);
  }, [open]);

  const pickPackage = (id: string) => {
    setPackageId(id);
    const pkg = packages.find((p) => p.id === id);
    if (!pkg) return;
    setName(pkg.name);
    setSessions(pkg.session_count);
    setPrice(((pkg.total_price_minor ?? 0) / 100).toString());
  };

  const priceNum = Number(price) || 0;
  const paidNum = paymentMode === "paid" ? priceNum : paymentMode === "partial" ? Number(amountPaid) || 0 : 0;
  const perSession = sessions > 0 && priceNum > 0 ? priceNum / sessions : 0;
  const paidPerSession = sessions > 0 && paidNum > 0 ? paidNum / sessions : 0;
  const valueGap = Math.max(priceNum - paidNum, 0);

  const save = async () => {
    if (!name.trim()) return toast.error("Package name is required");
    if (!sessions || sessions < 1) return toast.error("Enter the number of sessions");
    if (paymentMode === "partial" && paidNum <= 0) return toast.error("Enter the amount paid");
    if (paidNum > priceNum) return toast.error("Amount paid cannot exceed the package value");
    setSaving(true);
    try {
      await sellSessionPack({
        data: {
          clientId,
          packageName: name.trim(),
          sessionCount: sessions,
          totalPriceMinor: Math.round(priceNum * 100),
          currency,
          paymentMode,
          amountPaidMinor: Math.round(paidNum * 100),
          paymentMethod: paymentMethod.trim() || null,
          expiryDate: expiry || null,
          note: note.trim() || null,
          showValueToClient: showValue,
        },
      });
      toast.success(
        paymentMode === "paid"
          ? "Session pack added — sessions active"
          : paymentMode === "partial"
            ? `Session pack added — ${currency} ${valueGap.toFixed(2)} still due`
            : "Session pack added — pending payment",
      );
      qc.invalidateQueries({ queryKey: ["pt-balance", clientId] });
      qc.invalidateQueries({ queryKey: ["pt-pack-purchases", clientId] });
      qc.invalidateQueries({ queryKey: ["client-session-credits", clientId] });
      qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add session pack");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Ticket className="h-4 w-4 text-primary" /> Sell Sessions</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {packages.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={mode === "package" ? "default" : "outline"} onClick={() => setMode("package")}>
                Pick a package
              </Button>
              <Button type="button" variant={mode === "custom" ? "default" : "outline"} onClick={() => setMode("custom")}>
                Custom pack
              </Button>
            </div>
          )}

          {mode === "package" && packages.length > 0 && (
            <div>
              <Label>Package</Label>
              <Select value={packageId} onValueChange={pickPackage}>
                <SelectTrigger><SelectValue placeholder="Select a session package" /></SelectTrigger>
                <SelectContent>
                  {packages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.session_count} sessions · {p.currency} {((p.total_price_minor ?? 0) / 100).toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Package name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Personal Training · 6 sessions" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Sessions</Label>
              <Input
                type="number" min={1} max={200} value={sessions}
                onChange={(e) => setSessions(Math.max(1, parseInt(e.target.value || "1", 10) || 1))}
              />
            </div>
            <div>
              <Label>Total price (CAD)</Label>
              <Input
                type="number" min={0} step="0.01" value={price} placeholder="300"
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>

          {perSession > 0 && (
            <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
              <strong>{sessions}</strong> session{sessions === 1 ? "" : "s"} · <strong>CAD {priceNum.toLocaleString()}</strong> total ·{" "}
              <strong>${perSession.toFixed(2)}/session</strong>
            </div>
          )}

          <div>
            <Label>Payment</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={paymentMode === "paid" ? "default" : "outline"} onClick={() => setPaymentMode("paid")}>
                Paid in full
              </Button>
              <Button type="button" variant={paymentMode === "pending" ? "default" : "outline"} onClick={() => setPaymentMode("pending")}>
                Pending payment
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {paymentMode === "paid"
                ? "Sessions are activated immediately."
                : "Sessions activate automatically once the purchase is marked paid (or a Stripe payment is reconciled)."}
            </p>
          </div>

          <div>
            <Label>Expiry date (optional)</Label>
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>

          <div>
            <Label>Admin notes (optional)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
            <Label className="text-xs">Show price to client</Label>
            <Switch checked={showValue} onCheckedChange={setShowValue} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-gradient-primary font-bold uppercase">
            {saving ? "Adding…" : "Add Session Pack"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}