import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { isNative } from "@/platform";
import { myBillingKey, useMyBilling, usePortalClientId } from "@/components/billing/use-my-billing";
import { ErrorState, OfflineState, SlowNote, useQueryView } from "@/components/loading";
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
  const portal = usePortalClientId();
  const { clientId } = portal;
  const billing = useMyBilling(clientId);
  const { view, refetch, isFetching, today } = billing;
  const billingState = useQueryView(billing).kind;

  // Back from Stripe Checkout: Stripe tells the app in a few seconds; look again twice, then stop.
  useEffect(() => {
    if (native || search.checkout !== "success") return;
    toast.success("Payment received. It shows here once Stripe confirms it.", { duration: 6000 });
    const timers = [3000, 10000].map((ms) => setTimeout(() => void qc.invalidateQueries({ queryKey: myBillingKey(clientId) }), ms));
    return () => timers.forEach(clearTimeout);
  }, [search.checkout, native, qc, clientId]);

  // Who they are, then their billing: each can be waiting, offline or failed, and none of those is "No purchases yet".
  const state = portal.state !== "ready" && portal.state !== "empty" ? portal.state : clientId ? billingState : "empty";
  const loading = state === "loading";
  const retry = () => (portal.state === "error" ? portal.retry() : refetch());
  return (
    <>
      <PageHeader title="My purchases" />
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-4 md:px-6 md:py-6">
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-36 jf-skeleton rounded-2xl bg-muted" />
            <div className="h-28 jf-skeleton rounded-2xl bg-muted" />
            <div className="h-40 jf-skeleton rounded-2xl bg-muted" />
            <SlowNote active onRetry={retry} what="your purchases" />
          </div>
        ) : state === "offline" ? (
          <OfflineState what="your purchases" />
        ) : state === "error" ? (
          <ErrorState error={portal.state === "error" ? portal.error : billing.error} what="your purchases" onRetry={retry} retrying={isFetching} />
        ) : !view ? (
          <SummaryPanel s={{ outstandingCents: 0, overdueCents: 0, noDatesCents: 0, paidCents: 0, next: null, actions: [], state: "nothing", taxIncluded: false }} money={() => ""} />
        ) : (
          <MyPurchasesBody view={view} today={today} />
        )}
      </div>
    </>
  );
}
