import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { todayLocalISO } from "@/lib/today";

export const Route = createFileRoute("/_authenticated/admin/purchases")({ component: PurchasesRedirect });

function PurchasesRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/sales", search: { tab: "products-payments", sub: "purchases" } as any, replace: true });
  }, [navigate]);
  return null;
}

export function PurchasesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: records = [] } = useQuery({
    queryKey: ["purchase-records"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_records")
        .select("*, clients!inner(id, full_name, email, agreement_signed)")
        .order("purchased_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const exportCsv = () => {
    const headers = ["Date", "Client", "Email", "Offer", "Type", "Amount", "Currency", "Payment status", "Terms accepted", "Agreement signed"];
    const rows = records.map((r) => [
      new Date(r.purchased_at).toISOString(),
      r.clients?.full_name ?? "",
      r.clients?.email ?? "",
      r.offer_name,
      r.offer_type ?? "",
      r.full_payable_amount ?? "",
      r.currency ?? "",
      r.payment_status,
      r.terms_accepted ? "yes" : "no",
      r.agreement_signed_at_purchase ? "yes" : "no",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `purchase-records-${todayLocalISO()}.csv`;
    a.click();
  };

  return (
    <>
      {!embedded && <PageHeader
        title="Purchase Records"
        subtitle="Every offer assigned or sold to a client, snapshotted at purchase time."
        actions={<Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Export CSV</Button>}
      />}
      {embedded && (
        <div className="flex justify-end px-6 pt-4 md:px-8">
          <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
        </div>
      )}
      <div className="p-6 md:p-8">
        {records.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No purchase records yet.</div>
        ) : (
          <div className="space-y-3">
            {records.map((r) => (
              <Link key={r.id} to="/admin/purchases/$id" params={{ id: r.id }}>
                <Card className="border-border bg-card p-4 hover:bg-secondary/30 transition">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-bold">{r.offer_name} <span className="text-xs text-muted-foreground font-normal">v{r.offer_version ?? 1}</span></div>
                      <div className="text-xs text-muted-foreground">{r.clients?.full_name} · {new Date(r.purchased_at).toLocaleDateString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{r.currency ?? "USD"} {Number(r.full_payable_amount ?? 0).toLocaleString()}</span>
                      <Badge variant={r.payment_status === "Paid" ? "default" : "outline"} className={r.payment_status === "Paid" ? "bg-gradient-primary" : ""}>{r.payment_status}</Badge>
                      <Badge variant="outline" className={r.terms_accepted ? "border-primary/40 text-primary" : "text-muted-foreground"}>{r.terms_accepted ? "Accepted" : "Not accepted"}</Badge>
                      <Badge variant="outline" className={r.agreement_signed_at_purchase ? "border-primary/40 text-primary" : "border-destructive/40 text-destructive"}>{r.agreement_signed_at_purchase ? "Agreement ✓" : "No agreement"}</Badge>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}