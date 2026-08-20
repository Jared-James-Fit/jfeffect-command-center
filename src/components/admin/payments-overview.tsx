import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { syncStripePayments } from "@/lib/stripe-sync.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingBag,
  Activity,
  Ticket,
  DollarSign,
  ExternalLink,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import type { AdminTransactionRow } from "@/lib/admin-transactions";
import { ledgerStatusTone } from "@/lib/payment-display";
import { countActiveDiscountCodes } from "@/lib/payments-overview";

/**
 * Products & Payments → Overview.
 *
 * Real-data summary only. Sources:
 *  - admin_transactions_v1 (last 30 days) → revenue + recent activity
 *  - coaching_products                    → product counts
 *  - discount_codes                       → active promo count
 *
 * All numbers come from RLS-guarded reads that admins/coaches already use
 * elsewhere in this workspace. No new tables, no fabricated stats. When a
 * source returns nothing, a clean empty state is shown.
 */
export function PaymentsOverviewPanel({
  onNavigateSub,
}: {
  onNavigateSub: (sub: string) => void;
}) {
  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  }, []);

  const txQuery = useQuery({
    queryKey: ["pp-overview-transactions-30d"],
    queryFn: async () => {
      const client = supabase as unknown as { from: (t: string) => any };
      const { data, error } = await client
        .from("admin_transactions_v1")
        .select("*")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as AdminTransactionRow[];
    },
  });

  const productsQuery = useQuery({
    queryKey: ["pp-overview-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coaching_products")
        .select("id,name,status,active,archived,archived_at,price_cents,currency");
      if (error) throw error;
      return data ?? [];
    },
  });

  const discountsQuery = useQuery({
    queryKey: ["pp-overview-discounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("discount_codes")
        .select("id,status");
      if (error) throw error;
      return data ?? [];
    },
  });

  const isLoading = txQuery.isLoading || productsQuery.isLoading || discountsQuery.isLoading;
  const isError = txQuery.isError || productsQuery.isError || discountsQuery.isError;

  const revenue = useMemo(() => {
    const rows = txQuery.data ?? [];
    let paid = 0;
    let refunded = 0;
    let paidCount = 0;
    let currency = "USD";
    for (const r of rows) {
      if (r.voided) continue;
      const s = (r.status ?? "").toLowerCase();
      const t = (r.txn_type ?? "").toLowerCase();
      if (s === "paid") {
        paid += Number(r.amount ?? 0);
        paidCount++;
        if (r.currency) currency = r.currency.toUpperCase();
      }
      if (t === "refund" || t === "partial_refund") refunded += Number(r.amount ?? 0);
    }
    return { paid, refunded, paidCount, currency, rowCount: rows.length };
  }, [txQuery.data]);

  const productStats = useMemo(() => {
    const rows = productsQuery.data ?? [];
    const active = rows.filter(
      (r: any) =>
        (r.status === "Active" || (r.status == null && r.active)) &&
        !r.archived_at &&
        !r.archived
    ).length;
    return { total: rows.length, active };
  }, [productsQuery.data]);

  const discountStats = useMemo(() => {
    const rows = discountsQuery.data ?? [];
    const active = countActiveDiscountCodes(rows);
    return { total: rows.length, active };
  }, [discountsQuery.data]);

  const recent = (txQuery.data ?? []).slice(0, 8);

  const fmtMoney = (n: number, cur = revenue.currency) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(n);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <StripeSyncBar />
      {isError && (
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Couldn't load one of the Overview sources. Try refresh.
          <Button
            size="sm"
            variant="outline"
            className="ml-3"
            onClick={() => {
              txQuery.refetch();
              productsQuery.refetch();
              discountsQuery.refetch();
            }}
          >
            <RefreshCw className="mr-1 h-3 w-3" /> Retry
          </Button>
        </Card>
      )}

      {/* Stat grid — real values only. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Paid · last 30d"
          value={isLoading ? "…" : fmtMoney(revenue.paid)}
          sub={isLoading ? "" : `${revenue.paidCount} charge${revenue.paidCount === 1 ? "" : "s"}`}
          icon={DollarSign}
          onClick={() => onNavigateSub("transactions")}
        />
        <StatCard
          label="Refunded · last 30d"
          value={isLoading ? "…" : fmtMoney(revenue.refunded)}
          tone={revenue.refunded > 0 ? "warn" : undefined}
          icon={Activity}
          onClick={() => onNavigateSub("transactions")}
        />
        <StatCard
          label="Active products"
          value={isLoading ? "…" : String(productStats.active)}
          sub={isLoading ? "" : `${productStats.total} total`}
          icon={ShoppingBag}
          onClick={() => onNavigateSub("products")}
        />
        <StatCard
          label="Active discount codes"
          value={isLoading ? "…" : String(discountStats.active)}
          sub={isLoading ? "" : `${discountStats.total} total`}
          icon={Ticket}
          onClick={() => onNavigateSub("discount-codes")}
        />
      </div>

      {/* Recent activity */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent transactions
          </div>
          <Button size="sm" variant="ghost" onClick={() => onNavigateSub("transactions")}>
            View all <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </div>
        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No transactions in the last 30 days.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Who</th>
                  <th className="px-4 py-2 text-left">Product</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => {
                  const href =
                    r.subject_kind === "client"
                      ? `/admin/clients/${r.subject_id}`
                      : `/admin/members/${r.subject_id}`;
                  return (
                    <tr key={`${r.source}-${r.id}`} className="border-t border-border">
                      <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(r.occurred_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2">
                        {r.subject_id ? (
                          <Link to={href} className="font-medium hover:underline">
                            {r.subject_name ?? "Unknown"}
                          </Link>
                        ) : (
                          <span className="font-medium">{r.subject_name ?? "Unknown"}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">{r.product_name}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap font-medium tabular-nums">
                        {fmtMoney(Number(r.amount ?? 0), (r.currency || "USD").toUpperCase())}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className={ledgerStatusTone(r.status)}>
                          {r.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Jump to shortcuts */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <JumpCard
          title="Manage products"
          desc="Create, edit, and share checkout links for coaching offers."
          icon={ShoppingBag}
          onClick={() => onNavigateSub("products")}
        />
        <JumpCard
          title="Review transactions"
          desc="Full payment history with Stripe deep-links, refunds, and receipts."
          icon={Activity}
          onClick={() => onNavigateSub("transactions")}
        />
        <JumpCard
          title="Discount codes"
          desc="Manage promo codes shared with clients and prospects."
          icon={Ticket}
          onClick={() => onNavigateSub("discount-codes")}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "warn";
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div
        className={`mt-2 text-2xl font-bold tabular-nums ${
          tone === "warn" ? "text-amber-500" : ""
        }`}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-left"
      >
        <Card className="p-4 transition-colors hover:bg-muted/30">{inner}</Card>
      </button>
    );
  }
  return <Card className="p-4">{inner}</Card>;
}

function JumpCard({
  title,
  desc,
  icon: Icon,
  onClick,
}: {
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left"
    >
      <Card className="h-full p-4 transition-colors hover:bg-muted/30">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <div className="font-semibold">{title}</div>
          <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      </Card>
    </button>
  );
}
/**
 * Stripe sync / backfill.
 *
 * Read-only against Stripe: it scans recent Checkout Sessions and updates the
 * matching purchase records and ledger rows in this app. It never charges,
 * refunds, cancels, or edits anything in Stripe.
 */
function StripeSyncBar() {
  const qc = useQueryClient();
  const syncFn = useServerFn(syncStripePayments);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const res: any = await syncFn({ data: { days: 30, mode: "live" } });
      setResult(res);
      if (res?.ok === false) {
        toast.error(res.error ?? "Sync unavailable");
      } else {
        const c = res.counts;
        toast.success(
          `Scanned ${res.scanned} Stripe checkouts — ${c.updated} updated, ${c.no_change} already correct, ${c.unmapped} unmatched.`,
        );
        qc.invalidateQueries({ queryKey: ["pp-overview-transactions-30d"] });
        qc.invalidateQueries({ queryKey: ["admin-transactions"] });
        qc.invalidateQueries({ queryKey: ["purchase-records"] });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Stripe sync failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-semibold">Stripe sync</div>
        <p className="text-xs text-muted-foreground">
          Pulls the last 30 days of Stripe checkouts and repairs any purchase that didn't update.
          Read-only in Stripe — nothing is charged or cancelled.
        </p>
        {result?.ok && (
          <p className="mt-1 text-xs text-muted-foreground">
            Last run: {result.scanned} scanned · {result.counts.updated} updated ·{" "}
            {result.counts.unmapped} unmatched
            {result.counts.unmapped > 0 ? " (needs manual review)" : ""}
          </p>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={run} disabled={busy} className="min-h-11 shrink-0">
        <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Syncing…" : "Sync from Stripe"}
      </Button>
    </Card>
  );
}
