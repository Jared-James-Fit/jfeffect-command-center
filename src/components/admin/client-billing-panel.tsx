import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { buildBillingSummary } from "@/lib/client-billing-summary";
import { ClientBalanceCard } from "@/components/admin/client-balance-card";
import { getClientBillingOverview } from "@/lib/billing.functions";

/**
 * The top of a client's Billing tab: what they owe, in plain words. The sales
 * under it (ClientSalesTable) hold each sale's payments and money actions.
 */
export function ClientBillingPanel({ clientId }: { clientId: string }) {
  const overview = useServerFn(getClientBillingOverview);
  const { data, isLoading } = useQuery({
    queryKey: ["client-billing", clientId],
    queryFn: () => overview({ data: { client_id: clientId } }),
  });

  if (isLoading) return <Card className="p-6 md:col-span-3 text-sm text-muted-foreground">Loading billing…</Card>;
  if (!data?.ok) return <Card className="p-6 md:col-span-3 text-sm text-destructive">Failed to load billing.</Card>;

  const summary = buildBillingSummary({
    sales: data.purchases as any[],
    ledger: data.ledger as any[],
    balance: data.session_balance as any[],
    events: data.session_events as any[],
  });
  return <ClientBalanceCard summary={summary} />;
}
