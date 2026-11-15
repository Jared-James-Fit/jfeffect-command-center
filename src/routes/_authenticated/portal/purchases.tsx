import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { isNative } from "@/platform";
import { myBillingKey, useMyBilling, usePortalClientId } from "@/components/billing/use-my-billing";
import { MyPurchasesBody, SummaryPanel } from "@/components/billing/my-purchases-view";

export const Route = createFileRoute("/_authenticated/portal/purchases")({
  component: MyPurchases,
  validateSearch: (s: Record<string, unknown>): { checkout?: string } => ({
    checkout: s.checkout as string | undefined,
  }),
});

/**
 * My Purchases: what they're on, what they owe and when, what they've paid
 * with every receipt, and what they bought before. One read for all of it
 * (useMyBilling), the same numbers as the coach's Billing tab, and only what
 * applies to this client: no sessions section without a package, no "next
 * charge" without one, no "Action needed" without something to do.
 */
function MyPurchases() {
  const search = useSearch({ from: "/_authenticated/portal/purchases" });
  const native = isNative();
  const qc = useQueryClient();
  const { clientId, loading: clientLoading } = usePortalClientId();
  const { view, isLoading, isError, refetch, isFetching, today } = useMyBilling(clientId);

  // Back from Stripe Checkout: Stripe tells the app in a few seconds; look again twice, then stop.
  useEffect(() => {
    if (native || search.checkout !== "success") return;
    toast.success("Payment received. It shows here once Stripe confirms it.", { duration: 6000 });
    const timers = [3000, 10000].map((ms) => setTimeout(() => void qc.invalidateQueries({ queryKey: myBillingKey(clientId) }), ms));
    return () => timers.forEach(clearTimeout);
  }, [search.checkout, native, qc, clientId]);

  const loading = clientLoading || (!!clientId && isLoading);
  return (
    <>
      <PageHeader title="My purchases" />
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-4 md:px-6 md:py-6">
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-36 animate-pulse rounded-2xl bg-muted" />
            <div className="h-28 animate-pulse rounded-2xl bg-muted" />
            <div className="h-40 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : isError ? (
          <div className="space-y-2 rounded-2xl border border-border p-5 text-center">
            <p className="text-[14px] text-muted-foreground">Your purchases couldn't be loaded.</p>
            <Button size="sm" variant="outline" className="h-10" disabled={isFetching} onClick={() => refetch()}>Try again</Button>
          </div>
        ) : !view ? (
          <SummaryPanel s={{ outstandingCents: 0, overdueCents: 0, noDatesCents: 0, paidCents: 0, next: null, actions: [], state: "nothing", taxIncluded: false }} money={() => ""} />
        ) : (
          <MyPurchasesBody view={view} today={today} />
        )}
      </div>
    </>
  );
}
