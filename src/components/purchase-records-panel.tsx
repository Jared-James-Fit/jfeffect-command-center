import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { ShoppingBag, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AssignOfferDialog } from "@/components/assign-offer-dialog";

export function PurchaseRecordsPanel({ clientId }: { clientId: string }) {
  const [picker, setPicker] = useState(false);
  const [chosenOffer, setChosenOffer] = useState<any | null>(null);

  const { data: records = [] } = useQuery({
    queryKey: ["client-purchases", clientId],
    queryFn: async () => (await supabase.from("purchase_records").select("*").eq("client_id", clientId).order("purchased_at", { ascending: false })).data ?? [],
  });

  const { data: offers = [] } = useQuery({
    queryKey: ["offers-pickable"],
    enabled: picker,
    queryFn: async () => (await supabase.from("offers").select("*").eq("archived", false).order("name")).data ?? [],
  });

  return (
    <Card className="border-border bg-card p-6 md:col-span-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><ShoppingBag className="h-4 w-4" />Purchase History</h3>
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => setPicker(true)}><Plus className="mr-1.5 h-3 w-3" />Assign offer</Button>
      </div>
      {records.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No purchases yet.</div>
      ) : (
        <ul className="space-y-2">
          {records.map((r: any) => (
            <li key={r.id}>
              <Link to="/admin/purchases/$id" params={{ id: r.id }}>
                <div className="rounded-md border border-border bg-secondary/20 p-3 hover:bg-secondary/40 transition flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">{r.offer_name} <span className="text-xs text-muted-foreground font-normal">v{r.offer_version}</span></div>
                    <div className="text-xs text-muted-foreground">{r.offer_type} · {new Date(r.purchased_at).toLocaleDateString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono">{r.currency} {Number(r.full_payable_amount ?? 0).toLocaleString()}</span>
                    <Badge variant="outline">{r.payment_status}</Badge>
                    <Badge variant="outline" className={r.terms_accepted ? "border-primary/40 text-primary" : ""}>{r.terms_accepted ? "Accepted" : "Pending"}</Badge>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Pick an offer</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {offers.map((o: any) => (
              <button key={o.id} type="button" onClick={() => { setChosenOffer(o); setPicker(false); }} className="w-full text-left rounded-md border border-border bg-secondary/20 p-3 hover:bg-secondary/40">
                <div className="font-semibold">{o.name}</div>
                <div className="text-xs text-muted-foreground">{o.offer_type} · {o.currency ?? "USD"} {Number(o.full_payable_amount ?? o.price ?? 0).toLocaleString()}</div>
              </button>
            ))}
            {offers.length === 0 && <p className="text-sm text-muted-foreground">No active offers. Create one in Offers / Products.</p>}
          </div>
        </DialogContent>
      </Dialog>

      <AssignOfferDialog offer={chosenOffer} fixedClientId={clientId} onClose={() => setChosenOffer(null)} />
    </Card>
  );
}