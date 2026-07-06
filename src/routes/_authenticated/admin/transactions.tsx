import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExternalLink, Search, Receipt } from "lucide-react";
import { TransactionDetailDrawer } from "@/components/payments/transaction-detail-drawer";
import type { AdminTransactionRow } from "@/lib/admin-transactions";
import {
  stripeCustomerUrl,
  stripePaymentIntentUrl,
  stripeSubscriptionUrl,
  stripeCheckoutSessionUrl,
} from "@/lib/stripe-links";

export const Route = createFileRoute("/_authenticated/admin/transactions")({
  component: AdminTransactionsPage,
});

function statusTone(status?: string | null) {
  const s = (status ?? "").toLowerCase();
  if (s === "paid") return "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
  if (s === "refunded" || s === "voided") return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  if (s === "failed") return "bg-red-500/15 text-red-500 border-red-500/30";
  if (s === "pending") return "bg-blue-500/15 text-blue-500 border-blue-500/30";
  return "bg-muted text-muted-foreground border-border";
}

function StripeIcon({ href, title }: { href: string | null; title: string }) {
  if (!href) return null;
  return (
    <button
      type="button"
      title={`Open ${title} in Stripe`}
      onClick={(e) => {
        e.stopPropagation();
        window.open(href, "_blank", "noopener,noreferrer");
      }}
      className="text-muted-foreground hover:text-foreground"
    >
      <ExternalLink className="h-3.5 w-3.5" />
    </button>
  );
}

function AdminTransactionsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [subjectKind, setSubjectKind] = useState<string>("all");
  const [days, setDays] = useState<string>("90");
  const [selected, setSelected] = useState<AdminTransactionRow | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-transactions", days],
    queryFn: async () => {
      // Query the unified view. It's not in the generated types, so cast.
      const client = supabase as unknown as {
        from: (t: string) => any;
      };
      let q = client
        .from("admin_transactions_v1")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(1000);
      if (days !== "all") {
        const since = new Date();
        since.setDate(since.getDate() - Number(days));
        q = q.gte("occurred_at", since.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AdminTransactionRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((r) => {
      if (status !== "all" && (r.status ?? "").toLowerCase() !== status) return false;
      if (source !== "all" && r.source !== source) return false;
      if (subjectKind !== "all" && r.subject_kind !== subjectKind) return false;
      if (!q) return true;
      return (
        (r.subject_name ?? "").toLowerCase().includes(q) ||
        (r.subject_email ?? "").toLowerCase().includes(q) ||
        (r.product_name ?? "").toLowerCase().includes(q) ||
        (r.stripe_customer_id ?? "").toLowerCase().includes(q) ||
        (r.stripe_payment_intent_id ?? "").toLowerCase().includes(q) ||
        (r.stripe_checkout_session_id ?? "").toLowerCase().includes(q) ||
        (r.stripe_subscription_id ?? "").toLowerCase().includes(q) ||
        (r.stripe_invoice_id ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search, status, source, subjectKind]);

  const totals = useMemo(() => {
    let paid = 0;
    let refunded = 0;
    let count = 0;
    for (const r of filtered) {
      count++;
      const s = (r.status ?? "").toLowerCase();
      if (s === "paid") paid += Number(r.amount ?? 0);
      if (s === "refunded" || s === "voided") refunded += Number(r.amount ?? 0);
    }
    return { paid, refunded, count };
  }, [filtered]);

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Every payment across client purchases and memberships, with direct Stripe deep-links."
      />
      <div className="p-6 md:p-8 space-y-6">
        {/* Totals */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Rows</div>
            <div className="mt-1 text-2xl font-semibold">{totals.count.toLocaleString()}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Paid</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-500">
              {new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(totals.paid)}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Refunded / Voided</div>
            <div className="mt-1 text-2xl font-semibold text-amber-500">
              {new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(totals.refunded)}
            </div>
          </Card>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, product, or Stripe ID"
                className="pl-8"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
                <SelectItem value="voided">Voided</SelectItem>
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="client">Client purchases</SelectItem>
                <SelectItem value="membership">Memberships</SelectItem>
              </SelectContent>
            </Select>
            <Select value={subjectKind} onValueChange={setSubjectKind}>
              <SelectTrigger><SelectValue placeholder="Account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                <SelectItem value="client">Clients</SelectItem>
                <SelectItem value="member">Members</SelectItem>
              </SelectContent>
            </Select>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger><SelectValue placeholder="Range" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Table */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Who</th>
                  <th className="px-4 py-2 text-left">Product / Plan</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Stripe</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No transactions match your filters.</td></tr>
                ) : (
                  filtered.map((r) => {
                    const profileHref =
                      r.subject_kind === "client"
                        ? `/admin/clients/${r.subject_id}`
                        : `/admin/members/${r.subject_id}`;
                    return (
                      <tr
                        key={`${r.source}-${r.id}`}
                        className="border-t border-border hover:bg-muted/30 cursor-pointer"
                        onClick={() => setSelected(r)}
                      >
                        <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(r.occurred_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2">
                          <Link
                            to={profileHref}
                            className="font-medium hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.subject_name ?? "Unknown"}
                          </Link>
                          <div className="text-xs text-muted-foreground">{r.subject_email}</div>
                        </td>
                        <td className="px-4 py-2">
                          {r.offer_id ? (
                            <Link
                              to="/admin/products-history/$offerId"
                              params={{ offerId: r.offer_id }}
                              onClick={(e) => e.stopPropagation()}
                              className="hover:underline"
                            >
                              {r.product_name}
                            </Link>
                          ) : (
                            <span>{r.product_name}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs capitalize text-muted-foreground">
                          {r.purchase_type ?? r.source}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap font-medium">
                          {new Intl.NumberFormat(undefined, {
                            style: "currency",
                            currency: r.currency || "USD",
                          }).format(Number(r.amount ?? 0))}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className={statusTone(r.status)}>{r.status}</Badge>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <StripeIcon href={stripeCustomerUrl(r.stripe_customer_id, r.stripe_mode)} title="customer" />
                            <StripeIcon href={stripePaymentIntentUrl(r.stripe_payment_intent_id, r.stripe_mode)} title="payment" />
                            <StripeIcon href={stripeCheckoutSessionUrl(r.stripe_checkout_session_id, r.stripe_mode)} title="checkout session" />
                            <StripeIcon href={stripeSubscriptionUrl(r.stripe_subscription_id, r.stripe_mode)} title="subscription" />
                            {r.receipt_url && (
                              <button
                                type="button"
                                title="Open receipt"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(r.receipt_url!, "_blank", "noopener,noreferrer");
                                }}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <Receipt className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="text-xs text-muted-foreground">
          Showing {filtered.length.toLocaleString()} of {data.length.toLocaleString()} rows. Click any row for details and full Stripe deep-links.
        </div>
      </div>

      <TransactionDetailDrawer
        txn={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </>
  );
}