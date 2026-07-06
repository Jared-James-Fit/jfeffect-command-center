import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/products-history/")({
  component: ProductsHistoryList,
});

function ProductsHistoryList() {
  const [q, setQ] = useState("");

  const { data: offers = [], isLoading } = useQuery({
    queryKey: ["admin-products-history-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offers")
        .select("id, name, offer_type, status, archived, price, currency, stripe_product_id, stripe_price_id")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: stats = [] } = useQuery({
    queryKey: ["admin-products-history-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_records")
        .select("offer_id, amount_paid, payment_status, status")
        .not("offer_id", "is", null);
      if (error) throw error;
      return (data ?? []) as Array<{ offer_id: string; amount_paid: number | null; payment_status: string | null; status: string | null }>;
    },
  });

  const byOffer = useMemo(() => {
    const m = new Map<string, { count: number; revenue: number; active: number }>();
    for (const p of stats) {
      const entry = m.get(p.offer_id) ?? { count: 0, revenue: 0, active: 0 };
      entry.count += 1;
      if ((p.payment_status ?? "").toLowerCase() === "paid") entry.revenue += Number(p.amount_paid ?? 0);
      if ((p.status ?? "").toLowerCase() === "active") entry.active += 1;
      m.set(p.offer_id, entry);
    }
    return m;
  }, [stats]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return offers;
    return offers.filter((o: any) => (o.name ?? "").toLowerCase().includes(term));
  }, [offers, q]);

  return (
    <>
      <PageHeader title="Product History" subtitle="Click any product/plan to see everyone who purchased it, revenue, and Stripe links." />
      <div className="p-6 md:p-8 space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product/plan" className="pl-8" />
        </div>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Product / Plan</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-right">Purchases</th>
                  <th className="px-4 py-2 text-right">Active</th>
                  <th className="px-4 py-2 text-right">Revenue</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No products.</td></tr>
                ) : (
                  filtered.map((o: any) => {
                    const s = byOffer.get(o.id) ?? { count: 0, revenue: 0, active: 0 };
                    return (
                      <tr key={o.id} className="border-t border-border hover:bg-muted/30">
                        <td className="px-4 py-2">
                          <Link to="/admin/products-history/$offerId" params={{ offerId: o.id }} className="font-medium hover:underline">
                            {o.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-xs capitalize text-muted-foreground">{o.offer_type ?? "—"}</td>
                        <td className="px-4 py-2 text-right">{s.count}</td>
                        <td className="px-4 py-2 text-right">{s.active}</td>
                        <td className="px-4 py-2 text-right font-medium">
                          {new Intl.NumberFormat(undefined, { style: "currency", currency: o.currency || "USD" }).format(s.revenue)}
                        </td>
                        <td className="px-4 py-2">
                          {o.archived
                            ? <Badge variant="outline" className="bg-muted text-muted-foreground">Archived</Badge>
                            : <Badge variant="outline" className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">Active</Badge>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}