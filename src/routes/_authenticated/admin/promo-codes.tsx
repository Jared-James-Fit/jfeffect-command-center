import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPromoRedemptions } from "@/lib/promo-redemptions.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Ticket, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/promo-codes")({
  component: PromoCodesPage,
});

function fmtDiscount(r: any): string {
  if (r.discount_percent_off != null) return `${r.discount_percent_off}% off`;
  if (r.discount_amount_off != null) {
    const cur = (r.discount_currency ?? "usd").toUpperCase();
    return `${(r.discount_amount_off / 100).toFixed(2)} ${cur} off`;
  }
  if (r.amount_discount_cents != null) return `$${(r.amount_discount_cents / 100).toFixed(2)} off`;
  return "—";
}

function PromoCodesPage() {
  const [search, setSearch] = useState("");
  const fetchList = useServerFn(listPromoRedemptions);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["promo-redemptions", search],
    queryFn: () => fetchList({ data: { search } }),
  });
  const rows = data?.rows ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Ticket className="h-5 w-5" /> Promo Codes
          </h1>
          <p className="text-sm text-muted-foreground">
            Promo codes are created in Stripe. The app accepts any valid code at checkout
            and records every redemption across JF Membership, coaching, and future products.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      <Input
        placeholder="Search code, email, customer ID, or product…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="p-2">Redeemed</th>
              <th className="p-2">Code</th>
              <th className="p-2">Discount</th>
              <th className="p-2">Product</th>
              <th className="p-2">Type</th>
              <th className="p-2">Email</th>
              <th className="p-2">Source</th>
              <th className="p-2">Stripe IDs</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={8}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={8}>No promo redemptions yet.</td></tr>
            ) : rows.map((r: any) => (
              <tr key={r.id} className="border-t align-top">
                <td className="p-2 whitespace-nowrap">{r.redeemed_at ? new Date(r.redeemed_at).toLocaleString() : "—"}</td>
                <td className="p-2 font-mono">{r.promotion_code ?? r.stripe_coupon_id ?? "—"}</td>
                <td className="p-2">{fmtDiscount(r)}{r.discount_duration ? <div className="text-xs text-muted-foreground">{r.discount_duration}</div> : null}</td>
                <td className="p-2">{r.product_name ?? "—"}</td>
                <td className="p-2"><Badge variant="outline">{r.product_type ?? r.checkout_type ?? "—"}</Badge></td>
                <td className="p-2">{r.customer_email ?? "—"}</td>
                <td className="p-2">{r.source ?? "—"}</td>
                <td className="p-2 font-mono text-[11px] text-muted-foreground space-y-0.5">
                  {r.stripe_customer_id && <div>cus: {r.stripe_customer_id}</div>}
                  {r.stripe_subscription_id && <div>sub: {r.stripe_subscription_id}</div>}
                  {r.stripe_payment_intent_id && <div>pi: {r.stripe_payment_intent_id}</div>}
                  {r.stripe_checkout_session_id && <div>cs: {r.stripe_checkout_session_id}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}