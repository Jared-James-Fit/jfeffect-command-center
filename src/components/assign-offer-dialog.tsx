import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { snapshotOfferForPurchase } from "@/lib/offers";

export function AssignOfferDialog({ offer, onClose, fixedClientId }: { offer: any | null; onClose: () => void; fixedClientId?: string }) {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState<string>(fixedClientId ?? "");
  const [adminNotes, setAdminNotes] = useState("");
  const [recordPaid, setRecordPaid] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-assign-list"],
    enabled: !!offer && !fixedClientId,
    queryFn: async () => (await supabase.from("clients").select("id, full_name, email, agreement_status, agreement_signed").eq("archived", false).order("full_name")).data ?? [],
  });

  const { data: selectedClient } = useQuery({
    queryKey: ["client-for-assign", clientId],
    enabled: !!clientId,
    queryFn: async () => (await supabase.from("clients").select("id, full_name, email, agreement_status, agreement_signed, agreement_signed_date, agreement_version, agreement_link, timezone").eq("id", clientId).single()).data,
  });

  const submit = async () => {
    if (!offer || !clientId || !selectedClient) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const snap = snapshotOfferForPurchase(offer, { clientId, assignedBy: u.user?.id ?? null, timezone: selectedClient.timezone });
    const payload = {
      ...snap,
      admin_notes: adminNotes || null,
      agreement_signed_at_purchase: !!selectedClient.agreement_signed,
      agreement_signed_date: selectedClient.agreement_signed_date ?? null,
      agreement_version: selectedClient.agreement_version ?? null,
      agreement_link: selectedClient.agreement_link ?? null,
      payment_status: recordPaid ? "Paid" : "Pending",
      paid_at: recordPaid ? new Date().toISOString() : null,
      amount_paid: recordPaid ? snap.full_payable_amount ?? 0 : 0,
    };
    const { error } = await supabase.from("purchase_records").insert(payload as any);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Purchase record created");
    qc.invalidateQueries({ queryKey: ["purchase-records"] });
    qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
    onClose();
    setClientId(fixedClientId ?? "");
    setAdminNotes("");
    setRecordPaid(false);
  };

  return (
    <Dialog open={!!offer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Assign offer to client</DialogTitle></DialogHeader>
        {offer && (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-secondary/30 p-3">
              <div className="font-bold">{offer.name}</div>
              <div className="text-xs text-muted-foreground">{offer.offer_type} · v{offer.version ?? 1} · {offer.currency ?? "USD"} {Number(offer.full_payable_amount ?? offer.price ?? 0).toLocaleString()}</div>
            </div>
            {!fixedClientId && (
              <div>
                <Label>Client</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue placeholder="Pick a client" /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name} {c.agreement_signed ? "✓" : "⚠︎"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {selectedClient && (
              <div className={`rounded-md border p-3 text-sm ${selectedClient.agreement_signed ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5"}`}>
                <div className="flex items-center gap-2 font-semibold">
                  {selectedClient.agreement_signed ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
                  Coaching Agreement: <Badge variant="outline">{selectedClient.agreement_status ?? "Not Sent"}</Badge>
                </div>
                {!selectedClient.agreement_signed && (
                  <p className="mt-1 text-xs text-destructive">This client does not have a signed Coaching Agreement on file. You can still assign the offer.</p>
                )}
              </div>
            )}
            <div>
              <Label>Admin notes (optional)</Label>
              <Textarea rows={2} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={recordPaid} onCheckedChange={setRecordPaid} />
              <Label>Mark as already paid in full</Label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!clientId || busy} onClick={submit} className="bg-gradient-primary font-bold uppercase">{busy ? "Creating…" : "Create purchase record"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}