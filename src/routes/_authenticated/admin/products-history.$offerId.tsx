import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import {
  stripeProductUrl,
  stripePriceUrl,
  stripeCustomerUrl,
  stripePaymentIntentUrl,
  stripeSubscriptionUrl,
  stripeCheckoutSessionUrl,
} from "@/lib/stripe-links";
import { TransactionDetailDrawer } from "@/components/payments/transaction-detail-drawer";
import type { AdminTransactionRow } from "@/lib/admin-transactions";

export const Route = createFileRoute("/_authenticated/admin/products-history/$offerId")({
  component: OfferHistory,
});

function statusTone(s?: string | null) {
  const v = (s ?? "").toLowerCase();
  if (v === "paid" || v === "active") return "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
  if (v === "refunded" || v === "cancelled" || v === "voided") return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  if (v === "failed") return "bg-red-500/15 text-red-500 border-red-500/30";
  if (v === "pending") return "bg-blue-500/15 text-blue-500 border-blue-500/30";
  return "bg-muted text-muted-foreground border-border";
}

function OfferHistory() {
  const { offerId } = Route.useParams();
  const [selectedTxn, setSelectedTxn] = useState<AdminTransactionRow | null>(null);

  const { data: offer } = useQuery({
    queryKey: ["offer", offerId],
    queryFn: async () => {
      const { data, error } = await supabase.from("offers").select("*").eq("id", offerId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: purchases = [] } = useQuery({
    queryKey: ["offer-purchases", offerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_records")
        .select("id, client_id, offer_name, amount_paid, full_payable_amount, currency, payment_status, status, assigned_at, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id, stripe_payment_intent_id, receipt_url, stripe_mode, clients(id, full_name, email)")
        .eq("offer_id", offerId)
        .order("assigned_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: txns = [] } = useQuery({
    queryKey: ["offer-transactions", offerId],
    queryFn: async () => {
      const c = supabase as unknown as { from: (t: string) => any };
      const { data, error } = await c
        .from("admin_transactions_v1")
        .select("*")
        .eq("offer_id", offerId)
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as AdminTransactionRow[];
    },
  });

  const stats = useMemo(() => {
    let paidCount = 0, activeCount = 0, refundedCount = 0, revenue = 0;
    for (const p of purchases as any[]) {
      if ((p.payment_status ?? "").toLowerCase() === "paid") { paidCount++; revenue += Number(p.amount_paid ?? 0); }
      if ((p.status ?? "").toLowerCase() === "active") activeCount++;
      if ((p.status ?? "").toLowerCase() === "refunded" || (p.status ?? "").toLowerCase() === "cancelled") refundedCount++;
    }
    return { paidCount, activeCount, refundedCount, revenue };
  }, [purchases]);

  const mode = (offer as any)?.stripe_mode as string | null | undefined;
  const currency = (offer as any)?.currency ?? "USD";

  return (
    <>
      <PageHeader
        title={(offer as any)?.name ?? "Product"}
        subtitle={<Link to="/admin/products-history" className="hover:underline">← All products</Link>}
      />
      <div className="p-6 md:p-8 space-y-6">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{(offer as any)?.offer_type ?? "—"}</div>
              <div className="mt-1 text-2xl font-semibold">{(offer as any)?.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Price: {new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number((offer as any)?.full_payable_amount ?? (offer as any)?.price ?? 0))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              {(offer as any)?.stripe_product_id && (
                <Button variant="outline" size="sm" onClick={() => window.open(stripeProductUrl((offer as any).stripe_product_id, mode)!, "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1" /> Product in Stripe
                </Button>
              )}
              {(offer as any)?.stripe_price_id && (
                <Button variant="outline" size="sm" onClick={() => window.open(stripePriceUrl((offer as any).stripe_price_id, mode)!, "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1" /> Price in Stripe
                </Button>
              )}
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4"><div className="text-xs uppercase tracking-widest text-muted-foreground">Purchases</div><div className="mt-1 text-2xl font-semibold">{purchases.length}</div></Card>
          <Card className="p-4"><div className="text-xs uppercase tracking-widest text-muted-foreground">Paid</div><div className="mt-1 text-2xl font-semibold text-emerald-500">{stats.paidCount}</div></Card>
          <Card className="p-4"><div className="text-xs uppercase tracking-widest text-muted-foreground">Active</div><div className="mt-1 text-2xl font-semibold">{stats.activeCount}</div></Card>
          <Card className="p-4"><div className="text-xs uppercase tracking-widest text-muted-foreground">Revenue</div><div className="mt-1 text-2xl font-semibold">{new Intl.NumberFormat(undefined, { style: "currency", currency }).format(stats.revenue)}</div></Card>
        </div>

        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">Everyone assigned or who purchased</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Client</th>
                  <th className="px-4 py-2 text-left">Payment</th>
                  <th className="px-4 py-2 text-left">Assignment</th>
                  <th className="px-4 py-2 text-right">Paid</th>
                  <th className="px-4 py-2 text-left">Stripe</th>
                </tr>
              </thead>
              <tbody>
                {(purchases as any[]).length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No purchases yet.</td></tr>
                ) : (purchases as any[]).map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-4 py-2">
                      <Link to="/admin/clients/$id" params={{ id: p.client_id }} className="font-medium hover:underline">
                        {p.clients?.full_name ?? "Unknown"}
                      </Link>
                      <div className="text-xs text-muted-foreground">{p.clients?.email}</div>
                    </td>
                    <td className="px-4 py-2"><Badge variant="outline" className={statusTone(p.payment_status)}>{p.payment_status ?? "—"}</Badge></td>
                    <td className="px-4 py-2"><Badge variant="outline" className={statusTone(p.status)}>{p.status ?? "—"}</Badge></td>
                    <td className="px-4 py-2 text-right">
                      {new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency || "USD" }).format(Number(p.amount_paid ?? 0))}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {p.stripe_customer_id && <a href={stripeCustomerUrl(p.stripe_customer_id, p.stripe_mode)!} target="_blank" rel="noopener noreferrer" title="Customer in Stripe" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /></a>}
                        {p.stripe_payment_intent_id && <a href={stripePaymentIntentUrl(p.stripe_payment_intent_id, p.stripe_mode)!} target="_blank" rel="noopener noreferrer" title="Payment in Stripe" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /></a>}
                        {p.stripe_subscription_id && <a href={stripeSubscriptionUrl(p.stripe_subscription_id, p.stripe_mode)!} target="_blank" rel="noopener noreferrer" title="Subscription in Stripe" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /></a>}
                        {p.stripe_checkout_session_id && <a href={stripeCheckoutSessionUrl(p.stripe_checkout_session_id, p.stripe_mode)!} target="_blank" rel="noopener noreferrer" title="Checkout session in Stripe" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /></a>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">Transactions</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Who</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {txns.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No transactions.</td></tr>
                ) : txns.map((t) => (
                  <tr key={t.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedTxn(t)}>
                    <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(t.occurred_at).toLocaleString()}</td>
                    <td className="px-4 py-2">{t.subject_name} <span className="text-xs text-muted-foreground">{t.subject_email}</span></td>
                    <td className="px-4 py-2 text-right font-medium">{new Intl.NumberFormat(undefined, { style: "currency", currency: t.currency || "USD" }).format(Number(t.amount ?? 0))}</td>
                    <td className="px-4 py-2"><Badge variant="outline" className={statusTone(t.status)}>{t.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <TransactionDetailDrawer txn={selectedTxn} open={!!selectedTxn} onOpenChange={(o) => !o && setSelectedTxn(null)} />
    </>
  );
}