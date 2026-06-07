import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";

function statusBadgeClass(s?: string | null) {
  if (s === "Paid" || s === "Active Subscription") return "border-green-500/40 text-green-500 bg-green-500/10";
  if (s === "Overdue" || s === "Failed" || s === "Manual Payment Needed") return "border-destructive/40 text-destructive bg-destructive/5";
  if (s === "Cancelled" || s === "Refunded" || s === "Expired") return "border-border text-muted-foreground";
  return "border-warning/40 text-warning bg-warning/5";
}
function statusLabel(s?: string | null) {
  if (s === "Paid") return "Paid · Active";
  if (s === "Active Subscription") return "Active subscription";
  if (s === "Cancelled") return "Cancelled";
  if (!s || s === "Not Sent" || s === "Sent" || s === "Pending") return "Payment setup needed";
  return s;
}

export const Route = createFileRoute("/_authenticated/portal/purchases")({
  component: MyPurchases,
  validateSearch: (s: Record<string, unknown>) => ({
    checkout: s.checkout as string | undefined,
  }),
});

function MyPurchases() {
  const portalUserId = usePortalUserId();
  const search = useSearch({ from: "/_authenticated/portal/purchases" });

  // Show success toast when returning from Stripe Checkout
  useEffect(() => {
    if (search.checkout === "success") {
      toast.success("Payment successful! Your access has been updated.", { duration: 6000 });
    }
  }, [search.checkout]);

  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () =>
      (await supabase.from("clients").select("id").eq("user_id", portalUserId!).maybeSingle()).data,
  });

  const { data: records = [] } = useQuery({
    queryKey: ["my-purchases", client?.id],
    enabled: !!client?.id,
    queryFn: async () =>
      (
        await supabase
          .from("purchase_records")
          .select("*")
          .eq("client_id", client!.id)
          .order("purchased_at", { ascending: false })
      ).data ?? [],
  });

  return (
    <>
      <PageHeader
        title="My Purchases"
        subtitle="Your coaching purchases and billing history."
      />
      <div className="p-6 md:p-8 space-y-8">

        {/* ── Purchase History ─────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Purchase History</h2>
          {records.length === 0 ? (
            <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">
              No purchases yet. Your coach will send you a payment link when a plan is ready for you.
            </Card>
          ) : (
            <div className="space-y-3">
              {records.map((r: any) => (
                <Link key={r.id} to="/portal/purchases/$id" params={{ id: r.id }}>
                  <Card className="border-border bg-card p-4 hover:bg-secondary/30 transition flex items-center justify-between">
                    <div>
                      <div className="font-bold">{r.offer_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.offer_type} · {new Date(r.purchased_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!r.terms_accepted && <Badge className="bg-gradient-primary">Action needed</Badge>}
                      <Badge variant="outline" className={statusBadgeClass(r.payment_status)}>{statusLabel(r.payment_status)}</Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
