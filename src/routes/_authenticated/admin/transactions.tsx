import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
import { ExternalLink, Search, Receipt, FileText, MoreHorizontal } from "lucide-react";
import { TransactionDetailDrawer } from "@/components/payments/transaction-detail-drawer";
import type { AdminTransactionRow } from "@/lib/admin-transactions";
import {
  stripePaymentIntentUrl,
  stripeSubscriptionUrl,
  stripeCheckoutSessionUrl,
  stripeChargeUrl,
  stripeInvoiceUrl,
} from "@/lib/stripe-links";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ledgerStatusTone } from "@/lib/payment-display";
import { listStripeAccountTransactions } from "@/lib/stripe-sync.functions";

export const Route = createFileRoute("/_authenticated/admin/transactions")({
  component: () => <AdminTransactionsPage />,
});

const statusTone = ledgerStatusTone;

function bestStripeUrl(r: AdminTransactionRow): string | null {
  // Prefer the charge_id: it is written by webhook handlers with a unique
  // active index (`payment_ledger_stripe_charge_unique_active`) and always
  // resolves at Stripe's `/payments/{id}` route. PaymentIntent IDs occasionally
  // drift from the real intent (e.g. checkout swap-outs, manual backfills)
  // and can 404 or open the wrong payment in the dashboard. The checkout
  // session and invoice are the next most authoritative fallbacks; PI is
  // last because it is the field most prone to stale/incorrect values.
  const piId = r.stripe_payment_intent_id;
  const isChargeLike = piId && (piId.startsWith("py_") || piId.startsWith("ch_"));
  return (
    stripeChargeUrl(r.stripe_charge_id, r.stripe_mode) ??
    (isChargeLike ? stripeChargeUrl(piId, r.stripe_mode) : null) ??
    stripeInvoiceUrl(r.stripe_invoice_id, r.stripe_mode) ??
    stripeCheckoutSessionUrl(r.stripe_checkout_session_id, r.stripe_mode) ??
    stripePaymentIntentUrl(piId, r.stripe_mode) ??
    stripeSubscriptionUrl(r.stripe_subscription_id, r.stripe_mode)
  );
}

type ActionLink = { label: string; href: string; icon: React.ComponentType<{ className?: string }> };

function actionsFor(r: AdminTransactionRow): ActionLink[] {
  const out: ActionLink[] = [];
  const stripe = bestStripeUrl(r);
  if (stripe) out.push({ label: "Stripe", href: stripe, icon: ExternalLink });
  if (r.invoice_pdf_url) out.push({ label: "Invoice PDF", href: r.invoice_pdf_url, icon: FileText });
  if (r.receipt_url) out.push({ label: "Receipt", href: r.receipt_url, icon: Receipt });
  return out;
}

function ActionsCell({ r }: { r: AdminTransactionRow }) {
  const actions = actionsFor(r);
  if (actions.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:flex flex-wrap items-center gap-1">
        {actions.slice(0, 3).map((a) => {
          const Icon = a.icon;
          return (
            <Button
              key={a.label}
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                window.open(a.href, "_blank", "noopener,noreferrer");
              }}
            >
              <Icon className="h-3 w-3" />
              {a.label}
            </Button>
          );
        })}
      </div>
      {/* Mobile */}
      <div className="md:hidden">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3 w-3" /> Actions
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-1" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col">
              {actions.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.label}
                    type="button"
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(a.href, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {a.label}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}

const RANGE_LABEL: Record<string, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  "365": "Last year",
  "all": "All time",
};

