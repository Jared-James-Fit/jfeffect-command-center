import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPromoRedemptions, backfillPromoFromSession } from "@/lib/promo-redemptions.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Ticket, RefreshCw, Download, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

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

function toCsv(rows: any[]): string {
  const cols = [
    "redeemed_at","promotion_code","stripe_promotion_code_id","stripe_coupon_id",
    "discount_percent_off","discount_amount_off","discount_currency","discount_duration",
    "amount_discount_cents","product_type","product_name","customer_email",
    "stripe_customer_id","stripe_subscription_id","stripe_payment_intent_id","stripe_checkout_session_id",
  ];
  const esc = (v: any) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function PromoCodesPage() {
  const [code, setCode] = useState("");
  const [productType, setProductType] = useState<string>("__all");
  const [email, setEmail] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [backfillId, setBackfillId] = useState("");
  const fetchList = useServerFn(listPromoRedemptions);
  const backfillFn = useServerFn(backfillPromoFromSession);
  const filters = useMemo(
    () => ({
      code: code || undefined,
      productType: productType === "__all" ? undefined : productType,
      email: email || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to + "T23:59:59").toISOString() : undefined,
    }),
    [code, productType, email, from, to],
  );
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["promo-redemptions", filters],
    queryFn: () => fetchList({ data: filters }),
  });
  const rows: any[] = data?.rows ?? [];

  const exportCsv = () => {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `promo-redemptions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runBackfill = async (sessionId: string) => {
    if (!sessionId.trim()) return;
    try {
      const res: any = await backfillFn({ data: { sessionId: sessionId.trim() } });
      if (!res?.ok) {
        toast.error(`Backfill failed: ${res?.error ?? "unknown"}`);
        return;
      }
      const r = res.row ?? {};
      toast.success(
        res.stripe_attached_discount
          ? `Backfilled (${res.status}): ${r.promotion_code ?? r.stripe_promotion_code_id ?? "code"} · ${r.discount_percent_off ?? "?"}% off`
          : `Session has no Stripe discount attached (${res.status})`,
      );
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Backfill failed");
    }
  };

  const clearFilters = () => {
    setCode(""); setProductType("__all"); setEmail(""); setFrom(""); setTo("");
  };

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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-3 w-3 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>
      <Card className="p-3 space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <Input placeholder="Promo code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Select value={productType} onValueChange={setProductType}>
            <SelectTrigger><SelectValue placeholder="Product type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All product types</SelectItem>
              <SelectItem value="jf_membership">JF Membership</SelectItem>
              <SelectItem value="coaching">Coaching</SelectItem>
              <SelectItem value="subscription">Subscription</SelectItem>
              <SelectItem value="one_time">One-time</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Customer email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From date" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To date" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
          <div className="text-xs text-muted-foreground">{rows.length} row(s)</div>
        </div>
      </Card>
      <Card className="p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Backfill from Stripe Checkout Session
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="cs_live_… or cs_test_…"
            value={backfillId}
            onChange={(e) => setBackfillId(e.target.value)}
            className="font-mono"
          />
          <Button onClick={() => runBackfill(backfillId)} disabled={!backfillId.trim()}>
            <RotateCw className="h-3 w-3 mr-1" /> Backfill
          </Button>
        </div>
      </Card>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="p-2">Redeemed</th>
              <th className="p-2">Code</th>
              <th className="p-2">Coupon</th>
              <th className="p-2">Discount</th>
              <th className="p-2">Amount discounted</th>
              <th className="p-2">Product</th>
              <th className="p-2">Type</th>
              <th className="p-2">Email</th>
              <th className="p-2">Stripe IDs</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={10}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={10}>No promo redemptions match these filters.</td></tr>
            ) : rows.map((r: any) => {
              const hasAnyDiscountSignal = Boolean(
                r.promotion_code || r.stripe_promotion_code_id || r.stripe_coupon_id ||
                r.discount_percent_off || r.discount_amount_off || r.amount_discount_cents,
              );
              const hasResolvedCode = Boolean(r.promotion_code);
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-2 whitespace-nowrap">{r.redeemed_at ? new Date(r.redeemed_at).toLocaleString() : "—"}</td>
                  <td className="p-2">
                    {hasResolvedCode ? (
                      <span className="font-mono">{r.promotion_code}</span>
                    ) : r.stripe_promotion_code_id ? (
                      <span className="font-mono text-xs text-muted-foreground" title="Promotion code id only — text not captured">
                        {r.stripe_promotion_code_id}
                      </span>
                    ) : hasAnyDiscountSignal ? (
                      <Badge variant="outline" className="text-amber-600">No promotion code</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">No discount captured</Badge>
                    )}
                  </td>
                  <td className="p-2 font-mono text-xs text-muted-foreground">{r.stripe_coupon_id ?? "—"}</td>
                  <td className="p-2">
                    {fmtDiscount(r)}
                    {r.discount_duration ? <div className="text-xs text-muted-foreground">{r.discount_duration}</div> : null}
                  </td>
                  <td className="p-2 tabular-nums">
                    {r.amount_discount_cents != null
                      ? `$${(r.amount_discount_cents / 100).toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="p-2">{r.product_name ?? "—"}</td>
                  <td className="p-2"><Badge variant="outline">{r.product_type ?? r.checkout_type ?? "—"}</Badge></td>
                  <td className="p-2">{r.customer_email ?? "—"}</td>
                  <td className="p-2 font-mono text-[11px] text-muted-foreground space-y-0.5">
                    {r.stripe_customer_id && <div>cus: {r.stripe_customer_id}</div>}
                    {r.stripe_subscription_id && <div>sub: {r.stripe_subscription_id}</div>}
                    {r.stripe_payment_intent_id && <div>pi: {r.stripe_payment_intent_id}</div>}
                    {r.stripe_checkout_session_id && <div>cs: {r.stripe_checkout_session_id}</div>}
                  </td>
                  <td className="p-2">
                    {r.stripe_checkout_session_id && (
                      <Button size="sm" variant="ghost" title="Re-fetch from Stripe" onClick={() => runBackfill(r.stripe_checkout_session_id)}>
                        <RotateCw className="h-3 w-3" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}