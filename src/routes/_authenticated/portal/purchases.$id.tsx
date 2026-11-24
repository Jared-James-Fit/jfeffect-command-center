import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { useMyBilling, usePortalClientId } from "@/components/billing/use-my-billing";
import { PurchaseDetailBody, usePurchaseDetail } from "@/components/billing/my-purchase-detail";
import { ErrorState, OfflineState, SlowNote, useQueryView } from "@/components/loading";

export const Route = createFileRoute("/_authenticated/portal/purchases/$id")({ component: ClientPurchase });

function ClientPurchase() {
  const { id } = Route.useParams();
  const portal = usePortalClientId();
  const { clientId } = portal;
  const billing = useMyBilling(clientId);
  const { view, data, refetch, isFetching, today } = billing;
  const { detail, sale, sessionLog } = usePurchaseDetail(view, data, id);
  const billingState = useQueryView(billing).kind;
  // Waiting, offline or failed is never "This purchase isn't on your account".
  const state = portal.state !== "ready" && portal.state !== "empty" ? portal.state : clientId ? billingState : "empty";
  const retry = () => (portal.state === "error" ? portal.retry() : refetch());

  if (state === "loading") {
    return (
      <>
        <PageHeader backTo="/portal/purchases" backLabel="Purchases" title="Purchase" />
        <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-4" aria-busy="true">
          <div className="h-40 jf-skeleton rounded-2xl bg-muted" />
          <div className="h-32 jf-skeleton rounded-2xl bg-muted" />
          <SlowNote active onRetry={retry} what="this purchase" />
        </div>
      </>
    );
  }
  if (state === "offline" || state === "error") {
    return (
      <>
        <PageHeader backTo="/portal/purchases" backLabel="Purchases" title="Purchase" />
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          {state === "offline"
            ? <OfflineState what="this purchase" />
            : <ErrorState error={portal.state === "error" ? portal.error : billing.error} what="this purchase" onRetry={retry} retrying={isFetching} />}
        </div>
      </>
    );
  }
  if (!view || !detail || !sale || !clientId) {
    return (
      <>
        <PageHeader backTo="/portal/purchases" backLabel="Purchases" title="Purchase" />
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          <div className="space-y-2 rounded-2xl border border-border p-5 text-center">
            <p className="text-[14px] text-muted-foreground">This purchase isn't on your account.</p>
            <Button size="sm" variant="outline" className="h-10" asChild><Link to="/portal/purchases">Back to purchases</Link></Button>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader backTo="/portal/purchases" backLabel="Purchases" title={detail.title} subtitle={detail.subtitle ?? undefined} />
      <PurchaseDetailBody id={id} clientId={clientId} view={view} detail={detail} sale={sale} sessionLog={sessionLog} today={today} />
    </>
  );
}
