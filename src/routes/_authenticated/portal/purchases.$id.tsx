import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { useMyBilling, usePortalClientId } from "@/components/billing/use-my-billing";
import { PurchaseDetailBody, usePurchaseDetail } from "@/components/billing/my-purchase-detail";

export const Route = createFileRoute("/_authenticated/portal/purchases/$id")({ component: ClientPurchase });

function ClientPurchase() {
  const { id } = Route.useParams();
  const { clientId, loading: clientLoading } = usePortalClientId();
  const { view, data, isLoading, isError, refetch, isFetching, today } = useMyBilling(clientId);
  const { detail, sale, sessionLog } = usePurchaseDetail(view, data, id);

  if (clientLoading || isLoading) {
    return (
      <>
        <PageHeader backTo="/portal/purchases" backLabel="Purchases" title="Purchase" />
        <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-4" aria-busy="true">
          <div className="h-40 animate-pulse rounded-2xl bg-muted" />
          <div className="h-32 animate-pulse rounded-2xl bg-muted" />
        </div>
      </>
    );
  }
  if (isError || !view || !detail || !sale || !clientId) {
    return (
      <>
        <PageHeader backTo="/portal/purchases" backLabel="Purchases" title="Purchase" />
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          <div className="space-y-2 rounded-2xl border border-border p-5 text-center">
            <p className="text-[14px] text-muted-foreground">{isError ? "This purchase couldn't be loaded." : "This purchase isn't on your account."}</p>
            {isError
              ? <Button size="sm" variant="outline" className="h-10" disabled={isFetching} onClick={() => refetch()}>Try again</Button>
              : <Button size="sm" variant="outline" className="h-10" asChild><Link to="/portal/purchases">Back to purchases</Link></Button>}
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
