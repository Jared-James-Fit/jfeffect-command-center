import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssignOfferDialog } from "@/components/assign-offer-dialog";
import { OfferDetailDialog } from "@/components/offer-detail-dialog";
import { Eye } from "lucide-react";

export function PriceCardPickerDialog({ open, onClose, fixedClientId }: { open: boolean; onClose: () => void; fixedClientId?: string }) {
  const [q, setQ] = useState("");
  const [assigning, setAssigning] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);

  const { data: offers = [] } = useQuery({
    queryKey: ["price-card-offers"],
    enabled: open,
    queryFn: async () => (await supabase.from("offers").select("*").eq("archived", false).neq("status", "Archived").order("name")).data ?? [],
  });

  const filtered = offers.filter((o: any) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return o.name?.toLowerCase().includes(s) || o.offer_type?.toLowerCase().includes(s);
  });

  return (
    <>
      <Dialog open={open && !assigning && !viewing} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Price Card / Offer Menu</DialogTitle>
          </DialogHeader>
          <Input placeholder="Search offers…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.length === 0 && (
              <div className="col-span-full rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No offers available.</div>
            )}
            {filtered.map((o: any) => (
              <Card key={o.id} className="border-border bg-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold">{o.name}</div>
                    <div className="text-xs text-muted-foreground">{o.offer_type}</div>
                  </div>
                  <Badge variant="outline">{o.status}</Badge>
                </div>
                {(o.full_payable_amount ?? o.price) != null && (
                  <div className="text-lg font-black">{o.currency ?? "USD"} {Number(o.full_payable_amount ?? o.price).toLocaleString()}</div>
                )}
                {o.payment_structure && <div className="text-xs text-muted-foreground">{o.payment_structure}</div>}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="bg-gradient-primary font-bold uppercase flex-1" onClick={() => setAssigning(o)}>Assign</Button>
                  <Button size="sm" variant="outline" onClick={() => setViewing(o)}><Eye className="h-3 w-3" /></Button>
                </div>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <OfferDetailDialog offer={viewing} onClose={() => setViewing(null)} onAssign={(o) => { setViewing(null); setAssigning(o); }} />
      <AssignOfferDialog offer={assigning} fixedClientId={fixedClientId} onClose={() => { setAssigning(null); onClose(); }} />
    </>
  );
}