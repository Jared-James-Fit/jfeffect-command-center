import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Receipt } from "lucide-react";
import { toast } from "sonner";
import { isNative } from "@/platform";
import { resolvePaymentDisplay, formatMoney } from "@/lib/payment-display";

export const Route = createFileRoute("/_authenticated/portal/purchases")({
  component: MyPurchases,
  validateSearch: (s: Record<string, unknown>) => ({
    checkout: s.checkout as string | undefined,
  }),
});

function MyPurchases() {
  const portalUserId = usePortalUserId();
  const search = useSearch({ from: "/_authenticated/portal/purchases" });
  const native = isNative();

  // Show success toast when returning from Stripe Checkout (web only)
  useEffect(() => {
    if (!native && search.checkout === "success") {
      toast.success("Payment successful! Your access has been updated.", { duration: 6000 });
    }
  }, [search.checkout, native]);

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

  // Pull latest non-voided ledger row per purchase — used for receipt/method.
  const { data: ledgerByPurchase = {} } = useQuery({
    queryKey: ["my-purchases-ledger", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("payment_ledger")
        .select("purchase_id, method, receipt_url, hosted_invoice_url, invoice_pdf_url, transaction_date, voided")
        .eq("client_id", client!.id)
        .eq("voided", false)
        .order("transaction_date", { ascending: false });
      const map: Record<string, any> = {};
      for (const row of data ?? []) {
        if (row.purchase_id && !map[row.purchase_id]) map[row.purchase_id] = row;
      }
      return map;
    },
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
              {records.map((r: any) => {
                const d = resolvePaymentDisplay({ ...r, latest_ledger: ledgerByPurchase[r.id] ?? null });
                return (
                  <Link key={r.id} to="/portal/purchases/$id" params={{ id: r.id }}>
                    <Card className="border-border bg-card p-4 hover:bg-secondary/30 transition">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold truncate">{d.productName}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.offer_type ? `${r.offer_type} · ` : ""}
                            {new Date(r.purchased_at).toLocaleDateString()}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            <span>
                              <span className="text-muted-foreground">Paid:</span>{" "}
                              <span className="font-semibold">{formatMoney(d.amountPaid, d.currency)}</span>
                            </span>
                            {d.amountOutstanding > 0 && (
                              <span>
                                <span className="text-muted-foreground">Outstanding:</span>{" "}
                                <span className="font-semibold text-destructive">{formatMoney(d.amountOutstanding, d.currency)}</span>
                              </span>
                            )}
                            {d.nextBillingDate && (
                              <span>
                                <span className="text-muted-foreground">Next payment:</span>{" "}
                                <span className="font-semibold">{new Date(d.nextBillingDate).toLocaleDateString()}</span>
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {!r.terms_accepted && <Badge className="bg-gradient-primary">Action needed</Badge>}
                          <Badge variant="outline" className={d.statusTone}>{d.statusLabel}</Badge>
                          {d.receiptUrl && (
                            <a
                              href={d.receiptUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                            >
                              <Receipt className="h-3 w-3" /> Receipt
                            </a>
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