export function AdminTransactionsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [subjectKind, setSubjectKind] = useState<string>("all");
  const [days, setDays] = useState<string>("90");
  const [selected, setSelected] = useState<AdminTransactionRow | null>(null);

  const stripeAccountFn = useServerFn(listStripeAccountTransactions);
  const {
    data: stripeAccount,
    isLoading,
    isError: stripeLoadError,
  } = useQuery({
    queryKey: ["admin-transactions-stripe-account", days],
    queryFn: async () => {
      const res: any = await stripeAccountFn({
        data: { days: days === "all" ? 3650 : Number(days), mode: "live" },
      });
      if (!res?.ok) throw new Error(res?.error ?? "Unable to read Stripe account transactions.");
      return res;
    },
    staleTime: 30_000,
  });
  const stripeRows = (stripeAccount?.rows ?? []) as AdminTransactionRow[];

  // Awaiting-checkout purchases have no ledger row yet, but admins need to see
  // that a payment request is outstanding. Merge them in as synthetic rows.
  const { data: pendingRows = [] } = useQuery({
    queryKey: ["admin-transactions-pending"],
    queryFn: async () => {
      const client = supabase as unknown as { from: (t: string) => any };
      const { data, error } = await client
        .from("purchase_records")
        .select("*, clients:client_id(id, full_name, email)")
        .in("payment_status", ["Pending Payment", "Payment Link Sent", "Pending"])
        .order("purchased_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((r: any): AdminTransactionRow => ({
        id: `pending:${r.id}`,
        source: "client",
        occurred_on: String(r.purchased_at ?? r.created_at ?? "").slice(0, 10),
        occurred_at: r.purchased_at ?? r.created_at ?? new Date().toISOString(),
        subject_id: r.client_id ?? null,
        subject_kind: "client",
        subject_name: r.clients?.full_name ?? null,
        subject_email: r.clients?.email ?? null,
        purchase_id: r.id,
        offer_id: r.offer_id ?? null,
        product_name: r.offer_name ?? r.product_name ?? "Purchase",
        purchase_type: r.offer_type ?? null,
        amount: Number(r.full_payable_amount ?? r.price ?? 0),
        currency: r.currency ?? "USD",
        txn_type: "payment_request",
        method: "stripe",
        status: "Pending Payment",
        stripe_customer_id: r.stripe_customer_id ?? null,
        stripe_payment_intent_id: null,
        stripe_charge_id: null,
        stripe_invoice_id: null,
        stripe_checkout_session_id: r.stripe_checkout_session_id ?? null,
        stripe_subscription_id: r.stripe_subscription_id ?? null,
        stripe_product_id: null,
        stripe_price_id: r.stripe_price_id ?? null,
        receipt_url: null,
        hosted_invoice_url: null,
        invoice_pdf_url: null,
        stripe_mode: r.stripe_mode ?? null,
        admin_notes: r.admin_notes ?? null,
        voided: false,
      }));
    },
  });

  const data = useMemo(
    () =>
      [...pendingRows, ...stripeRows].sort((a, b) =>
        String(b.occurred_at).localeCompare(String(a.occurred_at)),
      ),
    [pendingRows, stripeRows],
  );

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
    let stripeOnly = 0;
    const currencies = new Set<string>();
    for (const r of filtered) {
      if (r.voided) continue;
      count++;
      const st = (r.status ?? "").toLowerCase();
      const type = (r.txn_type ?? "").toLowerCase();
      if (r.currency) currencies.add(String(r.currency).toUpperCase());
      if (st === "paid") paid += Number(r.amount ?? 0);
      if (type === "refund" || type === "partial_refund") refunded += Number(r.amount ?? 0);
      if (r.source === "stripe") stripeOnly++;
    }
    const currency = currencies.size === 1 ? Array.from(currencies)[0] : "CAD";
    return { paid, refunded, count, stripeOnly, currency };
  }, [filtered]);

  const fmtTotal = (amount: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: totals.currency }).format(amount);

  return (
    <>
      {!embedded && (
        <PageHeader
          title="Transactions"
          subtitle="Live Stripe account activity, enriched with JF Effect client and product links when available."
        />
      )}
      <div className={embedded ? "p-4 md:p-6 space-y-6" : "p-6 md:p-8 space-y-6"}>
        {/* Totals */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Rows</div>
            <div className="mt-1 text-2xl font-semibold">{totals.count.toLocaleString()}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Paid · {RANGE_LABEL[days] ?? ""}</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-500">{fmtTotal(totals.paid)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Refunded</div>
            <div className="mt-1 text-2xl font-semibold text-amber-500">{fmtTotal(totals.refunded)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Stripe-only</div>
            <div className="mt-1 text-2xl font-semibold text-primary">{totals.stripeOnly.toLocaleString()}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Not linked to an app purchase</div>
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
                <SelectItem value="stripe">Stripe-only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={subjectKind} onValueChange={setSubjectKind}>
              <SelectTrigger><SelectValue placeholder="Account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                <SelectItem value="client">Clients</SelectItem>
                <SelectItem value="member">Members</SelectItem>
                <SelectItem value="stripe">Stripe customers</SelectItem>
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

        {stripeLoadError && (
          <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Stripe could not be loaded right now. Refresh this page to retry.
          </Card>
        )}

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
                  <th className="px-4 py-2 text-left">Actions</th>
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
                      r.subject_id && r.subject_kind === "client"
                        ? `/admin/clients/${r.subject_id}`
                        : r.subject_id && r.subject_kind === "member"
                          ? `/admin/members/${r.subject_id}`
                          : null;
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
                          {profileHref ? (
                            <Link
                              to={profileHref}
                              className="font-medium hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {r.subject_name ?? "Unknown"}
                            </Link>
                          ) : (
                            <span className="font-medium">{r.subject_name ?? "Stripe customer"}</span>
                          )}
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
                          <ActionsCell r={r} />
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
          Showing {filtered.length.toLocaleString()} of {data.length.toLocaleString()} rows from the live Stripe account plus pending JF Effect payment requests. Stripe-only rows stay visible even when they are not linked to a client purchase.
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